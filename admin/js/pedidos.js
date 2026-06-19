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

  const btnLogout = document.getElementById('btn-logout');
  const btnRefresh = document.getElementById('btn-refresh');
  
  const listPendiente = document.getElementById('list-pendiente');
  const listPreparando = document.getElementById('list-preparando');
  const listEntregado = document.getElementById('list-entregado');
  
  const countPendiente = document.getElementById('count-pendiente');
  const countPreparando = document.getElementById('count-preparando');
  const countEntregado = document.getElementById('count-entregado');

  let pedidos = [];
  let refreshInterval = null;

  btnLogout.addEventListener('click', () => {
    localStorage.removeItem('puro_sabor_admin_token');
    localStorage.removeItem('puro_sabor_admin_user');
    window.location.href = '/admin/';
  });

  btnRefresh.addEventListener('click', cargarPedidos);

  async function cargarPedidos() {
    try {
      btnRefresh.querySelector('span').textContent = 'Actualizando...';
      const response = await fetch('/api/pedidos', {
        headers: authHeaders
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      if (data.success) {
        pedidos = data.data;
        renderKanban();
      } else {
        throw new Error(data.error || 'Error al cargar pedidos');
      }
    } catch (error) {
      console.error('Error cargando pedidos:', error);
      [listPendiente, listPreparando, listEntregado].forEach(el => {
        el.innerHTML = `<p style="color:var(--danger);text-align:center;padding:20px;">Error: ${error.message}</p>`;
      });
    } finally {
      if (btnRefresh.querySelector('span')) btnRefresh.querySelector('span').textContent = 'Actualizar';
    }
  }

  function renderKanban() {
    const pendientes = pedidos.filter(p => p.estado === 'pendiente');
    const preparando = pedidos.filter(p => p.estado === 'preparando' || p.estado === 'listo');
    const entregados = pedidos.filter(p => ['entregado', 'pagado', 'cancelado'].includes(p.estado)).slice(0, 20);

    countPendiente.textContent = pendientes.length;
    countPreparando.textContent = preparando.length;
    countEntregado.textContent = entregados.length;

    renderList(listPendiente, pendientes, 'pendiente');
    renderList(listPreparando, preparando, 'preparando');
    renderList(listEntregado, entregados, 'entregado');
  }

  function renderList(container, lista, statusClass) {
    if (lista.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding: 30px;">Sin pedidos</p>';
      return;
    }

    let html = '';
    lista.forEach(p => {
      let itemsHtml = '';
      if (p.items && p.items.length) {
        p.items.forEach(item => {
          itemsHtml += `
            <div class="pedido-item">
              <span><span class="pedido-item-qty">${item.cantidad}x</span> ${item.nombre}</span>
            </div>
          `;
        });
      } else {
        itemsHtml = '<p style="color:var(--text-muted);font-size:13px;">Sin detalle</p>';
      }

      const fecha = new Date(p.creado_en);
      const timeString = isNaN(fecha) ? '—' : fecha.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
      const tableString = !p.mesa_numero || p.mesa_numero === 0 ? 'Para Llevar' : `Mesa ${p.mesa_numero}`;

      html += `
        <div class="pedido-card status-${statusClass}">
          <div class="pedido-card-header">
            <span class="pedido-mesa">${tableString}</span>
            <span class="pedido-time">${timeString}</span>
          </div>
          <div class="pedido-items">
            ${itemsHtml}
          </div>
          <div class="pedido-footer">
            <span class="pedido-total">$${parseFloat(p.total || 0).toLocaleString('es-CO')}</span>
            <div class="pedido-actions">
              <select data-id="${p.id}" class="select-estado">
                <option value="pendiente" ${p.estado === 'pendiente' ? 'selected' : ''}>Pendiente ⏳</option>
                <option value="preparando" ${p.estado === 'preparando' ? 'selected' : ''}>Preparando 👨‍🍳</option>
                <option value="listo" ${p.estado === 'listo' ? 'selected' : ''}>Listo 🔔</option>
                <option value="entregado" ${p.estado === 'entregado' ? 'selected' : ''}>Entregado ✅</option>
                <option value="pagado" ${p.estado === 'pagado' ? 'selected' : ''}>Pagado 💰</option>
                <option value="cancelado" ${p.estado === 'cancelado' ? 'selected' : ''}>Cancelado ❌</option>
              </select>
            </div>
          </div>
        </div>
      `;
    });
    container.innerHTML = html;

    container.querySelectorAll('.select-estado').forEach(select => {
      select.addEventListener('change', async (e) => {
        const id = e.target.getAttribute('data-id');
        const nuevoEstado = e.target.value;
        await cambiarEstado(id, nuevoEstado);
      });
    });
  }

  async function cambiarEstado(id, estado) {
    try {
      const response = await fetch(`/api/pedidos/${id}/estado`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ estado })
      });
      const data = await response.json();
      if (data.success) {
        const idx = pedidos.findIndex(p => p.id == id);
        if (idx !== -1) {
          pedidos[idx].estado = estado;
          renderKanban();
        }
      } else {
        alert('Error al cambiar el estado: ' + (data.error || 'Error'));
        cargarPedidos();
      }
    } catch (e) {
      console.error(e);
      cargarPedidos();
    }
  }

  // Socket.IO para tiempo real
  try {
    const socket = io();
    socket.on('connect', () => { socket.emit('unirse_admin'); });
    socket.on('nuevo_pedido', () => { cargarPedidos(); });
    socket.on('pedido_estado_actualizado', () => { cargarPedidos(); });
  } catch(e) {
    console.warn('Socket.IO no disponible, usando polling cada 30s');
    // Fallback: polling cada 30 segundos
    refreshInterval = setInterval(cargarPedidos, 30000);
  }

  // Auto-refresh cada 30 segundos como seguridad extra
  setInterval(cargarPedidos, 30000);

  // Start
  cargarPedidos();
});
