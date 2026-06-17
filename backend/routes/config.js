const express = require('express');
const router = express.Router();
const configService = require('../services/configService');
const { verificarJWT } = require('../middleware/auth');

// GET /api/config (Público, para traer toda la configuración)
router.get('/', async (req, res, next) => {
  try {
    const data = await configService.getAllConfigs();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// GET /api/config/:key (Público, para cosas como mesas_activadas)
router.get('/:key', async (req, res, next) => {
  try {
    const value = await configService.getConfig(req.params.key);
    res.json({
      success: true,
      key: req.params.key,
      value
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/config (Admin)
router.post('/', verificarJWT, async (req, res, next) => {
  try {
    const keys = Object.keys(req.body);
    for (const key of keys) {
      await configService.setConfig(key, req.body[key]);
    }
    
    // Notificar a todos los clientes (ej. activar_mesas = 1)
    const io = req.app.get('io');
    if (io && req.body.hasOwnProperty('activar_mesas')) {
      io.emit('config_actualizada', { activar_mesas: req.body.activar_mesas });
    }
    
    res.json({
      success: true,
      message: 'Configuración actualizada.'
    });
  } catch (error) {
    next(error);
  }
});

// PUT /api/config — alias para retrocompatibilidad con el frontend (mesas.html usa PUT)
router.put('/', verificarJWT, async (req, res, next) => {
  try {
    const keys = Object.keys(req.body);
    for (const key of keys) {
      await configService.setConfig(key, req.body[key]);
    }
    const io = req.app.get('io');
    if (io && req.body.hasOwnProperty('activar_mesas')) {
      io.emit('config_actualizada', { activar_mesas: req.body.activar_mesas });
    }
    res.json({ success: true, message: 'Configuración actualizada.' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
