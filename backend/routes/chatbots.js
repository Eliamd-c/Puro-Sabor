const express = require('express');
const router = express.Router();
const waAgent = require('../services/whatsappAgent');
const configService = require('../services/configService');
const { verificarJWT } = require('../middleware/auth');

// GET /api/chatbots/:type/status
router.get('/:type/status', verificarJWT, (req, res) => {
  const type = req.params.type; // 'client' o 'admin'
  const io = req.app.get('io');
  const bot = waAgent.getBot(type, io);
  res.json({
    success: true,
    status: bot.botStatus,
    qr: bot.latestQrDataUrl
  });
});

// POST /api/chatbots/:type/reconnect
router.post('/:type/reconnect', verificarJWT, async (req, res, next) => {
  try {
    const type = req.params.type;
    const io = req.app.get('io');
    const bot = waAgent.getBot(type, io);
    
    // Marcar activo en BD según el tipo
    const activeKey = type === 'client' ? 'whatsapp_bot_active' : 'whatsapp_admin_bot_active';
    await configService.setConfig(activeKey, '1');
    
    // Reiniciar
    bot.inicializarWhatsApp().catch(err => {
      console.error(`[WA Route ${type}] Error al reconectar el bot:`, err.message);
    });

    res.json({
      success: true,
      message: 'Se ha solicitado la reconexión de WhatsApp.'
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/chatbots/:type/logout
router.post('/:type/logout', verificarJWT, async (req, res, next) => {
  try {
    const type = req.params.type;
    const io = req.app.get('io');
    const bot = waAgent.getBot(type, io);
    
    await bot.logout();
    
    res.json({
      success: true,
      message: 'Se ha cerrado la sesión de WhatsApp exitosamente.'
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
