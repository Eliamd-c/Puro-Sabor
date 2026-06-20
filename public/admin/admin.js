// ════════════════════════════════════════════════════════════════
// PURO SABOR — ADMIN DASHBOARD
// ════════════════════════════════════════════════════════════════

class AdminApp {
  constructor() {
    this.token = localStorage.getItem('puro_sabor_admin_token');
    this.socket = null;
    this.currentPage = 'dashboard';
    this.allPedidos = [];
    this.allHistorial = [];
    this.init();
  }

  init() {
    if (this.token) {
      this.showDashboard();
      this.loadData();
      this.setupSocketIO();
      this.setupEventListeners();
      this.startClock();
    } else {
      this.showLoginScreen();
    }
  }

  // ─── LOGIN ───────────────────────────────────────────────────
  showLoginScreen() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('admin-app').style.display = 'none';
    document.getElementById('login-form').addEventListener('submit', (e) => this.handleLogin(e));
  }

  showDashboard() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('admin-app').style.display = 'flex';
  }

  async handleLogin(e) {
    e.preventDefault();
    const usuario = document.getElementById('input-usuario').value;
    const password = document.getElementById('input-password').value;
    const errorDiv = document.getElementById('login-error');

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario, password })
      });

      const data = await res.json();
      if (!data.success) {
        errorDiv.textContent = data.error || 'Error en login';
        errorDiv.style.display = 'block';
        return;
      }

      localStorage.setItem('puro_sabor_admin_token', data.token);
      this.token = data.token;
      this.showDashboard();
      this.loadData();
      this.setupSocketIO();
      this.setupEventListeners();
      this.startClock();
    } catch (error) {
      errorDiv.textContent = 'Error de conexión';
      errorDiv.style.display = 'block';
    }
  }

  // ─── EVENT LISTENERS ─────────────────────────────────────────
  setupEventListeners() {
    // Logout
    document.getElementById('btn-logout').addEventListener('click', () => this.logout());

    // Navigation
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', (e) => this.switchPage(e.currentTarget.dataset.page));
    });

    // Export
    document.getElementById('btn-export').addEventListener('click', () => this.exportData());

    // Filters - Pedidos
    document.getElementById('search-orders').addEventListener('input', () => this.filterPedidos());
    document.getElementById('filter-status').addEventListener('change', () => this.filterPedidos());
    document.getElementById('filter-date').addEventListener('change', () => this.filterPedidos());

    // Filters - Auditoría
    document.getElementById('audit-search').addEventListener('input', () => this.filterAuditoria());
    document.getElementById('audit-type').addEventListener('change', () => this.filterAuditoria());
    document.getElementById('audit-date').addEventListener('change', () => this.filterAuditoria());
  }

  switchPage(page) {
    this.currentPage = page;
    document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
    document.querySelector(`[data-page="${page}"]`).classList.add('active');

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector(`[data-page="${page}"]`).classList.add('active');

    // Update header
    const titles = {
      dashboard: { title: 'Dashboard', subtitle: 'Control y auditoría de pedidos' },
      pedidos: { title: 'Pedidos', subtitle: 'Historial completo de órdenes' },
      auditoria: { title: 'Auditoría', subtitle: 'Registro de cambios y modificaciones' },
      reportes: { title: 'Reportes', subtitle: 'Análisis de ventas y actividades' }
    };
    const t = titles[page];
    document.getElementById('page-title').textContent = t.title;
    document.getElementById('page-subtitle').textContent = t.subtitle;
  }

  logout() {
    localStorage.removeItem('puro_sabor_admin_token');
    window.location.reload();
  }

  // ─── DATA LOADING ────────────────────────────────────────────
  async loadData() {
    try {
      const res = await fetch('/api/pedidos', {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      const data = await res.json();
      this.allPedidos = data.data || [];
      this.renderDashboard();
      this.renderPedidosTable();
    } catch (error) {
      console.error('Error loading pedidos:', error);
    }

    try {
      const res = await fetch('/api/pedidos/historial', {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      const data = await res.json();
      this.allHistorial = data.data || [];
      this.renderAuditoria();
    } catch (error) {
      console.error('Error loading historial:', error);
    }

    try {
      const res = await fetch('/api/pedidos/reportes', {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      const data = await res.json();
      this.renderReportes(data.data || {});
    } catch (error) {
      console.error('Error loading reportes:', error);
    }
  }

  // ─── DASHBOARD ────────────────────────────────────────────────
  renderDashboard() {
    const today = new Date().toISOString().split('T')[0];
    const todayPedidos = this.allPedidos.filter(p => p.creado_en?.startsWith(today));
    const pendientes = todayPedidos.filter(p => p.estado === 'pendiente' || p.estado === 'preparando').length;
    const totalVentas = todayPedidos.filter(p => p.estado === 'pagado').reduce((s, p) => s + (p.total || 0), 0);
    const cambiosHoy = this.allHistorial.filter(h => h.creado_en?.startsWith(today)).length;

    document.getElementById('stat-total').textContent = todayPedidos.length;
    document.getElementById('stat-pending').textContent = pendientes;
    document.getElementById('stat-revenue').textContent = '$' + totalVentas.toFixed(2);
    document.getElementById('stat-changes').textContent = cambiosHoy;

    // Recent orders
    const recentOrders = this.allPedidos.slice(0, 5);
    const ordersHtml = recentOrders.map(p => `
      <div class="mini-item">
        <div class="mini-item-main">
          <div class="mini-item-id">#${p.id}</div>
          <div class="mini-item-meta">${p.nombre_cliente || 'Cliente'} • $${p.total || 0}</div>
        </div>
        <div class="mini-item-badge status-${p.estado}">${p.estado}</div>
      </div>
    `).join('');
    document.getElementById('recent-orders').innerHTML = ordersHtml || '<p style="color: var(--muted); font-size: 12px;">Sin pedidos hoy</p>';

    // Recent changes
    const recentChanges = this.allHistorial.slice(0, 5);
    const changesHtml = recentChanges.map(h => `
      <div class="mini-item">
        <div class="mini-item-main">
          <div class="mini-item-id">Pedido #${h.pedido_id}</div>
          <div class="mini-item-meta">${h.tipo_cambio} • ${h.usuario_nombre || 'Sistema'}</div>
        </div>
        <div class="mini-item-badge">✓</div>
      </div>
    `).join('');
    document.getElementById('recent-changes').innerHTML = changesHtml || '<p style="color: var(--muted); font-size: 12px;">Sin cambios hoy</p>';
  }

  // ─── PEDIDOS TABLE ───────────────────────────────────────────
  renderPedidosTable(filtered = null) {
    const pedidos = filtered || this.allPedidos;
    const headerHtml = `
      <div class="orders-table-header">
        <div>ID</div>
        <div>Cliente</div>
        <div>Mesa/Dirección</div>
        <div>Total</div>
        <div>Estado</div>
        <div>Cambios</div>
        <div>Acciones</div>
      </div>
    `;

    const rowsHtml = pedidos.map(p => {
      const lugar = p.tipo_pedido === 'local' ? `Mesa ${p.mesa_numero}` : (p.tipo_pedido === 'domicilio' ? `${p.direccion_domicilio}` : 'Para llevar');
      const cambios = this.allHistorial.filter(h => h.pedido_id === p.id).length;
      return `
        <div class="orders-table-row">
          <div class="order-id-col">#${p.id}</div>
          <div class="order-client-col">${p.nombre_cliente || '-'}</div>
          <div>${lugar}</div>
          <div class="order-total">$${(p.total || 0).toFixed(2)}</div>
          <div class="order-status status-${p.estado}">${p.estado}</div>
          <div class="order-changes">${cambios}</div>
          <div class="order-actions">
            <button class="btn-delete-order" onclick="app.deletePedido(${p.id}, event)" title="Eliminar pedido">🗑</button>
          </div>
        </div>
      `;
    }).join('');

    document.getElementById('orders-table').innerHTML = headerHtml + rowsHtml;
  }

  filterPedidos() {
    const search = document.getElementById('search-orders').value.toLowerCase();
    const status = document.getElementById('filter-status').value;
    const date = document.getElementById('filter-date').value;

    let filtered = this.allPedidos.filter(p => {
      const matchSearch = !search ||
        p.nombre_cliente?.toLowerCase().includes(search) ||
        p.id.toString().includes(search) ||
        p.mesa_numero?.toString().includes(search);

      const matchStatus = !status || p.estado === status;

      const matchDate = !date || p.creado_en?.startsWith(date);

      return matchSearch && matchStatus && matchDate;
    });

    this.renderPedidosTable(filtered);
  }

  openPedidoDetail(id) {
    const pedido = this.allPedidos.find(p => p.id === id);
    if (!pedido) return;
    this.showToast(`Pedido #${id} seleccionado`);
  }

  async deletePedido(id, event) {
    event.stopPropagation();
    if (!confirm(`¿Eliminar pedido #${id}?`)) return;

    try {
      const res = await fetch(`/api/pedidos/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      const data = await res.json();
      if (data.success) {
        this.allPedidos = this.allPedidos.filter(p => p.id !== id);
        this.renderDashboard();
        this.renderPedidosTable();
        this.showToast(`✓ Pedido #${id} eliminado`);
      } else {
        this.showToast(`✗ Error al eliminar: ${data.error}`);
      }
    } catch (error) {
      this.showToast('Error de conexión');
      console.error(error);
    }
  }

  // ─── AUDITORIA ───────────────────────────────────────────────
  renderAuditoria(filtered = null) {
    const historial = filtered || this.allHistorial;
    const html = historial.map(h => {
      const campos = [];
      try {
        const antes = JSON.parse(h.campos_anteriores || '{}');
        const ahora = JSON.parse(h.campos_nuevos || '{}');
        for (const key in ahora) {
          if (antes[key] !== undefined) {
            campos.push(`
              <div class="audit-change">
                <div class="audit-change-field">${key}:</div>
                <div class="audit-change-before">${JSON.stringify(antes[key])}</div>
                <div class="audit-change-arrow">→</div>
                <div class="audit-change-after">${JSON.stringify(ahora[key])}</div>
              </div>
            `);
          }
        }
      } catch (e) {}

      return `
        <div class="audit-entry">
          <div class="audit-entry-header">
            <div class="audit-entry-id">Pedido #${h.pedido_id}</div>
            <div class="audit-entry-time">${new Date(h.creado_en).toLocaleString()}</div>
          </div>
          <div style="font-size: 12px; color: var(--muted); margin-bottom: 8px;">
            ${h.tipo_cambio} • ${h.usuario_nombre || 'Sistema'} ${h.notas_cambio ? '• ' + h.notas_cambio : ''}
          </div>
          <div class="audit-entry-changes">${campos.join('')}</div>
        </div>
      `;
    }).join('');

    document.getElementById('audit-timeline').innerHTML = html || '<p style="color: var(--muted);">Sin cambios registrados</p>';
  }

  filterAuditoria() {
    const search = document.getElementById('audit-search').value;
    const type = document.getElementById('audit-type').value;
    const date = document.getElementById('audit-date').value;

    let filtered = this.allHistorial.filter(h => {
      const matchSearch = !search || h.pedido_id.toString().includes(search);
      const matchType = !type || h.tipo_cambio === type;
      const matchDate = !date || h.creado_en?.startsWith(date);
      return matchSearch && matchType && matchDate;
    });

    this.renderAuditoria(filtered);
  }

  // ─── REPORTES ────────────────────────────────────────────────
  renderReportes(data) {
    // Top products
    const topProducts = data.topProducts || [];
    const productsHtml = topProducts.slice(0, 10).map(p => `
      <div class="reporte-item">
        <div class="reporte-item-name">${p.nombre}</div>
        <div class="reporte-item-value">${p.cantidad} unid.</div>
      </div>
    `).join('');
    document.getElementById('top-products').innerHTML = productsHtml || '<p style="color: var(--muted); font-size: 12px;">Sin datos</p>';

    // Changes by user
    const changesByUser = data.changesByUser || [];
    const usersHtml = changesByUser.map(u => `
      <div class="reporte-item">
        <div class="reporte-item-name">${u.usuario_nombre}</div>
        <div class="reporte-item-value">${u.cambios} cambios</div>
      </div>
    `).join('');
    document.getElementById('changes-by-user').innerHTML = usersHtml || '<p style="color: var(--muted); font-size: 12px;">Sin datos</p>';
  }

  // ─── SOCKET.IO ────────────────────────────────────────────────
  setupSocketIO() {
    this.socket = io();

    this.socket.on('connect', () => {
      this.socket.emit('join', { role: 'admin' });
    });

    this.socket.on('nuevo_pedido', (data) => {
      this.loadData();
      this.showToast(`Nuevo pedido #${data.id} - $${data.total}`);
    });

    this.socket.on('pedido_estado_actualizado', (data) => {
      const p = this.allPedidos.find(pd => pd.id === data.id);
      if (p) {
        p.estado = data.estado;
        this.renderDashboard();
        this.renderPedidosTable();
      }
    });

    this.socket.on('pedido_actualizado', (data) => {
      this.loadData();
    });
  }

  // ─── EXPORT ──────────────────────────────────────────────────
  async exportData() {
    const today = new Date().toISOString().split('T')[0];
    const todayPedidos = this.allPedidos.filter(p => p.creado_en?.startsWith(today));

    const ws = XLSX.utils.json_to_sheet(todayPedidos.map(p => ({
      'ID': p.id,
      'Cliente': p.nombre_cliente || '-',
      'Mesa': p.mesa_numero,
      'Total': p.total,
      'Estado': p.estado,
      'Tipo': p.tipo_pedido,
      'Prepagado': p.prepagado ? 'Sí' : 'No',
      'Fecha': new Date(p.creado_en).toLocaleString()
    })));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pedidos');
    XLSX.writeFile(wb, `pedidos_${today}.xlsx`);
    this.showToast('Datos exportados');
  }

  // ─── CLOCK ──────────────────────────────────────────────────
  startClock() {
    const updateTime = () => {
      const now = new Date();
      const time = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      document.getElementById('current-time').textContent = time;
    };
    updateTime();
    setInterval(updateTime, 1000);
  }

  // ─── TOAST ──────────────────────────────────────────────────
  showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.style.display = 'block';
    setTimeout(() => {
      toast.style.display = 'none';
    }, 3000);
  }
}

// Initialize app
const app = new AdminApp();
