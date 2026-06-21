const express = require('express');
const router = express.Router();
const dbAsync = require('../config/database-promise');
const { verificarJWT } = require('../middleware/auth');

// GET /api/caja/hoy - Resumen de caja de hoy (ventas reales + movimientos manuales)
router.get('/hoy', verificarJWT, async (req, res, next) => {
  try {
    // 1. Ventas reales del día (pedidos pagados)
    const ventasRow = await dbAsync.get(`
      SELECT COUNT(*) as num_pedidos, COALESCE(SUM(total), 0) as ventas
      FROM pedidos WHERE estado = 'pagado' AND DATE(creado_en) = CURRENT_DATE
    `);
    // 2. Ingresos/gastos manuales registrados en caja
    const cajaRow = await dbAsync.get(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo = 'ingreso' THEN monto ELSE 0 END), 0) as ingresos_manuales,
        COALESCE(SUM(CASE WHEN tipo = 'gasto' THEN monto ELSE 0 END), 0) as gastos
      FROM caja_registros WHERE DATE(fecha) = CURRENT_DATE
    `);

    const ventas = parseFloat(ventasRow?.ventas || 0);
    const ingresosManuales = parseFloat(cajaRow?.ingresos_manuales || 0);
    const gastos = parseFloat(cajaRow?.gastos || 0);
    const ingresos = ventas + ingresosManuales;
    const balance = ingresos - gastos;

    res.json({
      success: true,
      data: {
        // Claves nuevas (detalle)
        ventas,
        num_pedidos: parseInt(ventasRow?.num_pedidos || 0),
        ingresos_manuales: ingresosManuales,
        // Claves compatibles con el panel actual
        ingresos,
        gastos,
        balance
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/caja/cierre?fecha=YYYY-MM-DD - Cierre de caja formal (reporte Z)
router.get('/cierre', verificarJWT, async (req, res, next) => {
  try {
    const fecha = req.query.fecha; // opcional; por defecto hoy
    const filtroFecha = fecha ? 'DATE(creado_en) = ?' : 'DATE(creado_en) = CURRENT_DATE';
    const filtroCaja = fecha ? 'DATE(fecha) = ?' : 'DATE(fecha) = CURRENT_DATE';
    const pParam = fecha ? [fecha] : [];

    // Ventas por método de pago
    const porMetodo = await dbAsync.all(`
      SELECT COALESCE(NULLIF(metodo_pago, ''), 'sin_especificar') as metodo,
             COUNT(*) as pedidos, COALESCE(SUM(total), 0) as monto
      FROM pedidos
      WHERE estado = 'pagado' AND ${filtroFecha}
      GROUP BY COALESCE(NULLIF(metodo_pago, ''), 'sin_especificar')
      ORDER BY monto DESC
    `, pParam);

    // Totales de ventas
    const ventasRow = await dbAsync.get(`
      SELECT COUNT(*) as num_pedidos, COALESCE(SUM(total), 0) as total_ventas,
             COALESCE(AVG(total), 0) as ticket_promedio
      FROM pedidos WHERE estado = 'pagado' AND ${filtroFecha}
    `, pParam);

    // Gastos por categoría
    const gastosPorCat = await dbAsync.all(`
      SELECT COALESCE(categoria, 'General') as categoria, COALESCE(SUM(monto), 0) as monto
      FROM caja_registros WHERE tipo = 'gasto' AND ${filtroCaja}
      GROUP BY COALESCE(categoria, 'General') ORDER BY monto DESC
    `, pParam);

    const ingresosManualesRow = await dbAsync.get(`
      SELECT COALESCE(SUM(monto), 0) as monto FROM caja_registros
      WHERE tipo = 'ingreso' AND ${filtroCaja}
    `, pParam);

    const totalVentas = parseFloat(ventasRow?.total_ventas || 0);
    const ingresosManuales = parseFloat(ingresosManualesRow?.monto || 0);
    const totalGastos = gastosPorCat.reduce((s, g) => s + parseFloat(g.monto), 0);

    res.json({
      success: true,
      data: {
        fecha: fecha || 'hoy',
        num_pedidos: parseInt(ventasRow?.num_pedidos || 0),
        total_ventas: totalVentas,
        ticket_promedio: Math.round(parseFloat(ventasRow?.ticket_promedio || 0)),
        ventas_por_metodo: porMetodo.map(m => ({ metodo: m.metodo, pedidos: parseInt(m.pedidos), monto: parseFloat(m.monto) })),
        ingresos_manuales: ingresosManuales,
        gastos_por_categoria: gastosPorCat.map(g => ({ categoria: g.categoria, monto: parseFloat(g.monto) })),
        total_gastos: totalGastos,
        balance: totalVentas + ingresosManuales - totalGastos
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/caja/registros - Obtener registros de caja
router.get('/registros', verificarJWT, async (req, res, next) => {
  try {
    const rows = await dbAsync.all('SELECT * FROM caja_registros ORDER BY fecha DESC LIMIT 100');
    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

// POST /api/caja/registro - Crear un nuevo registro manual (gasto o ingreso)
router.post('/registro', verificarJWT, async (req, res, next) => {
  const { tipo, descripcion, monto, categoria } = req.body;
  
  if (!tipo || !descripcion || !monto) {
    return res.status(400).json({ success: false, message: 'Faltan datos obligatorios' });
  }

  try {
    const query = `
      INSERT INTO caja_registros (tipo, descripcion, monto, categoria, creado_por)
      VALUES (?, ?, ?, ?, ?)
    `;
    const adminUser = req.admin ? req.admin.usuario : 'admin';
    const result = await dbAsync.run(query, [tipo, descripcion, monto, categoria || 'General', adminUser]);
    res.status(201).json({ success: true, message: 'Registro creado', id: result.lastID });
  } catch (error) {
    next(error);
  }
});

// GET /api/caja/reporte-ventas - Obtener productos más vendidos
router.get('/reporte-ventas', verificarJWT, async (req, res, next) => {
  try {
    const query = `SELECT COUNT(*) as total_pedidos FROM pedidos WHERE estado = 'pagado' AND DATE(creado_en) = CURRENT_DATE`;
    const result = await dbAsync.get(query);

    res.json({ success: true, data: { total_pedidos_hoy: parseInt(result?.total_pedidos || 0) } });
  } catch (error) {
    next(error);
  }
});

// PUT /api/caja/registro/:id - Editar un registro manual
router.put('/registro/:id', verificarJWT, async (req, res, next) => {
  const { tipo, descripcion, monto, categoria } = req.body;
  const { id } = req.params;
  
  if (!tipo || !descripcion || monto === undefined) {
    return res.status(400).json({ success: false, message: 'Faltan datos obligatorios' });
  }

  try {
    const query = `
      UPDATE caja_registros 
      SET tipo = ?, descripcion = ?, monto = ?, categoria = ?
      WHERE id = ?
    `;
    const result = await dbAsync.run(query, [tipo, descripcion, monto, categoria || 'General', id]);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Registro no encontrado' });
    }
    res.json({ success: true, message: 'Registro actualizado' });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/caja/registro/:id - Eliminar un registro
router.delete('/registro/:id', verificarJWT, async (req, res, next) => {
  const { id } = req.params;
  
  try {
    const query = `DELETE FROM caja_registros WHERE id = ?`;
    const result = await dbAsync.run(query, [id]);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, message: 'Registro no encontrado' });
    }
    res.json({ success: true, message: 'Registro eliminado' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
