// ==========================================================================
// 🛒 MESA.JS — Sistema de Auto-Servicio con Carrito Compartido | Puro Sabor
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  // ── Detectar número de mesa desde la URL ──────────────────────────────
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  // /mesa/5 → ['mesa', '5'] o /mesa/general → ['mesa', 'general']
  const mesaNumero = pathParts.length >= 2 ? pathParts[1] : 'general';
  const esMesaGeneral = mesaNumero === 'general' || mesaNumero === '0';

  // ── Estado ──────────────────────────────────────────────────────────────
  let productos = [];
  let categorias = [];
  let categoriaActiva = '';
  let productoSeleccionado = null;
  let swiperInstance = null;
  let carrito = []; // Array de { id, nombre, nombreCompleto, imagen_url, precio, cantidad, categoria_nombre }
  let cantidadModal = 1;
  let varianteActivaId = null;
  let varianteActivaPrecio = 0;
  let rondaActual = 0;
  let whatsappNumero = '3133288298';
  let socket = null;
  let clienteNombre = '';

  // ── Elementos del DOM ──────────────────────────────────────────────────
  const mesaLabel = document.getElementById('mesa-label');
  const categoriesScroll = document.getElementById('categories-scroll');
  const searchInput = document.getElementById('search-input');
  const migasCarouselSection = document.getElementById('migas-carousel-section');
  const swiperWrapperMigas = document.getElementById('swiper-wrapper-migas');
  const secondarySections = document.getElementById('secondary-sections');
  const searchResultsSection = document.getElementById('search-results-section');
  const productsGrid = document.getElementById('products-grid');

  // Modal
  const modalOverlay = document.getElementById('modal-overlay');
  const modalContent = document.getElementById('modal-content');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const modalImg = document.getElementById('modal-img');
  const modalCategory = document.getElementById('modal-category');
  const modalTitle = document.getElementById('modal-title');
  const modalPrice = document.getElementById('modal-price');
  const modalDesc = document.getElementById('modal-desc');
  const btnQtyMinus = document.getElementById('btn-qty-minus');
  const btnQtyPlus = document.getElementById('btn-qty-plus');
  const qtyDisplay = document.getElementById('qty-display');
  const btnAgregarCarrito = document.getElementById('btn-agregar-carrito');

  // Carrito flotante
  const floatingCart = document.getElementById('floating-cart');
  const btnOpenCart = document.getElementById('btn-open-cart');
  const cartBadge = document.getElementById('cart-badge');
  const cartTotalLabel = document.getElementById('cart-total-label');

  // Panel del carrito
  const cartPanelOverlay = document.getElementById('cart-panel-overlay');
  const cartPanelBody = document.getElementById('cart-panel-body');
  const cartSubtotal = document.getElementById('cart-subtotal');
  const cartTotal = document.getElementById('cart-total');
  const btnCloseCart = document.getElementById('btn-close-cart');
  const btnCheckout = document.getElementById('btn-checkout');
  const notasPedido = document.getElementById('notas-pedido');
  const nombrePedido = document.getElementById('nombre-pedido');

  // Pantallas de estado
  const successOverlay = document.getElementById('success-overlay');
  const successMesaText = document.getElementById('success-mesa-text');
  const btnNuevaRonda = document.getElementById('btn-nueva-ronda');
  const cerradaOverlay = document.getElementById('cerrada-overlay');
  const syncIndicator = document.getElementById('sync-indicator');

  // Elementos de Bienvenida
  const welcomeOverlay = document.getElementById('welcome-overlay');
  const clienteNombreInput = document.getElementById('cliente-nombre-input');
  const btnWelcomeEnter = document.getElementById('btn-welcome-enter');
  const btnWelcomeSkip = document.getElementById('btn-welcome-skip');

  // Elementos del Bottom Sheet
  const bottomSheetOverlay = document.getElementById('bottom-sheet-overlay');
  const bottomSheet = document.getElementById('bottom-sheet');
  const bottomSheetIcon = document.getElementById('bottom-sheet-icon');
  const sheetTitle = document.getElementById('sheet-title');
  const sheetMessage = document.getElementById('sheet-message');
  const btnSheetSuggest = document.getElementById('btn-sheet-suggest');
  const btnSheetCart = document.getElementById('btn-sheet-cart');
  const btnSheetClose = document.getElementById('btn-sheet-close');

  // Contenedor de Toast
  const toastContainer = document.getElementById('toast-container');

  // ── Inicialización ─────────────────────────────────────────────────────
  async function init() {
    // Mostrar nombre de la mesa
    if (esMesaGeneral) {
      mesaLabel.textContent = 'Pedido General (para llevar)';
    } else {
      mesaLabel.textContent = `🪑 Mesa ${mesaNumero}`;
    }

    mostrarCarga();

    // Cargar configuración
    try {
      const resp = await fetch('/api/config');
      const result = await resp.json();
      if (result.success && result.data.whatsapp_numero) {
        whatsappNumero = result.data.whatsapp_numero;
      }
    } catch (e) { /* fallback al número por defecto */ }

    // Cargar categorías y productos
    categorias = await API.getCategorias();
    productos = await API.getProductos();

    const catMigas = categorias.find(c => c.nombre.toLowerCase().includes('migas'));
    categoriaActiva = catMigas ? catMigas.id : '';

    renderCategorias();
    renderMenu();
    configurarEventos();
    configurarEventosColaborativos();

    // Gestionar el nombre del cliente (cargar o preguntar)
    gestionarNombreUsuario();

    // Conectar Socket.io
    conectarSocket();
  }

  // ── Solicitar o Cargar Nombre del Cliente ──────────────────────────────
  function gestionarNombreUsuario() {
    const guardado = localStorage.getItem('puro_sabor_cliente_nombre');
    if (guardado && guardado.trim().length > 0) {
      clienteNombre = guardado.trim();
      if (nombrePedido) nombrePedido.value = clienteNombre;
    } else {
      if (welcomeOverlay) {
        welcomeOverlay.style.display = 'flex';
      }
    }
  }

  // ── Configurar Eventos del Sistema Colaborativo ────────────────────────
  function configurarEventosColaborativos() {
    if (btnWelcomeEnter) {
      btnWelcomeEnter.addEventListener('click', () => {
        const value = clienteNombreInput.value.trim();
        if (value.length === 0) {
          clienteNombreInput.style.borderColor = '#e74c3c';
          setTimeout(() => clienteNombreInput.style.borderColor = '', 1500);
          return;
        }
        clienteNombre = value;
        localStorage.setItem('puro_sabor_cliente_nombre', clienteNombre);
        if (nombrePedido) nombrePedido.value = clienteNombre;
        if (welcomeOverlay) welcomeOverlay.style.display = 'none';
        
        mostrarToast('👋', `Bienvenido, <strong>${clienteNombre}</strong>`);
      });
    }

    if (btnWelcomeSkip) {
      btnWelcomeSkip.addEventListener('click', () => {
        const rnd = Math.floor(Math.random() * 100) + 1;
        clienteNombre = `Comensal ${rnd}`;
        if (nombrePedido) nombrePedido.value = clienteNombre;
        if (welcomeOverlay) welcomeOverlay.style.display = 'none';
        
        mostrarToast('👋', `Bienvenido, <strong>${clienteNombre}</strong>`);
      });
    }

    if (btnSheetClose) {
      btnSheetClose.addEventListener('click', cerrarBottomSheet);
    }
    if (bottomSheetOverlay) {
      bottomSheetOverlay.addEventListener('click', cerrarBottomSheet);
    }
    if (btnSheetCart) {
      btnSheetCart.addEventListener('click', () => {
        cerrarBottomSheet();
        if (cartPanelOverlay) cartPanelOverlay.classList.add('open');
      });
    }
    if (btnSheetSuggest) {
      btnSheetSuggest.addEventListener('click', () => {
        cerrarBottomSheet();
        const categoriaBebidas = categorias.find(c => c.nombre.toLowerCase().includes('bebida') || c.nombre.toLowerCase().includes('tomar'));
        if (categoriaBebidas) {
          const catBtn = document.querySelector(`.category-btn[data-id="${categoriaBebidas.id}"]`);
          if (catBtn) {
            catBtn.click();
          } else {
            const allBtns = document.querySelectorAll('.category-btn');
            for (const btn of allBtns) {
              if (btn.textContent.toLowerCase().includes('bebida') || btn.textContent.toLowerCase().includes('tomar')) {
                btn.click();
                break;
              }
            }
          }
        }
      });
    }
  }

  // ── Mostrar Hoja Deslizable (Mesero Sugestivo) ─────────────────────────
  function mostrarBottomSheet(productoName, categoriaName) {
    if (!bottomSheet) return;
    
    sheetTitle.textContent = '¡Agregado con éxito! 🍽️';
    
    const esPlatoFuerte = !categoriaName.toLowerCase().includes('bebida') && 
                          !categoriaName.toLowerCase().includes('tomar') && 
                          !categoriaName.toLowerCase().includes('postre');
                          
    const tieneBebidas = carrito.some(item => 
      item.categoria_nombre && (
        item.categoria_nombre.toLowerCase().includes('bebida') || 
        item.categoria_nombre.toLowerCase().includes('tomar')
      )
    );

    if (esPlatoFuerte && !tieneBebidas) {
      sheetMessage.innerHTML = `¡Uff, excelente elección, <strong>${clienteNombre}</strong>! 🍖 Agregamos <strong>${productoName}</strong> al pedido de la mesa. ¿Te provoca acompañarlo con una de nuestras <strong>bebidas frías</strong>? 🍹`;
      btnSheetSuggest.style.display = 'block';
      btnSheetSuggest.textContent = '🍹 Ver Bebidas';
    } else if (categoriaName.toLowerCase().includes('bebida') || categoriaName.toLowerCase().includes('tomar')) {
      sheetMessage.innerHTML = `Agregamos tu bebida (<strong>${productoName}</strong>) al pedido de la mesa. ¿Quieres elegir un plato fuerte o prefieres revisar lo que lleva la mesa en el carrito? 🛒`;
      btnSheetSuggest.style.display = 'none';
    } else {
      sheetMessage.innerHTML = `Agregamos <strong>${productoName}</strong> al pedido compartido de la mesa. ¿Deseas ver el carrito o seguir explorando el menú?`;
      btnSheetSuggest.style.display = 'none';
    }

    bottomSheetOverlay.style.display = 'block';
    setTimeout(() => {
      bottomSheet.classList.add('open');
    }, 50);
  }

  function cerrarBottomSheet() {
    if (bottomSheet) {
      bottomSheet.classList.remove('open');
    }
    setTimeout(() => {
      if (bottomSheetOverlay) bottomSheetOverlay.style.display = 'none';
    }, 350);
  }

  // ── Mostrar Toast de Notificación Flotante ─────────────────────────────
  function mostrarToast(icon, text) {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = 'toast-notificacion';
    toast.innerHTML = `
      <div class="toast-icon">${icon}</div>
      <div class="toast-content">${text}</div>
    `;
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
      toast.remove();
    }, 4500);
  }

  // ── Socket.io: Sincronización en tiempo real ──────────────────────────
  function conectarSocket() {
    try {
      if (typeof io === 'undefined') {
        console.warn('Socket.io no está disponible. El modo offline está activo.');
        return;
      }
      
      socket = io();

      socket.on('connect', () => {
        socket.emit('unirse_mesa', mesaNumero);
        if (syncIndicator) {
          syncIndicator.classList.remove('desconectado');
          syncIndicator.querySelector('.sync-text').textContent = 'En vivo';
        }
        console.log('[Socket] Conectado a mesa:', mesaNumero);
      });

      socket.on('disconnect', () => {
        if (syncIndicator) {
          syncIndicator.classList.add('desconectado');
          syncIndicator.querySelector('.sync-text').textContent = 'Sin conexión';
        }
      });

      // Recibir carrito actualizado (de otro celular)
      socket.on('carrito_actualizado', (items) => {
        carrito = items;
        actualizarUICarrito();

        // Pulso visual en el badge
        if (cartBadge) {
          cartBadge.classList.add('sync-pulse');
          setTimeout(() => cartBadge.classList.remove('sync-pulse'), 600);
        }
      });

      // Pedido confirmado (por otro celular)
      socket.on('pedido_confirmado', (resumen) => {
        rondaActual = resumen.ronda || rondaActual;
        carrito = [];
        actualizarUICarrito();
      });

      // Mesa cerrada por la cajera
      socket.on('mesa_cerrada', (data) => {
        if (cerradaOverlay) cerradaOverlay.style.display = 'flex';
        if (successOverlay) successOverlay.style.display = 'none';
        if (cartPanelOverlay) cartPanelOverlay.classList.remove('open');
      });

      // Recibir alerta de que otro comensal agregó un producto
      socket.on('notificar_item_agregado', ({ cliente, producto }) => {
        mostrarToast('🔥', `<strong>${cliente}</strong> agregó <strong>${producto}</strong> al carrito de la mesa.`);
      });
    } catch (e) {
      console.warn('Error al iniciar WebSockets:', e);
    }
  }

  // Emitir cambios del carrito al servidor
  function emitirCambioCarrito() {
    if (socket && socket.connected) {
      socket.emit('actualizar_carrito', { mesaNumero, items: carrito });
    }
  }

  // ── Renders del menú (igual que en main.js pero con botones de agregar) ─

  function mostrarCarga() {
    swiperWrapperMigas.innerHTML = `
      <div class="loader-container" style="width:100%;">
        <div class="spinner"></div>
        <p>Cocinando las especialidades...</p>
      </div>`;
    secondarySections.innerHTML = '';
    searchResultsSection.style.display = 'none';
  }

  function agruparProductos(lista) {
    const agp = {};
    lista.forEach(prod => {
      const match = prod.nombre.match(/^(.*?)\s*\((.*?)\)$/i);
      if (match) {
        const nombreBase = match[1].trim();
        const tamano = match[2].trim();
        if (!agp[nombreBase]) {
          agp[nombreBase] = {
            id: prod.id, nombre: nombreBase, descripcion: prod.descripcion,
            categoria_id: prod.categoria_id, categoria_nombre: prod.categoria_nombre,
            imagen_url: prod.imagen_url, disponible: 0, stock: 0, variantes: []
          };
        }
        let label = tamano;
        if (tamano.toLowerCase() === 'pequeña') label = 'Pequeña (125 gr)';
        else if (tamano.toLowerCase() === 'grande') label = 'Grande (250 gr)';

        agp[nombreBase].variantes.push({
          id: prod.id, nombreCompleto: prod.nombre, precio: prod.precio,
          stock: prod.stock, disponible: prod.disponible, tamano: label
        });
        if (prod.disponible && prod.stock > 0) agp[nombreBase].disponible = 1;
        agp[nombreBase].stock += prod.stock;
      } else {
        agp[prod.nombre] = {
          id: prod.id, nombre: prod.nombre, descripcion: prod.descripcion,
          categoria_id: prod.categoria_id, categoria_nombre: prod.categoria_nombre,
          imagen_url: prod.imagen_url, precio: prod.precio,
          disponible: prod.disponible, stock: prod.stock, variantes: []
        };
      }
    });
    return Object.values(agp);
  }

  function renderCategorias() {
    if (!categoriesScroll) return;
    let html = `<div class="category-tab ${categoriaActiva === '' ? 'active' : ''}" data-id="">
      <span class="category-emoji">🍽️</span> Todos</div>`;
    const emojis = { 'Migas al Carbón': '🥩', 'Bebidas': '🍹', 'Postres': '🍰' };
    categorias.forEach(cat => {
      const emoji = emojis[cat.nombre] || '🍔';
      html += `<div class="category-tab ${categoriaActiva == cat.id ? 'active' : ''}" data-id="${cat.id}">
        <span class="category-emoji">${emoji}</span> ${cat.nombre}</div>`;
    });
    categoriesScroll.innerHTML = html;

    document.querySelectorAll('.category-tab').forEach(tab => {
      tab.addEventListener('click', async () => {
        document.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        categoriaActiva = tab.getAttribute('data-id');
        searchInput.value = '';
        mostrarCarga();
        productos = await API.getProductos();
        renderMenu();
      });
    });
  }

  function renderMenu() {
    const term = searchInput.value.trim().toLowerCase();
    const productosAgrupados = agruparProductos(productos);

    if (term.length > 0) {
      migasCarouselSection.style.display = 'none';
      secondarySections.style.display = 'none';
      searchResultsSection.style.display = 'block';
      const filtrados = productosAgrupados.filter(p =>
        p.nombre.toLowerCase().includes(term) ||
        (p.descripcion && p.descripcion.toLowerCase().includes(term))
      );
      if (filtrados.length === 0) {
        productsGrid.innerHTML = `<div class="not-found-container" style="grid-column: 1 / -1;">
          <div class="not-found-icon">🕵️‍♂️</div><p>No encontramos platos que coincidan.</p></div>`;
        return;
      }
      let gridHtml = '';
      filtrados.forEach(prod => { gridHtml += renderCardSecundaria(prod); });
      productsGrid.innerHTML = gridHtml;
      agregarEventosClicGrid(filtrados, '.secondary-card');
      return;
    }

    searchResultsSection.style.display = 'none';
    const catMigas = categorias.find(c => c.nombre.toLowerCase().includes('migas'));
    const catBebidas = categorias.find(c => c.nombre.toLowerCase().includes('bebidas'));
    const catPostres = categorias.find(c => c.nombre.toLowerCase().includes('postres'));

    const migasItems = catMigas ? productosAgrupados.filter(p => p.categoria_id === catMigas.id) : [];
    const bebidasItems = catBebidas ? productosAgrupados.filter(p => p.categoria_id === catBebidas.id) : [];
    const postresItems = catPostres ? productosAgrupados.filter(p => p.categoria_id === catPostres.id) : [];

    if (categoriaActiva === '' || (catMigas && categoriaActiva == catMigas.id)) {
      migasCarouselSection.style.display = 'block';
      let sliderHtml = '';
      migasItems.forEach(prod => {
        sliderHtml += `<div class="swiper-slide" data-nombre="${prod.nombre}">
          <div class="slide-image"><img src="${prod.imagen_url}" alt="${prod.nombre}" onerror="this.src='/assets/images/default-food.jpg'"></div>
          <div class="slide-content">
            <h4 class="slide-title">${prod.nombre}</h4>
            <p class="slide-desc">${prod.descripcion || ''}</p>
            <div class="slide-footer">
              <span class="slide-price">${getPrecioText(prod)}</span>
              <button class="btn-slide-action">Agregar 🛒</button>
            </div>
          </div></div>`;
      });
      swiperWrapperMigas.innerHTML = sliderHtml;
      initSwiper();
      agregarEventosClicGrid(migasItems, '.swiper-slide');
    } else {
      migasCarouselSection.style.display = 'none';
    }

    let secHtml = '';
    if ((categoriaActiva === '' || (catBebidas && categoriaActiva == catBebidas.id)) && bebidasItems.length > 0) {
      secHtml += `<div class="secondary-category-container"><div class="section-header">
        <span class="section-tagline">Para Acompañar</span><h3 class="section-title">Bebidas Refrescantes</h3></div>
        <div class="secondary-grid">`;
      bebidasItems.forEach(prod => { secHtml += renderCardSecundaria(prod); });
      secHtml += `</div></div>`;
    }
    if ((categoriaActiva === '' || (catPostres && categoriaActiva == catPostres.id)) && postresItems.length > 0) {
      secHtml += `<div class="secondary-category-container"><div class="section-header">
        <span class="section-tagline">El Toque Dulce</span><h3 class="section-title">Postres Artesanales</h3></div>
        <div class="secondary-grid">`;
      postresItems.forEach(prod => { secHtml += renderCardSecundaria(prod); });
      secHtml += `</div></div>`;
    }
    secondarySections.innerHTML = secHtml;
    secondarySections.style.display = 'block';
    agregarEventosClicGrid([...bebidasItems, ...postresItems], '.secondary-card');
  }

  function renderCardSecundaria(prod) {
    return `<div class="secondary-card animate-fade-in-up" data-nombre="${prod.nombre}">
      <div class="secondary-card-image"><img src="${prod.imagen_url}" alt="${prod.nombre}" onerror="this.src='/assets/images/default-food.jpg'"></div>
      <div class="secondary-card-content">
        <h4 class="secondary-card-title">${prod.nombre}</h4>
        <div class="secondary-card-footer">
          <span class="secondary-card-price">${getPrecioText(prod)}</span>
          <span class="secondary-card-btn">+ Agregar</span>
        </div></div></div>`;
  }

  function getPrecioText(prod) {
    if (prod.variantes && prod.variantes.length > 0) {
      const precios = prod.variantes.map(v => v.precio).sort((a, b) => a - b);
      return `Desde $${precios[0].toLocaleString('es-CO', { minimumFractionDigits: 0 })} COP`;
    }
    return `$${prod.precio.toLocaleString('es-CO', { minimumFractionDigits: 0 })} COP`;
  }

  function agregarEventosClicGrid(productList, selector) {
    document.querySelectorAll(selector).forEach(card => {
      card.addEventListener('click', () => {
        const nombre = card.getAttribute('data-nombre');
        const prod = productList.find(p => p.nombre === nombre);
        if (prod) abrirModalDetalle(prod);
      });
    });
  }

  function initSwiper() {
    if (swiperInstance) swiperInstance.destroy(true, true);
    swiperInstance = new Swiper('.mySwiper', {
      effect: 'coverflow', grabCursor: true, centeredSlides: true, slidesPerView: 'auto',
      coverflowEffect: { rotate: 15, stretch: 5, depth: 80, modifier: 1.2, slideShadows: false },
      pagination: { el: '.swiper-pagination', clickable: true },
    });
  }

  // ── Modal de Detalle + Agregar al Carrito ──────────────────────────────
  function actualizarPrecioModal(id, precio) {
    varianteActivaId = id;
    varianteActivaPrecio = precio;
    modalPrice.textContent = `$${precio.toLocaleString('es-CO', { minimumFractionDigits: 0 })} COP`;
  }

  function abrirModalDetalle(prodGrouped) {
    productoSeleccionado = prodGrouped;
    cantidadModal = 1;
    qtyDisplay.textContent = '1';

    modalImg.src = prodGrouped.imagen_url;
    modalImg.onerror = () => { modalImg.src = '/assets/images/default-food.jpg'; };
    modalCategory.textContent = prodGrouped.categoria_nombre;
    modalTitle.textContent = prodGrouped.nombre;
    modalDesc.textContent = prodGrouped.descripcion || '';

    const sizeContainer = document.getElementById('modal-size-container');
    if (prodGrouped.variantes && prodGrouped.variantes.length > 0) {
      sizeContainer.style.display = 'block';
      const varOrdenadas = [...prodGrouped.variantes].sort((a, b) => a.precio - b.precio);
      let sizeHtml = `<span class="modal-size-label">Selecciona el Tamaño:</span><div class="size-options">`;
      varOrdenadas.forEach((v, idx) => {
        sizeHtml += `<button class="size-option-btn ${idx === 0 ? 'active' : ''}" data-id="${v.id}" data-price="${v.precio}" data-nombre-completo="${v.nombreCompleto}">
          <span>${v.tamano}</span><span class="size-price">$${v.precio.toLocaleString('es-CO', { minimumFractionDigits: 0 })} COP</span></button>`;
      });
      sizeHtml += `</div>`;
      sizeContainer.innerHTML = sizeHtml;

      const seleccionada = varOrdenadas[0];
      actualizarPrecioModal(seleccionada.id, seleccionada.precio);

      document.querySelectorAll('.size-option-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          document.querySelectorAll('.size-option-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          actualizarPrecioModal(parseInt(btn.dataset.id), parseFloat(btn.dataset.price));
        });
      });
    } else {
      sizeContainer.style.display = 'none';
      actualizarPrecioModal(prodGrouped.id, prodGrouped.precio);
    }

    modalOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function cerrarModalDetalle() {
    modalOverlay.classList.remove('open');
    document.body.style.overflow = '';
    productoSeleccionado = null;
  }

  // Agregar al carrito
  function agregarAlCarrito() {
    if (!productoSeleccionado) return;

    let nombreItem = productoSeleccionado.nombre;
    let idItem = varianteActivaId || productoSeleccionado.id;
    let precioItem = varianteActivaPrecio || productoSeleccionado.precio;

    // Si tiene variantes, usar el nombre completo de la variante seleccionada
    if (productoSeleccionado.variantes && productoSeleccionado.variantes.length > 0) {
      const varActiva = productoSeleccionado.variantes.find(v => v.id === varianteActivaId);
      if (varActiva) {
        nombreItem = varActiva.nombreCompleto || productoSeleccionado.nombre;
      }
    }

    const prodName = productoSeleccionado.nombre;
    const catName = productoSeleccionado.categoria_nombre || '';
    const nombreDueno = clienteNombre || 'Anónimo';

    // Buscar si ya existe en el carrito el mismo producto agregado por la misma persona
    const existente = carrito.find(item => item.id === idItem && item.agregadoPor === nombreDueno);
    if (existente) {
      existente.cantidad += cantidadModal;
    } else {
      carrito.push({
        id: idItem,
        nombre: nombreItem,
        imagen_url: productoSeleccionado.imagen_url,
        precio: precioItem,
        cantidad: cantidadModal,
        categoria_nombre: catName,
        agregadoPor: nombreDueno
      });
    }

    cerrarModalDetalle();
    actualizarUICarrito();
    emitirCambioCarrito();

    // Notificar a los demás comensales de la mesa
    if (socket && socket.connected) {
      socket.emit('item_agregado_grupo', {
        mesaNumero,
        cliente: nombreDueno,
        producto: nombreItem
      });
    }

    // Mostrar el panel deslizable (Mesero Sugestivo)
    mostrarBottomSheet(prodName, catName);
  }

  // ── UI del Carrito ─────────────────────────────────────────────────────
  function actualizarUICarrito() {
    const totalItems = carrito.reduce((sum, item) => sum + item.cantidad, 0);
    const totalPrecio = carrito.reduce((sum, item) => sum + (item.precio * item.cantidad), 0);
    const totalFormateado = `$${totalPrecio.toLocaleString('es-CO', { minimumFractionDigits: 0 })}`;

    // Carrito flotante
    if (totalItems > 0) {
      floatingCart.style.display = 'block';
      cartBadge.textContent = totalItems;
      cartTotalLabel.textContent = totalFormateado;
    } else {
      floatingCart.style.display = 'none';
    }

    // Subtotal y total
    cartSubtotal.textContent = totalFormateado;
    cartTotal.textContent = totalFormateado;

    // Renderizar items del carrito en el panel
    if (carrito.length === 0) {
      cartPanelBody.innerHTML = `<div class="cart-empty">
        <div class="cart-empty-icon">🍽️</div>
        <p>Tu pedido está vacío</p><p style="font-size:12px;">Agrega platos desde el menú</p></div>`;
      btnCheckout.disabled = true;
      return;
    }
    btnCheckout.disabled = false;

    let html = '';
    carrito.forEach((item, idx) => {
      const ownerHtml = item.agregadoPor ? `<div class="cart-item-owner">👤 ${item.agregadoPor}</div>` : '';
      html += `<div class="cart-item" data-index="${idx}">
        <img class="cart-item-img" src="${item.imagen_url}" alt="${item.nombre}" onerror="this.src='/assets/images/default-food.jpg'">
        <div class="cart-item-info">
          <div class="cart-item-name">${item.nombre}</div>
          <div class="cart-item-price">$${(item.precio * item.cantidad).toLocaleString('es-CO', { minimumFractionDigits: 0 })} COP</div>
          ${ownerHtml}
        </div>
        <div class="cart-item-controls">
          <button class="cart-qty-btn" data-action="restar" data-index="${idx}">−</button>
          <span class="cart-item-qty">${item.cantidad}</span>
          <button class="cart-qty-btn" data-action="sumar" data-index="${idx}">+</button>
        </div></div>`;
    });
    cartPanelBody.innerHTML = html;

    // Eventos de cantidad en el carrito
    document.querySelectorAll('.cart-qty-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index);
        const action = btn.dataset.action;
        if (action === 'sumar') {
          carrito[idx].cantidad++;
        } else {
          carrito[idx].cantidad--;
          if (carrito[idx].cantidad <= 0) carrito.splice(idx, 1);
        }
        actualizarUICarrito();
        emitirCambioCarrito();
      });
    });
  }

  // ── WhatsApp Checkout ──────────────────────────────────────────────────
  function generarMensajeWhatsApp() {
    const nombre = nombrePedido.value.trim();
    const notas = notasPedido.value.trim();
    const totalPrecio = carrito.reduce((sum, item) => sum + (item.precio * item.cantidad), 0);

    let msg = `Hola buenas, soy *${nombre}*`;

    if (esMesaGeneral) {
      msg += ` y quisiera hacer un pedido para llevar.`;
    } else {
      msg += ` y estoy en la *Mesa ${mesaNumero}*. Quisiera hacer un pedido.`;
    }

    msg += `\n\n📋 *Mi pedido:*\n`;

    // Agrupar items por persona
    const grupos = {};
    carrito.forEach(item => {
      const persona = item.agregadoPor || 'General';
      if (!grupos[persona]) grupos[persona] = [];
      grupos[persona].push(item);
    });

    const keys = Object.keys(grupos);
    if (keys.length === 1 && (keys[0] === 'General' || keys[0] === nombre)) {
      // Formato normal simple
      carrito.forEach(item => {
        const subtotal = item.precio * item.cantidad;
        msg += `• ${item.cantidad}x ${item.nombre} — $${subtotal.toLocaleString('es-CO', { minimumFractionDigits: 0 })}\n`;
      });
    } else {
      // Estructurado por comensal
      keys.forEach(persona => {
        msg += `\n👤 *Para ${persona}:*\n`;
        grupos[persona].forEach(item => {
          const subtotal = item.precio * item.cantidad;
          msg += `  ▪ ${item.cantidad}x ${item.nombre} — $${subtotal.toLocaleString('es-CO', { minimumFractionDigits: 0 })}\n`;
        });
      });
    }

    msg += `\n💰 *Total: $${totalPrecio.toLocaleString('es-CO', { minimumFractionDigits: 0 })} COP*`;

    if (notas) {
      msg += `\n\n📝 *Nota:* ${notas}`;
    }

    msg += `\n\n¡Gracias! 🍖🔥`;

    return msg;
  }

  async function confirmarPedido() {
    if (carrito.length === 0) return;

    // Validar nombre obligatorio
    const nombre = nombrePedido.value.trim();
    if (!nombre) {
      nombrePedido.classList.add('error');
      nombrePedido.focus();
      setTimeout(() => nombrePedido.classList.remove('error'), 500);
      return;
    }

    const totalPrecio = carrito.reduce((sum, item) => sum + (item.precio * item.cantidad), 0);
    const notas = notasPedido.value.trim();

    // 1. Registrar pedido en el servidor
    try {
      const resp = await fetch(`/api/mesas/${mesaNumero}/pedido`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: carrito.map(i => ({ id: i.id, nombre: i.nombre, precio: i.precio, cantidad: i.cantidad })),
          total: totalPrecio,
          notas: notas || null,
          nombre_cliente: nombre
        })
      });
      const result = await resp.json();
      if (result.success) {
        rondaActual = result.data.ronda;
      }
    } catch (e) {
      console.warn('Error al registrar pedido en servidor:', e);
    }

    // 2. Generar y abrir WhatsApp
    const mensaje = generarMensajeWhatsApp();
    const waURL = `https://wa.me/57${whatsappNumero}?text=${encodeURIComponent(mensaje)}`;
    window.open(waURL, '_blank');

    // 3. Notificar al Socket
    if (socket && socket.connected) {
      socket.emit('pedido_enviado', {
        mesaNumero,
        resumen: { mesa: mesaNumero, ronda: rondaActual, total: totalPrecio, nombre }
      });
    }

    // 4. Limpiar carrito y mostrar éxito
    carrito = [];
    notasPedido.value = '';
    nombrePedido.value = '';
    actualizarUICarrito();
    cartPanelOverlay.classList.remove('open');

    const mesaTexto = esMesaGeneral ? 'Pedido General' : `Mesa <strong>${mesaNumero}</strong>`;
    successMesaText.innerHTML = `${mesaTexto} — Ronda <strong>#${rondaActual}</strong>`;
    successOverlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  // ── Eventos ────────────────────────────────────────────────────────────
  function configurarEventos() {
    // Búsqueda
    let timeoutBusqueda = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(timeoutBusqueda);
      timeoutBusqueda = setTimeout(() => renderMenu(), 300);
    });

    // Modal: cerrar
    btnCloseModal.addEventListener('click', (e) => { e.stopPropagation(); cerrarModalDetalle(); });
    modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) cerrarModalDetalle(); });

    // Modal: cantidad
    btnQtyMinus.addEventListener('click', (e) => {
      e.stopPropagation();
      if (cantidadModal > 1) { cantidadModal--; qtyDisplay.textContent = cantidadModal; }
    });
    btnQtyPlus.addEventListener('click', (e) => {
      e.stopPropagation();
      cantidadModal++;
      qtyDisplay.textContent = cantidadModal;
    });

    // Agregar al carrito
    btnAgregarCarrito.addEventListener('click', (e) => { e.stopPropagation(); agregarAlCarrito(); });

    // Carrito flotante → abrir panel
    btnOpenCart.addEventListener('click', () => {
      cartPanelOverlay.classList.add('open');
      document.body.style.overflow = 'hidden';
    });

    // Cerrar panel del carrito
    btnCloseCart.addEventListener('click', () => {
      cartPanelOverlay.classList.remove('open');
      document.body.style.overflow = '';
    });
    cartPanelOverlay.addEventListener('click', (e) => {
      if (e.target === cartPanelOverlay) {
        cartPanelOverlay.classList.remove('open');
        document.body.style.overflow = '';
      }
    });

    // Checkout WhatsApp
    btnCheckout.addEventListener('click', () => confirmarPedido());

    // Nueva ronda (después del éxito)
    btnNuevaRonda.addEventListener('click', () => {
      successOverlay.style.display = 'none';
      document.body.style.overflow = '';
    });

    // Swipe down para cerrar modal en móviles
    let touchStartY = 0;
    modalContent.addEventListener('touchstart', (e) => { touchStartY = e.touches[0].clientY; });
    modalContent.addEventListener('touchend', (e) => {
      const touchEndY = e.changedTouches[0].clientY;
      if (touchEndY - touchStartY > 80 && modalContent.scrollTop === 0) cerrarModalDetalle();
    });
  }

  // ── Iniciar ────────────────────────────────────────────────────────────
  init();
});
