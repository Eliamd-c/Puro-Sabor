const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const db = require('../config/database');
const { verificarJWT } = require('../middleware/auth');

// Helper: obtener configuración de la BD
function getConfig(key) {
  return new Promise((resolve, reject) => {
    db.get('SELECT value FROM config WHERE key = ?', [key], (err, row) => {
      if (err) reject(err);
      else resolve(row ? row.value : null);
    });
  });
}

// Helper: obtener o crear sesión activa de una mesa
function obtenerSesionActiva(mesaNumero) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM sesiones_mesa WHERE mesa_numero = ? AND estado = 'activa' ORDER BY creada_en DESC LIMIT 1`,
      [mesaNumero],
      (err, sesion) => {
        if (err) return reject(err);
        if (sesion) return resolve(sesion);

        // Crear sesión nueva
        db.run(
          `INSERT INTO sesiones_mesa (mesa_numero, estado) VALUES (?, 'activa')`,
          [mesaNumero],
          function (err2) {
            if (err2) return reject(err2);
            db.get('SELECT * FROM sesiones_mesa WHERE id = ?', [this.lastID], (err3, nueva) => {
              if (err3) return reject(err3);
              resolve(nueva);
            });
          }
        );
      }
    );
  });
}

// ─────────────────────────────────────────────
// GET /api/mesas — Listar todas las mesas con estado
// ─────────────────────────────────────────────
router.get('/', verificarJWT, (req, res) => {
  db.all('SELECT * FROM mesas WHERE activa = 1 ORDER BY numero ASC', [], (err, mesas) => {
    if (err) return res.status(500).json({ success: false, message: err.message });

    // Para cada mesa, obtener la sesión activa y sus pedidos
    const promises = mesas.map(mesa => new Promise((resolve) => {
      db.get(
        `SELECT * FROM sesiones_mesa WHERE mesa_numero = ? AND estado = 'activa' ORDER BY creada_en DESC LIMIT 1`,
        [mesa.numero],
        (err, sesion) => {
          if (!sesion) return resolve({ ...mesa, estado: 'libre', sesion: null, pedidos: [], total: 0, rondas: 0 });

          db.all(
            `SELECT * FROM pedidos WHERE sesion_id = ? ORDER BY numero_ronda ASC`,
            [sesion.id],
            (err, pedidos) => {
              const total = pedidos.reduce((sum, p) => sum + p.total, 0);
              resolve({
                ...mesa,
                estado: 'activa',
                sesion,
                pedidos: pedidos.map(p => ({ ...p, items: JSON.parse(p.items_json) })),
                total,
                rondas: pedidos.length
              });
            }
          );
        }
      );
    }));

    Promise.all(promises).then(data => res.json({ success: true, data }));
  });
});

// ─────────────────────────────────────────────
// GET /api/mesas/:numero/estado — Estado público de una mesa (sin JWT)
// ─────────────────────────────────────────────
router.get('/:numero/estado', async (req, res) => {
  const { numero } = req.params;
  const mesaNum = parseInt(numero);

  // Verificar si la mesa existe (o es "general")
  if (numero !== 'general') {
    const mesa = await new Promise(resolve =>
      db.get('SELECT * FROM mesas WHERE numero = ? AND activa = 1', [mesaNum], (_, row) => resolve(row))
    );
    if (!mesa) return res.status(404).json({ success: false, message: `Mesa ${numero} no existe.` });
  }

  try {
    if (numero === 'general') {
      return res.json({ success: true, data: { tipo: 'general', estado: 'activa' } });
    }

    const sesion = await obtenerSesionActiva(mesaNum);

    db.all(
      `SELECT * FROM pedidos WHERE sesion_id = ? ORDER BY numero_ronda ASC`,
      [sesion.id],
      (err, pedidos) => {
        const total = pedidos.reduce((sum, p) => sum + p.total, 0);
        res.json({
          success: true,
          data: {
            mesa: mesaNum,
            sesion_id: sesion.id,
            estado: sesion.estado,
            pedidos: pedidos.map(p => ({ ...p, items: JSON.parse(p.items_json) })),
            total,
            rondas: pedidos.length
          }
        });
      }
    );
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/mesas/:numero/pedido — Registrar pedido confirmado
// ─────────────────────────────────────────────
router.post('/:numero/pedido', async (req, res) => {
  const { numero } = req.params;
  const { items, total, notas } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, message: 'El pedido debe tener al menos un item.' });
  }
  if (total === undefined || isNaN(parseFloat(total))) {
    return res.status(400).json({ success: false, message: 'El total es requerido.' });
  }

  try {
    let sesionId;
    let mesaNumero = numero;

    if (numero === 'general') {
      // Para QR general, crear una sesión especial
      const result = await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO sesiones_mesa (mesa_numero, estado) VALUES (0, 'activa')`,
          function (err) { if (err) reject(err); else resolve(this.lastID); }
        );
      });
      sesionId = result;
      mesaNumero = 0;
    } else {
      const sesion = await obtenerSesionActiva(parseInt(numero));
      sesionId = sesion.id;
      mesaNumero = parseInt(numero);
    }

    // Calcular número de ronda
    const rondaAnterior = await new Promise(resolve =>
      db.get('SELECT MAX(numero_ronda) as max_ronda FROM pedidos WHERE sesion_id = ?', [sesionId],
        (_, row) => resolve(row ? (row.max_ronda || 0) : 0))
    );
    const numeroRonda = rondaAnterior + 1;

    // Registrar el pedido
    db.run(
      `INSERT INTO pedidos (sesion_id, mesa_numero, numero_ronda, items_json, total, notas) VALUES (?, ?, ?, ?, ?, ?)`,
      [sesionId, mesaNumero, numeroRonda, JSON.stringify(items), parseFloat(total), notas || null],
      function (err) {
        if (err) return res.status(500).json({ success: false, message: err.message });

        // Actualizar última actividad de la sesión
        db.run(`UPDATE sesiones_mesa SET ultima_actividad = CURRENT_TIMESTAMP WHERE id = ?`, [sesionId]);

        // Notificar al servidor Socket.io (se accede desde req.app)
        const io = req.app.get('io');
        if (io) {
          io.to(`admin`).emit('nuevo_pedido', {
            mesa: numero,
            ronda: numeroRonda,
            items,
            total: parseFloat(total),
            notas: notas || null,
            pedido_id: this.lastID,
            timestamp: new Date().toISOString()
          });
        }

        res.status(201).json({
          success: true,
          message: 'Pedido registrado con éxito.',
          data: {
            pedido_id: this.lastID,
            sesion_id: sesionId,
            mesa: numero,
            ronda: numeroRonda,
            total: parseFloat(total)
          }
        });
      }
    );
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
// PATCH /api/mesas/:numero/cerrar — Cajera cierra la mesa (requiere JWT)
// ─────────────────────────────────────────────
router.patch('/:numero/cerrar', verificarJWT, async (req, res) => {
  const { numero } = req.params;
  const cerradaPor = req.admin ? req.admin.usuario : 'admin';

  try {
    const sesion = await new Promise(resolve =>
      db.get(
        `SELECT * FROM sesiones_mesa WHERE mesa_numero = ? AND estado = 'activa' ORDER BY creada_en DESC LIMIT 1`,
        [parseInt(numero)], (_, row) => resolve(row)
      )
    );

    if (!sesion) {
      return res.status(404).json({ success: false, message: `Mesa ${numero} no tiene una sesión activa.` });
    }

    // Obtener todos los pedidos de la sesión para el resumen
    const pedidos = await new Promise(resolve =>
      db.all('SELECT * FROM pedidos WHERE sesion_id = ?', [sesion.id], (_, rows) => resolve(rows || []))
    );

    const total = pedidos.reduce((sum, p) => sum + p.total, 0);

    // Cerrar la sesión
    db.run(
      `UPDATE sesiones_mesa SET estado = 'cerrada', cerrada_en = CURRENT_TIMESTAMP, cerrada_por = ? WHERE id = ?`,
      [cerradaPor, sesion.id],
      (err) => {
        if (err) return res.status(500).json({ success: false, message: err.message });

        // Notificar a los clientes de la mesa que fue cerrada
        const io = req.app.get('io');
        if (io) {
          io.to(`mesa_${numero}`).emit('mesa_cerrada', {
            mesa: numero,
            mensaje: '✅ Tu cuenta fue cerrada. ¡Gracias por visitarnos!'
          });
          io.to(`admin`).emit('mesa_actualizada', { mesa: numero, estado: 'libre' });
        }

        res.json({
          success: true,
          message: `Mesa ${numero} cerrada con éxito.`,
          data: {
            mesa: numero,
            sesion_id: sesion.id,
            total_cobrado: total,
            rondas: pedidos.length,
            pedidos: pedidos.map(p => ({ ...p, items: JSON.parse(p.items_json) })),
            cerrada_por: cerradaPor
          }
        });
      }
    );
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/mesas — Crear nueva mesa (admin)
// ─────────────────────────────────────────────
router.post('/', verificarJWT, (req, res) => {
  const { numero, nombre } = req.body;

  if (!numero || isNaN(parseInt(numero))) {
    return res.status(400).json({ success: false, message: 'El número de mesa es requerido.' });
  }

  const mesaNum = parseInt(numero);
  const mesaNombre = nombre || `Mesa ${mesaNum}`;

  db.run(
    'INSERT INTO mesas (numero, nombre) VALUES (?, ?)',
    [mesaNum, mesaNombre],
    function (err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint')) {
          return res.status(409).json({ success: false, message: `La Mesa ${mesaNum} ya existe.` });
        }
        return res.status(500).json({ success: false, message: err.message });
      }
      res.status(201).json({
        success: true,
        message: `Mesa ${mesaNum} creada con éxito.`,
        data: { id: this.lastID, numero: mesaNum, nombre: mesaNombre }
      });
    }
  );
});

// ─────────────────────────────────────────────
// DELETE /api/mesas/:numero — Eliminar mesa (admin)
// ─────────────────────────────────────────────
router.delete('/:numero', verificarJWT, (req, res) => {
  const { numero } = req.params;
  db.run(
    'UPDATE mesas SET activa = 0 WHERE numero = ?',
    [parseInt(numero)],
    function (err) {
      if (err) return res.status(500).json({ success: false, message: err.message });
      if (this.changes === 0) return res.status(404).json({ success: false, message: 'Mesa no encontrada.' });
      res.json({ success: true, message: `Mesa ${numero} eliminada.` });
    }
  );
});

// ─────────────────────────────────────────────
// GET /api/mesas/general/qr — QR general del restaurante
// ─────────────────────────────────────────────
router.get('/general/qr', async (req, res) => {
  try {
    const dominio = await getConfig('dominio_base') || 'http://localhost:3000';
    const url = `${dominio}/mesa/general`;
    const qrBuffer = await QRCode.toBuffer(url, {
      type: 'png',
      width: 400,
      margin: 2,
      color: { dark: '#1a0a00', light: '#fff8f0' }
    });
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', `attachment; filename="QR-General-Puro-Sabor.png"`);
    res.send(qrBuffer);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error al generar QR.', error: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/mesas/:numero/qr — Generar QR de una mesa
// ─────────────────────────────────────────────
router.get('/:numero/qr', async (req, res) => {
  const { numero } = req.params;
  try {
    const dominio = await getConfig('dominio_base') || 'http://localhost:3000';
    const url = `${dominio}/mesa/${numero}`;
    const qrBuffer = await QRCode.toBuffer(url, {
      type: 'png',
      width: 400,
      margin: 2,
      color: { dark: '#1a0a00', light: '#fff8f0' }
    });
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', `attachment; filename="QR-Mesa-${numero}-Puro-Sabor.png"`);
    res.send(qrBuffer);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error al generar QR.', error: err.message });
  }
});

module.exports = router;
