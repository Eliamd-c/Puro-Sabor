document.addEventListener('DOMContentLoaded', () => {
  const tableBody = document.getElementById('admin-insumos-table-body');
  const btnAdd = document.getElementById('btn-open-add-insumo');
  const modal = document.getElementById('insumo-modal');
  const btnClose = document.getElementById('btn-close-insumo-modal');
  const btnCancel = document.getElementById('btn-cancel-insumo-modal');
  const form = document.getElementById('insumo-form');
  const searchInput = document.getElementById('admin-search-input');
  const filterCategory = document.getElementById('admin-filter-category');

  let insumos = [];

  // Handle logout
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    localStorage.removeItem('puro_sabor_admin_token');
    window.location.href = '/admin/';
  });

  // API Calls
  async function fetchInsumos() {
    try {
      const token = localStorage.getItem('puro_sabor_admin_token');
      if (!token) {
        window.location.href = '/admin/';
        return;
      }
      const res = await fetch('/api/insumos', { headers: { 'Authorization': `Bearer ${token}` } });
      const data = await res.json();
      if (data.success) {
        insumos = data.data;
        renderTable();
      } else {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: red;">Error: ${data.message}</td></tr>`;
      }
    } catch (e) {
      console.error(e);
      tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: red;">Error de red al cargar insumos</td></tr>`;
    }
  }

  // Render Table
  function renderTable() {
    const term = searchInput.value.toLowerCase();
    const cat = filterCategory.value;
    
    const filtered = insumos.filter(ins => {
      const matchName = ins.nombre.toLowerCase().includes(term);
      const matchCat = cat ? ins.categoria === cat : true;
      return matchName && matchCat;
    });

    if (filtered.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px;">No se encontraron insumos.</td></tr>';
      return;
    }

    tableBody.innerHTML = filtered.map(ins => {
      const isLow = parseFloat(ins.cantidad) <= parseFloat(ins.stock_minimo);
      const statusColor = isLow ? (ins.cantidad == 0 ? 'var(--danger)' : 'var(--warning)') : 'var(--success)';
      return `
        <tr>
          <td>#${ins.id}</td>
          <td><strong>${ins.nombre}</strong><br><small style="color:var(--text-muted)">${ins.notas || ''}</small></td>
          <td><span class="status-badge" style="background:#f1f3f5; color:#495057;">${ins.categoria}</span></td>
          <td><strong style="color:${statusColor}">${ins.cantidad}</strong></td>
          <td>${ins.unidad}</td>
          <td>${ins.stock_minimo}</td>
          <td>
            <button class="btn-icon" onclick="editInsumo(${ins.id})" title="Editar">✏️</button>
            <button class="btn-icon" onclick="deleteInsumo(${ins.id})" title="Eliminar">🗑️</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Modal logic
  function openModal(ins = null) {
    document.getElementById('insumo-id-field').value = ins ? ins.id : '';
    document.getElementById('ins-name').value = ins ? ins.nombre : '';
    document.getElementById('ins-category').value = ins ? ins.categoria : 'General';
    document.getElementById('ins-unit').value = ins ? ins.unidad : 'unidades';
    document.getElementById('ins-stock').value = ins ? ins.cantidad : 0;
    document.getElementById('ins-min-stock').value = ins ? ins.stock_minimo : 0;
    document.getElementById('ins-desc').value = ins ? ins.notas : '';
    
    document.getElementById('modal-form-title').textContent = ins ? 'Editar Insumo' : 'Añadir Nuevo Insumo';
    modal.classList.add('open');
  }

  function closeModal() {
    modal.classList.remove('open');
    form.reset();
  }

  btnAdd.addEventListener('click', () => openModal());
  btnClose.addEventListener('click', closeModal);
  btnCancel.addEventListener('click', closeModal);
  searchInput.addEventListener('input', renderTable);
  filterCategory.addEventListener('change', renderTable);

  // Save logic
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('insumo-id-field').value;
    const payload = {
      nombre: document.getElementById('ins-name').value,
      categoria: document.getElementById('ins-category').value,
      unidad: document.getElementById('ins-unit').value,
      cantidad: document.getElementById('ins-stock').value,
      stock_minimo: document.getElementById('ins-min-stock').value,
      notas: document.getElementById('ins-desc').value
    };

    try {
      const token = localStorage.getItem('puro_sabor_admin_token');
      const url = id ? `/api/insumos/${id}` : '/api/insumos';
      const method = id ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        closeModal();
        fetchInsumos();
      } else {
        alert(data.message || 'Error guardando insumo');
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión');
    }
  });

  // Global functions for inline handlers
  window.editInsumo = (id) => {
    const ins = insumos.find(i => i.id == id);
    if (ins) openModal(ins);
  };

  window.deleteInsumo = async (id) => {
    if (!confirm('¿Seguro que deseas eliminar este insumo?')) return;
    try {
      const token = localStorage.getItem('puro_sabor_admin_token');
      const res = await fetch(`/api/insumos/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) fetchInsumos();
      else alert(data.message);
    } catch (e) {
      console.error(e);
      alert('Error eliminando insumo');
    }
  };

  fetchInsumos();
});
