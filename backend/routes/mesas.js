const express = require('express');
const router = express.Router();
const mesaService = require('../services/mesaService');
const { verificarJWT } = require('../middleware/auth');
const waAgent = require('../services/whatsappAgent');
const Joi = require('joi');
const validate = require('../middleware/validate');

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
router.get('/activas', verificarJWT, async (req, res, next) => {
  try {
    const sesiones = await mesaService.getAll();
    res.json({ success: true, sesiones });
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

module.exports = router;
