const express = require('express');
const router = express.Router();
const dbAsync = require('../config/database-promise');
const { verificarJWT } = require('../middleware/auth');

// GET /api/insumos - Obtener todos los insumos
router.get('/', verificarJWT, async (req, res, next) => {
  try {
    const rows = await dbAsync.all('SELECT * FROM insumos ORDER BY categoria, nombre');
    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

// POST /api/insumos - Crear un nuevo insumo
router.post('/', verificarJWT, async (req, res, next) => {
  const { nombre, categoria, cantidad, unidad, stock_minimo, notas } = req.body;
  
  if (!nombre) {
    return res.status(400).json({ success: false, message: 'El nombre es requerido' });
  }

  try {
    const query = `
      INSERT INTO insumos (nombre, categoria, cantidad, unidad, stock_minimo, notas)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    const result = await dbAsync.run(query, [
      nombre, 
      categoria || 'General', 
      cantidad || 0, 
      unidad || 'unidades', 
      stock_minimo || 0, 
      notas || ''
    ]);
    res.status(201).json({ success: true, message: 'Insumo creado', id: result.lastID });
  } catch (error) {
    next(error);
  }
});

// PUT /api/insumos/:id - Actualizar insumo
router.put('/:id', verificarJWT, async (req, res, next) => {
  const { nombre, categoria, cantidad, unidad, stock_minimo, notas } = req.body;
  const { id } = req.params;

  try {
    const query = `
      UPDATE insumos 
      SET nombre = COALESCE(?, nombre),
          categoria = COALESCE(?, categoria),
          cantidad = COALESCE(?, cantidad),
          unidad = COALESCE(?, unidad),
          stock_minimo = COALESCE(?, stock_minimo),
          notas = COALESCE(?, notas),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;
    await dbAsync.run(query, [nombre, categoria, cantidad, unidad, stock_minimo, notas, id]);
    res.json({ success: true, message: 'Insumo actualizado' });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/insumos/:id - Eliminar insumo
router.delete('/:id', verificarJWT, async (req, res, next) => {
  try {
    await dbAsync.run('DELETE FROM insumos WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Insumo eliminado' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
