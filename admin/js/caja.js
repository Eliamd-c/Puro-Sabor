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
      const token = localStorage.getItem('adminToken');
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
      tableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px;">No hay registros de caja aún.</td></tr>';
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
        </tr>
      `;
    }).join('');
  }

  // Modal logic
  function openModal() {
    modal.classList.add('open');
  }

  function closeModal() {
    modal.classList.remove('open');
    form.reset();
  }

  btnAdd.addEventListener('click', openModal);
  btnClose.addEventListener('click', closeModal);
  btnCancel.addEventListener('click', closeModal);

  // Save logic
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      tipo: document.getElementById('reg-tipo').value,
      monto: document.getElementById('reg-monto').value,
      descripcion: document.getElementById('reg-desc').value,
      categoria: document.getElementById('reg-category').value
    };

    try {
      const token = localStorage.getItem('adminToken');
      const res = await fetch('/api/caja/registro', {
        method: 'POST',
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
