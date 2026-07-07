const express = require('express');
const router = express.Router();
const dbAsync = require('../config/database-promise');
const { verificarJWT } = require('../middleware/auth');
const Joi = require('joi');
const validate = require('../middleware/validate');
const { normalizePagination, buildOffsetPaginatedResponse } = require('../utils/paginationHelper');

// ─── GET /api/pedidos — Listar todos los pedidos (con paginación) ────────────
router.get('/', verificarJWT, async (req, res, next) => {
  try {
    // FASE 3.4: Pagination with validation
    const { page, limit, offset } = normalizePagination(req.query.page, req.query.limit);
    const estado = req.query.estado || null; // Optional filter

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM pedidos';
    const countParams = [];

    if (estado) {
      countQuery += ' WHERE estado = ?';
      countParams.push(estado);
    }

    const countResult = await dbAsync.get(countQuery, countParams);
    const total = countResult.total || 0;

    // Get paginated data
    let dataQuery = 'SELECT p.* FROM pedidos p';
    const dataParams = [];

    if (estado) {
      dataQuery += ' WHERE p.estado = ?';
      dataParams.push(estado);
    }

    dataQuery += ' ORDER BY p.creado_en DESC LIMIT ? OFFSET ?';
    dataParams.push(limit, offset);

    const pedidos = await dbAsync.all(dataQuery, dataParams);

    // Parse JSON items
    const procesados = pedidos.map(p => {
      let items = [];
      try {
        items = JSON.parse(p.items_json || '[]');
      } catch (e) {
        console.warn('Error parsing items_json for order', p.id);
      }
      return { ...p, items };
    });

    // Build paginated response
    const paginatedResponse = buildOffsetPaginatedResponse(procesados, page, limit, total);

    res.json({
      success: true,
      ...paginatedResponse
    });
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

    const creado_por = req.admin?.nombre || req.admin?.usuario || 'Sistema';
    let result;
    try {
      result = await dbAsync.run(
        `INSERT INTO pedidos (sesion_id, mesa_numero, items_json, total, notas, estado, tipo_pedido, direccion_domicilio, nombre_cliente, prepagado, creado_por)
         VALUES (?, ?, ?, ?, ?, 'pendiente', ?, ?, ?, ?, ?)`,
        [sesionId, mesaNum, JSON.stringify(items), total, notas || '', tipo_pedido || 'local', direccion_domicilio || '', nombre_cliente || '', prepagado || 0, creado_por]
      );
    } catch (colErr) {
      // Columna creado_por aún no existe (migración pendiente de reinicio del servidor)
      result = await dbAsync.run(
        `INSERT INTO pedidos (sesion_id, mesa_numero, items_json, total, notas, estado, tipo_pedido, direccion_domicilio, nombre_cliente, prepagado)
         VALUES (?, ?, ?, ?, ?, 'pendiente', ?, ?, ?, ?)`,
        [sesionId, mesaNum, JSON.stringify(items), total, notas || '', tipo_pedido || 'local', direccion_domicilio || '', nombre_cliente || '', prepagado || 0]
      );
    }

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

    // Auto-deduct stock + insumos (receta) cuando el pedido se marca PAGADO.
    // Todo dentro de una transacción: si algo falla, se revierte completo.
    if (estado === 'pagado' && pedido.estado !== 'pagado') {
      try {
        const items = JSON.parse(pedido.items_json || '[]');
        await dbAsync.withTransaction(async (tx) => {
          for (const item of items) {
            // 1. Descontar stock del producto
            await tx.run(
              `UPDATE productos SET stock = stock - ? WHERE id = ? AND stock >= ?`,
              [item.cantidad, item.id, item.cantidad]
            );
            await tx.run(
              `INSERT INTO movimientos_inventario (producto_id, cantidad_cambio, razon, pedido_id)
               VALUES (?, ?, 'venta', ?)`,
              [item.id, -item.cantidad, id]
            );
            // 2. Descontar insumos según la receta del producto (si tiene)
            const recetas = await tx.all(
              `SELECT insumo_id, cantidad_usada FROM recetas WHERE producto_id = ?`,
              [item.id]
            );
            for (const r of recetas) {
              await tx.run(
                `UPDATE insumos SET cantidad = GREATEST(0, cantidad - ?) WHERE id = ?`,
                [r.cantidad_usada * item.cantidad, r.insumo_id]
              );
            }
          }
        });
      } catch (e) {
        console.error('Error deducting stock (transacción revertida):', e.message);
      }
    }

    // Restaurar stock + insumos si un pedido PAGADO se cancela (también atómico)
    if (estado === 'cancelado' && pedido.estado === 'pagado') {
      try {
        const items = JSON.parse(pedido.items_json || '[]');
        await dbAsync.withTransaction(async (tx) => {
          for (const item of items) {
            await tx.run(
              `UPDATE productos SET stock = stock + ? WHERE id = ?`,
              [item.cantidad, item.id]
            );
            await tx.run(
              `INSERT INTO movimientos_inventario (producto_id, cantidad_cambio, razon, pedido_id)
               VALUES (?, ?, 'cancelacion', ?)`,
              [item.id, item.cantidad, id]
            );
            const recetas = await tx.all(
              `SELECT insumo_id, cantidad_usada FROM recetas WHERE producto_id = ?`,
              [item.id]
            );
            for (const r of recetas) {
              await tx.run(
                `UPDATE insumos SET cantidad = cantidad + ? WHERE id = ?`,
                [r.cantidad_usada * item.cantidad, r.insumo_id]
              );
            }
          }
        });
      } catch (e) {
        console.error('Error restoring stock (transacción revertida):', e.message);
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
      cantidad: Joi.number().integer().min(1).required(),
      // Timestamp ISO puesto por el POS al agregar un item a un pedido ya
      // enviado; cocina lo usa para resaltar "AGREGADO". validate() usa
      // stripUnknown, así que debe estar declarado o se pierde.
      agregado_en: Joi.string().allow('', null).optional()
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
      const usuarioNombre = req.admin?.nombre || req.admin?.usuario || 'Sistema';
      await dbAsync.run(
        `INSERT INTO pedidos_historial (pedido_id, tipo_cambio, campos_anteriores, campos_nuevos, usuario_nombre)
         VALUES (?, 'edicion', ?, ?, ?)`,
        [id, JSON.stringify(camposAnteriores), JSON.stringify(camposNuevos), usuarioNombre]
      );
    }

    const io = req.app.get('io');
    if (io) {
      // items_agregados: true si la edición SUMÓ unidades (items nuevos o
      // cantidades aumentadas) — cocina suena solo en ese caso
      let itemsAgregados = false;
      if (items && items.length > 0) {
        const oldItems = JSON.parse(pedido.items_json || '[]');
        const totalQty = (arr) => arr.reduce((s, i) => s + (parseInt(i.cantidad) || 0), 0);
        itemsAgregados = totalQty(items) > totalQty(oldItems);
      }
      io.to('admin').emit('pedido_actualizado', { id, items_agregados: itemsAgregados, ...req.validatedBody });
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

// ─── DELETE /api/pedidos/:id — Eliminar un pedido (ADMIN) ──────────────────
router.delete('/:id', verificarJWT, async (req, res, next) => {
  try {
    const { id } = req.params;

    const pedido = await dbAsync.get('SELECT * FROM pedidos WHERE id = ?', [id]);
    if (!pedido) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
    }

    await dbAsync.run('DELETE FROM pedidos WHERE id = ?', [id]);
    await dbAsync.run('DELETE FROM pedidos_historial WHERE pedido_id = ?', [id]);

    const io = req.app.get('io');
    if (io) {
      io.to('admin').emit('pedido_eliminado', { id });
    }

    res.json({ success: true, message: 'Pedido eliminado correctamente', id });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/pedidos-historial — Obtener historial de cambios (ADMIN) ──────
router.get('/historial', verificarJWT, async (req, res, next) => {
  try {
    const rows = await dbAsync.all(`
      SELECT *
      FROM pedidos_historial
      ORDER BY creado_en DESC
      LIMIT 500
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

// ─── GET /api/pedidos/reportes — Reportes de ventas con rango de fechas (ADMIN) ──
// Query params opcionales: ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD (zona America/Bogota).
// Por defecto: últimos 7 días. Máximo: 366 días.
// NOTA: la versión anterior usaba datetime() y json_extract() de SQLite, que no
// existen en PostgreSQL — el endpoint fallaba en producción. La agregación de
// items se hace en Node porque items_json es TEXT, y el conteo por LIKE contaba
// mal productos con nombres contenidos en otros (ej. "Limonada" vs "Limonada Cerezada").
router.get('/reportes', verificarJWT, async (req, res, next) => {
  try {
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    // Colombia es UTC-5 fijo (sin horario de verano)
    const coDay = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

    let { desde, hasta } = req.query;
    if (!DATE_RE.test(hasta || '')) hasta = coDay(new Date());
    if (!DATE_RE.test(desde || '')) {
      const d = new Date(`${hasta}T12:00:00-05:00`);
      d.setDate(d.getDate() - 6);
      desde = coDay(d);
    }
    if (desde > hasta) [desde, hasta] = [hasta, desde];

    const inicio = new Date(`${desde}T00:00:00-05:00`);
    const finExcl = new Date(`${hasta}T00:00:00-05:00`);
    finExcl.setDate(finExcl.getDate() + 1);

    if ((finExcl - inicio) / 86400000 > 366) {
      return res.status(400).json({ success: false, message: 'El rango máximo es de 366 días.' });
    }

    const pedidos = await dbAsync.all(
      `SELECT id, estado, tipo_pedido, total, items_json, creado_en
       FROM pedidos
       WHERE creado_en >= ? AND creado_en < ?
       ORDER BY creado_en ASC`,
      [inicio.toISOString(), finExcl.toISOString()]
    );

    // Las ventas son los pedidos PAGADOS dentro del rango (día en hora de Colombia)
    const enRango = pedidos.filter(p => {
      const dia = coDay(p.creado_en);
      return dia >= desde && dia <= hasta;
    });
    const pagados = enRango.filter(p => p.estado === 'pagado');

    // Resumen general
    const totalVentas = pagados.reduce((s, p) => s + (p.total || 0), 0);
    const porTipo = {};
    ['local', 'domicilio', 'recogen'].forEach(t => { porTipo[t] = { pedidos: 0, ventas: 0 }; });
    pagados.forEach(p => {
      const t = porTipo[p.tipo_pedido] || (porTipo[p.tipo_pedido] = { pedidos: 0, ventas: 0 });
      t.pedidos++;
      t.ventas += p.total || 0;
    });
    const resumen = {
      total_ventas: totalVentas,
      total_pedidos: pagados.length,
      promedio_pedido: pagados.length ? Math.round(totalVentas / pagados.length) : 0,
      pedidos_sin_pagar: enRango.filter(p => p.estado !== 'pagado' && p.estado !== 'cancelado').length,
      pedidos_cancelados: enRango.filter(p => p.estado === 'cancelado').length,
      por_tipo: porTipo
    };

    // Ventas por día (incluye días sin ventas para gráficas continuas)
    const ventasMap = {};
    pagados.forEach(p => {
      const dia = coDay(p.creado_en);
      if (!ventasMap[dia]) ventasMap[dia] = { total_pedidos: 0, venta_total: 0 };
      ventasMap[dia].total_pedidos++;
      ventasMap[dia].venta_total += p.total || 0;
    });
    const ventasPorDia = [];
    for (let d = new Date(`${desde}T12:00:00-05:00`); coDay(d) <= hasta; d.setDate(d.getDate() + 1)) {
      const dia = coDay(d);
      ventasPorDia.push({ fecha: dia, ...(ventasMap[dia] || { total_pedidos: 0, venta_total: 0 }) });
    }

    // Top 10 productos más vendidos (contando items reales de cada pedido pagado)
    const productosMap = {};
    pagados.forEach(p => {
      let items = [];
      try { items = JSON.parse(p.items_json || '[]'); } catch (e) { /* ignorar pedido con JSON corrupto */ }
      items.forEach(item => {
        const nombre = item.nombre || 'Sin nombre';
        const cantidad = parseInt(item.cantidad) || 0;
        const precio = parseFloat(item.precio) || 0;
        if (!productosMap[nombre]) productosMap[nombre] = { nombre, cantidad: 0, total_vendido: 0 };
        productosMap[nombre].cantidad += cantidad;
        productosMap[nombre].total_vendido += precio * cantidad;
      });
    });
    const topProducts = Object.values(productosMap)
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 10);

    // Cambios por usuario dentro del rango
    const changesByUser = await dbAsync.all(
      `SELECT usuario_nombre, COUNT(*) as cambios, MAX(creado_en) as ultimo_cambio
       FROM pedidos_historial
       WHERE creado_en >= ? AND creado_en < ?
       GROUP BY usuario_nombre
       ORDER BY cambios DESC`,
      [inicio.toISOString(), finExcl.toISOString()]
    );

    res.json({
      success: true,
      data: { desde, hasta, resumen, ventasPorDia, topProducts, changesByUser }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
