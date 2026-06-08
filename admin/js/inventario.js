// ==========================================================================
// 📈 LÓGICA DE INVENTARIO Y ASISTENTE IA - PURO SABOR
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  // --- VARIABLES DE ESTADO ---
  const token = localStorage.getItem('puro_sabor_admin_token');
  const adminUser = JSON.parse(localStorage.getItem('puro_sabor_admin_user'));
  
  let productos = [];
  let socket = null;

  // Redirigir a login si no está autenticado
  if (!token) {
    window.location.href = '/admin/index.html';
    return;
  }

  // --- ELEMENTOS DEL DOM ---
  const adminDisplayName = document.getElementById('admin-display-name');
  const btnLogout = document.getElementById('btn-logout');
  
  // KPIs
  const kpiTotalProducts = document.getElementById('kpi-total-products');
  const kpiLowStock = document.getElementById('kpi-low-stock');
  const waKpiBadge = document.getElementById('wa-kpi-badge');

  // Tabla y Búsqueda
  const inventarioSearchInput = document.getElementById('inventario-search-input');
  const inventarioTableBody = document.getElementById('inventario-table-body');

  // WhatsApp y Configuración IA
  const waQrContainer = document.getElementById('wa-qr-container');
  const btnReconnectWa = document.getElementById('btn-reconnect-wa');
  
  const formConfigAi = document.getElementById('form-config-ai');
  const geminiKeyInput = document.getElementById('gemini-key');
  const btnToggleGeminiKey = document.getElementById('btn-toggle-gemini-key');
  const whitelistNumbersInput = document.getElementById('whitelist-numbers');
  const botActiveToggle = document.getElementById('bot-active-toggle');
  const configAiAlert = document.getElementById('config-ai-alert');

  // --- INICIALIZACIÓN ---
  function init() {
    // Configurar sidebar con nombre de admin
    if (adminDisplayName && adminUser) {
      adminDisplayName.textContent = adminUser.usuario;
    }

    // Configurar Logout
    if (btnLogout) {
      btnLogout.addEventListener('click', () => {
        localStorage.removeItem('puro_sabor_admin_token');
        localStorage.removeItem('puro_sabor_admin_user');
        window.location.href = '/admin/index.html';
      });
    }

    // Cargar Datos Iniciales
    cargarProductos();
    cargarConfiguracionIA();

    // Conectar por WebSockets
    conectarSocket();

    // Configurar Eventos de Búsqueda y Formulario
    setupEventListeners();
  }

  // --- OBTENER PRODUCTOS DEL INVENTARIO ---
  async function cargarProductos() {
    try {
      const response = await fetch('/api/productos');
      const result = await response.json();

      if (result.success) {
        productos = result.data;
        renderizarTabla(productos);
        actualizarKPIs();
      } else {
        console.error('Error al cargar productos:', result.message);
        mostrarAlertaTabla('Error al cargar productos del servidor.');
      }
    } catch (error) {
      console.error('Error en fetch de productos:', error);
      mostrarAlertaTabla('Error de conexión al obtener productos.');
    }
  }

  // --- CARGAR CONFIGURACIÓN DE IA DESDE EL SERVIDOR ---
  async function cargarConfiguracionIA() {
    try {
      const response = await fetch('/api/inventario/config-ai', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const result = await response.json();

      if (result.success) {
        const config = result.data;
        geminiKeyInput.value = config.gemini_api_key || '';
        whitelistNumbersInput.value = config.whatsapp_whitelist || '';
        botActiveToggle.checked = config.whatsapp_bot_active;
        
        // Actualizar el estado visual del QR / Conexión
        actualizarEstadoWhatsApp(config.bot_status, config.bot_qr);
      }
    } catch (error) {
      console.error('Error cargando configuración de IA:', error);
    }
  }

  // --- RENDERIZAR TABLA DE INVENTARIO ---
  function renderizarTabla(listaProductos) {
    inventarioTableBody.innerHTML = '';

    if (listaProductos.length === 0) {
      inventarioTableBody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 40px; color: var(--text-secondary);">
            No se encontraron productos en el inventario.
          </td>
        </tr>`;
      return;
    }

    listaProductos.forEach(prod => {
      const tr = document.createElement('tr');
      tr.className = 'animate-fade-in-up';
      
      // Determinar clase para píldora de stock
      let stockClass = 'success';
      let stockLabel = 'Disponible';
      if (prod.stock === 0) {
        stockClass = 'danger';
        stockLabel = 'Agotado';
      } else if (prod.stock < 5) {
        stockClass = 'warning';
        stockLabel = 'Bajo Stock';
      }

      tr.innerHTML = `
        <td class="cell-image">
          <img src="${prod.imagen_url || '/assets/images/placeholder.png'}" alt="${prod.nombre}" onerror="this.src='/assets/images/placeholder.png'">
        </td>
        <td>
          <div style="font-weight: 700; color: var(--text-primary);">${prod.nombre}</div>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">ID: ${prod.id}</div>
        </td>
        <td class="cell-category">${prod.categoria_nombre || 'Sin Categoría'}</td>
        <td>
          <div class="stock-adjust-group">
            <button class="btn-stock-adjust btn-decrement-five" data-id="${prod.id}">-5</button>
            <button class="btn-stock-adjust btn-decrement-one" data-id="${prod.id}">-1</button>
            <input type="number" class="stock-display-input" data-id="${prod.id}" value="${prod.stock}" min="0">
            <button class="btn-stock-adjust btn-increment-one" data-id="${prod.id}">+1</button>
            <button class="btn-stock-adjust btn-increment-five" data-id="${prod.id}">+5</button>
          </div>
        </td>
        <td style="text-align: right;">
          <span class="status-pill ${stockClass}" id="pill-${prod.id}">${stockLabel}</span>
        </td>
      `;

      inventarioTableBody.appendChild(tr);
    });

    setupTablaEventos();
  }

  // --- CONFIGURAR EVENTOS DENTRO DE LA TABLA ---
  function setupTablaEventos() {
    // Eventos de botones rápido (+ y -)
    inventarioTableBody.querySelectorAll('.btn-stock-adjust').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = parseInt(btn.getAttribute('data-id'));
        const input = inventarioTableBody.querySelector(`.stock-display-input[data-id="${id}"]`);
        if (!input) return;

        let delta = 0;
        if (btn.classList.contains('btn-decrement-five')) delta = -5;
        else if (btn.classList.contains('btn-decrement-one')) delta = -1;
        else if (btn.classList.contains('btn-increment-one')) delta = 1;
        else if (btn.classList.contains('btn-increment-five')) delta = 5;

        let nuevoStock = Math.max(0, parseInt(input.value) + delta);
        input.value = nuevoStock;
        
        guardarStockServidor(id, nuevoStock);
      });
    });

    // Eventos al cambiar el input a mano
    inventarioTableBody.querySelectorAll('.stock-display-input').forEach(input => {
      input.addEventListener('change', () => {
        const id = parseInt(input.getAttribute('data-id'));
        let nuevoStock = Math.max(0, parseInt(input.value) || 0);
        input.value = nuevoStock;
        
        guardarStockServidor(id, nuevoStock);
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          input.blur();
        }
      });
    });
  }

  // --- ENVIAR STOCK AL SERVIDOR ---
  async function guardarStockServidor(id, stock) {
    try {
      const response = await fetch(`/api/productos/admin/${id}/stock`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ stock })
      });
      const result = await response.json();

      if (result.success) {
        // Actualizar localmente el array en memoria
        const prod = productos.find(p => p.id === id);
        if (prod) {
          prod.stock = stock;
          actualizarPildoraStock(id, stock);
          actualizarKPIs();
        }
      } else {
        console.error('Error al guardar stock:', result.message);
      }
    } catch (error) {
      console.error('Error en fetch al guardar stock:', error);
    }
  }

  // --- ACTUALIZAR LA PÍLDORA DE STOCK DINÁMICAMENTE ---
  function actualizarPildoraStock(id, stock) {
    const pill = document.getElementById(`pill-${id}`);
    if (!pill) return;

    pill.className = 'status-pill';
    if (stock === 0) {
      pill.classList.add('danger');
      pill.textContent = 'Agotado';
    } else if (stock < 5) {
      pill.classList.add('warning');
      pill.textContent = 'Bajo Stock';
    } else {
      pill.classList.add('success');
      pill.textContent = 'Disponible';
    }
  }

  // --- ACTUALIZAR INDICADORES KPI ---
  function actualizarKPIs() {
    if (kpiTotalProducts) {
      kpiTotalProducts.textContent = productos.length;
    }
    if (kpiLowStock) {
      const lowStockCount = productos.filter(p => p.stock < 5).length;
      kpiLowStock.textContent = lowStockCount;
    }
  }

  // --- CONECTAR WEBSOCKETS (Socket.io) ---
  function conectarSocket() {
    try {
      socket = io();

      socket.on('connect', () => {
        console.log('[Socket] Conectado al servidor.');
        socket.emit('unirse_admin');
      });

      // Escuchar cambios de stock de otros admins o del bot de WhatsApp
      socket.on('producto_actualizado', (data) => {
        console.log('[Socket] Producto actualizado recibido:', data);
        
        // Actualizar entrada de la tabla
        const input = document.querySelector(`.stock-display-input[data-id="${data.id}"]`);
        if (input) {
          input.value = data.stock;
        }

        // Actualizar array en memoria y píldora
        const prod = productos.find(p => p.id === data.id);
        if (prod) {
          prod.stock = data.stock;
          actualizarPildoraStock(data.id, data.stock);
          actualizarKPIs();
        }
      });

      // Escuchar cambios de estado del bot de WhatsApp
      socket.on('whatsapp_status', (data) => {
        console.log('[Socket] WhatsApp Status recibido:', data);
        actualizarEstadoWhatsApp(data.status, data.qr, data.error);
      });

    } catch (err) {
      console.error('[Socket] Error de conexión Socket.io:', err);
    }
  }

  // --- ACTUALIZAR ESTADO VISUAL DE WHATSAPP ---
  function actualizarEstadoWhatsApp(status, qr, errorMsg = '') {
    // 1. Actualizar Badge en KPI
    if (waKpiBadge) {
      let badgeHtml = '';
      switch (status) {
        case 'ready':
          badgeHtml = '<span class="status-badge ready">● Conectado</span>';
          break;
        case 'qr':
          badgeHtml = '<span class="status-badge qr">● Escanear QR</span>';
          break;
        case 'loading':
          badgeHtml = '<span class="status-badge loading">● Iniciando</span>';
          break;
        case 'disabled':
          badgeHtml = '<span class="status-badge disabled">● Desactivado</span>';
          break;
        case 'disconnected':
        default:
          badgeHtml = '<span class="status-badge disconnected">● Desconectado</span>';
          break;
      }
      waKpiBadge.innerHTML = badgeHtml;
    }

    // 2. Actualizar Caja del QR / Estado
    if (!waQrContainer) return;

    waQrContainer.innerHTML = '';

    if (status === 'disabled') {
      waQrContainer.innerHTML = `
        <span style="font-size: 48px; display:block; margin-bottom:12px;">🚫</span>
        <h4 style="font-size:16px; font-weight:700; color:var(--text-primary);">Agente Desactivado</h4>
        <p style="color:var(--text-secondary); font-size:13px; margin-top:6px; max-width:240px; margin-left:auto; margin-right:auto;">
          Activa la casilla "Activar Agente IA" abajo para encender el servicio.
        </p>
      `;
    } else if (status === 'loading') {
      waQrContainer.innerHTML = `
        <div class="spinner"></div>
        <h4 style="font-size:16px; font-weight:700; color:var(--text-primary); margin-top:8px;">Conectando al navegador...</h4>
        <p style="color:var(--text-secondary); font-size:12px; margin-top:4px;">Esto puede tardar unos segundos.</p>
      `;
    } else if (status === 'ready' || status === 'authenticated') {
      waQrContainer.innerHTML = `
        <span style="font-size: 54px; display:block; margin-bottom:12px;">🟢</span>
        <h4 style="font-size:18px; font-weight:800; color:var(--success);">¡Bot de WhatsApp Activo!</h4>
        <p style="color:var(--text-secondary); font-size:13px; margin-top:6px; max-width:260px; margin-left:auto; margin-right:auto;">
          El Agente de Inteligencia está listo y respondiendo a los administradores autorizados.
        </p>
        <div style="margin-top: 16px; display: flex; gap: 8px; justify-content: center;">
          <button class="btn-primary" id="btn-reconnect-inline" style="font-size:12px; padding:8px 16px;">Reconectar</button>
          <button id="btn-logout-wa" style="font-size:12px; padding:8px 16px; background-color: var(--danger); color: white; border: none; border-radius: 6px; cursor: pointer;">Cerrar Sesión</button>
        </div>
      `;

      const btnLogoutWa = waQrContainer.querySelector('#btn-logout-wa');
      if (btnLogoutWa) btnLogoutWa.addEventListener('click', cerrarSesionWhatsApp);
      
      const btnReconnectInline = waQrContainer.querySelector('#btn-reconnect-inline');
      if (btnReconnectInline) btnReconnectInline.addEventListener('click', reconectarWhatsApp);

    } else if (status === 'qr' && qr) {
      waQrContainer.innerHTML = `
        <div class="qr-wrapper">
          <img src="${qr}" alt="WhatsApp QR Code">
        </div>
        <h4 style="font-size:15px; font-weight:700; color:var(--text-primary);">Escanear Código QR</h4>
        <p style="color:var(--text-muted); font-size:12px; margin-top:4px;">Abre WhatsApp en tu celular y escanea este código.</p>
      `;
    } else {
      // Disconnected o sin QR
      waQrContainer.innerHTML = `
        <span style="font-size: 48px; display:block; margin-bottom:12px;">🔌</span>
        <h4 style="font-size:16px; font-weight:700; color:var(--text-primary);">WhatsApp Desconectado</h4>
        <p style="color:var(--text-secondary); font-size:13px; margin-top:6px;">
          ${errorMsg ? `Error: ${errorMsg}` : 'No se pudo establecer la sesión.'}
        </p>
        <button class="btn-primary" id="btn-retry-qr" style="margin-top:16px; font-size:12px; padding:8px 16px;">
          Intentar de Nuevo
        </button>
      `;

      const btnRetry = waQrContainer.querySelector('#btn-retry-qr');
      if (btnRetry) {
        btnRetry.addEventListener('click', reconectarWhatsApp);
      }
    }
  }

  // --- CERRAR SESIÓN DE WHATSAPP ---
  async function cerrarSesionWhatsApp() {
    if (!confirm('¿Estás seguro de que deseas cerrar la sesión de WhatsApp? Se desvinculará tu dispositivo y tendrás que volver a escanear el QR.')) return;
    
    actualizarEstadoWhatsApp('loading');
    try {
      const response = await fetch('/api/inventario/whatsapp/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const result = await response.json();
      if (!result.success) {
        alert('Error al cerrar sesión: ' + result.message);
      }
    } catch (error) {
      console.error('Error al cerrar sesión:', error);
      alert('Error en la conexión con el servidor al cerrar sesión.');
    }
  }

  // --- RECONECTAR WHATSAPP MANUALMENTE ---
  async function reconectarWhatsApp() {
    actualizarEstadoWhatsApp('loading');
    try {
      const response = await fetch('/api/inventario/whatsapp/reconnect', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const result = await response.json();
      if (!result.success) {
        alert('Error al intentar reconectar: ' + result.message);
      }
    } catch (error) {
      console.error('Error al reconectar:', error);
      alert('Error en la conexión con el servidor.');
    }
  }

  // --- CONFIGURAR EVENTOS DE BUSQUEDA Y FORMULARIOS ---
  function setupEventListeners() {
    // 1. Filtrado por Búsqueda (Búsqueda local rápida)
    if (inventarioSearchInput) {
      inventarioSearchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        const filtrados = productos.filter(p => 
          p.nombre.toLowerCase().includes(query) || 
          (p.categoria_nombre && p.categoria_nombre.toLowerCase().includes(query)) ||
          p.id.toString() === query
        );
        renderizarTabla(filtrados);
      });
    }

    // 2. Toggle visibilidad clave Gemini
    if (btnToggleGeminiKey && geminiKeyInput) {
      btnToggleGeminiKey.addEventListener('click', () => {
        if (geminiKeyInput.type === 'password') {
          geminiKeyInput.type = 'text';
          btnToggleGeminiKey.textContent = '🙈';
        } else {
          geminiKeyInput.type = 'password';
          btnToggleGeminiKey.textContent = '👁️';
        }
      });
    }

    // 3. Reconectar Bot botón
    if (btnReconnectWa) {
      btnReconnectWa.addEventListener('click', reconectarWhatsApp);
    }

    // 4. Guardar configuración IA
    if (formConfigAi) {
      formConfigAi.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const gemini_api_key = geminiKeyInput.value.trim();
        const whatsapp_whitelist = whitelistNumbersInput.value.trim();
        const whatsapp_bot_active = botActiveToggle.checked;

        // Visualización de carga en botón
        const btnSave = document.getElementById('btn-save-ai-config');
        const originalText = btnSave.innerHTML;
        btnSave.disabled = true;
        btnSave.innerHTML = '<span>Guardando y reiniciando bot...</span>';
        configAiAlert.style.display = 'none';

        try {
          const response = await fetch('/api/inventario/config-ai', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              gemini_api_key,
              whatsapp_whitelist,
              whatsapp_bot_active
            })
          });
          const result = await response.json();

          if (result.success) {
            mostrarAlertaConfig('success', 'Configuración guardada. El bot de WhatsApp se está reiniciando...');
            // Recargar para obtener el estado actual enmascarado
            setTimeout(cargarConfiguracionIA, 1500);
          } else {
            mostrarAlertaConfig('error', result.message || 'Error al guardar la configuración.');
          }
        } catch (error) {
          console.error('Error al guardar config:', error);
          mostrarAlertaConfig('error', 'Error en la conexión con el servidor.');
        } finally {
          btnSave.disabled = false;
          btnSave.innerHTML = originalText;
        }
      });
    }
  }

  function mostrarAlertaConfig(tipo, mensaje) {
    configAiAlert.textContent = mensaje;
    configAiAlert.className = `alert-box ${tipo}`;
    configAiAlert.style.display = 'block';
    
    // Auto-ocultar después de 5 segundos si es éxito
    if (tipo === 'success') {
      setTimeout(() => {
        configAiAlert.style.display = 'none';
      }, 5000);
    }
  }

  function mostrarAlertaTabla(mensaje) {
    inventarioTableBody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 40px; color: var(--danger); font-weight: 600;">
          ⚠️ ${mensaje}
        </td>
      </tr>`;
  }

  // --- EJECUTAR ---
  init();
});
