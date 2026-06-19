const express = require('express');
const router = express.Router();
const dbAsync = require('../config/database-promise');
const { verificarJWT } = require('../middleware/auth');
const Joi = require('joi');
const validate = require('../middleware/validate');

// ─── GET /api/pedidos — Listar todos los pedidos ────────────────────────────
router.get('/', verificarJWT, async (req, res, next) => {
  try {
    const query = `
      SELECT p.*
      FROM pedidos p
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
      return { ...p, items };
    });
    
    res.json({ success: true, data: procesados });
  } catch (error) {
    next(error);
  }
});

// ─── POST /api/pedidos/crear — Crear un pedido desde el POS ────────────────
const crearPedidoSchema = Joi.object({
  mesa_numero: Joi.number().integer().min(0).default(0),
  items: Joi.array().items(
    Joi.object({
      id: Joi.number().required(),
      nombre: Joi.string().required(),
      precio: Joi.number().min(0).required(),
      cantidad: Joi.number().integer().min(1).required()
    })
  ).min(1).required(),
  total: Joi.number().min(0).required(),
  notas: Joi.string().allow('', null).optional()
});

router.post('/crear', verificarJWT, validate(crearPedidoSchema), async (req, res, next) => {
  try {
    const { mesa_numero, items, total, notas } = req.validatedBody;
    const mesaNum = mesa_numero || 0;
    const notasVal = notas || '';

    // Buscar sesión activa para la mesa (si existe)
    let sesionId = null;
    if (mesaNum > 0) {
      const sesion = await dbAsync.get(
        "SELECT id FROM sesiones_mesa WHERE mesa_numero = ? AND estado = 'activa' ORDER BY creada_en DESC LIMIT 1",
        [mesaNum]
      );
      if (sesion) sesionId = sesion.id;
    }

    // Insertar pedido
    const result = await dbAsync.run(
      `INSERT INTO pedidos (sesion_id, mesa_numero, items_json, total, notas, estado)
       VALUES (?, ?, ?, ?, ?, 'pendiente')`,
      [sesionId, mesaNum, JSON.stringify(items), total, notasVal]
    );

    // Notificar por Socket.IO en tiempo real
    const io = req.app.get('io');
    if (io) {
      io.to('admin').emit('nuevo_pedido', {
        mesa: mesaNum,
        items,
        total,
        notas: notasVal,
        id: result.lastID
      });
    }

    res.json({ success: true, message: 'Pedido enviado a cocina.', id: result.lastID });
  } catch (error) {
    next(error);
  }
});

// ─── PUT /api/pedidos/:id/estado — Actualizar estado de un pedido ──────────
const actualizarEstadoSchema = Joi.object({
  estado: Joi.string().valid('pendiente', 'preparando', 'listo', 'entregado', 'pagado', 'cancelado').required()
});

router.put('/:id/estado', verificarJWT, validate(actualizarEstadoSchema), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { estado } = req.validatedBody;
    
    const pedidoExistente = await dbAsync.get('SELECT id FROM pedidos WHERE id = ?', [id]);
    if (!pedidoExistente) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
    }
    
    await dbAsync.run('UPDATE pedidos SET estado = ? WHERE id = ?', [estado, id]);
    
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
