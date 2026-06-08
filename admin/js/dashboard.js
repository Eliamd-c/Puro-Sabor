// ==========================================================================
// 🎛️ LÓGICA DEL PANEL DE CONTROL (DASHBOARD) - PURO SABOR
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  // --- VARIABLES DE ESTADO ---
  const token = localStorage.getItem('puro_sabor_admin_token');
  const adminUser = JSON.parse(localStorage.getItem('puro_sabor_admin_user'));
  
  let productos = [];
  let categorias = [];
  let productoEliminarId = null;

  // Si no está autenticado, redirigir inmediatamente a login
  if (!token) {
    window.location.href = '/admin/index.html';
    return;
  }

  // --- ELEMENTOS DEL DOM ---
  const adminDisplayName = document.getElementById('admin-display-name');
  const btnLogout = document.getElementById('btn-logout');
  
  // KPIs
  const kpiTotalProducts = document.getElementById('kpi-total-products');
  const kpiOutStock = document.getElementById('kpi-out-stock');
  const kpiLowStock = document.getElementById('kpi-low-stock');

  // Filtros de Tabla
  const adminSearchInput = document.getElementById('admin-search-input');
  const adminFilterCategory = document.getElementById('admin-filter-category');
  const productsTableBody = document.getElementById('admin-products-table-body');

  // Modales
  const productModal = document.getElementById('product-modal');
  const btnOpenAddProduct = document.getElementById('btn-open-add-product');
  const btnCloseProductModal = document.getElementById('btn-close-product-modal');
  const btnCancelProductModal = document.getElementById('btn-cancel-product-modal');
  
  const productForm = document.getElementById('product-form');
  const modalFormTitle = document.getElementById('modal-form-title');
  const productIdField = document.getElementById('product-id-field');
  const prodName = document.getElementById('prod-name');
  const prodCategory = document.getElementById('prod-category');
  const prodPrice = document.getElementById('prod-price');
  const prodStock = document.getElementById('prod-stock');
  const prodAvailable = document.getElementById('prod-available');
  const prodDesc = document.getElementById('prod-desc');
  const prodImageFile = document.getElementById('prod-image-file');
  const prodImageUrlExistente = document.getElementById('prod-image-url-existente');
  const imageUploadPreview = document.getElementById('image-upload-preview');

  // Modal Eliminar
  const confirmDeleteModal = document.getElementById('confirm-delete-modal');
  const btnCancelDelete = document.getElementById('btn-cancel-delete');
  const btnConfirmDelete = document.getElementById('btn-confirm-delete');

  // --- INICIALIZACIÓN ---
  function init() {
    // Configurar información de usuario
    if (adminUser && adminDisplayName) {
      adminDisplayName.textContent = adminUser.usuario;
    }

    // Cargar datos principales
    cargarFiltrosYDatos();

    // Registrar escuchas de eventos generales
    configurarEventos();
  }

  // --- LOGICA DE DATOS & API ---

  async function cargarFiltrosYDatos() {
    await cargarCategorias();
    await cargarProductos();
  }

  // Cargar categorías en filtros y en formularios de modales
  async function cargarCategorias() {
    try {
      const response = await fetch('/api/categorias');
      const result = await response.json();
      
      if (result.success) {
        categorias = result.data;
        
        // Renderizar en el select de filtros de tabla
        let filterHtml = '<option value="">Todas las categorías</option>';
        // Renderizar en el select del modal de producto
        let modalHtml = '<option value="" disabled selected>Selecciona categoría...</option>';
        
        categorias.forEach(cat => {
          filterHtml += `<option value="${cat.id}">${cat.nombre}</option>`;
          modalHtml += `<option value="${cat.id}">${cat.nombre}</option>`;
        });
        
        adminFilterCategory.innerHTML = filterHtml;
        prodCategory.innerHTML = modalHtml;
      }
    } catch (error) {
      console.error('Error al cargar categorías:', error);
    }
  }

  // Cargar productos con filtros desde API
  async function cargarProductos() {
    const buscar = adminSearchInput.value.trim();
    const categoriaId = adminFilterCategory.value;
    
    try {
      const params = new URLSearchParams();
      if (buscar) params.append('buscar', buscar);
      if (categoriaId) params.append('categoria_id', categoriaId);

      const response = await fetch(`/api/productos/admin/list?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      const result = await response.json();
      
      if (result.success) {
        productos = result.data;
        renderTablaProductos();
        actualizarKPIs();
      } else {
        // Si hay error de autenticación (token expirado)
        if (response.status === 401) {
          manejarSesionExpirada();
        }
      }
    } catch (error) {
      console.error('Error al cargar productos:', error);
      productsTableBody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 40px; color: var(--danger); font-weight: bold;">
            Error en la conexión con el servidor.
          </td>
        </tr>
      `;
    }
  }

  // Renderizar filas de tabla de productos
  function renderTablaProductos() {
    if (productos.length === 0) {
      productsTableBody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 40px; color: var(--text-secondary);">
            No se encontraron productos en el inventario.
          </td>
        </tr>
      `;
      return;
    }

    let html = '';
    productos.forEach(prod => {
      const isChecked = prod.disponible ? 'checked' : '';
      
      html += `
        <tr data-id="${prod.id}">
          <td class="cell-image">
            <img src="${prod.imagen_url}" alt="${prod.nombre}" onerror="this.src='/assets/images/default-food.jpg'">
          </td>
          <td>
            <div class="cell-name">${prod.nombre}</div>
            <div class="cell-desc">${prod.descripcion || 'Sin descripción.'}</div>
          </td>
          <td class="cell-category">${prod.categoria_nombre}</td>
          <td class="cell-price">$${prod.precio.toFixed(2)}</td>
          <td>
            <div class="cell-stock">
              <input type="number" class="stock-input" value="${prod.stock}" min="0" data-id="${prod.id}">
              <button class="btn-stock-save" data-id="${prod.id}" title="Guardar stock">✓</button>
            </div>
          </td>
          <td>
            <label class="switch">
              <input type="checkbox" class="toggle-availability" data-id="${prod.id}" ${isChecked}>
              <span class="slider-toggle"></span>
            </label>
          </td>
          <td>
            <div class="btn-action-group">
              <button class="btn-icon btn-edit" data-id="${prod.id}" title="Editar producto">
                <svg viewBox="0 0 24 24">
                  <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                </svg>
              </button>
              <button class="btn-icon btn-delete" data-id="${prod.id}" title="Eliminar producto">
                <svg viewBox="0 0 24 24">
                  <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                </svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    });

    productsTableBody.innerHTML = html;
    
    // Asignar escuchadores dinámicos de las celdas
    configurarEventosFila();
  }

  // Calcular KPIs en base a productos en tiempo real
  function actualizarKPIs() {
    const total = productos.length;
    const agotados = productos.filter(p => p.stock === 0 || !p.disponible).length;
    const bajoStock = productos.filter(p => p.stock > 0 && p.stock < 5).length;

    kpiTotalProducts.textContent = total;
    kpiOutStock.textContent = agotados;
    kpiLowStock.textContent = bajoStock;
  }

  // --- CONTROL DE MODALES (CRUD) ---

  function abrirModalProducto(producto = null) {
    if (producto) {
      // Editar
      modalFormTitle.textContent = 'Editar Producto';
      productIdField.value = producto.id;
      prodName.value = producto.nombre;
      prodCategory.value = producto.categoria_id;
      prodPrice.value = producto.precio;
      prodStock.value = producto.stock;
      prodAvailable.checked = producto.disponible;
      prodDesc.value = producto.descripcion || '';
      prodImageUrlExistente.value = producto.imagen_url;
      
      imageUploadPreview.innerHTML = `<img src="${producto.imagen_url}" onerror="this.src='/assets/images/default-food.jpg'">`;
    } else {
      // Crear
      modalFormTitle.textContent = 'Añadir Nuevo Producto';
      productForm.reset();
      productIdField.value = '';
      prodImageUrlExistente.value = '';
      imageUploadPreview.innerHTML = `<span style="font-size: 24px; color: var(--text-muted);">🍽️</span>`;
    }
    
    productModal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function cerrarModalProducto() {
    productModal.classList.remove('open');
    document.body.style.overflow = '';
  }

  function abrirModalEliminar(id) {
    productoEliminarId = id;
    confirmDeleteModal.classList.add('open');
  }

  function cerrarModalEliminar() {
    confirmDeleteModal.classList.remove('open');
    productoEliminarId = null;
  }

  // --- CONTROLADORES DE EVENTOS ---

  function configurarEventos() {
    // Cerrar sesión
    btnLogout.addEventListener('click', async () => {
      try {
        await fetch('/api/admin/logout', { method: 'POST' });
      } catch (err) {
        console.error(err);
      }
      localStorage.removeItem('puro_sabor_admin_token');
      localStorage.removeItem('puro_sabor_admin_user');
      window.location.href = '/admin/index.html';
    });

    // Filtros
    let searchTimeout = null;
    adminSearchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(cargarProductos, 300);
    });

    adminFilterCategory.addEventListener('change', cargarProductos);

    // Modales disparadores
    btnOpenAddProduct.addEventListener('click', () => abrirModalProducto());
    btnCloseProductModal.addEventListener('click', cerrarModalProducto);
    btnCancelProductModal.addEventListener('click', cerrarModalProducto);
    
    btnCancelDelete.addEventListener('click', cerrarModalEliminar);

    // Preview de subida de imagen localmente
    prodImageFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          imageUploadPreview.innerHTML = `<img src="${event.target.result}">`;
        };
        reader.readAsDataURL(file);
      }
    });

    // Envío del Formulario (Guardar / Actualizar)
    productForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const id = productIdField.value;
      const formData = new FormData();
      
      formData.append('nombre', prodName.value.trim());
      formData.append('categoria_id', prodCategory.value);
      formData.append('precio', prodPrice.value);
      formData.append('stock', prodStock.value || 0);
      formData.append('disponible', prodAvailable.checked);
      formData.append('descripcion', prodDesc.value.trim());
      
      if (prodImageFile.files[0]) {
        formData.append('imagen', prodImageFile.files[0]);
      } else if (prodImageUrlExistente.value) {
        formData.append('imagen_url_existente', prodImageUrlExistente.value);
      }

      const url = id ? `/api/productos/admin/${id}` : '/api/productos/admin';
      const method = id ? 'PUT' : 'POST';

      try {
        const response = await fetch(url, {
          method: method,
          headers: {
            'Authorization': `Bearer ${token}`
          },
          body: formData
        });

        const result = await response.json();

        if (result.success) {
          cerrarModalProducto();
          cargarProductos();
        } else {
          alert(result.message || 'Error al guardar el producto.');
          if (response.status === 401) manejarSesionExpirada();
        }
      } catch (error) {
        console.error('Error al guardar:', error);
        alert('Error al comunicarse con el servidor.');
      }
    });

    // Confirmar eliminación física
    btnConfirmDelete.addEventListener('click', async () => {
      if (!productoEliminarId) return;

      try {
        const response = await fetch(`/api/productos/admin/${productoEliminarId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        const result = await response.json();

        if (result.success) {
          cerrarModalEliminar();
          cargarProductos();
        } else {
          alert(result.message || 'Error al eliminar el producto.');
          if (response.status === 401) manejarSesionExpirada();
        }
      } catch (error) {
        console.error('Error al eliminar:', error);
        alert('Error en el servidor al intentar eliminar.');
      }
    });
  }

  function configurarEventosFila() {
    // 1. Guardado rápido de stock
    document.querySelectorAll('.btn-stock-save').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.getAttribute('data-id'));
        const input = document.querySelector(`.stock-input[data-id="${id}"]`);
        const stockVal = parseInt(input.value);

        if (isNaN(stockVal) || stockVal < 0) {
          alert('Por favor ingresa un stock válido mayor o igual a 0.');
          return;
        }

        try {
          const response = await fetch(`/api/productos/admin/${id}/stock`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ stock: stockVal })
          });

          const result = await response.json();

          if (result.success) {
            // Estilo verde de éxito temporal en el botón
            btn.textContent = '✓';
            btn.style.background = 'var(--success)';
            setTimeout(() => {
              btn.textContent = '✓';
              btn.style.background = 'var(--primary)';
            }, 1500);
            
            // Recargar productos localmente para refrescar KPIs
            // Buscamos el producto en la lista y le actualizamos el stock
            const prod = productos.find(p => p.id === id);
            if (prod) {
              prod.stock = stockVal;
              // Si el stock llega a 0, también actualizamos su disponibilidad visual
              if (stockVal === 0) {
                prod.disponible = false;
                const toggle = document.querySelector(`.toggle-availability[data-id="${id}"]`);
                if (toggle) toggle.checked = false;
              }
              actualizarKPIs();
            }
          } else {
            alert(result.message);
            if (response.status === 401) manejarSesionExpirada();
          }
        } catch (error) {
          console.error(error);
          alert('Error de conexión.');
        }
      });
    });

    // 2. Toggle rápido de disponibilidad
    document.querySelectorAll('.toggle-availability').forEach(toggle => {
      toggle.addEventListener('change', async () => {
        const id = parseInt(toggle.getAttribute('data-id'));
        const prod = productos.find(p => p.id === id);
        if (!prod) return;

        const dispVal = toggle.checked;

        // Si intentamos activar la disponibilidad pero el stock es 0, advertir y no dejar si es el caso,
        // o dejarlo (y la API maneja la disponibilidad aparte). En nuestro caso, la API actualiza disponibilidad
        // independiente, pero es amigable sincronizar.
        try {
          const formData = new FormData();
          formData.append('nombre', prod.nombre);
          formData.append('categoria_id', prod.categoria_id);
          formData.append('precio', prod.precio);
          formData.append('stock', prod.stock);
          formData.append('disponible', dispVal);
          formData.append('imagen_url_existente', prod.imagen_url);

          const response = await fetch(`/api/productos/admin/${id}`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`
            },
            body: formData
          });

          const result = await response.json();

          if (result.success) {
            prod.disponible = dispVal;
            actualizarKPIs();
          } else {
            toggle.checked = !dispVal; // Revertir cambio
            alert(result.message);
            if (response.status === 401) manejarSesionExpirada();
          }
        } catch (error) {
          toggle.checked = !dispVal; // Revertir
          console.error(error);
        }
      });
    });

    // 3. Editar Producto
    document.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.getAttribute('data-id'));
        const prod = productos.find(p => p.id === id);
        if (prod) {
          abrirModalProducto(prod);
        }
      });
    });

    // 4. Eliminar Producto
    document.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.getAttribute('data-id'));
        abrirModalEliminar(id);
      });
    });
  }

  function manejarSesionExpirada() {
    alert('Tu sesión ha expirado. Por favor inicia sesión de nuevo.');
    localStorage.removeItem('puro_sabor_admin_token');
    localStorage.removeItem('puro_sabor_admin_user');
    window.location.href = '/admin/index.html';
  }

  // --- EJECUCIÓN INICIAL ---
  init();
});
