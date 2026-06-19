/* ================================================================
   PURO SABOR — MESERA POS — JavaScript
   ================================================================ */

(function () {
  'use strict';

  // ─── CONSTANTS ─────────────────────────────────────────────
  const TOKEN_KEY = 'puro_sabor_admin_token';
  const API = {
    login:      '/api/admin/login',
    productos:  '/api/productos?limit=200',
    categorias: '/api/categorias',
    mesas:      '/api/mesas',
    pedido:     '/api/pedidos/crear',
  };

  // ─── STATE ─────────────────────────────────────────────────
  let token       = localStorage.getItem(TOKEN_KEY) || null;
  let productos   = [];        // all active products
  let categorias  = [];
  let mesas       = [];
  let carrito     = [];        // { key, prodId, name, variant, price, qty }
  let catActiva   = 'todos';

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

  // ─── BOOT ──────────────────────────────────────────────────
  if (token) {
    showApp();
  } else {
    showLogin();
  }

  // ─── AUTH ──────────────────────────────────────────────────
  function showLogin() {
    loginScreen.style.display = 'flex';
    posApp.style.display = 'none';
  }

  function showApp() {
    loginScreen.style.display = 'none';
    posApp.style.display = 'flex';
    loadAll();
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

  // ─── LOAD DATA ─────────────────────────────────────────────
  async function loadAll() {
    await Promise.all([loadCategorias(), loadMesas()]);
    await loadProductos();
  }

  async function loadCategorias() {
    try {
      const res = await fetch(API.categorias, { headers: authH() });
      const data = await res.json();
      if (data.success) {
        categorias = (data.data || []).filter(c => c.activa == 1);
        renderCats();
      }
    } catch(e) { console.warn('cats:', e); }
  }

  async function loadMesas() {
    try {
      const res = await fetch(API.mesas, { headers: authH() });
      const data = await res.json();
      if (data.success) {
        mesas = (data.mesas || []).sort((a,b) => a.numero - b.numero);
        mesaSelect.innerHTML = '<option value="0">Para Llevar</option>';
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
        // Flatten: group old-style (nombre con paréntesis) as variants
        productos = buildProductList(data.data || []);
        renderProducts();
      }
    } catch(e) {
      prodGrid.innerHTML = '<div class="loading-grid">❌ Error cargando productos</div>';
      console.error(e);
    }
  }

  // ─── BUILD PRODUCT LIST ────────────────────────────────────
  // Supports both new system (tiene_variantes + producto_variantes table)
  // and old system (nombre with "(Grande)", "(Pequeña)" etc.)
  function buildProductList(raw) {
    const map = {};
    raw.forEach(p => {
      const parenMatch = p.nombre.match(/^(.+?)\s*\((.+?)\)$/);
      if (parenMatch) {
        const base  = parenMatch[1].trim();
        const size  = parenMatch[2].trim();
        const key   = `${p.categoria_id}__${base}`;
        if (!map[key]) {
          map[key] = {
            id:         p.id,
            nombre:     base,
            imagen_url: p.imagen_url,
            categoria_id: p.categoria_id,
            precio:     p.precio,
            esVariante: true,
            variantes:  []
          };
        }
        map[key].variantes.push({ id: p.id, nombre: size, precio: p.precio });
      } else {
        // New system: tiene_variantes may have variantes array from json_agg
        let vars = [];
        if (p.tiene_variantes == 1 && p.variantes) {
          try {
            vars = typeof p.variantes === 'string' ? JSON.parse(p.variantes) : p.variantes;
          } catch {}
        }
        map[`prod__${p.id}`] = {
          id:          p.id,
          nombre:      p.nombre,
          imagen_url:  p.imagen_url,
          categoria_id:p.categoria_id,
          precio:      p.precio,
          esVariante:  vars.length > 0,
          variantes:   vars.length > 0 ? vars : null
        };
      }
    });
    return Object.values(map);
  }

  // ─── RENDER CATEGORIES ─────────────────────────────────────
  function renderCats() {
    catNav.innerHTML = '';
    const todos = btn('Todas', 'todos', catActiva === 'todos');
    catNav.appendChild(todos);
    categorias.forEach(c => {
      catNav.appendChild(btn(c.nombre, c.id, catActiva == c.id));
    });

    function btn(label, id, active) {
      const b = document.createElement('button');
      b.className = 'cat-btn' + (active ? ' active' : '');
      b.textContent = label;
      b.dataset.id = id;
      b.addEventListener('click', () => {
        catActiva = id;
        document.querySelectorAll('.cat-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        renderProducts();
      });
      return b;
    }
  }

  // ─── RENDER PRODUCTS ───────────────────────────────────────
  function renderProducts() {
    const q = searchInput.value.trim().toLowerCase();
    let list = productos;

    if (catActiva !== 'todos') {
      list = list.filter(p => p.categoria_id == catActiva);
    }
    if (q) {
      list = list.filter(p => p.nombre.toLowerCase().includes(q));
    }

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

      card.innerHTML = `
        <img class="prod-card-img" src="${img}?v=2" onerror="this.src='/assets/images/default-food.jpg'" alt="${prod.nombre}">
        ${prod.esVariante ? '<span class="prod-badge">Opciones</span>' : ''}
        <div class="prod-card-body">
          <div class="prod-name">${prod.nombre}</div>
          <div class="prod-price">${priceStr}</div>
        </div>
      `;

      card.addEventListener('click', () => onProductClick(prod));
      prodGrid.appendChild(card);
    });
  }

  searchInput.addEventListener('input', renderProducts);

  // ─── PRODUCT CLICK ─────────────────────────────────────────
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
      b.addEventListener('click', () => {
        addToCart(v.id || prod.id, prod.nombre, v.id, name, price);
        closeModal();
      });
      modalOpts.appendChild(b);
    });

    modal.style.display = 'flex';
  }

  btnCloseModal.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  function closeModal() {
    modal.style.display = 'none';
  }

  // ─── CART ──────────────────────────────────────────────────
  function cartKey(prodId, variantId) {
    return `${prodId}__${variantId ?? 'base'}`;
  }

  function addToCart(prodId, name, variantId, variantName, price) {
    const key = cartKey(prodId, variantId);
    const existing = carrito.find(i => i.key === key);
    if (existing) {
      existing.qty++;
    } else {
      carrito.push({ key, prodId, name, variantId, variantName, price, qty: 1 });
    }
    renderTicket();

    // Haptic-like flash on card
    flashCard(prodId);
  }

  function flashCard(prodId) {
    const card = prodGrid.querySelector(`[data-pid="${prodId}"]`);
    if (!card) return;
    card.style.borderColor = 'var(--brand)';
    setTimeout(() => { card.style.borderColor = ''; }, 400);
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
      ticketList.innerHTML = `
        <div class="ticket-placeholder">
          <svg viewBox="0 0 24 24"><path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96C5 16.1 5.9 17 7 17h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63H19c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1 1 0 0 0 23.46 4H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/></svg>
          <p>Agrega productos<br>para comenzar</p>
        </div>
      `;
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
        </div>
      `;
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
    if (confirm('¿Limpiar todos los ítems?')) {
      carrito = [];
      renderTicket();
    }
  });

  // ─── SEND ORDER ────────────────────────────────────────────
  btnSend.addEventListener('click', async () => {
    if (!carrito.length) return;

    const mesa = parseInt(mesaSelect.value) || 0;
    const items = carrito.map(i => ({
      id:      i.variantId || i.prodId,
      nombre:  i.variantName ? `${i.name} — ${i.variantName}` : i.name,
      precio:  i.price,
      cantidad:i.qty
    }));
    const total = carrito.reduce((s, i) => s + i.price * i.qty, 0);

    btnSend.disabled = true;
    btnSend.innerHTML = '<div class="spinner" style="width:18px;height:18px;border-width:2px;"></div>';

    try {
      const res = await fetch(API.pedido, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authH() },
        body: JSON.stringify({ mesa_numero: mesa, items, total })
      });
      const data = await res.json();

      if (data.success) {
        carrito = [];
        renderTicket();
        const label = mesa === 0 ? 'Para Llevar' : `Mesa ${mesa}`;
        showToast(`✅ Pedido enviado — ${label}`);
      } else {
        alert('Error al enviar pedido: ' + (data.error || 'Error desconocido'));
      }
    } catch (e) {
      alert('Error de conexión: ' + e.message);
    } finally {
      btnSend.disabled = false;
      btnSend.innerHTML = `<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg> Enviar a Cocina`;
    }
  });

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
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  }

})();
