/* ================================================================
   PURO SABOR — MESERA POS — JavaScript
   3-screen flow: Login → Mesa → POS
   ================================================================ */
(function () {
  'use strict';

  const TOKEN_KEY  = 'puro_sabor_admin_token';
  const NOMBRE_KEY = 'puro_sabor_mesera_nombre';

  const API = {
    login:     '/api/admin/login',
    productos: '/api/productos?limit=200',
    categorias:'/api/categorias',
    mesas:     '/api/mesas',
    pedido:    '/api/pedidos/crear',
  };

  // ── STATE ──────────────────────────────────────────────────
  let token        = localStorage.getItem(TOKEN_KEY) || null;
  let mesera       = localStorage.getItem(NOMBRE_KEY) || '';
  let productos    = [];
  let categorias   = [];
  let mesas        = [];
  let carrito      = [];
  let catActiva    = 'todos';
  let mesaSeleccionada = null; // { numero, label }
  let mobileTab    = 'menu';  // 'menu' | 'ticket'

  // ── DOM ────────────────────────────────────────────────────
  const screenLogin = document.getElementById('screen-login');
  const screenMesa  = document.getElementById('screen-mesa');
  const screenPos   = document.getElementById('screen-pos');

  // Login
  const loginForm    = document.getElementById('login-form');
  const inpNombre    = document.getElementById('inp-nombre');
  const inpUsuario   = document.getElementById('inp-usuario');
  const inpPass      = document.getElementById('inp-pass');
  const btnLogin     = document.getElementById('btn-login');
  const loginErr     = document.getElementById('login-err');

  // Mesa selection
  const mesaNameBadge = document.getElementById('mesera-name-badge');
  const mesaNameText  = document.getElementById('mesera-name-text');
  const mesasGrid     = document.getElementById('mesas-grid');
  const btnLogoutMesa = document.getElementById('btn-logout-mesa');

  // POS
  const headerMesaNum  = document.getElementById('header-mesa-num');
  const ticketMesaLbl  = document.getElementById('ticket-mesa-label');
  const ticketBy       = document.getElementById('ticket-by');
  const catStrip       = document.getElementById('cat-strip');
  const prodGrid       = document.getElementById('prod-grid');
  const searchInput    = document.getElementById('search-input');
  const ticketPanel    = document.getElementById('ticket-panel');
  const ticketItems    = document.getElementById('ticket-items');
  const ticketTotal    = document.getElementById('ticket-total');
  const btnSend        = document.getElementById('btn-send');
  const btnClear       = document.getElementById('btn-clear');
  const btnBackMesa    = document.getElementById('btn-back-mesa');
  const headerBadge    = document.getElementById('header-badge');
  const cartCount      = document.getElementById('cart-count');

  // Mobile bottom nav
  const bnavMenu   = document.getElementById('bnav-menu');
  const bnavTicket = document.getElementById('bnav-ticket');
  const bnavBadge  = document.getElementById('bnav-badge');

  // Modal
  const modalVar      = document.getElementById('modal-var');
  const modalProdName = document.getElementById('modal-prod-name');
  const modalImg      = document.getElementById('modal-img');
  const modalOpts     = document.getElementById('modal-opts');
  const btnCloseModal = document.getElementById('btn-close-modal');

  // Toast
  const toastEl = document.getElementById('toast');

  // ── BOOT ───────────────────────────────────────────────────
  if (token) {
    goToMesaScreen();
  } else {
    goToLoginScreen();
  }

  // ── SCREEN NAVIGATION ──────────────────────────────────────
  function goToLoginScreen() {
    screenLogin.classList.add('active');
    screenMesa.classList.remove('active');
    screenPos.classList.remove('active');
  }

  function goToMesaScreen() {
    screenLogin.classList.remove('active');
    screenMesa.classList.add('active');
    screenPos.classList.remove('active');

    mesaNameText.textContent = mesera || 'Mesera';
    loadMesas();
  }

  function goToPosScreen(mesa) {
    mesaSeleccionada = mesa;
    carrito = [];

    const label = mesa.numero === 0 ? 'Para Llevar' : `Mesa ${mesa.numero}`;
    headerMesaNum.textContent = mesa.numero === 0 ? '🛵' : mesa.numero;
    ticketMesaLbl.textContent = label;
    ticketBy.textContent      = mesera ? `Por: ${mesera}` : '';

    screenLogin.classList.remove('active');
    screenMesa.classList.remove('active');
    screenPos.classList.add('active');

    renderTicket();
    if (productos.length === 0) loadProductos();
    if (categorias.length === 0) loadCategorias();
    else renderCats();

    // Start at menu tab on mobile
    setMobileTab('menu');
  }

  // ── LOGIN ──────────────────────────────────────────────────
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginErr.hidden = true;
    btnLogin.disabled = true;
    btnLogin.textContent = 'Verificando…';

    const nombre = inpNombre.value.trim();
    if (!nombre) {
      showLoginErr('Por favor ingresa tu nombre');
      btnLogin.disabled = false;
      btnLogin.textContent = 'Entrar al sistema';
      return;
    }

    try {
      const res  = await fetch(API.login, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: inpUsuario.value.trim(), password: inpPass.value })
      });
      const data = await res.json();
      if (data.success) {
        token  = data.token;
        mesera = nombre;
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(NOMBRE_KEY, mesera);
        goToMesaScreen();
      } else {
        showLoginErr(data.message || 'Usuario o contraseña incorrectos');
      }
    } catch {
      showLoginErr('Error de conexión. Intenta de nuevo.');
    } finally {
      btnLogin.disabled = false;
      btnLogin.textContent = 'Entrar al sistema';
    }
  });

  function showLoginErr(msg) {
    loginErr.textContent = msg;
    loginErr.hidden = false;
  }

  // Logout from mesa screen
  btnLogoutMesa.addEventListener('click', () => {
    if (!confirm('¿Cerrar sesión?')) return;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(NOMBRE_KEY);
    token = null; mesera = '';
    goToLoginScreen();
  });

  // Back to mesa selection
  btnBackMesa.addEventListener('click', () => {
    if (carrito.length > 0 && !confirm('¿Volver a la selección de mesas? Se perderá el pedido actual.')) return;
    goToMesaScreen();
  });

  // ── LOAD MESAS ─────────────────────────────────────────────
  async function loadMesas() {
    mesasGrid.innerHTML = '<p style="color:#888;padding:20px;grid-column:1/-1">Cargando mesas…</p>';
    try {
      const res  = await fetch(API.mesas, { headers: authH() });
      const data = await res.json();
      mesas = (data.mesas || []).sort((a, b) => a.numero - b.numero);
    } catch (e) {
      mesas = [];
    }
    renderMesas();
  }

  function renderMesas() {
    mesasGrid.innerHTML = '';

    // Para Llevar card
    const llevar = makeCard({ numero: 0, label: 'Para Llevar', icon: '🛵', status: null, extra: 'llevar' });
    mesasGrid.appendChild(llevar);

    // Mesa cards
    mesas.forEach(m => {
      const card = makeCard({ numero: m.numero, label: `Mesa ${m.numero}`, icon: '🪑', status: m.sesion_activa ? 'activa' : 'libre' });
      mesasGrid.appendChild(card);
    });
  }

  function makeCard({ numero, label, icon, status, extra }) {
    const div = document.createElement('div');
    div.className = 'mesa-card' + (extra ? ` ${extra}` : '');
    let statusHtml = '';
    if (status === 'activa')  statusHtml = '<span class="mesa-status activa">Ocupada</span>';
    if (status === 'libre')   statusHtml = '<span class="mesa-status libre">Libre</span>';
    div.innerHTML = `
      <div class="mesa-icon">${icon}</div>
      <div class="mesa-label">${label}</div>
      ${statusHtml}
    `;
    div.addEventListener('click', () => goToPosScreen({ numero, label }));
    return div;
  }

  // ── LOAD CATEGORIAS ────────────────────────────────────────
  async function loadCategorias() {
    try {
      const res  = await fetch(API.categorias, { headers: authH() });
      const data = await res.json();
      categorias = (data.data || []).filter(c => c.activa == 1);
    } catch {}
    renderCats();
  }

  function renderCats() {
    catStrip.innerHTML = '';
    const all = catBtn('Todas', 'todos', catActiva === 'todos');
    catStrip.appendChild(all);
    categorias.forEach(c => catStrip.appendChild(catBtn(c.nombre, c.id, catActiva == c.id)));
  }

  function catBtn(label, id, active) {
    const b = document.createElement('button');
    b.className = 'cat-btn' + (active ? ' active' : '');
    b.textContent = label;
    b.addEventListener('click', () => {
      catActiva = id;
      document.querySelectorAll('.cat-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      renderProds();
    });
    return b;
  }

  // ── LOAD PRODUCTOS ─────────────────────────────────────────
  async function loadProductos() {
    prodGrid.innerHTML = '<div class="grid-loading"><div class="spinner"></div>Cargando productos…</div>';
    try {
      const res  = await fetch(API.productos, { headers: authH() });
      const data = await res.json();
      productos  = buildProdList(data.data || []);
    } catch (e) {
      prodGrid.innerHTML = '<div class="grid-empty">❌ Error al cargar productos</div>';
      return;
    }
    await loadCategorias();
    renderProds();
  }

  function buildProdList(raw) {
    const map = {};
    raw.forEach(p => {
      const m = p.nombre.match(/^(.+?)\s*\((.+?)\)$/);
      if (m) {
        const base = m[1].trim(), size = m[2].trim();
        const key  = `${p.categoria_id}__${base}`;
        if (!map[key]) {
          map[key] = { id: p.id, nombre: base, imagen_url: p.imagen_url,
            categoria_id: p.categoria_id, precio: p.precio, esVariante: true, variantes: [] };
        }
        map[key].variantes.push({ id: p.id, nombre: size, precio: p.precio });
      } else {
        let vars = [];
        if (p.tiene_variantes == 1 && p.variantes) {
          try { vars = typeof p.variantes === 'string' ? JSON.parse(p.variantes) : (p.variantes || []); } catch {}
        }
        map[`p__${p.id}`] = { id: p.id, nombre: p.nombre, imagen_url: p.imagen_url,
          categoria_id: p.categoria_id, precio: p.precio,
          esVariante: vars.length > 0, variantes: vars.length > 0 ? vars : null };
      }
    });
    return Object.values(map);
  }

  // ── RENDER PRODUCTS ────────────────────────────────────────
  function renderProds() {
    const q = searchInput.value.trim().toLowerCase();
    let list = productos;
    if (catActiva !== 'todos') list = list.filter(p => p.categoria_id == catActiva);
    if (q) list = list.filter(p => p.nombre.toLowerCase().includes(q));

    if (!list.length) {
      prodGrid.innerHTML = '<div class="grid-empty">Sin productos en esta categoría</div>';
      return;
    }

    prodGrid.innerHTML = '';
    list.forEach(prod => {
      const card = document.createElement('div');
      card.className = 'prod-card';

      const img = prod.imagen_url || '/assets/images/default-food.jpg';
      let priceStr;
      if (prod.esVariante && prod.variantes) {
        const min = Math.min(...prod.variantes.map(v => parseFloat(v.precio ?? prod.precio ?? 0)));
        priceStr = `Desde $${min.toLocaleString('es-CO')}`;
      } else {
        priceStr = `$${parseFloat(prod.precio ?? 0).toLocaleString('es-CO')}`;
      }

      card.innerHTML = `
        <img class="prod-card-img" src="${img}?v=2" onerror="this.src='/assets/images/default-food.jpg'" alt="${prod.nombre}">
        ${prod.esVariante ? '<span class="prod-badge">Opciones</span>' : ''}
        <div class="prod-card-body">
          <div class="prod-name">${prod.nombre}</div>
          <div class="prod-price">${priceStr}</div>
        </div>
      `;
      card.addEventListener('click', () => onProdClick(prod));
      prodGrid.appendChild(card);
    });
  }

  searchInput.addEventListener('input', renderProds);

  // ── PRODUCT CLICK ──────────────────────────────────────────
  function onProdClick(prod) {
    if (prod.esVariante && prod.variantes && prod.variantes.length > 0) {
      openModal(prod);
    } else {
      addToCart(prod.id, prod.nombre, null, null, parseFloat(prod.precio ?? 0));
    }
  }

  // ── VARIANT MODAL ──────────────────────────────────────────
  function openModal(prod) {
    modalProdName.textContent = prod.nombre;
    modalImg.src = (prod.imagen_url || '/assets/images/default-food.jpg') + '?v=2';
    modalImg.onerror = () => { modalImg.src = '/assets/images/default-food.jpg'; };
    modalOpts.innerHTML = '';

    prod.variantes.forEach(v => {
      const price = parseFloat(v.precio !== undefined ? v.precio : prod.precio);
      const name  = v.nombre || v.tamano || 'Opción';
      const b = document.createElement('button');
      b.className = 'modal-opt';
      b.innerHTML = `<span>${name}</span><span class="opt-price">$${price.toLocaleString('es-CO')}</span>`;
      b.addEventListener('click', () => {
        addToCart(v.id ?? prod.id, prod.nombre, v.id, name, price);
        closeModal();
        // On mobile: switch to ticket tab after adding
        if (window.innerWidth < 700) setMobileTab('ticket');
      });
      modalOpts.appendChild(b);
    });

    modalVar.hidden = false;
  }

  btnCloseModal.addEventListener('click', closeModal);
  modalVar.addEventListener('click', e => { if (e.target === modalVar) closeModal(); });
  function closeModal() { modalVar.hidden = true; }

  // ── CART ───────────────────────────────────────────────────
  function cartKey(prodId, variantId) {
    return `${prodId}__${variantId ?? 'base'}`;
  }

  function addToCart(prodId, name, variantId, variantName, price) {
    const key = cartKey(prodId, variantId);
    const ex = carrito.find(i => i.key === key);
    if (ex) { ex.qty++; }
    else { carrito.push({ key, prodId, name, variantId, variantName, price, qty: 1 }); }
    renderTicket();
    updateBadge();

    // On mobile: switch to ticket after plain products
    if (window.innerWidth < 700 && !variantId) setMobileTab('ticket');
  }

  function changeQty(key, delta) {
    const idx = carrito.findIndex(i => i.key === key);
    if (idx < 0) return;
    carrito[idx].qty += delta;
    if (carrito[idx].qty <= 0) carrito.splice(idx, 1);
    renderTicket();
    updateBadge();
  }

  btnClear.addEventListener('click', () => {
    if (!carrito.length || !confirm('¿Limpiar el pedido?')) return;
    carrito = []; renderTicket(); updateBadge();
  });

  function updateBadge() {
    const total = carrito.reduce((s, i) => s + i.qty, 0);
    cartCount.textContent = total;
    bnavBadge.textContent = total;
    headerBadge.style.display = total > 0 ? 'block' : 'none';
    bnavBadge.style.display   = total > 0 ? 'block' : 'none';
  }

  function renderTicket() {
    const total = carrito.reduce((s, i) => s + i.price * i.qty, 0);
    ticketTotal.textContent = `$${total.toLocaleString('es-CO')}`;
    btnSend.disabled = carrito.length === 0;

    if (!carrito.length) {
      ticketItems.innerHTML = `
        <div class="ticket-empty">
          <svg viewBox="0 0 24 24"><path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96C5 16.1 5.9 17 7 17h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63H19c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1 1 0 0023.46 4H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/></svg>
          <p>El pedido está vacío</p>
        </div>`;
      return;
    }

    ticketItems.innerHTML = '';
    carrito.forEach(item => {
      const sub = item.price * item.qty;
      const el  = document.createElement('div');
      el.className = 't-item';
      el.innerHTML = `
        <div class="t-item-info">
          <div class="t-item-name">${item.name}</div>
          ${item.variantName ? `<div class="t-item-sub">${item.variantName}</div>` : ''}
          <div class="t-item-price">$${sub.toLocaleString('es-CO')}</div>
        </div>
        <div class="qty-ctrl">
          <button class="qty-btn" data-key="${item.key}" data-d="-1">−</button>
          <span class="qty-n">${item.qty}</span>
          <button class="qty-btn" data-key="${item.key}" data-d="1">+</button>
        </div>
      `;
      ticketItems.appendChild(el);
    });

    ticketItems.querySelectorAll('.qty-btn').forEach(b => {
      b.addEventListener('click', e => {
        changeQty(e.currentTarget.dataset.key, parseInt(e.currentTarget.dataset.d));
      });
    });
  }

  // ── SEND ORDER ─────────────────────────────────────────────
  btnSend.addEventListener('click', async () => {
    if (!carrito.length || !mesaSeleccionada) return;

    const mesa  = mesaSeleccionada.numero;
    const label = mesaSeleccionada.label;
    const items = carrito.map(i => ({
      id:      i.variantId ?? i.prodId,
      nombre:  i.variantName ? `${i.name} — ${i.variantName}` : i.name,
      precio:  i.price,
      cantidad:i.qty
    }));
    const total = carrito.reduce((s, i) => s + i.price * i.qty, 0);

    btnSend.disabled = true;
    btnSend.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2px;"></div>';

    try {
      const res  = await fetch(API.pedido, {
        method: 'POST',
        headers: authH(),
        body: JSON.stringify({ mesa_numero: mesa, items, total, notas: `Tomado por: ${mesera}` })
      });
      const data = await res.json();

      if (data.success) {
        carrito = [];
        renderTicket();
        updateBadge();
        showToast(`✅ Pedido enviado · ${label}`);
        setMobileTab('menu');
        // Go back to mesa selection after short delay
        setTimeout(() => goToMesaScreen(), 2000);
      } else {
        alert('Error al enviar el pedido: ' + (data.error || 'Error'));
      }
    } catch (e) {
      alert('Error de conexión: ' + e.message);
    } finally {
      btnSend.disabled = false;
      btnSend.innerHTML = `<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg> Enviar a Cocina`;
    }
  });

  // ── MOBILE TABS ────────────────────────────────────────────
  function setMobileTab(tab) {
    mobileTab = tab;
    bnavMenu.classList.toggle('active',   tab === 'menu');
    bnavTicket.classList.toggle('active', tab === 'ticket');
    if (window.innerWidth < 700) {
      ticketPanel.classList.toggle('open', tab === 'ticket');
    }
  }

  bnavMenu.addEventListener('click', () => setMobileTab('menu'));
  bnavTicket.addEventListener('click', () => setMobileTab('ticket'));

  // Close ticket sheet by dragging (tap outside)
  ticketPanel.querySelector('.ticket-drag-handle').addEventListener('click', () => setMobileTab('menu'));

  // ── TOAST ──────────────────────────────────────────────────
  let toastT;
  function showToast(msg, ms = 3000) {
    clearTimeout(toastT);
    toastEl.textContent = msg;
    toastEl.hidden = false;
    toastT = setTimeout(() => { toastEl.hidden = true; }, ms);
  }

  // ── AUTH HEADER ────────────────────────────────────────────
  function authH() {
    return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  }

})();
