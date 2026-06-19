document.addEventListener('DOMContentLoaded', async () => {
  if (!verificarAutenticacion()) return;

  const btnLogout = document.getElementById('btn-logout');
  const btnRefresh = document.getElementById('btn-refresh');
  
  const listPendiente = document.getElementById('list-pendiente');
  const listPreparando = document.getElementById('list-preparando');
  const listEntregado = document.getElementById('list-entregado');
  
  const countPendiente = document.getElementById('count-pendiente');
  const countPreparando = document.getElementById('count-preparando');
  const countEntregado = document.getElementById('count-entregado');

  let pedidos = [];

  btnLogout.addEventListener('click', () => {
    localStorage.removeItem('adminToken');
    window.location.href = '/admin/';
  });

  btnRefresh.addEventListener('click', cargarPedidos);

  async function cargarPedidos() {
    try {
      btnRefresh.innerHTML = '<div class="spinner" style="width:16px;height:16px;border-width:2px;display:inline-block;vertical-align:middle;"></div>';
      const response = await fetch('/api/pedidos', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('adminToken')}` }
      });
      const data = await response.json();
      if (data.success) {
        pedidos = data.data;
        renderKanban();
      }
    } catch (error) {
      console.error(error);
    } finally {
      btnRefresh.innerHTML = '<svg viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg><span>Actualizar</span>';
    }
  }

  function renderKanban() {
    const pendientes = pedidos.filter(p => p.estado === 'pendiente');
    const preparando = pedidos.filter(p => p.estado === 'preparando' || p.estado === 'listo');
    // En historial corto mostramos entregados, pagados o cancelados
    const entregados = pedidos.filter(p => ['entregado', 'pagado', 'cancelado'].includes(p.estado)).slice(0, 20); // Limitar a los últimos 20

    countPendiente.textContent = pendientes.length;
    countPreparando.textContent = preparando.length;
    countEntregado.textContent = entregados.length;

    renderList(listPendiente, pendientes, 'pendiente');
    renderList(listPreparando, preparando, 'preparando');
    renderList(listEntregado, entregados, 'entregado');
  }

  function renderList(container, lista, statusClass) {
    if (lista.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding: 20px;">No hay pedidos</p>';
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
      }

      const timeString = new Date(p.creado_en).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
      const tableString = p.mesa_numero === 0 ? 'Para Llevar / Domicilio' : `Mesa ${p.mesa_numero}`;

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
            <span class="pedido-total">$${(p.total || 0).toLocaleString('es-CO')}</span>
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

    // Attach listeners
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
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
        },
        body: JSON.stringify({ estado })
      });
      const data = await response.json();
      if (data.success) {
        // Optimistic UI update
        const idx = pedidos.findIndex(p => p.id == id);
        if (idx !== -1) {
          pedidos[idx].estado = estado;
          renderKanban();
        }
      } else {
        alert('Error al cambiar el estado: ' + data.error);
        cargarPedidos();
      }
    } catch (e) {
      console.error(e);
      cargarPedidos();
    }
  }

  // Socket.IO para tiempo real
  const socket = io();
  socket.on('connect', () => {
    socket.emit('unirse_admin');
  });

  socket.on('nuevo_pedido', (data) => {
    // Si la pantalla de pedidos está abierta, recargar los pedidos para verlo
    cargarPedidos();
    
    // Play sound (opcional)
    try {
      const audio = new Audio('/assets/sounds/notification.mp3');
      audio.play().catch(e=>console.log("Auto-play prevented", e));
    } catch(e){}
  });

  socket.on('pedido_estado_actualizado', (data) => {
    cargarPedidos();
  });

  // Start
  cargarPedidos();
});
