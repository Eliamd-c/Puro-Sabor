(function () {
  'use strict';

  const TOKEN_KEY = 'puro_sabor_auxiliar_token';
  const USER_KEY  = 'puro_sabor_auxiliar_user';
  const SOUND_KEY = 'puro_sabor_cocina_sound';
  const API = {
    login:   '/api/admin/auxiliar/login',
    pedidos: '/api/pedidos',
    estado:  (id) => `/api/pedidos/${id}/estado`
  };

  let token   = localStorage.getItem(TOKEN_KEY) || null;
  let pedidos = [];
  let socket  = null;
  let timerInterval = null;
  let pollInterval  = null;
  let soundOn = localStorage.getItem(SOUND_KEY) !== '0';
  let knownIds = new Set();

  // ── DOM ──
  const loginScreen = document.getElementById('login-screen');
  const kdsApp      = document.getElementById('kds-app');
  const loginForm   = document.getElementById('login-form');
  const loginError  = document.getElementById('login-error');
  const inputUser   = document.getElementById('input-usuario');
  const inputPass   = document.getElementById('input-password');
  const btnIngresar = document.getElementById('btn-ingresar');
  const connDot     = document.getElementById('conn-dot');
  const btnSound    = document.getElementById('btn-sound');

  // ── AUTH ──
  function authH() { return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }; }

  function showLogin() {
    loginScreen.style.display = 'flex';
    kdsApp.style.display = 'none';
    if (socket) { socket.disconnect(); socket = null; }
    if (timerInterval) clearInterval(timerInterval);
    if (pollInterval) clearInterval(pollInterval);
  }

  function showApp() {
    loginScreen.style.display = 'none';
    kdsApp.style.display = 'flex';
    updateSoundBtn();
    loadPedidos();
    connectSocket();
    timerInterval = setInterval(updateTimers, 1000);
    pollInterval = setInterval(loadPedidos, 30000); // respaldo si el socket falla
  }

  function handleUnauthorized() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    token = null;
    showLogin();
    loginError.textContent = 'Sesión expirada, vuelve a entrar.';
    loginError.style.display = 'block';
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.style.display = 'none';
    btnIngresar.disabled = true;
    btnIngresar.textContent = 'Verificando…';
    try {
      const res = await fetch(API.login, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: inputUser.value.trim(), password: inputPass.value })
      });
      const data = await res.json();
      if (data.success) {
        token = data.token;
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        showApp();
      } else {
        loginError.textContent = data.message || data.error || 'Credenciales incorrectas';
        loginError.style.display = 'block';
      }
    } catch {
      loginError.textContent = 'Error de conexión, intenta de nuevo';
      loginError.style.display = 'block';
    } finally {
      btnIngresar.disabled = false;
      btnIngresar.textContent = 'Entrar a Cocina';
    }
  });

  document.getElementById('btn-logout').addEventListener('click', () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    token = null;
    showLogin();
  });

  document.getElementById('btn-refresh').addEventListener('click', loadPedidos);

  // ── SONIDO ──
  btnSound.addEventListener('click', () => {
    soundOn = !soundOn;
    localStorage.setItem(SOUND_KEY, soundOn ? '1' : '0');
    updateSoundBtn();
    if (soundOn) beep();
  });
  function updateSoundBtn() {
    btnSound.classList.toggle('muted', !soundOn);
    btnSound.textContent = soundOn ? '🔔' : '🔕';
  }
  function beep() {
    if (!soundOn) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'sine'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      o.start(); o.stop(ctx.currentTime + 0.5);
    } catch (_) {}
  }

  // ── DATA ──
  async function loadPedidos() {
    if (!token) return;
    try {
      const res = await fetch(API.pedidos, { headers: authH() });
      if (res.status === 401) { handleUnauthorized(); return; }
      const data = await res.json();
      if (data.success) {
        pedidos = (data.data || []).filter(p => ['pendiente', 'preparando', 'listo'].includes(p.estado));
        render();
      }
    } catch (e) { console.warn('loadPedidos:', e.message); }
  }

  async function updateEstado(id, nuevoEstado) {
    try {
      const res = await fetch(API.estado(id), {
        method: 'PUT',
        headers: authH(),
        body: JSON.stringify({ estado: nuevoEstado })
      });
      if (res.status === 401) { handleUnauthorized(); return; }
      const data = await res.json();
      if (data.success) loadPedidos();
    } catch (e) { console.warn('updateEstado:', e.message); }
  }

  // ── SOCKET ──
  function connectSocket() {
    socket = io({ transports: ['websocket', 'polling'] });
    socket.on('connect', () => { socket.emit('unirse_admin'); connDot.className = 'conn-dot online'; });
    socket.on('disconnect', () => { connDot.className = 'conn-dot offline'; });
    socket.on('nuevo_pedido', () => { beep(); loadPedidos(); });
    socket.on('pedido_estado_actualizado', loadPedidos);
    socket.on('pedido_actualizado', loadPedidos);
    socket.on('pedido_eliminado', loadPedidos);
    socket.on('reconnect', () => { socket.emit('unirse_admin'); loadPedidos(); });
  }

  // ── RENDER ──
  const TIPO_LABEL = { local: 'LOCAL', domicilio: 'DOMICILIO', recogen: 'RECOGE' };

  function render() {
    const cols = { pendiente: [], preparando: [], listo: [] };
    pedidos.forEach(p => { if (cols[p.estado]) cols[p.estado].push(p); });

    // beep si hay un pendiente nuevo que no conocíamos
    const currentIds = new Set(pedidos.map(p => p.id));
    let hayNuevo = false;
    cols.pendiente.forEach(p => { if (!knownIds.has(p.id)) hayNuevo = true; });
    if (hayNuevo && knownIds.size > 0) beep();
    knownIds = currentIds;

    ['pendiente', 'preparando', 'listo'].forEach(estado => {
      const cont = document.getElementById('col-' + estado);
      const count = document.getElementById('count-' + estado);
      count.textContent = cols[estado].length;
      if (cols[estado].length === 0) {
        cont.innerHTML = '<div class="kds-empty">Sin pedidos</div>';
        return;
      }
      cont.innerHTML = cols[estado].map(p => cardHTML(p)).join('');
    });
  }

  function cardHTML(p) {
    const tipo = p.tipo_pedido || 'local';
    const items = (p.items || []).map(i =>
      `<li><span class="kds-item-qty">${i.cantidad}×</span><span>${esc(i.nombre)}</span></li>`
    ).join('');
    const lugar = p.mesa_numero > 0 ? `Mesa ${p.mesa_numero}` : (TIPO_LABEL[tipo] || 'Para llevar');
    const cliente = p.nombre_cliente ? `<strong>${esc(p.nombre_cliente)}</strong> · ` : '';

    let btn = '';
    if (p.estado === 'pendiente')      btn = `<button class="kds-btn-advance to-preparando" onclick="window.kds.avanzar(${p.id},'preparando')">▶ Empezar</button>`;
    else if (p.estado === 'preparando') btn = `<button class="kds-btn-advance to-listo" onclick="window.kds.avanzar(${p.id},'listo')">✓ Listo</button>`;
    else if (p.estado === 'listo')      btn = `<button class="kds-btn-advance to-entregado" onclick="window.kds.avanzar(${p.id},'entregado')">✓ Entregado</button>`;

    return `
      <div class="kds-card tipo-${tipo}" data-id="${p.id}">
        <div class="kds-card-top">
          <span class="kds-card-id">#${p.id}</span>
          <span class="kds-card-tipo">${TIPO_LABEL[tipo] || tipo}</span>
          <span class="kds-timer" data-created="${p.creado_en}">--:--</span>
        </div>
        <div class="kds-card-meta">${cliente}${esc(lugar)}</div>
        <ul class="kds-items">${items}</ul>
        ${p.notas ? `<div class="kds-notas">📝 ${esc(p.notas)}</div>` : ''}
        <div class="kds-card-actions">
          ${btn}
          <button class="kds-btn-print" onclick="window.kds.imprimir(${p.id})" title="Imprimir comanda">🖨</button>
        </div>
      </div>`;
  }

  // ── TIMERS (cuenta regresiva 20 min) ──
  function updateTimers() {
    const LIMIT = 20 * 60 * 1000;
    document.querySelectorAll('.kds-timer').forEach(el => {
      const created = el.dataset.created;
      if (!created) return;
      const ms = new Date(created).getTime();
      if (isNaN(ms)) return;
      const elapsed = Date.now() - ms;
      if (elapsed < LIMIT) {
        const rem = LIMIT - elapsed;
        const m = Math.floor(rem / 60000), s = Math.floor((rem % 60000) / 1000);
        el.textContent = `${pad(m)}:${pad(s)}`;
        el.className = 'kds-timer ' + (rem < 5 * 60 * 1000 ? 'warn' : 'ok');
      } else {
        const over = elapsed - LIMIT;
        const m = Math.floor(over / 60000), s = Math.floor((over % 60000) / 1000);
        el.textContent = `+${pad(m)}:${pad(s)}`;
        el.className = 'kds-timer overdue';
      }
    });
  }

  // ── IMPRESIÓN ──
  function imprimir(id) {
    const p = pedidos.find(x => x.id === id);
    if (!p) return;
    const tipo = p.tipo_pedido || 'local';
    const lugar = p.mesa_numero > 0 ? `Mesa ${p.mesa_numero}` : (TIPO_LABEL[tipo] || 'Para llevar');
    const fecha = new Date(p.creado_en || Date.now()).toLocaleString('es-CO');
    const items = (p.items || []).map(i => `<div class="ticket-item">${i.cantidad} x ${esc(i.nombre)}</div>`).join('');
    document.getElementById('print-area').innerHTML = `
      <div class="ticket-h1">PURO SABOR — COCINA</div>
      <div class="ticket-meta">Pedido #${p.id}</div>
      <div class="ticket-meta">${esc(lugar)}${p.nombre_cliente ? ' · ' + esc(p.nombre_cliente) : ''}</div>
      <div class="ticket-meta">${fecha}</div>
      <div class="ticket-line"></div>
      ${items}
      ${p.notas ? `<div class="ticket-line"></div><div class="ticket-notas">NOTA: ${esc(p.notas)}</div>` : ''}
      <div class="ticket-line"></div>
    `;
    window.print();
  }

  // ── HELPERS ──
  function pad(n) { return String(n).padStart(2, '0'); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

  // API pública para los onclick inline
  window.kds = { avanzar: updateEstado, imprimir };

  // ── INIT ──
  if (token) showApp(); else showLogin();
})();
