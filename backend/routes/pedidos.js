const express = require('express');
const router = express.Router();
const dbAsync = require('../config/database-promise');
const { verificarJWT } = require('../middleware/auth');
const Joi = require('joi');
const validate = require('../middleware/validate');

/**
 * @swagger
 * /api/pedidos:
 *   get:
 *     summary: Obtener todos los pedidos
 *     description: Retorna todos los pedidos, incluyendo historial y los más recientes primero.
 *     tags:
 *       - Pedidos
 *     security:
 *       - BearerAuth: []
 */
router.get('/', verificarJWT, async (req, res, next) => {
  try {
    const query = `
      SELECT p.*, 
             s.mesa_numero as mesa_sesion
      FROM pedidos p
      LEFT JOIN sesiones_mesa s ON p.sesion_id = s.id
      ORDER BY p.creado_en DESC
      LIMIT 100
    `;
    const pedidos = await dbAsync.all(query);
    
    // Parsear items_json
    const procesados = pedidos.map(p => {
      let items = [];
      try {
        items = JSON.parse(p.items_json || '[]');
      } catch (e) {}
      
      return {
        ...p,
        items
      };
    });
    
    res.json({ success: true, data: procesados });
  } catch (error) {
    next(error);
  }
});

const actualizarEstadoSchema = Joi.object({
  estado: Joi.string().valid('pendiente', 'preparando', 'listo', 'entregado', 'pagado', 'cancelado').required()
});

/**
 * @swagger
 * /api/pedidos/{id}/estado:
 *   put:
 *     summary: Actualizar estado de un pedido
 *     tags:
 *       - Pedidos
 *     security:
 *       - BearerAuth: []
 */
router.put('/:id/estado', verificarJWT, validate(actualizarEstadoSchema), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { estado } = req.validatedBody;
    
    const pedidoExisten = await dbAsync.get('SELECT id FROM pedidos WHERE id = ?', [id]);
    if (!pedidoExisten) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
    }
    
    await dbAsync.run(
      'UPDATE pedidos SET estado = ? WHERE id = ?',
      [estado, id]
    );
    
    const io = req.app.get('io');
    if (io) {
      io.to('admin').emit('pedido_estado_actualizado', { id, estado });
    }
    
    res.json({ success: true, message: 'Estado actualizado correctamente', id, estado });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
