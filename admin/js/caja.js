document.addEventListener('DOMContentLoaded', () => {
  const tableBody = document.getElementById('admin-caja-table-body');
  const btnAdd = document.getElementById('btn-open-add-registro');
  const modal = document.getElementById('registro-modal');
  const btnClose = document.getElementById('btn-close-registro-modal');
  const btnCancel = document.getElementById('btn-cancel-registro-modal');
  const form = document.getElementById('registro-form');

  // API Calls
  async function fetchCaja() {
    try {
      const token = localStorage.getItem('puro_sabor_admin_token');
      const [resKpi, resRegistros] = await Promise.all([
        fetch('/api/caja/hoy', { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch('/api/caja/registros', { headers: { 'Authorization': `Bearer ${token}` } })
      ]);
      
      const dataKpi = await resKpi.json();
      const dataReg = await resRegistros.json();

      if (dataKpi.success) {
        document.getElementById('kpi-ingresos').textContent = `$${dataKpi.data.ingresos.toLocaleString()}`;
        document.getElementById('kpi-gastos').textContent = `$${dataKpi.data.gastos.toLocaleString()}`;
        document.getElementById('kpi-balance').textContent = `$${dataKpi.data.balance.toLocaleString()}`;
      }

      if (dataReg.success) {
        renderTable(dataReg.data);
      }
    } catch (e) {
      console.error(e);
      alert('Error cargando caja');
    }
  }

  // Render Table
  function renderTable(registros) {
    if (registros.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px;">No hay registros de caja aún.</td></tr>';
      return;
    }

    tableBody.innerHTML = registros.map(reg => {
      const isIngreso = reg.tipo === 'ingreso';
      const color = isIngreso ? 'var(--success)' : 'var(--danger)';
      const signo = isIngreso ? '+' : '-';
      const fecha = new Date(reg.fecha).toLocaleString();

      return `
        <tr>
          <td>#${reg.id}</td>
          <td><span class="status-badge" style="background:${isIngreso?'#d4edda':'#f8d7da'}; color:${isIngreso?'#155724':'#721c24'}">${reg.tipo.toUpperCase()}</span></td>
          <td><strong>${reg.descripcion}</strong></td>
          <td><span class="status-badge" style="background:#f1f3f5; color:#495057;">${reg.categoria || 'General'}</span></td>
          <td><strong style="color:${color}">${signo} $${parseFloat(reg.monto).toLocaleString()}</strong></td>
          <td><small>${fecha}</small></td>
          <td><small>${reg.creado_por}</small></td>
          <td style="text-align: right; white-space: nowrap;">
            <button class="btn-icon" onclick="editRegistro(${reg.id}, '${reg.tipo}', '${reg.descripcion.replace(/'/g, "\\'")}', ${reg.monto}, '${(reg.categoria || 'General').replace(/'/g, "\\'")}')" title="Editar">✏️</button>
            <button class="btn-icon" onclick="deleteRegistro(${reg.id})" title="Eliminar" style="color: var(--danger);">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Edit logic
  window.editRegistro = (id, tipo, descripcion, monto, categoria) => {
    document.getElementById('reg-id').value = id;
    document.getElementById('reg-tipo').value = tipo;
    document.getElementById('reg-desc').value = descripcion;
    document.getElementById('reg-monto').value = monto;
    document.getElementById('reg-category').value = categoria;
    document.getElementById('registro-modal-title').textContent = 'Editar Registro';
    openModal();
  };

  window.deleteRegistro = async (id) => {
    if (!confirm('¿Seguro que deseas eliminar este registro? Esto afectará el balance de caja.')) return;
    try {
      const token = localStorage.getItem('puro_sabor_admin_token');
      const res = await fetch(`/api/caja/registro/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        fetchCaja();
      } else {
        alert(data.message || 'Error al eliminar');
      }
    } catch (e) {
      alert('Error de red al eliminar');
    }
  };

  // Modal logic
  function openModal() {
    modal.classList.add('open');
  }

  function closeModal() {
    modal.classList.remove('open');
    form.reset();
    document.getElementById('reg-id').value = '';
    document.getElementById('registro-modal-title').textContent = 'Añadir Registro Manual';
  }

  btnAdd.addEventListener('click', () => {
    document.getElementById('reg-id').value = '';
    document.getElementById('registro-modal-title').textContent = 'Añadir Registro Manual';
    openModal();
  });
  btnClose.addEventListener('click', closeModal);
  btnCancel.addEventListener('click', closeModal);

  // Save logic
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('reg-id').value;
    const payload = {
      tipo: document.getElementById('reg-tipo').value,
      monto: document.getElementById('reg-monto').value,
      descripcion: document.getElementById('reg-desc').value,
      categoria: document.getElementById('reg-category').value
    };

    try {
      const token = localStorage.getItem('puro_sabor_admin_token');
      const method = id ? 'PUT' : 'POST';
      const url = id ? `/api/caja/registro/${id}` : '/api/caja/registro';
      
      const res = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        closeModal();
        fetchCaja(); // Refresh
      } else {
        alert(data.message || 'Error guardando registro');
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión');
    }
  });

  fetchCaja();
});
