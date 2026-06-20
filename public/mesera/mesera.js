/* ================================================================
   PURO SABOR — MESERA POS — JavaScript
   Features: Timer, Tipo pedido, Calculadora cambio, Carne en parrilla,
   Notificación sonora, Prepagado, Descuento inventario, Historial, Excel
   ================================================================ */

(function () {
  'use strict';

  const TOKEN_KEY = 'puro_sabor_admin_token';
  const API = {
    login:      '/api/admin/login',
    productos:  '/api/productos?limit=200',
    categorias: '/api/categorias',
    mesas:      '/api/mesas',
    pedido:     '/api/pedidos/crear',
    pedidos:    '/api/pedidos',
    flags:      (id) => `/api/pedidos/${id}/flags`,
    estado:     (id) => `/api/pedidos/${id}/estado`,
  };

  // ─── STATE ─────────────────────────────────────────────────
  let token       = localStorage.getItem(TOKEN_KEY) || null;
  let productos   = [];
  let categorias  = [];
  let mesas       = [];
  let carrito     = [];
  let pedidos     = [];
  let catActiva   = 'todos';
  let tipoPedido  = 'local';
  let filtroEstado= 'pendiente';
  let timerInterval = null;
  let socket      = null;

  // ─── DOM REFS ──────────────────────────────────────────────
  const loginScreen  = document.getElementById('login-screen');
  const posApp       = document.getElementById('pos-app');
  const loginForm    = document.getElementById('login-form');
  const inputUser    = document.getElementById('input-usuario');
  const inputPass    = document.getElementById('input-password');
  const btnIngresar  = document.getElementById('btn-ingresar');
  const loginError   = document.getElementById('login-error');
  const catNav       = document.getElementById('cat-nav');
  const prodGrid     = document.getElementById('products-grid');
  const searchInput  = document.getElementById('search-input');
  const mesaSelect   = document.getElementById('mesa-select');
  const ticketList   = document.getElementById('ticket-list');
  const ticketSub    = document.getElementById('ticket-subtotal');
  const ticketTotal  = document.getElementById('ticket-total');
  const btnSend      = document.getElementById('btn-send');
  const btnClear     = document.getElementById('btn-clear');
  const btnLogout    = document.getElementById('btn-logout');
  const modal        = document.getElementById('modal-variante');
  const modalName    = document.getElementById('modal-product-name');
  const modalImg     = document.getElementById('modal-product-img');
  const modalOpts    = document.getElementById('modal-options');
  const btnCloseModal= document.getElementById('btn-close-modal');
  const toast        = document.getElementById('toast');
  const ordersList   = document.getElementById('orders-list');
  const banner       = document.getElementById('new-order-banner');
  const payModal     = document.getElementById('modal-payment');

  // ─── BOOT ──────────────────────────────────────────────────
  if (token) { showApp(); } else { showLogin(); }

  // ─── AUTH ──────────────────────────────────────────────────
  function showLogin() {
    loginScreen.style.display = 'flex';
    posApp.style.display = 'none';
    if (socket) { socket.disconnect(); socket = null; }
    if (timerInterval) clearInterval(timerInterval);
  }

  function showApp() {
    loginScreen.style.display = 'none';
    posApp.style.display = 'flex';
    loadAll();
    connectSocket();
    timerInterval = setInterval(updateTimers, 1000);
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
        showApp();
      } else {
        showLoginError(data.message || 'Credenciales incorrectas');
      }
    } catch {
      showLoginError('Error de conexión, intenta de nuevo');
    } finally {
      btnIngresar.disabled = false;
      btnIngresar.textContent = 'Ingresar';
    }
  });

  function showLoginError(msg) {
    loginError.textContent = msg;
    loginError.style.display = 'block';
  }

  btnLogout.addEventListener('click', () => {
    if (confirm('¿Salir del sistema?')) {
      localStorage.removeItem(TOKEN_KEY);
      token = null;
      carrito = [];
      showLogin();
    }
  });

  // ─── SOCKET.IO ─────────────────────────────────────────────
  function connectSocket() {
    if (socket) return;
    try {
      socket = io({ transports: ['websocket', 'polling'] });
      socket.on('connect', () => socket.emit('unirse_admin'));
      socket.on('nuevo_pedido', () => {
        playNotificationSound();
        showBanner('🔔 ¡Nuevo pedido recibido!');
        loadPedidos();
      });
      socket.on('pedido_estado_actualizado', (data) => {
        if (data.estado === 'listo') {
          playNotificationSound();
          showBanner('🍽 ¡Pedido listo para entregar!');
        }
        loadPedidos();
        // Actualiza estado de mesas si el modal está abierto
        if (modalMesa.style.display === 'flex') {
          renderMesasModal();
        }
      });
      socket.on('pedido_flags_actualizado', () => loadPedidos());
    } catch (e) {
      console.warn('Socket.IO no disponible:', e);
    }
  }

  // ─── NOTIFICATION SOUND ────────────────────────────────────
  function playNotificationSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 523;
      gain.gain.value = 0.3;
      osc.start();
      osc.frequency.setValueAtTime(523, ctx.currentTime);
      osc.frequency.setValueAtTime(659, ctx.currentTime + 0.15);
      osc.frequency.setValueAtTime(784, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.3, ctx.currentTime + 0.4);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
      osc.stop(ctx.currentTime + 0.6);
    } catch (e) { /* silence */ }

    // Flash browser title
    let flashing = true;
    const orig = document.title;
    const flashId = setInterval(() => {
      document.title = flashing ? '🔔 ¡PEDIDO!' : orig;
      flashing = !flashing;
    }, 800);
    setTimeout(() => { clearInterval(flashId); document.title = orig; }, 6000);
  }

  function showBanner(text) {
    banner.querySelector('span').textContent = text;
    banner.style.display = 'flex';
    setTimeout(() => { banner.style.display = 'none'; }, 8000);
  }

  document.getElementById('banner-dismiss').addEventListener('click', () => {
    banner.style.display = 'none';
  });

  // ─── TAB SWITCHING ─────────────────────────────────────────
  document.querySelectorAll('.topbar-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.topbar-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
      tab.classList.add('active');
      const target = document.getElementById('tab-' + tab.dataset.tab);
      target.style.display = tab.dataset.tab === 'pos' ? 'flex' : 'block';
      if (tab.dataset.tab === 'orders') loadPedidos();
    });
  });

  // ─── ORDER TYPE SELECTOR ──────────────────────────────────
  function updateOrderTypeUI() {
    const addrInput = document.getElementById('delivery-address');
    const mesaChip = document.getElementById('mesa-chip');
    addrInput.style.display = tipoPedido === 'domicilio' ? 'block' : 'none';
    mesaChip.style.display = tipoPedido === 'local' ? 'flex' : 'none';
  }

  document.querySelectorAll('.order-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.order-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      tipoPedido = btn.dataset.type;
      updateOrderTypeUI();
    });
  });

  updateOrderTypeUI();

  // ─── ORDER STATUS FILTERS ─────────────────────────────────
  document.querySelectorAll('.order-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.order-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filtroEstado = btn.dataset.filter;
      renderPedidos();
    });
  });

  // ─── LOAD DATA ─────────────────────────────────────────────
  async function loadAll() {
    await Promise.all([loadCategorias(), loadMesas()]);
    await loadProductos();
  }

  async function loadCategorias() {
    try {
      const res = await fetch(API.categorias, { headers: authH() });
      const data = await res.json();
      const arr = Array.isArray(data) ? data : (data.data || []);
      categorias = arr.filter(c => c.activa == 1);
      renderCats();
    } catch(e) { console.warn('cats:', e); }
  }

  async function loadMesas() {
    try {
      const res = await fetch(API.mesas, { headers: authH() });
      const data = await res.json();
      if (data.success) {
        mesas = (data.mesas || data.data || []).sort((a,b) => a.numero - b.numero);
        mesaSelect.innerHTML = '<option value="">Seleccionar mesa…</option>';
        mesas.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.numero;
          opt.textContent = `Mesa ${m.numero}`;
          mesaSelect.appendChild(opt);
        });
      }
    } catch(e) { console.warn('mesas:', e); }
  }

  async function loadProductos() {
    prodGrid.innerHTML = '<div class="loading-grid"><div class="spinner"></div>Cargando productos…</div>';
    try {
      const res = await fetch(API.productos, { headers: authH() });
      const data = await res.json();
      if (data.success) {
        productos = buildProductList(data.data || []);
        renderProducts();
      }
    } catch(e) {
      prodGrid.innerHTML = '<div class="loading-grid">❌ Error cargando productos</div>';
    }
  }

  async function loadPedidos() {
    try {
      const res = await fetch(API.pedidos, { headers: authH() });
      const data = await res.json();
      if (data.success) {
        pedidos = data.data || [];
        renderPedidos();
      }
    } catch(e) { console.warn('pedidos:', e); }
  }

  // ─── BUILD PRODUCT LIST ────────────────────────────────────
  function buildProductList(raw) {
    const map = {};
    raw.forEach(p => {
      const parenMatch = p.nombre.match(/^(.+?)\s*\((.+?)\)$/);
      if (parenMatch) {
        const base = parenMatch[1].trim();
        const size = parenMatch[2].trim();
        const key  = `${p.categoria_id}__${base}`;
        if (!map[key]) {
          map[key] = {
            id: p.id, nombre: base, imagen_url: p.imagen_url,
            categoria_id: p.categoria_id, precio: p.precio,
            esVariante: true, variantes: []
          };
        }
        map[key].variantes.push({ id: p.id, nombre: size, precio: p.precio });
      } else {
        let vars = [];
        if (p.tiene_variantes == 1 && p.variantes) {
          try { vars = typeof p.variantes === 'string' ? JSON.parse(p.variantes) : p.variantes; } catch {}
        }
        map[`prod__${p.id}`] = {
          id: p.id, nombre: p.nombre, imagen_url: p.imagen_url,
          categoria_id: p.categoria_id, precio: p.precio,
          esVariante: vars.length > 0, variantes: vars.length > 0 ? vars : null
        };
      }
    });
    return Object.values(map);
  }

  // ─── RENDER CATEGORIES ─────────────────────────────────────
  function renderCats() {
    catNav.innerHTML = '';
    catNav.appendChild(catBtn('Todas', 'todos', catActiva === 'todos'));
    categorias.forEach(c => catNav.appendChild(catBtn(c.nombre, c.id, catActiva == c.id)));
  }

  function catBtn(label, id, active) {
    const b = document.createElement('button');
    b.className = 'cat-btn' + (active ? ' active' : '');
    b.textContent = label;
    b.addEventListener('click', () => {
      catActiva = id;
      document.querySelectorAll('.cat-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      renderProducts();
    });
    return b;
  }

  // ─── PRODUCT ICONS ──────────────────────────────────────────
  function getProductIcon(name) {
    const n = name.toLowerCase();
    if (n.includes('res'))        return '🐄';
    if (n.includes('cerdo'))      return '🐷';
    if (n.includes('pollo'))      return '🐔';
    if (n.includes('costilla'))   return '🍖';
    if (n.includes('ubre'))       return '🥩';
    if (n.includes('chorizo'))    return '🌭';
    if (n.includes('coca') || n.includes('pepsi'))  return '🥤';
    if (n.includes('postobon') || n.includes('postobón')) return '🧃';
    if (n.includes('agua'))       return '💧';
    if (n.includes('jugo'))       return '🍊';
    if (n.includes('cerveza'))    return '🍺';
    if (n.includes('limonada'))   return '🍋';
    if (n.includes('miga'))       return '🍳';
    if (n.includes('arepa'))      return '🫓';
    if (n.includes('ensalada'))   return '🥗';
    if (n.includes('papa') || n.includes('frita'))  return '🍟';
    if (n.includes('arroz'))      return '🍚';
    return '';
  }

  // ─── RENDER PRODUCTS ───────────────────────────────────────
  function renderProducts() {
    const q = searchInput.value.trim().toLowerCase();
    let list = productos;
    if (catActiva !== 'todos') list = list.filter(p => p.categoria_id == catActiva);
    if (q) list = list.filter(p => p.nombre.toLowerCase().includes(q));

    if (!list.length) {
      prodGrid.innerHTML = '<div class="loading-grid">Sin productos en esta categoría</div>';
      return;
    }

    prodGrid.innerHTML = '';
    list.forEach(prod => {
      const card = document.createElement('div');
      card.className = 'prod-card';
      const img = prod.imagen_url || '/assets/images/default-food.jpg';
      let priceStr;
      if (prod.esVariante && prod.variantes && prod.variantes.length > 0) {
        const minP = Math.min(...prod.variantes.map(v => parseFloat(v.precio || prod.precio || 0)));
        priceStr = `Desde $${minP.toLocaleString('es-CO')}`;
      } else {
        priceStr = `$${parseFloat(prod.precio || 0).toLocaleString('es-CO')}`;
      }
      const icon = getProductIcon(prod.nombre);
      card.innerHTML = `
        <img class="prod-card-img" src="${img}?v=2" onerror="this.src='/assets/images/default-food.jpg'" alt="${prod.nombre}">
        ${prod.esVariante ? '<span class="prod-badge">Opciones</span>' : ''}
        <div class="prod-card-body">
          <div class="prod-name">${icon ? `<span class="prod-icon">${icon}</span>` : ''}${prod.nombre}</div>
          <div class="prod-price">${priceStr}</div>
        </div>`;
      card.addEventListener('click', () => onProductClick(prod));
      prodGrid.appendChild(card);
    });
  }

  searchInput.addEventListener('input', renderProducts);

  // ─── PRODUCT CLICK / MODAL ─────────────────────────────────
  function onProductClick(prod) {
    if (prod.esVariante && prod.variantes && prod.variantes.length > 0) {
      openVariantModal(prod);
    } else {
      addToCart(prod.id, prod.nombre, null, null, parseFloat(prod.precio || 0));
    }
  }

  function openVariantModal(prod) {
    modalName.textContent = prod.nombre;
    modalImg.src = (prod.imagen_url || '/assets/images/default-food.jpg') + '?v=2';
    modalImg.onerror = () => { modalImg.src = '/assets/images/default-food.jpg'; };
    modalOpts.innerHTML = '';
    prod.variantes.forEach(v => {
      const price = parseFloat(v.precio !== undefined ? v.precio : prod.precio);
      const name  = v.nombre || v.tamano || 'Opción';
      const b = document.createElement('button');
      b.className = 'modal-opt-btn';
      b.innerHTML = `<span>${name}</span><span class="opt-price">$${price.toLocaleString('es-CO')}</span>`;
      b.addEventListener('click', () => { addToCart(v.id || prod.id, prod.nombre, v.id, name, price); closeModal(); });
      modalOpts.appendChild(b);
    });
    modal.style.display = 'flex';
  }

  btnCloseModal.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  function closeModal() { modal.style.display = 'none'; }

  // ─── CART ──────────────────────────────────────────────────
  function cartKey(prodId, variantId) { return `${prodId}__${variantId ?? 'base'}`; }

  function addToCart(prodId, name, variantId, variantName, price) {
    const isFirstItem = carrito.length === 0;
    const key = cartKey(prodId, variantId);
    const existing = carrito.find(i => i.key === key);
    if (existing) { existing.qty++; } else {
      carrito.push({ key, prodId, name, variantId, variantName, price, qty: 1 });
    }
    renderTicket();

    // Si es el primer producto y es local, abre modal de mesa
    if (isFirstItem && tipoPedido === 'local') {
      openMesaModal();
    }
  }

  function changeQty(key, delta) {
    const idx = carrito.findIndex(i => i.key === key);
    if (idx < 0) return;
    carrito[idx].qty += delta;
    if (carrito[idx].qty <= 0) carrito.splice(idx, 1);
    renderTicket();
  }

  function renderTicket() {
    if (!carrito.length) {
      ticketList.innerHTML = `<div class="ticket-placeholder">
        <svg viewBox="0 0 24 24"><path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96C5 16.1 5.9 17 7 17h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63H19c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1 1 0 0 0 23.46 4H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/></svg>
        <p>Agrega productos<br>para comenzar</p></div>`;
      ticketSub.textContent = '$0';
      ticketTotal.textContent = '$0';
      btnSend.disabled = true;
      return;
    }
    btnSend.disabled = false;
    let total = 0;
    ticketList.innerHTML = '';
    carrito.forEach(item => {
      const sub = item.price * item.qty;
      total += sub;
      const el = document.createElement('div');
      el.className = 'ticket-item';
      el.innerHTML = `
        <div class="ticket-item-info">
          <div class="ticket-item-name">${item.name}</div>
          ${item.variantName ? `<div class="ticket-item-sub">${item.variantName}</div>` : ''}
          <div class="ticket-item-price">$${sub.toLocaleString('es-CO')}</div>
        </div>
        <div class="ticket-qty-ctrl">
          <button class="qty-btn" data-key="${item.key}" data-d="-1">−</button>
          <span class="qty-num">${item.qty}</span>
          <button class="qty-btn" data-key="${item.key}" data-d="1">+</button>
        </div>`;
      ticketList.appendChild(el);
    });
    ticketList.querySelectorAll('.qty-btn').forEach(b => {
      b.addEventListener('click', (e) => {
        changeQty(e.currentTarget.dataset.key, parseInt(e.currentTarget.dataset.d));
      });
    });
    ticketSub.textContent = `$${total.toLocaleString('es-CO')}`;
    ticketTotal.textContent = `$${total.toLocaleString('es-CO')}`;
  }

  btnClear.addEventListener('click', () => {
    if (!carrito.length) return;
    if (confirm('¿Limpiar todos los ítems?')) { carrito = []; renderTicket(); }
  });

  // ─── MESA SELECTION MODAL ─────────────────────────────────
  const mesaGrid = document.getElementById('mesa-grid');
  const modalMesa = document.getElementById('modal-mesa');
  const btnConfirmMesa = document.getElementById('btn-confirm-mesa');
  let mesaSeleccionada = null;
  let pendingOrderData = null;
  let mesaStates = {}; // { mesa_numero: { isOccupied, lastState } }

  async function getMesaStates() {
    try {
      const res = await fetch(API.pedidos, { headers: authH() });
      const data = await res.json();
      const orders = data.data || [];

      mesaStates = {};
      mesas.forEach(m => {
        const hasPendingOrder = orders.some(p =>
          p.mesa_numero === m.numero &&
          p.estado !== 'pagado' &&
          p.estado !== 'cancelado'
        );
        const lastOrder = orders
          .filter(p => p.mesa_numero === m.numero)
          .sort((a, b) => new Date(b.creado_en) - new Date(a.creado_en))[0];

        mesaStates[m.numero] = {
          isOccupied: hasPendingOrder,
          lastState: lastOrder?.estado || null
        };
      });
    } catch (e) {
      console.warn('Error getting mesa states:', e);
    }
  }

  async function renderMesasModal() {
    await getMesaStates();
    mesaGrid.innerHTML = '';
    mesas.forEach(m => {
      const state = mesaStates[m.numero];
      const isOccupied = state?.isOccupied || false;
      const lastState = state?.lastState;
      const btn = document.createElement('button');
      btn.className = `mesa-btn ${isOccupied ? 'occupied' : ''} ${mesaSeleccionada === m.numero ? 'selected' : ''}`;
      btn.type = 'button';
      btn.disabled = isOccupied;
      const statusText = isOccupied ? `Con clientes\n${lastState}` : 'Libre';
      btn.innerHTML = `<div class="mesa-number">🪑 ${m.numero}</div><div class="mesa-status">${statusText}</div>`;
      btn.addEventListener('click', () => {
        if (!isOccupied) {
          mesaSeleccionada = m.numero;
          renderMesasModal();
          btnConfirmMesa.disabled = false;
        } else {
          showToast('⚠️ Esta mesa tiene un pedido abierto');
        }
      });
      mesaGrid.appendChild(btn);
    });
  }

  function openMesaModal() {
    mesaSeleccionada = null;
    btnConfirmMesa.disabled = true;
    renderMesasModal();
    modalMesa.style.display = 'flex';
  }

  function closeMesaModal() {
    modalMesa.style.display = 'none';
  }

  btnConfirmMesa.addEventListener('click', () => {
    if (!mesaSeleccionada) return;
    mesaSelect.value = mesaSeleccionada;
    showToast(`✅ Mesa ${mesaSeleccionada} seleccionada`);
    closeMesaModal();
  });

  document.querySelectorAll('[data-close="modal-mesa"]').forEach(b => {
    b.addEventListener('click', () => {
      mesaSeleccionada = null;
      closeMesaModal();
    });
  });

  // ─── SEND ORDER ────────────────────────────────────────────
  async function doSendOrder(orderData) {
    btnSend.disabled = true;
    btnSend.innerHTML = '<div class="spinner" style="width:18px;height:18px;border-width:2px;"></div>';

    try {
      const res = await fetch(API.pedido, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authH() },
        body: JSON.stringify(orderData)
      });
      const data = await res.json();
      if (data.success) {
        const nameInput = document.getElementById('order-name-input');
        const addrInput = document.getElementById('delivery-address');
        const prepaidCheck = document.getElementById('prepaid-check');
        carrito = [];
        if (nameInput) nameInput.value = '';
        if (addrInput) addrInput.value = '';
        if (prepaidCheck) prepaidCheck.checked = false;
        mesaSelect.value = '';
        renderTicket();
        playNotificationSound();
        const typeLabels = { local: `Mesa ${orderData.mesa_numero}`, domicilio: 'Domicilio', recogen: 'Recogen' };
        showToast(`✅ Pedido enviado — ${typeLabels[orderData.tipo_pedido] || 'Enviado'}`);
      } else {
        showToast('❌ Error al enviar pedido: ' + (data.error || 'Error desconocido'));
      }
    } catch (e) {
      showToast('❌ Error de conexión: ' + e.message);
    } finally {
      btnSend.disabled = false;
      btnSend.innerHTML = `<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg> Enviar a Cocina`;
    }
  }

  btnSend.addEventListener('click', async () => {
    if (!carrito.length) return;
    const nameInput = document.getElementById('order-name-input');
    const addrInput = document.getElementById('delivery-address');
    const prepaidCheck = document.getElementById('prepaid-check');
    const nombre_cliente = nameInput ? nameInput.value.trim() : '';
    const notas = '';
    const direccion = addrInput ? addrInput.value.trim() : '';

    if (tipoPedido === 'domicilio' && !direccion) {
      showToast('⚠️ Ingresa la dirección del domicilio');
      return;
    }

    if (tipoPedido === 'local' && !mesaSeleccionada) {
      showToast('⚠️ Selecciona una mesa primero');
      openMesaModal();
      return;
    }

    const items = carrito.map(i => ({
      id: i.variantId || i.prodId,
      nombre: i.variantName ? `${i.name} — ${i.variantName}` : i.name,
      precio: i.price,
      cantidad: i.qty
    }));
    const total = carrito.reduce((s, i) => s + i.price * i.qty, 0);

    const orderData = {
      mesa_numero: mesaSeleccionada || 0,
      items,
      total,
      notas,
      tipo_pedido: tipoPedido,
      direccion_domicilio: direccion,
      nombre_cliente: nombre_cliente,
      prepagado: prepaidCheck && prepaidCheck.checked ? 1 : 0
    };

    await doSendOrder(orderData);
  });

  // ─── RENDER PEDIDOS (Mis Pedidos tab) ──────────────────────
  function renderPedidos() {
    const filtered = pedidos.filter(p => p.estado === filtroEstado);

    if (!filtered.length) {
      ordersList.innerHTML = `<div class="orders-empty">No hay pedidos ${filtroEstado}s</div>`;
      return;
    }

    ordersList.innerHTML = '';
    filtered.forEach(p => {
      const items = p.items || [];
      const createdAt = p.creado_en ? new Date(p.creado_en) : null;
      const timeStr = createdAt ? createdAt.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '';

      const typeIcons = { local: '🏪', domicilio: '🏍', recogen: '🛍' };
      const typeColors = { local: '#27ae60', domicilio: '#f39c12', recogen: '#e67e22' };
      const tipo = p.tipo_pedido || 'local';
      const typeIcon = typeIcons[tipo] || '📋';
      const typeColor = typeColors[tipo] || '#888';

      const el = document.createElement('div');
      el.className = 'order-card';
      el.style.borderLeftColor = typeColor;

      let flagsHtml = '';
      if (p.prepagado) flagsHtml += '<span class="order-flag flag-paid">💰 Pagado</span>';
      if (p.carne_en_parrilla) flagsHtml += '<span class="order-flag flag-grill">🔥 En parrilla</span>';

      let actionsHtml = '';

      // Checkbox de parrilla para pendiente/preparando
      if (p.estado === 'pendiente' || p.estado === 'preparando') {
        actionsHtml += `
          <label class="grill-toggle">
            <input type="checkbox" class="grill-check" data-id="${p.id}" ${p.carne_en_parrilla ? 'checked' : ''}>
            <span>🔥 Parrilla</span>
          </label>`;
      }

      // Estado: Pendiente → Preparando
      if (p.estado === 'pendiente') {
        actionsHtml += `<button class="btn-action btn-prepare" data-id="${p.id}">👨‍🍳 Preparando</button>`;
      }

      // Estado: Preparando → Listo
      if (p.estado === 'preparando') {
        actionsHtml += `<button class="btn-action btn-ready" data-id="${p.id}">✅ Listo</button>`;
      }

      // Estado: Listo → Entregado
      if (p.estado === 'listo') {
        actionsHtml += `<button class="btn-action btn-deliver" data-id="${p.id}">🚚 Entregado</button>`;
      }

      // Estado: Entregado → Pagado
      if (p.estado === 'entregado') {
        actionsHtml += `<button class="btn-action btn-pay" data-id="${p.id}" data-total="${p.total}">💳 Cobrar</button>`;
      }

      el.innerHTML = `
        <div class="order-card-top">
          <div class="order-card-info">
            <div class="order-card-title">
              <span class="order-num">#${p.id}</span>
              <span class="order-type-icon" style="color:${typeColor}">${typeIcon} ${tipo}</span>
              ${flagsHtml}
            </div>
            <div class="order-card-meta">
              ${p.nombre_cliente ? `<span class="order-client">${p.nombre_cliente}</span>` : ''}
              <span class="order-mesa">${p.mesa_numero > 0 ? 'Mesa ' + p.mesa_numero : 'Para llevar'}</span>
              <span class="order-time">${timeStr}</span>
            </div>
            ${p.direccion_domicilio ? `<div class="order-address">📍 ${p.direccion_domicilio}</div>` : ''}
          </div>
          <div class="order-card-right">
            ${p.estado === 'pendiente' ? `<div class="order-timer" data-created="${p.creado_en}">--:--</div>` : ''}
            <div class="order-total">$${parseFloat(p.total).toLocaleString('es-CO')}</div>
          </div>
        </div>
        <div class="order-items-list">
          ${items.map(i => `<div class="order-item-row"><span>${i.cantidad}x ${i.nombre}</span><span>$${(i.precio * i.cantidad).toLocaleString('es-CO')}</span></div>`).join('')}
        </div>
        ${p.notas ? `<div class="order-notes">📝 ${p.notas}</div>` : ''}
        <div class="order-actions">${actionsHtml}</div>`;

      ordersList.appendChild(el);
    });

    // Bind action buttons
    ordersList.querySelectorAll('.grill-check').forEach(cb => {
      cb.addEventListener('change', async (e) => {
        const id = e.target.dataset.id;
        await updateFlags(id, { carne_en_parrilla: e.target.checked ? 1 : 0 });
      });
    });

    ordersList.querySelectorAll('.btn-prepare').forEach(btn => {
      btn.addEventListener('click', async () => {
        await updateEstado(btn.dataset.id, 'preparando');
      });
    });

    ordersList.querySelectorAll('.btn-ready').forEach(btn => {
      btn.addEventListener('click', async () => {
        await updateEstado(btn.dataset.id, 'listo');
      });
    });

    ordersList.querySelectorAll('.btn-deliver').forEach(btn => {
      btn.addEventListener('click', async () => {
        await updateEstado(btn.dataset.id, 'entregado');
      });
    });

    ordersList.querySelectorAll('.btn-pay').forEach(btn => {
      btn.addEventListener('click', () => {
        openPaymentModal(btn.dataset.id, parseFloat(btn.dataset.total));
      });
    });

    updateTimers();
  }

  // ─── TIMERS ────────────────────────────────────────────────
  function updateTimers() {
    document.querySelectorAll('.order-timer').forEach(el => {
      const created = el.dataset.created;
      if (!created) return;
      const createdMs = new Date(created).getTime();
      if (isNaN(createdMs)) return;
      const now = Date.now();
      const elapsed = now - createdMs;
      const limit = 20 * 60 * 1000;

      if (elapsed < limit) {
        const remaining = limit - elapsed;
        const m = Math.floor(remaining / 60000);
        const s = Math.floor((remaining % 60000) / 1000);
        el.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        el.classList.remove('timer-overdue');
        el.classList.add('timer-ok');
      } else {
        const overdue = elapsed - limit;
        const m = Math.floor(overdue / 60000);
        const s = Math.floor((overdue % 60000) / 1000);
        el.textContent = `+${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        el.classList.remove('timer-ok');
        el.classList.add('timer-overdue');
      }
    });
  }

  // ─── API ACTIONS ───────────────────────────────────────────
  async function updateFlags(id, flags) {
    try {
      await fetch(API.flags(id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authH() },
        body: JSON.stringify(flags)
      });
    } catch (e) { console.error(e); }
  }

  async function updateEstado(id, estado, metodo_pago) {
    try {
      const body = { estado };
      if (metodo_pago) body.metodo_pago = metodo_pago;
      const res = await fetch(API.estado(id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authH() },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.success) {
        showToast(`✅ Pedido #${id} → ${estado}`);
        loadPedidos();
      }
    } catch (e) { console.error(e); }
  }

  // ─── PAYMENT MODAL (Calculadora de Cambio) ────────────────
  let payingOrderId = null;

  function openPaymentModal(orderId, total) {
    payingOrderId = orderId;
    document.getElementById('pay-total').textContent = `$${total.toLocaleString('es-CO')}`;
    document.getElementById('pay-amount').value = '';
    document.getElementById('pay-change').textContent = '$0';
    document.getElementById('pay-method').value = 'efectivo';
    document.getElementById('change-calc').style.display = 'block';
    payModal.style.display = 'flex';
  }

  payModal.querySelector('[data-close]').addEventListener('click', () => {
    payModal.style.display = 'none';
  });
  payModal.addEventListener('click', (e) => { if (e.target === payModal) payModal.style.display = 'none'; });

  document.getElementById('pay-method').addEventListener('change', (e) => {
    document.getElementById('change-calc').style.display = e.target.value === 'efectivo' ? 'block' : 'none';
  });

  document.getElementById('pay-amount').addEventListener('input', (e) => {
    const totalText = document.getElementById('pay-total').textContent.replace(/[^0-9]/g, '');
    const total = parseInt(totalText) || 0;
    const paid = parseInt(e.target.value) || 0;
    const change = Math.max(0, paid - total);
    document.getElementById('pay-change').textContent = `$${change.toLocaleString('es-CO')}`;
    document.getElementById('pay-change').className = paid >= total ? 'change-amount change-positive' : 'change-amount';
  });

  document.getElementById('btn-confirm-pay').addEventListener('click', async () => {
    if (!payingOrderId) return;
    const metodo = document.getElementById('pay-method').value;
    await updateEstado(payingOrderId, 'pagado', metodo);
    payModal.style.display = 'none';
    payingOrderId = null;
  });

  // ─── EXPORT TO EXCEL ───────────────────────────────────────
  document.getElementById('btn-export-excel').addEventListener('click', () => {
    if (!pedidos.length) { showToast('No hay pedidos para exportar'); return; }
    const rows = pedidos.map(p => ({
      ID: p.id,
      Estado: p.estado,
      Tipo: p.tipo_pedido || 'local',
      Cliente: p.nombre_cliente || '',
      Mesa: p.mesa_numero,
      Total: p.total,
      Metodo_Pago: p.metodo_pago || '',
      Prepagado: p.prepagado ? 'Sí' : 'No',
      Items: (p.items || []).map(i => `${i.cantidad}x ${i.nombre}`).join('; '),
      Fecha: p.creado_en ? new Date(p.creado_en).toLocaleString('es-CO') : '',
      Notas: p.notas || ''
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Pedidos');
    XLSX.writeFile(wb, `pedidos-${new Date().toISOString().slice(0,10)}.xlsx`);
    showToast('📊 Excel exportado');
  });

  document.getElementById('btn-refresh-orders').addEventListener('click', loadPedidos);

  // ─── TOAST ─────────────────────────────────────────────────
  let toastTimer;
  function showToast(msg, duration = 3000) {
    clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.style.display = 'block';
    toastTimer = setTimeout(() => { toast.style.display = 'none'; }, duration);
  }

  // ─── HELPERS ───────────────────────────────────────────────
  function authH() {
    return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  }

})();
