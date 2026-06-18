const express = require('express');
const router = express.Router();
const configService = require('../services/configService');
const { verificarJWT } = require('../middleware/auth');
const waAgent = require('../services/whatsappAgent');
const { apiLimiter } = require('../middleware/rateLimiter');

// Helper para enmascarar la clave API
function maskApiKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '********';
  return `${key.slice(0, 6)}...${key.slice(-6)}`;
}

// GET /api/inventario/config-ai
router.get('/config-ai', verificarJWT, async (req, res, next) => {
  try {
    const adminNumbers = await configService.getConfig('admin_whatsapp_numbers');
    const apiKey = await configService.getConfig('gemini_api_key');
    const botActive = await configService.getConfig('whatsapp_admin_bot_active');
    
    const adminBot = waAgent.getBot('admin', req.app.get('io'));

    res.json({
      success: true,
      data: {
        gemini_api_key: apiKey,
        whatsapp_whitelist: adminNumbers,
        whatsapp_bot_active: botActive === '1',
        bot_horario_activo: '0',
        bot_mensaje_ausencia: '',
        bot_status: adminBot ? adminBot.botStatus : 'disconnected',
        bot_qr: adminBot ? adminBot.qrCodeStr : null
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
