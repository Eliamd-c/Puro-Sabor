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
  notas: Joi.string().allow('', null).optional(),
  tipo_pedido: Joi.string().valid('local', 'domicilio', 'recogen').default('local'),
  direccion_domicilio: Joi.string().allow('', null).optional(),
  nombre_cliente: Joi.string().allow('', null).optional(),
  prepagado: Joi.number().integer().valid(0, 1).default(0)
});

router.post('/crear', verificarJWT, validate(crearPedidoSchema), async (req, res, next) => {
  try {
    const { mesa_numero, items, total, notas, tipo_pedido, direccion_domicilio, nombre_cliente, prepagado } = req.validatedBody;
    const mesaNum = mesa_numero || 0;

    let sesionId = null;
    if (mesaNum > 0) {
      const sesion = await dbAsync.get(
        "SELECT id FROM sesiones_mesa WHERE mesa_numero = ? AND estado = 'activa' ORDER BY creada_en DESC LIMIT 1",
        [mesaNum]
      );
      if (sesion) sesionId = sesion.id;
    }

    const result = await dbAsync.run(
      `INSERT INTO pedidos (sesion_id, mesa_numero, items_json, total, notas, estado, tipo_pedido, direccion_domicilio, nombre_cliente, prepagado)
       VALUES (?, ?, ?, ?, ?, 'pendiente', ?, ?, ?, ?)`,
      [sesionId, mesaNum, JSON.stringify(items), total, notas || '', tipo_pedido || 'local', direccion_domicilio || '', nombre_cliente || '', prepagado || 0]
    );

    const io = req.app.get('io');
    if (io) {
      io.to('admin').emit('nuevo_pedido', {
        mesa: mesaNum,
        items,
        total,
        notas: notas || '',
        id: result.lastID,
        tipo_pedido: tipo_pedido || 'local',
        nombre_cliente: nombre_cliente || ''
      });
    }

    res.json({ success: true, message: 'Pedido enviado a cocina.', id: result.lastID });
  } catch (error) {
    next(error);
  }
});

// ─── PUT /api/pedidos/:id/estado — Actualizar estado de un pedido ──────────
const actualizarEstadoSchema = Joi.object({
  estado: Joi.string().valid('pendiente', 'preparando', 'listo', 'entregado', 'pagado', 'cancelado').required(),
  metodo_pago: Joi.string().valid('efectivo', 'nequi', 'daviplata', 'transferencia').allow('', null).optional()
});

router.put('/:id/estado', verificarJWT, validate(actualizarEstadoSchema), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { estado, metodo_pago } = req.validatedBody;

    const pedido = await dbAsync.get('SELECT * FROM pedidos WHERE id = ?', [id]);
    if (!pedido) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
    }

    const updates = ['estado = ?', 'updated_at = CURRENT_TIMESTAMP'];
    const params = [estado];

    if (metodo_pago) {
      updates.push('metodo_pago = ?');
      params.push(metodo_pago);
    }

    params.push(id);
    await dbAsync.run(`UPDATE pedidos SET ${updates.join(', ')} WHERE id = ?`, params);

    // Auto-deduct stock when order is completed (pagado)
    if (estado === 'pagado' && pedido.estado !== 'pagado') {
      try {
        const items = JSON.parse(pedido.items_json || '[]');
        for (const item of items) {
          await dbAsync.run(
            `UPDATE productos SET stock = stock - ? WHERE id = ? AND stock >= ?`,
            [item.cantidad, item.id, item.cantidad]
          );
          await dbAsync.run(
            `INSERT INTO movimientos_inventario (producto_id, cantidad_cambio, razon, pedido_id)
             VALUES (?, ?, 'venta', ?)`,
            [item.id, -item.cantidad, id]
          );
        }
      } catch (e) {
        console.error('Error deducting stock:', e);
      }
    }

    // Restore stock if order is cancelled
    if (estado === 'cancelado' && pedido.estado === 'pagado') {
      try {
        const items = JSON.parse(pedido.items_json || '[]');
        for (const item of items) {
          await dbAsync.run(
            `UPDATE productos SET stock = stock + ? WHERE id = ?`,
            [item.cantidad, item.id]
          );
          await dbAsync.run(
            `INSERT INTO movimientos_inventario (producto_id, cantidad_cambio, razon, pedido_id)
             VALUES (?, ?, 'cancelacion', ?)`,
            [item.id, item.cantidad, id]
          );
        }
      } catch (e) {
        console.error('Error restoring stock:', e);
      }
    }

    const io = req.app.get('io');
    if (io) {
      io.to('admin').emit('pedido_estado_actualizado', { id, estado, metodo_pago });
    }

    res.json({ success: true, message: 'Estado actualizado correctamente', id, estado });
  } catch (error) {
    next(error);
  }
});

// ─── PATCH /api/pedidos/:id/flags — Actualizar flags (prepagado, carne_en_parrilla) ──
const updateFlagsSchema = Joi.object({
  prepagado: Joi.number().integer().valid(0, 1).optional(),
  carne_en_parrilla: Joi.number().integer().valid(0, 1).optional()
});

