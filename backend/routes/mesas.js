const express = require('express');
const router = express.Router();
const mesaService = require('../services/mesaService');
const { verificarJWT } = require('../middleware/auth');
const waAgent = require('../services/whatsappAgent');
const Joi = require('joi');
const validate = require('../middleware/validate');
const QRCode = require('qrcode');
const configService = require('../services/configService');

/**
 * @swagger
 * /api/mesas/activas:
 *   get:
 *     summary: Obtener mesas activas
 *     description: Retorna todas las sesiones de mesas activas (requiere autenticación)
 *     tags:
 *       - Mesas
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Mesas obtenidas exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 sesiones:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Mesa'
 *       401:
 *         description: No autorizado - JWT requerido
 */
// GET /api/mesas/activas — para admin panel
router.get('/activas', verificarJWT, async (req, res, next) => {
  try {
    const sesiones = await mesaService.getAll();
    res.json({ success: true, sesiones, data: sesiones });
  } catch (error) {
    next(error);
  }
});

// GET /api/mesas — alias raíz para el frontend del panel admin
router.get('/', verificarJWT, async (req, res, next) => {
  try {
    const dbAsync = require('../config/database-promise');
    
    // Obtener todas las mesas activas del catálogo
    const mesas = await dbAsync.all('SELECT * FROM mesas WHERE activa = 1 ORDER BY numero ASC');
    
    // Obtener los datos de socketio
    const io = req.app.get('io');
    
    const data = await Promise.all(mesas.map(async (mesa) => {
      const sala = `mesa_${mesa.numero}`;
      const viendo = io ? (io.sockets.adapter.rooms.get(sala)?.size || 0) : 0;
      
      const sesion = await dbAsync.get(
        `SELECT * FROM sesiones_mesa WHERE mesa_numero = ? AND estado = 'activa' ORDER BY creada_en DESC LIMIT 1`,
        [mesa.numero]
      );
      
      if (!sesion) {
        return { ...mesa, estado: 'libre', sesion: null, pedidos: [], total: 0, rondas: 0, viendo };
      }
      
      const pedidos = await dbAsync.all(
        `SELECT * FROM pedidos WHERE sesion_id = ? ORDER BY numero_ronda ASC`,
        [sesion.id]
      ) || [];
      
      const total = pedidos.reduce((sum, p) => sum + p.total, 0);
      
      return {
        ...mesa,
        estado: 'activa',
        sesion,
        pedidos: pedidos.map(p => ({ ...p, items: JSON.parse(p.items_json) })),
        total,
        rondas: pedidos.length,
        viendo
      };
    }));
    
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// POST /api/mesas — crear mesa desde panel admin { numero }
router.post('/', verificarJWT, async (req, res, next) => {
  try {
    const { numero } = req.body;
    if (!numero) {
      return res.status(400).json({ success: false, message: 'Número de mesa requerido.' });
    }
    const sesion = await mesaService.startSession(numero, 'admin');
    const io = req.app.get('io');
    if (io) io.to('admin').emit('mesa_actualizada', { mesa: numero, estado: 'activa' });
    res.json({ success: true, message: 'Mesa creada.', sesion });
  } catch (error) {
    next(error);
  }
});

// GET /api/mesas/:numero/estado
router.get('/:numero/estado', async (req, res, next) => {
  try {
    const sesion = await mesaService.getSession(req.params.numero);
    res.json({
      success: true,
      estado: sesion ? 'activa' : 'libre',
      sesion
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/mesas/:numero/sesion
router.post('/:numero/sesion', async (req, res, next) => {
  try {
    const { solicitadaPor } = req.body;
    const sesion = await mesaService.startSession(req.params.numero, solicitadaPor || 'cliente');
    
    const io = req.app.get('io');
    if (io) {
      io.to('admin').emit('mesa_actualizada', { mesa: req.params.numero, estado: 'activa' });
    }
    
    res.json({ success: true, message: 'Sesión iniciada.', sesion });
  } catch (error) {
    next(error);
  }
});

// POST /api/mesas/:numero/cerrar
router.post('/:numero/cerrar', verificarJWT, async (req, res, next) => {
  try {
    const sesion = await mesaService.getSession(req.params.numero);
    if (!sesion) {
      return res.status(404).json({ success: false, message: 'No hay sesión activa.' });
    }
    
    await mesaService.closeSession(sesion.id, 'admin');
    
    const io = req.app.get('io');
    if (io) {
      io.to(`mesa_${req.params.numero}`).emit('mesa_cerrada', {
        mesa: req.params.numero,
        mensaje: 'La sesión ha sido cerrada por el administrador.'
      });
      io.to('admin').emit('mesa_actualizada', { mesa: req.params.numero, estado: 'libre' });
    }
    
    res.json({ success: true, message: 'Sesión cerrada exitosamente.' });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/mesas/:numero/cerrar — alias para retrocompatibilidad con el frontend
router.patch('/:numero/cerrar', verificarJWT, async (req, res, next) => {
  try {
    const sesion = await mesaService.getSession(req.params.numero);
    if (!sesion) {
      return res.status(404).json({ success: false, message: 'No hay sesión activa.' });
    }
    await mesaService.closeSession(sesion.id, 'admin');
    const io = req.app.get('io');
    if (io) {
      io.to(`mesa_${req.params.numero}`).emit('mesa_cerrada', {
        mesa: req.params.numero,
        mensaje: 'La sesión ha sido cerrada por el administrador.'
      });
      io.to('admin').emit('mesa_actualizada', { mesa: req.params.numero, estado: 'libre' });
    }
    res.json({ success: true, message: 'Sesión cerrada exitosamente.' });
  } catch (error) {
    next(error);
  }
});

const pedidoSchema = Joi.object({
  items: Joi.array().required(),
  total: Joi.number().required()
});

// POST /api/mesas/:numero/pedido
router.post('/:numero/pedido', validate(pedidoSchema), async (req, res, next) => {
  try {
    const { items, total } = req.validatedBody;
    const mesaNumero = req.params.numero;
    
    await mesaService.createOrder(mesaNumero, items, total);
    
    const io = req.app.get('io');
    if (io) {
      io.to('admin').emit('nuevo_pedido', { mesa: mesaNumero, items, total });
    }
    
    try {
      await waAgent.notificarPedidoMesaAdmin(mesaNumero, items, total);
    } catch (e) {
      console.error('[Mesa] Error al enviar WhatsApp del pedido:', e.message);
    }
    
    res.json({ success: true, message: 'Pedido enviado a cocina.' });
  } catch (error) {
    next(error);
  }
});

// GET /api/mesas/general/qr — QR general del restaurante
router.get('/general/qr', async (req, res, next) => {
  try {
    const configDominio = await configService.getConfig('dominio_base');
    const dominio = configDominio || 'http://localhost:3000';
    const url = `${dominio}/mesa/general`;
    
    const qrBuffer = await QRCode.toBuffer(url, {
      type: 'png',
      width: 400,
      margin: 2,
      color: { dark: '#1a0a00', light: '#fff8f0' }
    });
    
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', 'attachment; filename="QR-General-Puro-Sabor.png"');
    res.send(qrBuffer);
  } catch (error) {
    next(error);
  }
});

// GET /api/mesas/:numero/qr — Generar QR de una mesa
router.get('/:numero/qr', async (req, res, next) => {
  try {
    const { numero } = req.params;
    const configDominio = await configService.getConfig('dominio_base');
    const dominio = configDominio || 'http://localhost:3000';
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
  } catch (error) {
    next(error);
  }
});

module.exports = router;
