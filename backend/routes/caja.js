const express = require('express');
const router = express.Router();
const dbAsync = require('../config/database-promise');
const { verificarJWT } = require('../middleware/auth');

// GET /api/caja/hoy - Obtener resumen de caja de hoy
router.get('/hoy', verificarJWT, async (req, res, next) => {
  try {
    // Calculamos el inicio del día en la zona horaria de Colombia
    const query = `
      SELECT 
        SUM(CASE WHEN tipo = 'ingreso' THEN monto ELSE 0 END) as ingresos,
        SUM(CASE WHEN tipo = 'gasto' THEN monto ELSE 0 END) as gastos
      FROM caja_registros 
      WHERE DATE(fecha) = CURRENT_DATE
    `;
    const result = await dbAsync.get(query);
    
    const ingresos = parseFloat(result?.ingresos || 0);
    const gastos = parseFloat(result?.gastos || 0);
    const balance = ingresos - gastos;

    res.json({ success: true, data: { ingresos, gastos, balance } });
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
    // Esto es un placeholder. En un futuro extraerá los items de los JSON de pedidos
    // Por ahora cuenta cantidad de pedidos
    const query = `SELECT COUNT(*) as total_pedidos FROM pedidos WHERE estado = 'completado' AND DATE(creado_en) = CURRENT_DATE`;
    const result = await dbAsync.get(query);
    
    res.json({ success: true, data: { total_pedidos_hoy: result.total_pedidos } });
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
