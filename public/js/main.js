// ==========================================================================
// 🍔 LÓGICA DEL MENÚ INTERACTIVO MÓVIL PREMIUM - PURO SABOR
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  // --- VARIABLES DE ESTADO ---
  let productos = [];
  let categorias = [];
  let categoriaActiva = '';
  let productoSeleccionado = null;
  let varianteActivaId = null;
  let swiperInstance = null;

  // Estado del Carrito
  let carrito = [];

  // --- ESTADO DE PAGINACIÓN ---
  let paginaActual = 1;
  let tieneProductosMas = true;
  let cargandoMas = false;
  let ultimoFiltro = { categoria: '', busqueda: '' };
  let lastSearchTerm = '';

  // --- ELEMENTOS DEL DOM ---
  const categoriesScroll = document.getElementById('categories-scroll');
  const searchInput = document.getElementById('search-input');
  
  // Elementos del Carrito y FABs
  const fabCart = document.getElementById('fab-cart');
  const cartBadge = document.getElementById('cart-badge');
  const cartOverlay = document.getElementById('cart-overlay');
  const btnCloseCart = document.getElementById('btn-close-cart');
  const cartItems = document.getElementById('cart-items');
  const cartTotalPrice = document.getElementById('cart-total-price');
  const btnCheckout = document.getElementById('btn-checkout');
  
  // Contenedores del Menú
  const migasCarouselSection = document.getElementById('migas-carousel-section');
  const swiperWrapperMigas = document.getElementById('swiper-wrapper-migas');
  const secondarySections = document.getElementById('secondary-sections');
  const searchResultsSection = document.getElementById('search-results-section');
  const productsGrid = document.getElementById('products-grid');
  
  // Elementos del Modal de Detalle (Bottom Sheet)
  const modalOverlay = document.getElementById('modal-overlay');
  const modalContent = document.getElementById('modal-content');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const modalImg = document.getElementById('modal-img');
  const modalCategory = document.getElementById('modal-category');
  const modalTitle = document.getElementById('modal-title');
  const modalPrice = document.getElementById('modal-price');
  const modalDesc = document.getElementById('modal-desc');

  // Elementos del Modal de Sugerencia
  const suggestionOverlay = document.getElementById('suggestion-overlay');
  const btnSuggestionYes = document.getElementById('btn-suggestion-yes');
  const btnSuggestionNo = document.getElementById('btn-suggestion-no');

  // --- INICIALIZACIÓN ---
  async function init() {
    mostrarCarga();

    // Cargar config global
    try {
      const resp = await fetch('/api/config');
      const result = await resp.json();
      if (result.success && result.data) {
        window.carruselNovedadesActivo = result.data.carrusel_novedades_activo === '1';
      }
    } catch (e) {
      window.carruselNovedadesActivo = true; // Por defecto
    }

    // Cargar categorías y productos iniciales (primera página)
    categorias = await API.getCategorias();
    productos = await API.getProductos({ page: 1, limit: 20 });

    paginaActual = 1;
    tieneProductosMas = productos.length >= 20;

    // Buscar la categoría 'Migas al Carbón' para activarla por defecto
    const catMigas = categorias.find(c => c.nombre.toLowerCase().includes('migas'));
    if (catMigas) {
      categoriaActiva = catMigas.id;
    } else {
      categoriaActiva = '';
    }

    renderCategorias();
    renderMenu();

    // Configurar escuchas de eventos
    configurarEventos();
    configurarLazyLoading();
  }

  // --- LAZY LOADING ---
  async function cargarMasProductos() {
    if (cargandoMas || !tieneProductosMas) return;

    cargandoMas = true;
    const pageToLoad = paginaActual + 1;
    const filtros = {
      page: pageToLoad,
      limit: 20,
      categoria_id: categoriaActiva || undefined,
      search: lastSearchTerm || undefined
    };

    try {
      const productosNuevos = await API.getProductos(filtros);
      if (productosNuevos && productosNuevos.length > 0) {
        productos = [...productos, ...productosNuevos];
        paginaActual = pageToLoad;
        tieneProductosMas = productosNuevos.length >= 20;
        // Renderizar solo las nuevas tarjetas en lugar de todo el menú
        anadirProductosAlMenu(productosNuevos);
      } else {
        tieneProductosMas = false;
      }
    } catch (error) {
      console.error('Error cargando más productos:', error);
    } finally {
      cargandoMas = false;
    }
  }

  function configurarLazyLoading() {
    window.addEventListener('scroll', () => {
      const scrollPosition = window.innerHeight + window.scrollY;
      const pageHeight = document.body.offsetHeight;
      // Cargar más cuando hay 500px hasta el final
      if (scrollPosition >= pageHeight - 500 && !cargandoMas && tieneProductosMas) {
        cargarMasProductos();
      }
    });
  }

  function anadirProductosAlMenu(productosNuevos) {
    const term = lastSearchTerm.trim().toLowerCase();
    const productosAgrupados = agruparProductos(productosNuevos);

    if (term.length > 0) {
      // En modo búsqueda, agregar a los resultados de búsqueda
      const filtrados = productosAgrupados.filter(p =>
        p.nombre.toLowerCase().includes(term) ||
        (p.descripcion && p.descripcion.toLowerCase().includes(term))
      );

      if (filtrados.length === 0) return;

      let gridHtml = '';
      filtrados.forEach(prod => {
        gridHtml += renderCardSecundaria(prod);
      });

      // Reemplazar mensaje "no encontrado" si existe
      if (productsGrid.innerHTML.includes('not-found-container')) {
        productsGrid.innerHTML = gridHtml;
      } else {
        productsGrid.innerHTML += gridHtml;
      }

      // Agregar eventos a las nuevas tarjetas
      agregarEventosClicGrid(filtrados, '.secondary-card');
    } else {
      // En modo normal, no se soporta lazy loading - rerenderizar todo
      // (Las secciones de Bebidas y Postres se muestran de una vez)
      // Para evitar replicación, solo renderizamos si hay espacio
      const catBebidas = categorias.find(c => c.nombre.toLowerCase().includes('bebidas'));
      const catPostres = categorias.find(c => c.nombre.toLowerCase().includes('postres'));

      const bebidasNuevas = productosAgrupados.filter(p => catBebidas && p.categoria_id === catBebidas.id);
      const postresNuevos = productosAgrupados.filter(p => catPostres && p.categoria_id === catPostres.id);

      // Encontrar secciones existentes y agregar productos
      const containers = secondarySections.querySelectorAll('.secondary-category-container');

      containers.forEach(container => {
        const title = container.querySelector('.section-title');
        const grid = container.querySelector('.secondary-grid');

        if (title && grid) {
          if (title.textContent.includes('Bebidas')) {
            bebidasNuevas.forEach(prod => {
              grid.innerHTML += renderCardSecundaria(prod);
            });
            if (bebidasNuevas.length > 0) {
              agregarEventosClicGrid(bebidasNuevas, '.secondary-card');
            }
          } else if (title.textContent.includes('Postres')) {
            postresNuevos.forEach(prod => {
              grid.innerHTML += renderCardSecundaria(prod);
            });
            if (postresNuevos.length > 0) {
              agregarEventosClicGrid(postresNuevos, '.secondary-card');
            }
          }
        }
      });
    }
  }

  // --- RENDERS ---

  // Mostrar un spinner de carga bonito
  function mostrarCarga() {
    swiperWrapperMigas.innerHTML = `
      <div class="loader-container" style="width: 100%;">
        <div class="spinner"></div>
        <p>Cocinando las especialidades...</p>
      </div>
    `;
    secondarySections.innerHTML = '';
    searchResultsSection.style.display = 'none';
  }

  // Agrupar productos con el mismo nombre base para admitir variantes de tamaño
  function agruparProductos(lista) {
    const agp = {};
    lista.forEach(prod => {
      // Intentar extraer el nombre base y el tamaño en paréntesis
      const match = prod.nombre.match(/^(.*?)\s*\((.*?)\)$/i);
      
      if (match) {
        const nombreBase = match[1].trim();
        const tamano = match[2].trim(); // "Pequeña", "Grande", "Mini 250 ml", "Personal", etc.
        
        if (!agp[nombreBase]) {
          agp[nombreBase] = {
            id: prod.id,
            nombre: nombreBase,
            descripcion: prod.descripcion,
            categoria_id: prod.categoria_id,
            categoria_nombre: prod.categoria_nombre,
            imagen_url: prod.imagen_url,
            disponible: 0,
            stock: 0,
            tiene_variantes: true,
            variantes: []
          };
        }
        
        let label = tamano;
        if (tamano.toLowerCase() === 'pequeña') {
          label = 'Pequeña (125 gr)';
        } else if (tamano.toLowerCase() === 'grande') {
          label = 'Grande (250 gr)';
        }
        
        agp[nombreBase].variantes.push({
          id: prod.id,
          nombreCompleto: prod.nombre,
          precio: prod.precio,
          stock: prod.stock,
          disponible: prod.disponible,
          tamano: label
        });
        
        if (prod.disponible && prod.stock > 0) {
          agp[nombreBase].disponible = 1;
        }
        agp[nombreBase].stock += prod.stock;
        
      } else {
        // Producto normal o con variantes desde DB
        agp[prod.nombre] = {
          id: prod.id,
          nombre: prod.nombre,
          descripcion: prod.descripcion,
          categoria_id: prod.categoria_id,
          categoria_nombre: prod.categoria_nombre,
          imagen_url: prod.imagen_url,
          precio: prod.precio,
          disponible: prod.disponible,
          stock: prod.stock,
          tiene_variantes: prod.tiene_variantes === 1,
          variantes: prod.variantes || []
        };
      }
    });
    
    return Object.values(agp);
  }

  // Renderizar pestañas de categorías
  function renderCategorias() {
    if (!categoriesScroll) return;

    let html = `
      <div class="category-tab ${categoriaActiva === '' ? 'active' : ''}" data-id="">
        <span class="category-emoji">🍽️</span> Todos
      </div>
    `;

    const emojis = {
      'Migas al Carbón': '🥩',
      'Bebidas': '🍹',
      'Postres': '🍰'
    };

    categorias.forEach(cat => {
      const emoji = emojis[cat.nombre] || '🍔';
      html += `
        <div class="category-tab ${categoriaActiva == cat.id ? 'active' : ''}" data-id="${cat.id}">
          <span class="category-emoji">${emoji}</span> ${cat.nombre}
        </div>
      `;
    });

    categoriesScroll.innerHTML = html;

    // Agregar eventos a las nuevas tabs
    document.querySelectorAll('.category-tab').forEach(tab => {
      tab.addEventListener('click', async () => {
        document.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        categoriaActiva = tab.getAttribute('data-id');

        // Limpiar búsqueda y resetear paginación
        searchInput.value = '';
        lastSearchTerm = '';
        paginaActual = 1;
        tieneProductosMas = true;

        mostrarCarga();
        const filtros = { page: 1, limit: 20 };
        if (categoriaActiva) {
          filtros.categoria_id = categoriaActiva;
        }
        productos = await API.getProductos(filtros);
        tieneProductosMas = productos.length >= 20;
        renderMenu();
      });
    });
  }

  // Renderizar la vista principal según filtros e interactividad
  function renderMenu() {
    const term = searchInput.value.trim().toLowerCase();
    const productosAgrupados = agruparProductos(productos);
    
    // Caso 1: Búsqueda activa
    if (term.length > 0) {
      migasCarouselSection.style.display = 'none';
      secondarySections.style.display = 'none';
      searchResultsSection.style.display = 'block';
      
      const filtrados = productosAgrupados.filter(p => 
        p.nombre.toLowerCase().includes(term) || 
        (p.descripcion && p.descripcion.toLowerCase().includes(term))
      );
      
      if (filtrados.length === 0) {
        productsGrid.innerHTML = `
          <div class="not-found-container" style="grid-column: 1 / -1;">
            <div class="not-found-icon">🕵️‍♂️</div>
            <p>No encontramos platos que coincidan con tu búsqueda.</p>
          </div>
        `;
        return;
      }
      
      let gridHtml = '';
      filtrados.forEach(prod => {
        gridHtml += renderCardSecundaria(prod);
      });
      productsGrid.innerHTML = gridHtml;
      
      // Asignar eventos de clic a las tarjetas de búsqueda
      agregarEventosClicGrid(filtrados, '.secondary-card');
      return;
    }
    
    // Caso 2: Sin búsqueda - Menú normal estructurado
    searchResultsSection.style.display = 'none';
    
    // Obtener las categorías por ID para segmentar
    const catMigas = categorias.find(c => c.nombre.toLowerCase().includes('migas'));
    const catBebidas = categorias.find(c => c.nombre.toLowerCase().includes('bebidas'));
    const catPostres = categorias.find(c => c.nombre.toLowerCase().includes('postres'));
    
    const migasItems = catMigas ? productosAgrupados.filter(p => p.categoria_id === catMigas.id) : [];
    const bebidasItems = catBebidas ? productosAgrupados.filter(p => p.categoria_id === catBebidas.id) : [];
    const postresItems = catPostres ? productosAgrupados.filter(p => p.categoria_id === catPostres.id) : [];
    
    // RENDER MIGA SLIDER 3D (Ahora Novedades)
    if (window.carruselNovedadesActivo) {
      migasCarouselSection.style.display = 'block';
      
      const noticias = [
        {
          titulo: '🔥 Lo más pedido',
          desc: 'Nuestras famosas Migas con Cerdo están siendo la sensación esta semana.',
          img: '/assets/images/miga_cerdo.png'
        },
        {
          titulo: '🎉 Evento Especial',
          desc: 'Ven con tus amigos y disfruta de música en vivo todos los viernes.',
          img: '/assets/images/default-food.jpg'
        },
        {
          titulo: '🛵 Domicilios Gratis',
          desc: 'Por compras superiores a $50.000 te llevamos el sabor hasta tu puerta.',
          img: '/assets/images/miga_mixta.jpg'
        }
      ];

      let sliderHtml = '';
      noticias.forEach(n => {
        sliderHtml += `
          <div class="swiper-slide">
            <div class="slide-image">
              <img src="${n.img}" alt="${n.titulo}" onerror="this.src='/assets/images/default-food.jpg'">
            </div>
            <div class="slide-content">
              <h4 class="slide-title" style="font-size: 1.2rem; color: var(--primary-color);">${n.titulo}</h4>
              <p class="slide-desc" style="font-size: 0.95rem; margin-top: 8px;">${n.desc}</p>
              <div class="slide-footer" style="justify-content: flex-end;">
                <button class="btn-slide-action" onclick="window.scrollTo(0, document.body.scrollHeight)">Saber más</button>
              </div>
            </div>
          </div>
        `;
      });
      swiperWrapperMigas.innerHTML = sliderHtml;
      
      // Inicializar Swiper 3D
      initSwiper();
    } else {
      migasCarouselSection.style.display = 'none';
    }
    
    // RENDER SECCIONES SECUNDARIAS
    let secHtml = '';
    
    // Render de Migas al Carbón (ahora en grid)
    if ((categoriaActiva === '' || (catMigas && categoriaActiva == catMigas.id)) && migasItems.length > 0) {
      secHtml += `
        <div class="secondary-category-container">
          <div class="section-header">
            <span class="section-tagline">Nuestra Especialidad</span>
            <h3 class="section-title">Migas al Carbón</h3>
          </div>
          <div class="secondary-grid">
      `;
      migasItems.forEach(prod => {
        secHtml += renderCardSecundaria(prod);
      });
      secHtml += `</div></div>`;
    }

    // Render de Bebidas
    if ((categoriaActiva === '' || (catBebidas && categoriaActiva == catBebidas.id)) && bebidasItems.length > 0) {
      secHtml += `
        <div class="secondary-category-container">
          <div class="section-header">
            <span class="section-tagline">Para Acompañar</span>
            <h3 class="section-title">Bebidas Refrescantes</h3>
          </div>
          <div class="secondary-grid">
      `;
      bebidasItems.forEach(prod => {
        secHtml += renderCardSecundaria(prod);
      });
      secHtml += `</div></div>`;
    }
    
    // Render de Postres
    if ((categoriaActiva === '' || (catPostres && categoriaActiva == catPostres.id)) && postresItems.length > 0) {
      secHtml += `
        <div class="secondary-category-container">
          <div class="section-header">
            <span class="section-tagline">El Toque Dulce</span>
            <h3 class="section-title">Postres Artesanales</h3>
          </div>
          <div class="secondary-grid">
      `;
      postresItems.forEach(prod => {
        secHtml += renderCardSecundaria(prod);
      });
      secHtml += `</div></div>`;
    }
    
    secondarySections.innerHTML = secHtml;
    secondarySections.style.display = 'block';
    
    // Unificar productos de la sección secundaria para vincular eventos de clic
    const secProductList = [...migasItems, ...bebidasItems, ...postresItems];
    agregarEventosClicGrid(secProductList, '.secondary-card');
  }

  // Helper para renderizar tarjeta secundaria de dos columnas
  function renderCardSecundaria(prod) {
    const precioHtml = getPrecioText(prod);
    return `
      <div class="secondary-card animate-fade-in-up" data-nombre="${prod.nombre}">
        <div class="secondary-card-image">
          <img src="${prod.imagen_url}?v=2" alt="${prod.nombre}" onerror="this.src='/assets/images/default-food.jpg'">
        </div>
        <div class="secondary-card-content">
          <h4 class="secondary-card-title">${prod.nombre}</h4>
          <div class="secondary-card-footer">
            <span class="secondary-card-price">${precioHtml}</span>
            <span class="secondary-card-btn">+ Info</span>
          </div>
        </div>
      </div>
    `;
  }

  // Obtener texto formateado del precio
  function getPrecioText(prod) {
    if (prod.variantes && prod.variantes.length > 0) {
      // Legacy variants had .precio, DB variants inherit from parent
      const precios = prod.variantes.map(v => v.precio !== undefined ? v.precio : prod.precio).sort((a, b) => a - b);
      return `Desde $${precios[0].toLocaleString('es-CO', { minimumFractionDigits: 0 })} COP`;
    }
    return `$${prod.precio.toLocaleString('es-CO', { minimumFractionDigits: 0 })} COP`;
  }

  // Vincular eventos de clic en las tarjetas de catálogo para abrir modal
  function agregarEventosClicGrid(productList, selector) {
    document.querySelectorAll(selector).forEach(card => {
      card.addEventListener('click', () => {
        const nombre = card.getAttribute('data-nombre');
        const prod = productList.find(p => p.nombre === nombre);
        if (prod) {
          abrirModalDetalle(prod);
        }
      });
    });
  }

  // --- SWIPER CAROUSEL 3D INITIALIZATION ---
  function initSwiper() {
    if (swiperInstance) {
      swiperInstance.destroy(true, true);
    }
    
    swiperInstance = new Swiper('.mySwiper', {
      effect: 'coverflow',
      grabCursor: true,
      centeredSlides: true,
      slidesPerView: 'auto',
      coverflowEffect: {
        rotate: 15,
        stretch: 5,
        depth: 80,
        modifier: 1.2,
        slideShadows: false,
      },
      pagination: {
        el: '.swiper-pagination',
        clickable: true,
      },
    });
  }

  // --- MÓDULO DE DETALLE (BOTTOM SHEET) ---

  function actualizarPrecioModal(id, precio) {
    varianteActivaId = id;
    modalPrice.textContent = `$${precio.toLocaleString('es-CO', { minimumFractionDigits: 0 })} COP`;
  }

  // Abrir modal de detalles (Bottom Sheet)
  function abrirModalDetalle(prodGrouped) {
    productoSeleccionado = prodGrouped;
    
    modalImg.src = prodGrouped.imagen_url + '?v=2';
    modalImg.onerror = () => { modalImg.src = '/assets/images/default-food.jpg'; };
    modalCategory.textContent = prodGrouped.categoria_nombre;
    modalTitle.textContent = prodGrouped.nombre;
    modalDesc.textContent = prodGrouped.descripcion || 'Preparado diariamente con técnicas artesanales sobre parrilla al carbón e ingredientes frescos de primera.';

    const sizeContainer = document.getElementById('modal-size-container');
    
    if (prodGrouped.tiene_variantes && prodGrouped.variantes && prodGrouped.variantes.length > 0) {
      sizeContainer.style.display = 'block';
      
      // Mostrar solo variantes con stock > 0
      const varDisponibles = prodGrouped.variantes.filter(v => v.stock > 0);

      if (varDisponibles.length > 0) {
        let sizeHtml = `
          <span class="modal-size-label">Selecciona el Sabor / Variante:</span>
          <div class="size-options">
        `;
        
        varDisponibles.forEach((v, idx) => {
          const activeClass = idx === 0 ? 'active' : '';
          // Toma el precio de la variante (antiguos) o hereda del padre (nuevos)
          const precioVar = v.precio !== undefined ? v.precio : prodGrouped.precio; 
          const nombreVar = v.nombre || v.tamano || 'Variante';
          
          sizeHtml += `
            <button class="size-option-btn ${activeClass}" data-id="${v.id}" data-price="${precioVar}" data-disponible="1" data-name="${nombreVar}">
              <span>${nombreVar}</span>
              <span class="size-price">$${precioVar.toLocaleString('es-CO', { minimumFractionDigits: 0 })} COP</span>
            </button>
          `;
        });
        
        sizeHtml += `</div>`;
        sizeContainer.innerHTML = sizeHtml;
      } else {
        sizeContainer.innerHTML = `<span class="modal-size-label" style="color:var(--danger)">Agotado en todas sus variantes</span>`;
      }

      if (varDisponibles && varDisponibles.length > 0) {
        const seleccionada = varDisponibles[0];
        const precioSeleccionada = seleccionada.precio !== undefined ? seleccionada.precio : prodGrouped.precio;
        actualizarPrecioModal(seleccionada.id, precioSeleccionada);

        document.querySelectorAll('.size-option-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation(); // Evitar propagación
            document.querySelectorAll('.size-option-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const id = parseInt(btn.getAttribute('data-id'));
            const price = parseFloat(btn.getAttribute('data-price'));
            
            actualizarPrecioModal(id, price);
          });
        });
      }

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

  // --- LÓGICA DEL CARRITO ---
  
  function abrirCarrito() {
    cartOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function cerrarCarrito() {
    cartOverlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  function agregarAlCarrito(idSeleccionado) {
    let productoAgregado = null;
    
    // 1. Buscar si el id corresponde al producto padre directamente
    let prodPadre = productos.find(p => p.id === idSeleccionado);
    if (prodPadre) {
      productoAgregado = { ...prodPadre };
    } else {
      // 2. Si no, buscar si corresponde al id de una variante
      for (const p of productos) {
        if (p.variantes && p.variantes.length > 0) {
          const varEncontrada = p.variantes.find(v => v.id === idSeleccionado);
          if (varEncontrada) {
            productoAgregado = {
              ...p,
              id: varEncontrada.id, // Guardamos en el carrito con el ID de la variante
              producto_id: p.id,
              nombre: p.nombre + ' (' + varEncontrada.tamano + ')',
              precio: varEncontrada.precio
            };
            break;
          }
        }
      }
    }

    if (!productoAgregado) {
      console.error("Producto o variante no encontrada:", idSeleccionado);
      return;
    }

    const itemExistente = carrito.find(item => item.id === productoAgregado.id);
    
    if (itemExistente) {
      itemExistente.cantidad += 1;
    } else {
      carrito.push({
        ...productoAgregado,
        cantidad: 1
      });
    }
    
    actualizarCarrito();
    cerrarModalDetalle();
    
    // Animación de feedback en el FAB
    fabCart.style.transform = 'scale(1.2)';
    setTimeout(() => fabCart.style.transform = '', 200);

    // Sugerencia de Bebidas (Opción 1)
    // Mostrar sugerencia solo si el producto agregado NO es de categoría bebidas o postres
    const catName = productoAgregado.categoria_nombre || productoAgregado.categoria || '';
    const cat = catName.toLowerCase();
    if (!cat.includes('bebida') && !cat.includes('postre') && cat !== '') {
      setTimeout(() => mostrarSugerenciaBebidas(), 300); // Pequeño retraso para que se vea natural
    }
  }

  function mostrarSugerenciaBebidas() {
    suggestionOverlay.classList.add('open');
  }

  function cerrarSugerenciaBebidas() {
    suggestionOverlay.classList.remove('open');
  }

  function eliminarDelCarrito(productoId) {
    carrito = carrito.filter(item => item.id !== productoId);
    actualizarCarrito();
  }

  function cambiarCantidadCarrito(productoId, delta) {
    const item = carrito.find(item => item.id === productoId);
    if (!item) return;
    
    item.cantidad += delta;
    if (item.cantidad <= 0) {
      eliminarDelCarrito(productoId);
    } else {
      actualizarCarrito();
    }
  }

  function actualizarCarrito() {
    let totalPrecio = 0;
    let totalItems = 0;
    
    carrito.forEach(item => {
      totalPrecio += item.precio * item.cantidad;
      totalItems += item.cantidad;
    });
    
    if (totalItems > 0) {
      cartBadge.style.display = 'flex';
      cartBadge.textContent = totalItems;
      btnCheckout.disabled = false;
    } else {
      cartBadge.style.display = 'none';
      btnCheckout.disabled = true;
    }
    
    cartTotalPrice.textContent = `$${totalPrecio.toLocaleString('es-CO', { minimumFractionDigits: 0 })} COP`;
    renderizarItemsCarrito();
  }

  function renderizarItemsCarrito() {
    if (carrito.length === 0) {
      cartItems.innerHTML = '<div class="empty-cart-msg">Tu carrito está vacío.</div>';
      return;
    }
    
    let html = '';
    carrito.forEach(item => {
      html += `
        <div class="cart-item">
          <img class="cart-item-img" src="${item.imagen_url}?v=2" alt="${item.nombre}" onerror="this.src='/assets/images/default-food.jpg'">
          <div class="cart-item-details">
            <h4 class="cart-item-title">${item.nombre}</h4>
            <div class="cart-item-price">$${(item.precio * item.cantidad).toLocaleString('es-CO', { minimumFractionDigits: 0 })}</div>
            <div class="cart-item-actions">
              <button class="btn-qty" onclick="window.cambiarCantidad(${item.id}, -1)">-</button>
              <span class="item-qty">${item.cantidad}</span>
              <button class="btn-qty" onclick="window.cambiarCantidad(${item.id}, 1)">+</button>
            </div>
          </div>
          <button class="btn-remove-item" onclick="window.eliminarItem(${item.id})">&times;</button>
        </div>
      `;
    });
    cartItems.innerHTML = html;
  }
  
  // Exponer globales para onclick
  window.cambiarCantidad = cambiarCantidadCarrito;
  window.eliminarItem = eliminarDelCarrito;

  function enviarPedidoWhatsApp() {
    if (carrito.length === 0) return;
    
    const nameInput = document.getElementById('customer-name-input');
    const customerName = nameInput ? nameInput.value.trim() : '';

    if (!customerName) {
      if (nameInput) {
        nameInput.classList.add('error');
        nameInput.style.borderColor = '#e74c3c'; // Rojo
        nameInput.focus();
        
        // Remover el error cuando el usuario empiece a escribir
        nameInput.addEventListener('input', function onInput() {
          nameInput.classList.remove('error');
          nameInput.style.borderColor = 'var(--primary-color)';
          nameInput.removeEventListener('input', onInput);
        });
      }
      return;
    }
    
    let texto = `¡Hola! Quiero hacer un pedido en *Puro Sabor* a nombre de *${customerName}*:%0A%0A`;
    let total = 0;
    
    carrito.forEach(item => {
      let subtotal = item.precio * item.cantidad;
      total += subtotal;
      texto += `▪️ ${item.cantidad}x ${item.nombre} - $${subtotal.toLocaleString('es-CO')}%0A`;
    });
    
    texto += `%0A*Total: $${total.toLocaleString('es-CO')}*`;
    
    const numero = '573142146407';
    window.open(`https://wa.me/${numero}?text=${texto}`, '_blank');
  }

  // --- CONTROLADORES DE EVENTOS ---

  function configurarEventos() {
    let timeoutBusqueda = null;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(timeoutBusqueda);
      const nuevoTermino = searchInput.value.trim().toLowerCase();

      // Si cambió el término de búsqueda, resetear paginación
      if (nuevoTermino !== lastSearchTerm) {
        paginaActual = 1;
        tieneProductosMas = true;
        lastSearchTerm = nuevoTermino;
      }

      timeoutBusqueda = setTimeout(() => {
        renderMenu();
      }, 300);
    });

    btnCloseModal.addEventListener('click', (e) => {
      e.stopPropagation();
      cerrarModalDetalle();
    });
    
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) {
        cerrarModalDetalle();
      }
    });

    let touchStartY = 0;
    modalContent.addEventListener('touchstart', (e) => {
      touchStartY = e.touches[0].clientY;
    });

    modalContent.addEventListener('touchend', (e) => {
      let touchEndY = e.changedTouches[0].clientY;
      if (touchEndY - touchStartY > 80 && modalContent.scrollTop === 0) {
        cerrarModalDetalle();
      }
    });

    // Eventos del Carrito
    fabCart.addEventListener('click', abrirCarrito);
    btnCloseCart.addEventListener('click', cerrarCarrito);
    cartOverlay.addEventListener('click', (e) => {
      if (e.target === cartOverlay) cerrarCarrito();
    });
    btnCheckout.addEventListener('click', enviarPedidoWhatsApp);

    // Botón Agregar al Carrito del Modal
    const btnAddToCart = document.getElementById('btn-add-to-cart');
    if (btnAddToCart) {
      btnAddToCart.addEventListener('click', () => {
        if (varianteActivaId) {
          agregarAlCarrito(varianteActivaId);
        }
      });
    }

    // Eventos del Modal de Sugerencia
    if (btnSuggestionYes) {
      btnSuggestionYes.addEventListener('click', async () => {
        cerrarSugerenciaBebidas();
        
        // Buscar el ID real de la categoría "Bebidas"
        const catBebidas = categorias.find(c => c.nombre.toLowerCase().includes('bebida'));
        const bebidaId = catBebidas ? catBebidas.id : '';

        // Limpiar búsqueda y resetear paginación
        searchInput.value = '';
        lastSearchTerm = '';
        ultimoFiltro = { categoria: bebidaId, busqueda: '' };
        categoriaActiva = bebidaId; // MUY IMPORTANTE: Actualizar el estado activo
        renderCategorias();
        paginaActual = 1;
        tieneProductosMas = true;
        
        // Fetch de productos (ya que no existe cargarProductos)
        mostrarCarga();
        const filtros = { page: 1, limit: 20 };
        if (bebidaId) {
          filtros.categoria_id = bebidaId;
        }
        productos = await API.getProductos(filtros);
        tieneProductosMas = productos.length >= 20;
        renderMenu();
        
        // Desplazarse a la cuadrícula de productos para ver las bebidas
        setTimeout(() => {
          const grid = document.getElementById('secondary-sections');
          if (grid) {
            grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 100); // Pequeño retraso para asegurar que el DOM se pintó
      });
    }

    if (btnSuggestionNo) {
      btnSuggestionNo.addEventListener('click', cerrarSugerenciaBebidas);
    }
    
    if (suggestionOverlay) {
      suggestionOverlay.addEventListener('click', (e) => {
        if (e.target === suggestionOverlay) cerrarSugerenciaBebidas();
      });
    }
  }

  // --- EJECUCIÓN INICIAL ---
  init();
});
