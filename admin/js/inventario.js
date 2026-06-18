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
  const waQrContainer = document.getElementById('qr-admin-container');
  const btnReconnectWa = document.getElementById('btn-reconnect-admin');
  const btnLogoutWa = document.getElementById('btn-logout-admin');
  const waQrImage = document.getElementById('qr-admin-image');
  const waQrText = document.getElementById('qr-admin-text');
  const waStatusBadge = document.getElementById('status-admin-badge');
  
  const formConfigAi = null;
  const geminiKeyInput = null;
  const btnToggleGeminiKey = null;
  const whitelistNumbersInput = document.getElementById('input-admin-numbers');
  const btnSaveNumbers = document.getElementById('btn-save-numbers');
  const botActiveToggle = null;
  const botHorarioToggle = null;
  const botMensajeAusenciaInput = null;
  const configAiAlert = null;

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
    loadAdminBotStatus();
    loadAdminNumbers();
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
        if (geminiKeyInput) geminiKeyInput.value = config.gemini_api_key || '';
        if (whitelistNumbersInput) whitelistNumbersInput.value = config.whatsapp_whitelist || '';
        if (botActiveToggle) botActiveToggle.checked = config.whatsapp_bot_active;
        if (botHorarioToggle) botHorarioToggle.checked = config.bot_horario_activo == '1';
        if (botMensajeAusenciaInput) botMensajeAusenciaInput.value = config.bot_mensaje_ausencia || '';
        
        // Actualizar el estado visual del QR / Conexión
        if (typeof updateAdminBotUI === 'function') {
          updateAdminBotUI(config.bot_status, config.bot_qr);
        }
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

      // Escuchar cambios del admin bot
      socket.on('whatsapp_admin_status', (data) => {
        console.log('[Socket] WhatsApp Status recibido:', data);
        updateAdminBotUI(data.status, data.qr, data.error);
      });



    } catch (err) {
      console.error('[Socket] Error de conexión Socket.io:', err);
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
  }

  function mostrarAlertaTabla(mensaje) {
    inventarioTableBody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 40px; color: var(--danger); font-weight: 600;">
          ⚠️ ${mensaje}
        </td>
      </tr>`;
  }

  // --- ADMIN BOT LOGIC ---
  const botAdmin = {
    badge: document.getElementById('status-admin-badge'),
    image: document.getElementById('qr-admin-image'),
    text: document.getElementById('qr-admin-text'),
    btnReconnect: document.getElementById('btn-reconnect-admin'),
    btnLogout: document.getElementById('btn-logout-admin')
  };

  async function loadAdminBotStatus() {
    try {
      const res = await fetch(`/api/chatbots/admin/status`, { headers: { 'Authorization': `Bearer ${token}` } });
      const data = await res.json();
      if (data.success) {
        updateAdminBotUI(data.status, data.qr);
      }
    } catch (err) {
      console.error('Error loading admin bot status:', err);
    }
  }

  async function loadAdminNumbers() {
    try {
      const res = await fetch('/api/config', { headers: { 'Authorization': `Bearer ${token}` } });
      const data = await res.json();
      if (data.success) {
        if(whitelistNumbersInput) whitelistNumbersInput.value = data.data.admin_whatsapp_numbers || '';
      }
    } catch (err) {
      console.error('Error loading config:', err);
    }
  }

  if (btnSaveNumbers) {
    btnSaveNumbers.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ admin_whatsapp_numbers: whitelistNumbersInput.value })
        });
        const data = await res.json();
        if (data.success) {
          alert('Números autorizados guardados correctamente.');
        } else {
          alert('Error al guardar: ' + data.message);
        }
      } catch (err) {
        alert('Error de conexión al guardar.');
      }
    });
  }

  if (botAdmin.btnReconnect) {
    botAdmin.btnReconnect.addEventListener('click', async () => {
      botAdmin.btnReconnect.disabled = true;
      try {
        await fetch(`/api/chatbots/admin/reconnect`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
      } catch (err) {
        console.error('Error reconnecting', err);
      }
      setTimeout(() => { botAdmin.btnReconnect.disabled = false; }, 3000);
    });
  }

  if (botAdmin.btnLogout) {
    botAdmin.btnLogout.addEventListener('click', async () => {
      if (!confirm(`¿Estás seguro de desvincular el Bot ADMINISTRATIVO?`)) return;
      botAdmin.btnLogout.disabled = true;
      try {
        await fetch(`/api/chatbots/admin/logout`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
      } catch (err) {
        console.error('Error logout', err);
      }
      setTimeout(() => { botAdmin.btnLogout.disabled = false; }, 3000);
    });
  }

  function updateAdminBotUI(status, qr = null, error = null) {
    if (!botAdmin.badge) return;
    botAdmin.badge.className = 'status-badge';
    if (status === 'ready') {
      botAdmin.badge.classList.add('connected');
      botAdmin.badge.innerHTML = '<span>●</span> Conectado';
      botAdmin.image.style.display = 'none';
      botAdmin.text.innerText = 'Bot funcionando correctamente.';
    } else if (status === 'qr') {
      botAdmin.badge.classList.add('loading');
      botAdmin.badge.innerHTML = '<span>●</span> Escanea el QR';
      if (qr) {
        botAdmin.image.src = qr;
        botAdmin.image.style.display = 'block';
        botAdmin.text.style.display = 'none';
      }
    } else if (status === 'loading') {
      botAdmin.badge.classList.add('loading');
      botAdmin.badge.innerHTML = '<span>●</span> Conectando...';
      botAdmin.image.style.display = 'none';
      botAdmin.text.style.display = 'block';
      botAdmin.text.innerText = 'Inicializando cliente...';
    } else {
      botAdmin.badge.classList.add('disconnected');
      botAdmin.badge.innerHTML = '<span>●</span> Desconectado';
      botAdmin.image.style.display = 'none';
      botAdmin.text.style.display = 'block';
      botAdmin.text.innerText = error || 'El bot no está enlazado a ningún dispositivo.';
    }
  }

  // --- EJECUTAR ---
  init();
});
