// ==========================================================================
// 🪑 MESAS.JS — Panel Administrativo de Mesas | Puro Sabor
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  // ── Autenticación ──────────────────────────────────────────────────────
  const token = localStorage.getItem('puro_sabor_admin_token') || getCookie('puro_sabor_admin_token');
  if (!token) {
    window.location.href = '/admin/';
    return;
  }

  function getCookie(name) {
    const cookies = document.cookie.split(';');
    for (let c of cookies) {
      const [k, v] = c.trim().split('=');
      if (k === name) return v;
    }
    return null;
  }

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };

  // ── Estado ─────────────────────────────────────────────────────────────
  let mesas = [];
  let mesaSeleccionada = null;
  let socket = null;

  // ── Elementos del DOM ──────────────────────────────────────────────────
  const mesasGrid = document.getElementById('mesas-grid');
  const qrGrid = document.getElementById('qr-grid');
  const kpiTotalMesas = document.getElementById('kpi-total-mesas');
  const kpiMesasActivas = document.getElementById('kpi-mesas-activas');
  const kpiVentasHoy = document.getElementById('kpi-ventas-hoy');
  const configWhatsapp = document.getElementById('config-whatsapp');
  const configDominio = document.getElementById('config-dominio');
  const btnSaveConfig = document.getElementById('btn-save-config');

  // Modales
  const modalPedidos = document.getElementById('modal-pedidos');
  const modalPedidosTitle = document.getElementById('modal-pedidos-title');
  const modalPedidosBody = document.getElementById('modal-pedidos-body');
  const modalPedidosTotal = document.getElementById('modal-pedidos-total');
  const btnClosePedidos = document.getElementById('btn-close-pedidos');
  const btnCerrarMesaModal = document.getElementById('btn-cerrar-mesa-modal');

  const modalNuevaMesa = document.getElementById('modal-nueva-mesa');
  const inputNuevaMesaNum = document.getElementById('input-nueva-mesa-numero');
  const btnNuevaMesa = document.getElementById('btn-nueva-mesa');
  const btnCancelNuevaMesa = document.getElementById('btn-cancel-nueva-mesa');
  const btnConfirmNuevaMesa = document.getElementById('btn-confirm-nueva-mesa');

  const btnLogout = document.getElementById('btn-logout');

  // ── Inicialización ─────────────────────────────────────────────────────
  async function init() {
    await cargarMesas();
    await cargarConfig();
    renderQRs();
    conectarSocket();
    configurarEventos();
  }

  // ── Socket.io ──────────────────────────────────────────────────────────
  function conectarSocket() {
    socket = io();
    socket.on('connect', () => {
      socket.emit('unirse_admin');
    });

    socket.on('nuevo_pedido', (data) => {
      console.log('[Admin] Nuevo pedido:', data);
      cargarMesas(); // Refrescar
    });

    socket.on('mesa_actualizada', (data) => {
      console.log('[Admin] Mesa actualizada:', data);
      cargarMesas(); // Refrescar
    });
  }

  // ── Cargar datos ───────────────────────────────────────────────────────
  async function cargarMesas() {
    try {
      const resp = await fetch('/api/mesas', { headers: authHeaders });
      const result = await resp.json();
      if (result.success) {
        mesas = result.data;
        renderMesas();
        actualizarKPIs();
      }
    } catch (e) {
      mesasGrid.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:20px;">Error al cargar mesas.</p>';
    }
  }

  async function cargarConfig() {
    try {
      const resp = await fetch('/api/config');
      const result = await resp.json();
      if (result.success) {
        configWhatsapp.value = result.data.whatsapp_numero || '';
        configDominio.value = result.data.dominio_base || '';
      }
    } catch (e) { /* silencioso */ }
  }

  // ── Renders ────────────────────────────────────────────────────────────
  function renderMesas() {
    if (mesas.length === 0) {
      mesasGrid.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:40px;">No hay mesas configuradas.</p>';
      return;
    }

    let html = '';
    mesas.forEach(mesa => {
      const esActiva = mesa.estado === 'activa';
      const claseEstado = esActiva ? 'activa' : 'libre';
      const textoEstado = esActiva ? 'Activa' : 'Libre';

      let infoHtml = '';
      if (esActiva) {
        infoHtml = `
          <strong>${mesa.rondas}</strong> ronda${mesa.rondas !== 1 ? 's' : ''} de pedido<br>
          Total: <strong>$${mesa.total.toLocaleString('es-CO', { minimumFractionDigits: 0 })} COP</strong>
        `;
      } else {
        if (mesa.viendo > 0) {
          infoHtml = `<span style="color:#2196F3; font-weight: 600;">👀 ${mesa.viendo} persona(s) mirando el menú</span>`;
        } else {
          infoHtml = 'Esperando clientes...';
        }
      }

      let accionesHtml = '';
      if (esActiva) {
        accionesHtml = `
          <button class="mesa-btn mesa-btn-ver" onclick="verPedidos(${mesa.numero})">📋 Ver Pedidos</button>
          <button class="mesa-btn mesa-btn-cerrar" onclick="cerrarMesa(${mesa.numero})">✓ Cerrar</button>
        `;
      }

      html += `
        <div class="mesa-card ${claseEstado} animate-fade-in-up">
          <div class="mesa-card-header">
            <span class="mesa-card-numero">🪑 Mesa ${mesa.numero}</span>
            <span class="mesa-card-estado">${textoEstado}</span>
          </div>
          <div class="mesa-card-info">${infoHtml}</div>
          <div class="mesa-card-actions">${accionesHtml}</div>
        </div>
      `;
    });

    mesasGrid.innerHTML = html;
  }

  function actualizarKPIs() {
    kpiTotalMesas.textContent = mesas.length;
    const activas = mesas.filter(m => m.estado === 'activa');
    kpiMesasActivas.textContent = activas.length;
    const totalVentas = activas.reduce((sum, m) => sum + m.total, 0);
    kpiVentasHoy.textContent = `$${totalVentas.toLocaleString('es-CO', { minimumFractionDigits: 0 })}`;
  }

  function renderQRs() {
    let html = '';
    const t = new Date().getTime(); // Cache buster

    // QR General
    html += `
      <div class="qr-card general animate-fade-in-up">
        <div class="qr-card-title">🌐 QR General</div>
        <img src="/api/mesas/general/qr?t=${t}" alt="QR General" onerror="this.style.display='none'">
        <br>
        <button class="btn-download-qr" onclick="descargarQR('general')">⬇️ Descargar</button>
      </div>
    `;

    // QR por mesa
    mesas.forEach(mesa => {
      html += `
        <div class="qr-card animate-fade-in-up">
          <div class="qr-card-title">🪑 Mesa ${mesa.numero}</div>
          <img src="/api/mesas/${mesa.numero}/qr?t=${t}" alt="QR Mesa ${mesa.numero}" onerror="this.style.display='none'">
          <br>
          <button class="btn-download-qr" onclick="descargarQR(${mesa.numero})">⬇️ Descargar</button>
        </div>
      `;
    });

    qrGrid.innerHTML = html;
  }

  // ── Acciones (funciones globales para onclick) ─────────────────────────
  window.verPedidos = function (mesaNum) {
    const mesa = mesas.find(m => m.numero === mesaNum);
    if (!mesa || !mesa.pedidos || mesa.pedidos.length === 0) return;

    mesaSeleccionada = mesaNum;
    modalPedidosTitle.textContent = `📋 Pedidos — Mesa ${mesaNum}`;

    let html = '';
    mesa.pedidos.forEach(pedido => {
      const hora = new Date(pedido.creado_en).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

      html += `<div class="pedido-ronda">
        <div class="pedido-ronda-header">
          <span class="pedido-ronda-titulo">🍽️ Ronda #${pedido.numero_ronda}</span>
          <span class="pedido-ronda-hora">${hora}</span>
        </div>`;

      const items = pedido.items || [];
      items.forEach(item => {
        const subtotal = item.precio * item.cantidad;
        html += `<div class="pedido-item-row">
          <span class="pedido-item-nombre">${item.cantidad}x ${item.nombre}</span>
          <span class="pedido-item-subtotal">$${subtotal.toLocaleString('es-CO')}</span>
        </div>`;
      });

      html += `<div class="pedido-ronda-total">
        <span>Subtotal ronda</span>
        <span>$${pedido.total.toLocaleString('es-CO')} COP</span>
      </div>`;

      if (pedido.notas) {
        html += `<div class="pedido-notas">📝 ${pedido.notas}</div>`;
      }

      html += `</div>`;
    });

    modalPedidosBody.innerHTML = html;
    modalPedidosTotal.textContent = `TOTAL: $${mesa.total.toLocaleString('es-CO', { minimumFractionDigits: 0 })} COP`;
    modalPedidos.classList.add('open');
  };

  window.cerrarMesa = async function (mesaNum) {
    // Si no estamos en el modal de pedidos, primero mostrar pedidos
    const mesa = mesas.find(m => m.numero === mesaNum);
    if (mesa && mesa.pedidos && mesa.pedidos.length > 0) {
      window.verPedidos(mesaNum);
      return;
    }

    // Si no hay pedidos, cerrar directamente
    await ejecutarCierreMesa(mesaNum);
  };

  async function ejecutarCierreMesa(mesaNum) {
    if (!confirm(`¿Confirmas cerrar la Mesa ${mesaNum}? Esto indica que el pago fue recibido.`)) return;

    try {
      const resp = await fetch(`/api/mesas/${mesaNum}/cerrar`, {
        method: 'PATCH',
        headers: authHeaders
      });
      const result = await resp.json();
      if (result.success) {
        modalPedidos.classList.remove('open');
        mesaSeleccionada = null;
        await cargarMesas();
        renderQRs();
      } else {
        alert('Error: ' + result.message);
      }
    } catch (e) {
      alert('Error de conexión al cerrar mesa.');
    }
  }

  window.descargarQR = function (mesaNum) {
    const filename = mesaNum === 'general' ? 'QR-General-Puro-Sabor.png' : `QR-Mesa-${mesaNum}-Puro-Sabor.png`;
    const link = document.createElement('a');
    link.href = `/api/mesas/${mesaNum}/qr`;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ── Eventos ────────────────────────────────────────────────────────────
  function configurarEventos() {
    // Cerrar modal pedidos
    btnClosePedidos.addEventListener('click', () => {
      modalPedidos.classList.remove('open');
    });
    modalPedidos.addEventListener('click', (e) => {
      if (e.target === modalPedidos) modalPedidos.classList.remove('open');
    });

    // Cerrar mesa desde modal de pedidos
    btnCerrarMesaModal.addEventListener('click', () => {
      if (mesaSeleccionada) ejecutarCierreMesa(mesaSeleccionada);
    });

    // Nueva mesa: abrir modal
    btnNuevaMesa.addEventListener('click', () => {
      inputNuevaMesaNum.value = '';
      modalNuevaMesa.classList.add('open');
      inputNuevaMesaNum.focus();
    });

    btnCancelNuevaMesa.addEventListener('click', () => modalNuevaMesa.classList.remove('open'));
    modalNuevaMesa.addEventListener('click', (e) => {
      if (e.target === modalNuevaMesa) modalNuevaMesa.classList.remove('open');
    });

    btnConfirmNuevaMesa.addEventListener('click', async () => {
      const num = parseInt(inputNuevaMesaNum.value);
      if (!num || num < 1) { alert('Ingresa un número de mesa válido.'); return; }

      try {
        const resp = await fetch('/api/mesas', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ numero: num })
        });
        const result = await resp.json();
        if (result.success) {
          modalNuevaMesa.classList.remove('open');
          await cargarMesas();
          renderQRs();
        } else {
          alert(result.message);
        }
      } catch (e) {
        alert('Error al crear mesa.');
      }
    });

    // Guardar configuración
    btnSaveConfig.addEventListener('click', async () => {
      const updates = {};
      if (configWhatsapp.value.trim()) updates.whatsapp_numero = configWhatsapp.value.trim();
      if (configDominio.value.trim()) updates.dominio_base = configDominio.value.trim();

      try {
        const resp = await fetch('/api/config', {
          method: 'PUT',
          headers: authHeaders,
          body: JSON.stringify(updates)
        });
        const result = await resp.json();
        if (result.success) {
          alert('✅ Configuración guardada con éxito.');
          renderQRs(); // Regenerar QRs con nuevo dominio
        } else {
          alert('Error: ' + result.message);
        }
      } catch (e) {
        alert('Error al guardar configuración.');
      }
    });

    // Logout
    btnLogout.addEventListener('click', () => {
      localStorage.removeItem('puro_sabor_admin_token');
      localStorage.removeItem('puro_sabor_admin_user');
      document.cookie = 'puro_sabor_admin_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
      window.location.href = '/admin/';
    });
  }

  // ── Iniciar ────────────────────────────────────────────────────────────
  init();
});