router.patch('/:id/flags', verificarJWT, validate(updateFlagsSchema), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { prepagado, carne_en_parrilla } = req.validatedBody;

    const updates = [];
    const params = [];

    if (prepagado !== undefined) {
      updates.push('prepagado = ?');
      params.push(prepagado);
    }
    if (carne_en_parrilla !== undefined) {
      updates.push('carne_en_parrilla = ?');
      params.push(carne_en_parrilla);
    }

    if (!updates.length) {
      return res.json({ success: true, message: 'Sin cambios' });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    await dbAsync.run(`UPDATE pedidos SET ${updates.join(', ')} WHERE id = ?`, params);

    const io = req.app.get('io');
    if (io) {
      io.to('admin').emit('pedido_flags_actualizado', { id, prepagado, carne_en_parrilla });
    }

    res.json({ success: true, message: 'Flags actualizados' });
  } catch (error) {
    next(error);
  }
});

// ─── PUT /api/pedidos/:id — Editar un pedido completo ──────────────────────
const editarPedidoSchema = Joi.object({
  nombre_cliente: Joi.string().allow('', null).optional(),
  mesa_numero: Joi.number().integer().min(0).optional(),
  direccion_domicilio: Joi.string().allow('', null).optional(),
  notas: Joi.string().allow('', null).optional(),
  items: Joi.array().items(
    Joi.object({
      id: Joi.number().required(),
      nombre: Joi.string().required(),
      precio: Joi.number().min(0).required(),
      cantidad: Joi.number().integer().min(1).required()
    })
  ).min(1).optional()
});

router.put('/:id', verificarJWT, validate(editarPedidoSchema), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { nombre_cliente, mesa_numero, direccion_domicilio, notas, items } = req.validatedBody;

    // Verificar que el pedido existe
    const pedido = await dbAsync.get('SELECT * FROM pedidos WHERE id = ?', [id]);
    if (!pedido) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
    }

    // Registrar cambios anteriores para auditoría
    const camposAnteriores = {};
    const camposNuevos = {};

    if (nombre_cliente !== undefined && nombre_cliente !== pedido.nombre_cliente) {
      camposAnteriores.nombre_cliente = pedido.nombre_cliente;
      camposNuevos.nombre_cliente = nombre_cliente;
    }
    if (mesa_numero !== undefined && mesa_numero !== pedido.mesa_numero) {
      camposAnteriores.mesa_numero = pedido.mesa_numero;
      camposNuevos.mesa_numero = mesa_numero;
    }
    if (direccion_domicilio !== undefined && direccion_domicilio !== pedido.direccion_domicilio) {
      camposAnteriores.direccion_domicilio = pedido.direccion_domicilio;
      camposNuevos.direccion_domicilio = direccion_domicilio;
    }
    if (notas !== undefined && notas !== pedido.notas) {
      camposAnteriores.notas = pedido.notas;
      camposNuevos.notas = notas;
    }
    if (items && items.length > 0) {
      const oldItems = JSON.parse(pedido.items_json || '[]');
      if (JSON.stringify(oldItems) !== JSON.stringify(items)) {
        camposAnteriores.items = oldItems;
        camposNuevos.items = items;
      }
    }

    // Preparar updates dinámicos
    const updates = ['updated_at = CURRENT_TIMESTAMP'];
    const params = [];

    if (nombre_cliente !== undefined) {
      updates.push('nombre_cliente = ?');
      params.push(nombre_cliente || '');
    }
    if (mesa_numero !== undefined) {
      updates.push('mesa_numero = ?');
      params.push(mesa_numero);
    }
    if (direccion_domicilio !== undefined) {
      updates.push('direccion_domicilio = ?');
      params.push(direccion_domicilio || '');
    }
    if (notas !== undefined) {
      updates.push('notas = ?');
      params.push(notas || '');
    }
    if (items && items.length > 0) {
      const total = items.reduce((s, i) => s + (i.precio * i.cantidad), 0);
      updates.push('items_json = ?');
      updates.push('total = ?');
      params.push(JSON.stringify(items));
      params.push(total);
    }

    params.push(id);
    await dbAsync.run(
      `UPDATE pedidos SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    // Registrar en el historial si hay cambios
    if (Object.keys(camposAnteriores).length > 0) {
      await dbAsync.run(
        `INSERT INTO pedidos_historial (pedido_id, tipo_cambio, campos_anteriores, campos_nuevos, usuario_nombre)
         VALUES (?, 'edicion', ?, ?, 'Mesera')`,
        [id, JSON.stringify(camposAnteriores), JSON.stringify(camposNuevos)]
      );
    }

    const io = req.app.get('io');
    if (io) {
      io.to('admin').emit('pedido_actualizado', { id, ...req.validatedBody });
    }

    res.json({ success: true, message: 'Pedido actualizado correctamente', id });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/pedidos/movimientos — Historial de movimientos de inventario ──
router.get('/movimientos', verificarJWT, async (req, res, next) => {
  try {
    const rows = await dbAsync.all(`
      SELECT m.*, p.nombre as producto_nombre
      FROM movimientos_inventario m
      LEFT JOIN productos p ON p.id = m.producto_id
      ORDER BY m.created_at DESC
      LIMIT 200
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
