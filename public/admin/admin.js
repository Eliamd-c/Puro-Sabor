// ════════════════════════════════════════════════════════════════
// PURO SABOR — ADMIN DASHBOARD (MEJORADO)
// Interfaz profesional con gráficos, búsqueda avanzada y más
// ════════════════════════════════════════════════════════════════

class AdminApp {
  constructor() {
    this.token = localStorage.getItem('puro_sabor_admin_token');
    this.socket = null;
    this.currentPage = 'dashboard';
    this.allPedidos = [];
    this.allHistorial = [];
    this.charts = {};
    this.reporteData = null; // último reporte cargado (para export y re-render)
    this.init();
  }

  // Moneda colombiana con separador de miles: 1250000 → "$1.250.000"
  fmtCOP(n) {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0
    }).format(n || 0);
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
    document.getElementById('btn-logout').addEventListener('click', () => this.logout());

    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', (e) => this.switchPage(e.currentTarget.dataset.page));
    });

    document.getElementById('btn-export').addEventListener('click', () => this.exportData());

    // Pedidos filters
    document.getElementById('search-orders').addEventListener('input', () => this.filterPedidos());
    document.getElementById('filter-status').addEventListener('change', () => this.filterPedidos());
    document.getElementById('filter-date').addEventListener('change', () => this.filterPedidos());

    // Auditoria filters
    document.getElementById('audit-search').addEventListener('input', () => this.filterAuditoria());
    document.getElementById('audit-type').addEventListener('change', () => this.filterAuditoria());
    document.getElementById('audit-date').addEventListener('change', () => this.filterAuditoria());

    // Reportes: presets, rango de fechas y export
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.aplicarPreset(btn.dataset.preset);
      });
    });
    document.getElementById('btn-generar-reporte').addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      this.loadReportes();
    });
    document.getElementById('btn-excel-reporte').addEventListener('click', () => this.exportReporte());
  }

  switchPage(page) {
    this.currentPage = page;
    document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
    document.querySelector(`.page-content[data-page="${page}"]`).classList.add('active');

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelector(`.nav-item[data-page="${page}"]`).classList.add('active');

    const titles = {
      dashboard: { title: 'Dashboard', subtitle: 'Control y auditoría de pedidos' },
      pedidos: { title: 'Pedidos', subtitle: 'Historial completo de órdenes' },
      auditoria: { title: 'Auditoría', subtitle: 'Registro de cambios y modificaciones' },
      reportes: { title: 'Reportes', subtitle: 'Análisis de ventas y actividades' }
    };
    const t = titles[page];
    document.getElementById('page-title').textContent = t.title;
    document.getElementById('page-subtitle').textContent = t.subtitle;

    // Renderizar contenido según página
    if (page === 'dashboard') {
      setTimeout(() => this.renderCharts(), 100);
    } else if (page === 'pedidos') {
      this.renderPedidosTable();
    } else if (page === 'auditoria') {
      this.renderAuditoria();
    } else if (page === 'reportes') {
      // Re-render con la página visible (Chart.js no dibuja bien en canvas oculto)
      if (this.reporteData) {
        setTimeout(() => this.renderReportes(this.reporteData), 100);
      } else {
        this.loadReportes();
      }
    }
  }

  logout() {
    localStorage.removeItem('puro_sabor_admin_token');
    window.location.reload();
  }

  // ─── AUTH HEADER / 401 HANDLER ──────────────────────────────
  authH() {
    return { 'Authorization': `Bearer ${this.token}`, 'Content-Type': 'application/json' };
  }

  handleUnauthorized() {
    this.showToast('⚠️ Sesión expirada, ingresa de nuevo');
    localStorage.removeItem('puro_sabor_admin_token');
    setTimeout(() => window.location.reload(), 1500);
  }

  // ─── DATA LOADING ────────────────────────────────────────────
  async loadData() {
    try {
      // limit=500: /api/pedidos pagina a 20 por defecto (FASE 3.4) y truncaría KPIs y gráficas
      const [resPedidos, resHistorial] = await Promise.all([
        fetch('/api/pedidos?limit=500', { headers: this.authH() }),
        fetch('/api/pedidos/historial', { headers: this.authH() })
      ]);

      if (resPedidos.status === 401 || resHistorial.status === 401) {
        this.handleUnauthorized();
        return;
      }

      const dataPedidos = await resPedidos.json();
      const dataHistorial = await resHistorial.json();

      this.allPedidos = dataPedidos.data || [];
      this.allHistorial = dataHistorial.data || [];

      this.renderDashboard();
      if (this.currentPage === 'pedidos') this.renderPedidosTable();
      if (this.currentPage === 'auditoria') this.renderAuditoria();
      if (this.currentPage === 'dashboard') setTimeout(() => this.renderCharts(), 100);
    } catch (error) {
      console.error('Error loading data:', error);
      this.showToast('❌ Error de conexión al cargar datos');
    }

    this.loadReportes();
  }

  // ─── REPORTES: CARGA CON RANGO DE FECHAS ────────────────────
  async loadReportes(desde, hasta) {
    // Sin argumentos usa lo que haya en los inputs (o el default del backend: 7 días)
    desde = desde || document.getElementById('reporte-desde').value;
    hasta = hasta || document.getElementById('reporte-hasta').value;
    const params = new URLSearchParams();
    if (desde) params.set('desde', desde);
    if (hasta) params.set('hasta', hasta);

    try {
      const res = await fetch(`/api/pedidos/reportes?${params}`, { headers: this.authH() });
      if (res.status === 401) { this.handleUnauthorized(); return; }
      const data = await res.json();
      if (!data.success) {
        this.showToast(`❌ ${data.message || 'Error al generar el reporte'}`);
        return;
      }
      this.reporteData = data.data || {};
      // Reflejar el rango efectivo en los inputs (el backend aplica defaults)
      document.getElementById('reporte-desde').value = this.reporteData.desde || '';
      document.getElementById('reporte-hasta').value = this.reporteData.hasta || '';
      this.renderReportes(this.reporteData);
    } catch (error) {
      console.error('Error loading reportes:', error);
      this.showToast('❌ Error de conexión al cargar reportes');
    }
  }

  aplicarPreset(preset) {
    const hoy = this.coDate(new Date());
    let desde = hoy;
    if (preset === '7d') {
      const d = new Date(); d.setDate(d.getDate() - 6); desde = this.coDate(d);
    } else if (preset === '30d') {
      const d = new Date(); d.setDate(d.getDate() - 29); desde = this.coDate(d);
    } else if (preset === 'mes') {
      desde = hoy.slice(0, 8) + '01';
    }
    document.getElementById('reporte-desde').value = desde;
    document.getElementById('reporte-hasta').value = hoy;
    this.loadReportes(desde, hoy);
  }

  // Fecha YYYY-MM-DD en zona horaria de Colombia (no UTC)
  coDate(ts) {
    return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  }

  // ─── DASHBOARD ────────────────────────────────────────────────
  renderDashboard() {
    const today = this.coDate(new Date());
    const esHoy = (ts) => ts && this.coDate(ts) === today;
    const todayPedidos = this.allPedidos.filter(p => esHoy(p.creado_en));
    const pendientes = todayPedidos.filter(p => p.estado === 'pendiente' || p.estado === 'preparando').length;
    const totalVentas = todayPedidos.filter(p => p.estado === 'pagado').reduce((s, p) => s + (p.total || 0), 0);
    const cambiosHoy = this.allHistorial.filter(h => esHoy(h.creado_en)).length;

    document.getElementById('kpi-total').textContent = todayPedidos.length;
    document.getElementById('kpi-total-sub').textContent = `${todayPedidos.length} hoy`;

    document.getElementById('kpi-pending').textContent = pendientes;
    document.getElementById('kpi-pending-sub').textContent = `${pendientes} en cola`;

    document.getElementById('kpi-revenue').textContent = this.fmtCOP(totalVentas);
    document.getElementById('kpi-revenue-sub').textContent = `Ingresos hoy`;

    document.getElementById('kpi-changes').textContent = cambiosHoy;
    document.getElementById('kpi-changes-sub').textContent = `${cambiosHoy} cambios`;

    // Recent orders
    const recentOrders = todayPedidos.slice(0, 5);
    const ordersHtml = recentOrders.map(p => `
      <div class="activity-item">
        <div class="activity-item-id">#${p.id} - ${p.nombre_cliente || 'Cliente'}</div>
        <div class="activity-item-meta">${this.fmtCOP(p.total)} • <span class="status-badge status-${p.estado}">${p.estado}</span></div>
      </div>
    `).join('');
    document.getElementById('recent-orders').innerHTML = ordersHtml || '<p style="color: var(--muted); font-size: 12px;">Sin pedidos hoy</p>';

    // Recent changes
    const recentChanges = this.allHistorial.filter(h => esHoy(h.creado_en)).slice(0, 5);
    const changesHtml = recentChanges.map(h => `
      <div class="activity-item">
        <div class="activity-item-id">Pedido #${h.pedido_id}</div>
        <div class="activity-item-meta">${h.tipo_cambio} • ${h.usuario_nombre || 'Sistema'}</div>
      </div>
    `).join('');
    document.getElementById('recent-changes').innerHTML = changesHtml || '<p style="color: var(--muted); font-size: 12px;">Sin cambios hoy</p>';
  }

  // ─── CHARTS ───────────────────────────────────────────────────
  renderCharts() {
    const ctx1 = document.getElementById('chart-status')?.getContext('2d');
    const ctx2 = document.getElementById('chart-revenue')?.getContext('2d');

    if (!ctx1 || !ctx2) return;

    // Chart 1: Orders by status
    const statusData = {};
    this.allPedidos.forEach(p => {
      statusData[p.estado] = (statusData[p.estado] || 0) + 1;
    });

    if (this.charts.status) this.charts.status.destroy();
    this.charts.status = new Chart(ctx1, {
      type: 'doughnut',
      data: {
        labels: Object.keys(statusData),
        datasets: [{
          data: Object.values(statusData),
          backgroundColor: ['#f39c12', '#3498db', '#27ae60', '#9b59b6', '#2ecc71'],
          borderColor: 'var(--surface)',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { position: 'bottom' } }
      }
    });

    // Chart 2: Revenue by day (last 7 days)
    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      last7Days.push(this.coDate(d));
    }

    const revenueByDay = {};
    last7Days.forEach(day => {
      revenueByDay[day] = this.allPedidos
        .filter(p => p.creado_en && this.coDate(p.creado_en) === day && p.estado === 'pagado')
        .reduce((sum, p) => sum + (p.total || 0), 0);
    });

    if (this.charts.revenue) this.charts.revenue.destroy();
    this.charts.revenue = new Chart(ctx2, {
      type: 'line',
      data: {
        labels: last7Days.map(d => new Date(d).toLocaleDateString('es-ES', { weekday: 'short', timeZone: 'UTC' })),
        datasets: [{
          label: 'Ingresos',
          data: Object.values(revenueByDay),
          borderColor: 'var(--brand)',
          backgroundColor: 'rgba(192, 57, 43, 0.1)',
          tension: 0.4,
          fill: true,
          pointRadius: 4,
          pointBackgroundColor: 'var(--brand)'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  }

  // ─── PEDIDOS TABLE ───────────────────────────────────────────
  renderPedidosTable(filtered = null) {
    const pedidos = filtered || this.allPedidos;
    const headerHtml = `
      <div class="orders-table-modern-header">
        <div>ID</div>
        <div>Cliente</div>
        <div>Lugar</div>
        <div>Total</div>
        <div>Estado</div>
        <div>Cambios</div>
        <div>Acciones</div>
      </div>
    `;

    const rowsHtml = pedidos.map(p => {
      const lugar = p.tipo_pedido === 'local' ? `Mesa ${p.mesa_numero}` : (p.tipo_pedido === 'domicilio' ? p.direccion_domicilio : 'Recogen');
      const cambios = this.allHistorial.filter(h => h.pedido_id === p.id).length;
      return `
        <div class="orders-table-modern-row">
          <div class="order-id">#${p.id}</div>
          <div class="order-client">${p.nombre_cliente || '-'}</div>
          <div class="order-info">${lugar}</div>
          <div class="order-total">${this.fmtCOP(p.total)}</div>
          <div><span class="status-badge status-${p.estado}">${p.estado}</span></div>
          <div class="order-info">${cambios}</div>
          <div style="display:flex;gap:6px;">
            <button class="btn-view-order" onclick="app.viewPedido(${p.id})" title="Ver detalle">👁</button>
            <button class="btn-delete-order" onclick="app.deletePedido(${p.id}, event)" title="Eliminar">🗑</button>
          </div>
        </div>
      `;
    }).join('');

    document.getElementById('orders-table').innerHTML = headerHtml + rowsHtml;
    document.getElementById('orders-count').textContent = `${pedidos.length} pedidos`;
  }

  filterPedidos() {
    const search = document.getElementById('search-orders').value.toLowerCase();
    const status = document.getElementById('filter-status').value;
    const date = document.getElementById('filter-date').value;

    let filtered = this.allPedidos.filter(p => {
      const matchSearch = !search || p.nombre_cliente?.toLowerCase().includes(search) || p.id.toString().includes(search) || p.mesa_numero?.toString().includes(search);
      const matchStatus = !status || p.estado === status;
      const matchDate = !date || p.creado_en?.startsWith(date);
      return matchSearch && matchStatus && matchDate;
    });

    this.renderPedidosTable(filtered);
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
        this.showToast(`✗ Error: ${data.error}`);
      }
    } catch (error) {
      this.showToast('Error de conexión');
      console.error(error);
    }
  }

  // ─── VER DETALLE PEDIDO ──────────────────────────────────────
  viewPedido(id) {
    const pedido = this.allPedidos.find(p => p.id === id);
    if (!pedido) return;

    const items = pedido.items || [];
    const historial = this.allHistorial.filter(h => h.pedido_id === id);

    const fecha = pedido.creado_en
      ? new Date(pedido.creado_en).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
      : '—';

    const lugarMap = {
      local: `Mesa ${pedido.mesa_numero || '—'}`,
      domicilio: pedido.direccion_domicilio || 'Sin dirección',
      recogen: 'Para recoger'
    };
    const lugar = lugarMap[pedido.tipo_pedido] || `Mesa ${pedido.mesa_numero || '—'}`;

    const tipoIcon = { local: '🏪', domicilio: '🏍', recogen: '🛍' }[pedido.tipo_pedido] || '📋';

    const itemsHtml = items.length
      ? items.map(i => `
          <div class="detail-item-row">
            <span class="detail-item-qty">${i.cantidad}x</span>
            <span class="detail-item-name">${i.nombre}</span>
            <span class="detail-item-price">$${((i.precio || 0) * i.cantidad).toLocaleString('es-CO')}</span>
          </div>`).join('')
      : '<p style="color:var(--muted);font-size:13px;">Sin items registrados</p>';

    const historialHtml = historial.length
      ? historial.map(h => {
          const when = new Date(h.creado_en).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
          return `
            <div class="detail-audit-row">
              <span class="detail-audit-who">👤 ${h.usuario_nombre || 'Sistema'}</span>
              <span class="detail-audit-type">${h.tipo_cambio}</span>
              <span class="detail-audit-when">${when}</span>
            </div>`;
        }).join('')
      : '<p style="color:var(--muted);font-size:13px;">Sin modificaciones registradas</p>';

    const creadoPor = pedido.creado_por || 'QR / Cliente';
    const metodo = pedido.metodo_pago || '—';
    const notas = pedido.notas || '—';
    const prepagado = pedido.prepagado ? '✅ Sí' : 'No';

    document.getElementById('modal-order-title').textContent = `Pedido #${pedido.id}`;
    document.getElementById('modal-order-body').innerHTML = `
      <div class="order-detail-wrap">

        <div class="detail-header-row">
          <span class="status-badge status-${pedido.estado}">${pedido.estado}</span>
          <span class="detail-meta">${tipoIcon} ${lugar}</span>
          <span class="detail-meta">🕐 ${fecha}</span>
        </div>

        <div class="detail-section">
          <div class="detail-field">
            <span class="detail-label">👤 Atendido por</span>
            <span class="detail-value detail-highlight">${creadoPor}</span>
          </div>
          <div class="detail-field">
            <span class="detail-label">🙍 Cliente</span>
            <span class="detail-value">${pedido.nombre_cliente || '—'}</span>
          </div>
          ${pedido.tipo_pedido === 'domicilio' ? `
          <div class="detail-field">
            <span class="detail-label">📍 Dirección</span>
            <span class="detail-value">${pedido.direccion_domicilio || '—'}</span>
          </div>` : ''}
        </div>

        <div class="detail-section">
          <h4 class="detail-section-title">🛒 Productos</h4>
          <div class="detail-items-list">${itemsHtml}</div>
          <div class="detail-total-row">
            <span>Total</span>
            <span class="detail-total-amount">$${(pedido.total || 0).toLocaleString('es-CO')}</span>
          </div>
        </div>

        <div class="detail-section detail-row-2">
          <div class="detail-field">
            <span class="detail-label">📝 Notas</span>
            <span class="detail-value">${notas}</span>
          </div>
          <div class="detail-field">
            <span class="detail-label">💳 Método de pago</span>
            <span class="detail-value">${metodo}</span>
          </div>
          <div class="detail-field">
            <span class="detail-label">💰 Prepagado</span>
            <span class="detail-value">${prepagado}</span>
          </div>
        </div>

        <div class="detail-section">
          <h4 class="detail-section-title">🔍 Historial de cambios</h4>
          <div class="detail-audit-list">${historialHtml}</div>
        </div>

      </div>
    `;

    document.getElementById('modal-order-detail').style.display = 'flex';
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
                <div class="audit-change-before">${JSON.stringify(antes[key]).substring(0, 20)}</div>
                <div class="audit-change-arrow">→</div>
                <div class="audit-change-after">${JSON.stringify(ahora[key]).substring(0, 20)}</div>
              </div>
            `);
          }
        }
      } catch (e) {}

      return `
        <div class="audit-item">
          <div class="audit-item-header">
            <div class="audit-item-id">Pedido #${h.pedido_id}</div>
            <div class="audit-item-time">${new Date(h.creado_en).toLocaleString()}</div>
          </div>
          <div class="audit-item-type">${h.tipo_cambio} • ${h.usuario_nombre || 'Sistema'}</div>
          <div class="audit-changes">${campos.join('')}</div>
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
    const resumen = data.resumen || {};
    const ventasPorDia = data.ventasPorDia || [];

    // Resumen del período
    const fmtFecha = (f) => f ? new Date(`${f}T12:00:00-05:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'America/Bogota' }) : '—';
    document.getElementById('rep-total-ventas').textContent = this.fmtCOP(resumen.total_ventas);
    document.getElementById('rep-rango').textContent = `${fmtFecha(data.desde)} → ${fmtFecha(data.hasta)}`;
    document.getElementById('rep-total-pedidos').textContent = resumen.total_pedidos || 0;
    document.getElementById('rep-sin-pagar').textContent =
      `${resumen.pedidos_sin_pagar || 0} sin pagar · ${resumen.pedidos_cancelados || 0} cancelados`;
    document.getElementById('rep-promedio').textContent = this.fmtCOP(resumen.promedio_pedido);
    const pt = resumen.por_tipo || {};
    document.getElementById('rep-por-tipo').innerHTML =
      `🏪 ${this.fmtCOP(pt.local?.ventas)}<br>🏍 ${this.fmtCOP(pt.domicilio?.ventas)}<br>🛍 ${this.fmtCOP(pt.recogen?.ventas)}`;

    // Gráfica de ventas por día
    document.getElementById('rep-dias-badge').textContent = `${ventasPorDia.length} días`;
    const ctx = document.getElementById('chart-ventas-dia')?.getContext('2d');
    if (ctx) {
      if (this.charts.ventasDia) this.charts.ventasDia.destroy();
      this.charts.ventasDia = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: ventasPorDia.map(v => new Date(`${v.fecha}T12:00:00-05:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'America/Bogota' })),
          datasets: [{
            label: 'Ventas',
            data: ventasPorDia.map(v => v.venta_total),
            backgroundColor: 'rgba(192, 57, 43, 0.6)',
            borderColor: '#c0392b',
            borderWidth: 1,
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (c) => `${this.fmtCOP(c.raw)} — ${ventasPorDia[c.dataIndex].total_pedidos} pedidos` } }
          },
          scales: { y: { beginAtZero: true, ticks: { callback: (v) => this.fmtCOP(v) } } }
        }
      });
    }

    // Tabla de ventas por día (solo días con movimiento, más fila de total)
    const conVentas = ventasPorDia.filter(v => v.total_pedidos > 0);
    const filas = conVentas.map(v => `
      <tr>
        <td>${new Date(`${v.fecha}T12:00:00-05:00`).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' })}</td>
        <td class="num">${v.total_pedidos}</td>
        <td class="num">${this.fmtCOP(v.venta_total)}</td>
        <td class="num">${this.fmtCOP(v.total_pedidos ? v.venta_total / v.total_pedidos : 0)}</td>
      </tr>
    `).join('');
    document.getElementById('ventas-dia-tabla').innerHTML = conVentas.length ? `
      <table>
        <thead><tr><th>Fecha</th><th class="num">Pedidos</th><th class="num">Ventas</th><th class="num">Promedio</th></tr></thead>
        <tbody>
          ${filas}
          <tr class="total-row">
            <td>TOTAL</td>
            <td class="num">${resumen.total_pedidos || 0}</td>
            <td class="num">${this.fmtCOP(resumen.total_ventas)}</td>
            <td class="num">${this.fmtCOP(resumen.promedio_pedido)}</td>
          </tr>
        </tbody>
      </table>` : '<p style="color: var(--muted); font-size: 12px; text-align:center; padding: 12px;">Sin ventas pagadas en este período</p>';

    // Top productos del período
    const topProducts = data.topProducts || [];
    const productsHtml = topProducts.slice(0, 10).map((p, i) => `
      <div class="reporte-item">
        <div style="display:flex;align-items:center;flex:1;">
          <div class="reporte-rank">#${i + 1}</div>
          <div class="reporte-item-name">${p.nombre}</div>
        </div>
        <div class="reporte-item-value">${p.cantidad} unid. · ${this.fmtCOP(p.total_vendido)}</div>
      </div>
    `).join('');
    document.getElementById('top-products').innerHTML = productsHtml || '<p style="color: var(--muted); font-size: 12px;">Sin datos</p>';

    const changesByUser = data.changesByUser || [];
    const usersHtml = changesByUser.slice(0, 10).map((u, i) => `
      <div class="reporte-item">
        <div style="display:flex;align-items:center;flex:1;">
          <div class="reporte-rank">#${i + 1}</div>
          <div class="reporte-item-name">${u.usuario_nombre}</div>
        </div>
        <div class="reporte-item-value">${u.cambios} cambios</div>
      </div>
    `).join('');
    document.getElementById('changes-by-user').innerHTML = usersHtml || '<p style="color: var(--muted); font-size: 12px;">Sin datos</p>';
  }

  // ─── SOCKET.IO ────────────────────────────────────────────────
  setupSocketIO() {
    this.socket = io({ transports: ['websocket', 'polling'] });

    this.socket.on('connect', () => {
      this.socket.emit('unirse_admin');
    });

    this.socket.on('disconnect', () => {
      this.showToast('⚠️ Conexión perdida, reconectando…');
    });

    this.socket.on('reconnect', () => {
      this.socket.emit('unirse_admin');
      this.loadData();
      this.showToast('✓ Reconectado');
    });

    this.socket.on('nuevo_pedido', (data) => {
      this.loadData();
      this.showToast(`🔔 Nuevo pedido #${data.id}`);
    });

    this.socket.on('pedido_estado_actualizado', (data) => {
      const p = this.allPedidos.find(pd => pd.id === parseInt(data.id));
      if (p) {
        p.estado = data.estado;
        this.renderDashboard();
        if (this.currentPage === 'pedidos') this.renderPedidosTable();
      }
    });

    this.socket.on('pedido_actualizado', () => {
      this.loadData();
    });

    this.socket.on('pedido_eliminado', (data) => {
      this.allPedidos = this.allPedidos.filter(p => p.id !== parseInt(data.id));
      this.renderDashboard();
      if (this.currentPage === 'pedidos') this.renderPedidosTable();
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
    this.showToast('✓ Datos exportados');
  }

  // Exporta el reporte del período actual: resumen + ventas por día + top productos
  exportReporte() {
    if (!this.reporteData) {
      this.showToast('⚠️ Genera un reporte primero');
      return;
    }
    const { desde, hasta, resumen = {}, ventasPorDia = [], topProducts = [] } = this.reporteData;
    const wb = XLSX.utils.book_new();

    const pt = resumen.por_tipo || {};
    const wsResumen = XLSX.utils.json_to_sheet([
      { Concepto: 'Período', Valor: `${desde} a ${hasta}` },
      { Concepto: 'Ventas totales', Valor: resumen.total_ventas || 0 },
      { Concepto: 'Pedidos pagados', Valor: resumen.total_pedidos || 0 },
      { Concepto: 'Promedio por pedido', Valor: resumen.promedio_pedido || 0 },
      { Concepto: 'Pedidos sin pagar', Valor: resumen.pedidos_sin_pagar || 0 },
      { Concepto: 'Pedidos cancelados', Valor: resumen.pedidos_cancelados || 0 },
      { Concepto: 'Ventas local', Valor: pt.local?.ventas || 0 },
      { Concepto: 'Ventas domicilio', Valor: pt.domicilio?.ventas || 0 },
      { Concepto: 'Ventas recogen', Valor: pt.recogen?.ventas || 0 }
    ]);
    XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

    const wsDias = XLSX.utils.json_to_sheet(ventasPorDia.map(v => ({
      Fecha: v.fecha,
      Pedidos: v.total_pedidos,
      Ventas: v.venta_total
    })));
    XLSX.utils.book_append_sheet(wb, wsDias, 'Ventas por día');

    const wsTop = XLSX.utils.json_to_sheet(topProducts.map((p, i) => ({
      Puesto: i + 1,
      Producto: p.nombre,
      Unidades: p.cantidad,
      'Total vendido': p.total_vendido
    })));
    XLSX.utils.book_append_sheet(wb, wsTop, 'Top productos');

    XLSX.writeFile(wb, `reporte_ventas_${desde}_a_${hasta}.xlsx`);
    this.showToast('✓ Reporte exportado');
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
