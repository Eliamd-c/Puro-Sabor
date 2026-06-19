document.addEventListener('DOMContentLoaded', async () => {
  // ── Autenticación ──────────────────────────────────────────────────────
  const token = localStorage.getItem('puro_sabor_admin_token');
  if (!token) {
    window.location.href = '/admin/';
    return;
  }
  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };

  // Elementos DOM
  const btnLogout = document.getElementById('btn-logout');
  const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
  const sidebar = document.getElementById('pos-sidebar');
  const categoriesContainer = document.getElementById('pos-categories');
  const productsGrid = document.getElementById('pos-products-grid');
  const mesaSelect = document.getElementById('pos-mesa-select');
  const ticketItems = document.getElementById('ticket-items');
  const ticketTotal = document.getElementById('ticket-total');
  const btnEnviarPedido = document.getElementById('btn-enviar-pedido');
  const searchInput = document.getElementById('pos-search-input');
  
  // Modal Variantes
  const modalVariantes = document.getElementById('modal-variantes');
  const modalVariantesTitle = document.getElementById('modal-variantes-title');
  const modalVariantesBody = document.getElementById('modal-variantes-body');
  const btnCloseVariantes = document.getElementById('btn-close-variantes');

  // Estado del POS
  let productos = [];
  let categorias = [];
  let mesas = [];
  let carrito = []; // { id, name, variantId, variantName, price, qty }
  let categoriaActiva = '';
  
  // Cerrar Sesión
  btnLogout.addEventListener('click', () => {
    localStorage.removeItem('puro_sabor_admin_token');
    localStorage.removeItem('puro_sabor_admin_user');
    window.location.href = '/admin/';
  });

  // Toggle Sidebar
  btnToggleSidebar.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
  });
  
  // Buscar
  searchInput.addEventListener('input', (e) => {
    renderProductos(categoriaActiva, e.target.value.trim().toLowerCase());
  });

  // Cerrar Modal Variantes
  btnCloseVariantes.addEventListener('click', () => {
    modalVariantes.classList.remove('open');
  });
  modalVariantes.addEventListener('click', (e) => {
    if (e.target === modalVariantes) modalVariantes.classList.remove('open');
  });

  // --- INICIALIZACIÓN ---
  async function init() {
    await Promise.all([cargarMesas(), cargarCategorias()]);
    await cargarProductos();
  }

  // --- DATA FETCHING ---
  async function cargarMesas() {
    try {
      const response = await fetch('/api/mesas', { headers: authHeaders });
      const data = await response.json();
      if (data.success) {
        mesas = data.mesas || [];
        renderMesas();
      }
    } catch (e) {
      console.error('Error cargando mesas:', e);
    }
  }

  async function cargarCategorias() {
    try {
      const response = await fetch('/api/categorias', { headers: authHeaders });
      const data = await response.json();
      if (data.success) {
        categorias = data.data.filter(c => c.activa === 1 || c.activa === true);
        renderCategorias();
      }
    } catch (e) {
      console.error('Error cargando categorías:', e);
    }
  }

  async function cargarProductos() {
    try {
      productsGrid.innerHTML = '<p style="color:var(--text-muted); grid-column:1/-1; text-align:center; padding:40px;">Cargando productos...</p>';
      const response = await fetch('/api/productos', { headers: authHeaders });
      const data = await response.json();
      if (data.success) {
        productos = agruparProductos(data.data.filter(p => p.activo === 1 || p.activo === true));
        renderProductos();
      }
    } catch (e) {
      console.error('Error cargando productos:', e);
      productsGrid.innerHTML = '<p style="color:var(--danger); grid-column:1/-1; text-align:center;">Error cargando productos</p>';
    }
  }

  // Agrupar productos con el mismo nombre base para admitir variantes antiguas y nuevas
  function agruparProductos(lista) {
    const agp = {};
    lista.forEach(prod => {
      const match = prod.nombre.match(/^(.*?)\s*\((.*?)\)$/i);
      if (match) {
        const nombreBase = match[1].trim();
        const tamano = match[2].trim();
        
        if (!agp[nombreBase]) {
          agp[nombreBase] = {
            id: prod.id,
            nombre: nombreBase,
            imagen_url: prod.imagen_url,
            categoria_id: prod.categoria_id,
            tiene_variantes: true,
            variantes: []
          };
        }
        agp[nombreBase].variantes.push({
          id: prod.id,
          nombre: tamano,
          precio: prod.precio
        });
      } else {
        // Verificar si el producto tiene variantes nuevas (de producto_variantes)
        agp[prod.nombre] = {
          id: prod.id,
          nombre: prod.nombre,
          imagen_url: prod.imagen_url,
          precio: prod.precio,
          categoria_id: prod.categoria_id,
          tiene_variantes: prod.tiene_variantes === 1 || prod.tiene_variantes === true,
          variantes: prod.variantes || []
        };
      }
    });
    return Object.values(agp);
  }

  // --- RENDERING ---
  function renderMesas() {
    mesaSelect.innerHTML = '<option value="0">Para Llevar / Domicilio</option>';
    const mesasOrdenadas = [...mesas].sort((a,b) => (a.numero || 0) - (b.numero || 0));
    mesasOrdenadas.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.numero;
      opt.textContent = `Mesa ${m.numero}`;
      mesaSelect.appendChild(opt);
    });
  }

  function renderCategorias() {
    let html = `<button class="pos-category-btn active" data-id="">Todas</button>`;
    categorias.forEach(c => {
      html += `<button class="pos-category-btn" data-id="${c.id}">${c.nombre}</button>`;
    });
    categoriesContainer.innerHTML = html;

    categoriesContainer.querySelectorAll('.pos-category-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        categoriesContainer.querySelectorAll('.pos-category-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        categoriaActiva = e.target.getAttribute('data-id');
        renderProductos(categoriaActiva, searchInput.value.trim().toLowerCase());
      });
    });
  }

  function renderProductos(catId = '', search = '') {
    let filtrados = productos;
    
    if (catId !== '') {
      filtrados = filtrados.filter(p => String(p.categoria_id) === String(catId));
    }
    
    if (search !== '') {
      filtrados = filtrados.filter(p => p.nombre.toLowerCase().includes(search));
    }

    if (filtrados.length === 0) {
      productsGrid.innerHTML = '<p style="color:var(--text-muted); grid-column:1/-1; text-align:center; padding:40px;">No hay productos en esta categoría</p>';
      return;
    }

    let html = '';
    filtrados.forEach(prod => {
      const isVariant = prod.tiene_variantes && prod.variantes && prod.variantes.length > 0;
      let precioHtml = '';
      if (isVariant) {
        const precios = prod.variantes
          .map(v => v.precio !== undefined && v.precio !== null ? parseFloat(v.precio) : parseFloat(prod.precio || 0))
          .filter(p => !isNaN(p))
          .sort((a,b) => a - b);
        precioHtml = precios.length > 0 ? `Desde $${precios[0].toLocaleString('es-CO')}` : 'Ver opciones';
      } else {
        const p = parseFloat(prod.precio || 0);
        precioHtml = `$${p.toLocaleString('es-CO')}`;
      }

      html += `
        <div class="pos-product-card" data-id="${prod.id}">
          <img src="${prod.imagen_url || '/assets/images/default-food.jpg'}?v=2" onerror="this.src='/assets/images/default-food.jpg'" alt="${prod.nombre}">
          <div class="pos-product-info">
            <h4 class="pos-product-title">${prod.nombre}</h4>
            <span class="pos-product-price">${precioHtml}</span>
          </div>
        </div>
      `;
    });
    productsGrid.innerHTML = html;

    productsGrid.querySelectorAll('.pos-product-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = parseInt(card.getAttribute('data-id'));
        const prod = productos.find(p => p.id === id);
        if (!prod) return;
        
        if (prod.tiene_variantes && prod.variantes && prod.variantes.length > 0) {
          abrirModalSeleccionVariante(prod);
        } else {
          agregarAlCarrito(prod.id, prod.nombre, null, null, parseFloat(prod.precio || 0));
        }
      });
    });
  }

  function abrirModalSeleccionVariante(prod) {
    modalVariantesTitle.textContent = prod.nombre;
    let html = '';
    prod.variantes.forEach(v => {
      const precioVar = v.precio !== undefined && v.precio !== null ? parseFloat(v.precio) : parseFloat(prod.precio || 0);
      const nombreVar = v.nombre || v.tamano || 'Variante';
      
      html += `
        <button class="modal-variante-btn" data-vid="${v.id}" data-vname="${nombreVar}" data-vprice="${precioVar}">
          ${nombreVar}
          <span>$${precioVar.toLocaleString('es-CO')}</span>
        </button>
      `;
    });
    
    modalVariantesBody.innerHTML = html;
    modalVariantes.classList.add('open');

    modalVariantesBody.querySelectorAll('.modal-variante-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget;
        const vid = parseInt(target.getAttribute('data-vid'));
        const vname = target.getAttribute('data-vname');
        const vprice = parseFloat(target.getAttribute('data-vprice'));
        agregarAlCarrito(prod.id, prod.nombre, vid, vname, vprice);
        modalVariantes.classList.remove('open');
      });
    });
  }

  // --- LÓGICA DE CARRITO (TICKET) ---
  function agregarAlCarrito(id, name, variantId, variantName, price) {
    const existIdx = carrito.findIndex(i => i.id === id && i.variantId === variantId);
    if (existIdx >= 0) {
      carrito[existIdx].qty += 1;
    } else {
      carrito.push({ id, name, variantId, variantName, price, qty: 1 });
    }
    renderTicket();
  }

  function actualizarCantidad(idx, delta) {
    carrito[idx].qty += delta;
    if (carrito[idx].qty <= 0) {
      carrito.splice(idx, 1);
    }
    renderTicket();
  }

  function renderTicket() {
    if (carrito.length === 0) {
      ticketItems.innerHTML = '<div class="ticket-empty"><p>El pedido está vacío</p></div>';
      ticketTotal.textContent = '$0';
      btnEnviarPedido.disabled = true;
      return;
    }

    btnEnviarPedido.disabled = false;
    let html = '';
    let total = 0;

    carrito.forEach((item, idx) => {
      const subtotal = item.price * item.qty;
      total += subtotal;
      
      html += `
        <div class="ticket-item">
          <div class="ticket-item-details">
            <h5 class="ticket-item-title">${item.name}</h5>
            ${item.variantName ? `<span class="ticket-item-variant">${item.variantName}</span>` : ''}
            <span class="ticket-item-price">$${subtotal.toLocaleString('es-CO')}</span>
          </div>
          <div class="ticket-item-controls">
            <button class="btn-qty" data-idx="${idx}" data-delta="-1">−</button>
            <span class="item-qty">${item.qty}</span>
            <button class="btn-qty" data-idx="${idx}" data-delta="1">+</button>
          </div>
        </div>
      `;
    });

    ticketItems.innerHTML = html;
    ticketTotal.textContent = `$${total.toLocaleString('es-CO')}`;

    ticketItems.querySelectorAll('.btn-qty').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.currentTarget.getAttribute('data-idx'));
        const delta = parseInt(e.currentTarget.getAttribute('data-delta'));
        actualizarCantidad(idx, delta);
      });
    });
  }

  // ENVIAR PEDIDO
  btnEnviarPedido.addEventListener('click', async () => {
    if (carrito.length === 0) return;
    
    const mesaSeleccionada = parseInt(mesaSelect.value) || 0;
    
    const itemsEnvio = carrito.map(item => ({
      id: item.variantId || item.id,
      nombre: item.variantName ? `${item.name} - ${item.variantName}` : item.name,
      precio: item.price,
      cantidad: item.qty
    }));

    const totalCalculado = carrito.reduce((sum, item) => sum + (item.price * item.qty), 0);

    try {
      btnEnviarPedido.disabled = true;
      btnEnviarPedido.innerHTML = '⏳ Enviando...';

      const response = await fetch('/api/pedidos/crear', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ mesa_numero: mesaSeleccionada, items: itemsEnvio, total: totalCalculado })
      });

      const data = await response.json();
      if (data.success) {
        carrito = [];
        renderTicket();
        
        // Feedback visual
        const feedback = document.createElement('div');
        feedback.style.cssText = 'position:fixed;top:20px;right:20px;background:#27ae60;color:white;padding:15px 25px;border-radius:10px;z-index:9999;font-weight:600;box-shadow:0 4px 15px rgba(0,0,0,0.2);';
        feedback.textContent = '✅ Pedido enviado a cocina correctamente';
        document.body.appendChild(feedback);
        setTimeout(() => feedback.remove(), 3000);
      } else {
        throw new Error(data.error || 'Error desconocido');
      }
    } catch (error) {
      console.error(error);
      alert('❌ Error al enviar el pedido: ' + error.message);
    } finally {
      btnEnviarPedido.disabled = false;
      btnEnviarPedido.textContent = 'Mandar a Cocina 👨‍🍳';
    }
  });

  // Start
  init();
});
