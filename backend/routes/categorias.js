const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verificarJWT } = require('../middleware/auth');

// === RUTAS PÚBLICAS ===

// GET /api/categorias (Listar categorías activas ordenadas)
router.get('/', (req, res) => {
  db.all('SELECT * FROM categorias WHERE activa = 1 ORDER BY orden ASC', (err, rows) => {
    if (err) {
      return res.status(500).json({ 
        success: false, 
        message: 'Error al obtener categorías.', 
        error: err.message 
      });
    }
    res.json({
      success: true,
      data: rows
    });
  });
});

// === RUTAS PRIVADAS (ADMIN) ===

// GET /api/admin/categorias (Listar todas las categorías, activa o inactiva, con conteo de productos)
router.get('/admin', verificarJWT, (req, res) => {
  const query = `
    SELECT c.*, COUNT(p.id) as total_productos 
    FROM categorias c 
    LEFT JOIN productos p ON c.id = p.categoria_id AND p.activo = 1
    GROUP BY c.id
    ORDER BY c.orden ASC
  `;
  
  db.all(query, (err, rows) => {
    if (err) {
      return res.status(500).json({ 
        success: false, 
        message: 'Error al obtener categorías de administración.', 
        error: err.message 
      });
    }
    res.json({
      success: true,
      data: rows
    });
  });
});

// POST /api/admin/categorias (Crear categoría)
router.post('/admin', verificarJWT, (req, res) => {
  const { nombre, descripcion, orden } = req.body;

  if (!nombre) {
    return res.status(400).json({ 
      success: false, 
      message: 'El nombre de la categoría es requerido.' 
    });
  }

  const query = 'INSERT INTO categorias (nombre, descripcion, orden) VALUES (?, ?, ?)';
  const params = [nombre, descripcion || '', orden || 0];

  db.run(query, params, function(err) {
    if (err) {
      if (err.message.includes('UNIQUE')) {
        return res.status(400).json({ 
          success: false, 
          message: 'Ya existe una categoría con ese nombre.' 
        });
      }
      return res.status(500).json({ 
        success: false, 
        message: 'Error al crear la categoría.', 
        error: err.message 
      });
    }

    res.status(201).json({
      success: true,
      message: 'Categoría creada con éxito.',
      data: {
        id: this.lastID,
        nombre,
        descripcion,
        orden: orden || 0,
        activa: 1
      }
    });
  });
});

// PUT /api/admin/categorias/:id (Actualizar categoría)
router.put('/admin/:id', verificarJWT, (req, res) => {
  const { id } = req.params;
  const { nombre, descripcion, orden, activa } = req.body;

  if (!nombre) {
    return res.status(400).json({ 
      success: false, 
      message: 'El nombre de la categoría es requerido.' 
    });
  }

  const query = `
    UPDATE categorias 
    SET nombre = ?, descripcion = ?, orden = ?, activa = ? 
    WHERE id = ?
  `;
  const params = [nombre, descripcion || '', orden || 0, activa === undefined ? 1 : activa, id];

  db.run(query, params, function(err) {
    if (err) {
      if (err.message.includes('UNIQUE')) {
        return res.status(400).json({ 
          success: false, 
          message: 'Ya existe otra categoría con ese nombre.' 
        });
      }
      return res.status(500).json({ 
        success: false, 
        message: 'Error al actualizar la categoría.', 
        error: err.message 
      });
    }

    if (this.changes === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Categoría no encontrada.' 
      });
    }

    res.json({
      success: true,
      message: 'Categoría actualizada con éxito.',
      data: { id: parseInt(id), nombre, descripcion, orden, activa }
    });
  });
});

// DELETE /api/admin/categorias/:id (Eliminar categoría)
// Hacemos soft-delete o desactivación si tiene productos, o eliminación física si no tiene
router.delete('/admin/:id', verificarJWT, (req, res) => {
  const { id } = req.params;

  // Verificar si hay productos activos en esta categoría
  db.get('SELECT COUNT(*) as count FROM productos WHERE categoria_id = ? AND activo = 1', [id], (err, row) => {
    if (err) {
      return res.status(500).json({ 
        success: false, 
        message: 'Error al verificar productos asociados.', 
        error: err.message 
      });
    }

    if (row.count > 0) {
      // Si tiene productos, solo permitimos desactivarla (soft-delete de la categoría)
      db.run('UPDATE categorias SET activa = 0 WHERE id = ?', [id], function(err) {
        if (err) {
          return res.status(500).json({ 
            success: false, 
            message: 'Error al desactivar la categoría.', 
            error: err.message 
          });
        }
        return res.json({
          success: true,
          message: 'La categoría contiene productos asociados. Se ha desactivado en lugar de eliminar.',
          softDeleted: true
        });
      });
    } else {
      // Si no tiene productos, la eliminamos físicamente
      db.run('DELETE FROM categorias WHERE id = ?', [id], function(err) {
        if (err) {
          return res.status(500).json({ 
            success: false, 
            message: 'Error al eliminar la categoría.', 
            error: err.message 
          });
        }

        if (this.changes === 0) {
          return res.status(404).json({ 
            success: false, 
            message: 'Categoría no encontrada.' 
          });
        }

        res.json({
          success: true,
          message: 'Categoría eliminada con éxito.',
          softDeleted: false
        });
      });
    }
  });
});

module.exports = router;
