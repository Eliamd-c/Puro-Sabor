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

// GET /api/inventario/config-ai — Obtener configuración del agente de IA y WhatsApp (Admin)
router.get('/config-ai', verificarJWT, async (req, res, next) => {
  try {
    const geminiKey = await configService.getConfig('gemini_api_key') || '';
    const whitelist = await configService.getConfig('whatsapp_whitelist') || '';
    const botActive = await configService.getConfig('whatsapp_bot_active') || '0';
    const botHorarioActivo = await configService.getConfig('bot_horario_activo') || '0';
    const botMensajeAusencia = await configService.getConfig('bot_mensaje_ausencia') || '';

    res.json({
      success: true,
      data: {
        gemini_api_key: maskApiKey(geminiKey),
        whatsapp_whitelist: whitelist,
        whatsapp_bot_active: botActive === '1',
        bot_horario_activo: botHorarioActivo,
        bot_mensaje_ausencia: botMensajeAusencia,
        bot_status: waAgent.getBotStatus(),
        bot_qr: waAgent.getLatestQr()
      }
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/inventario/config-ai — Guardar la configuración de IA y WhatsApp (Admin)
router.post('/config-ai', verificarJWT, apiLimiter, async (req, res, next) => {
  const { gemini_api_key, whatsapp_whitelist, whatsapp_bot_active, bot_horario_activo, bot_mensaje_ausencia } = req.body;
  const io = req.app.get('io');

  try {
    if (gemini_api_key && !gemini_api_key.includes('...') && gemini_api_key.trim().length > 5) {
      await configService.setConfig('gemini_api_key', gemini_api_key.trim());
    }

    if (whatsapp_whitelist !== undefined) {
      const whitelistLimpia = whatsapp_whitelist
        .split(',')
        .map(n => n.trim())
        .filter(n => n.length > 0)
        .join(',');
      await configService.setConfig('whatsapp_whitelist', whitelistLimpia);
    }

    if (whatsapp_bot_active !== undefined) {
      const activeVal = whatsapp_bot_active ? '1' : '0';
      await configService.setConfig('whatsapp_bot_active', activeVal);
    }

    if (bot_horario_activo !== undefined) {
      await configService.setConfig('bot_horario_activo', bot_horario_activo);
    }
    if (bot_mensaje_ausencia !== undefined) {
      await configService.setConfig('bot_mensaje_ausencia', bot_mensaje_ausencia);
    }

    waAgent.reloadConfig(io).catch(err => {
      console.error('[WA Route] Error al recargar la configuración del agente:', err.message);
    });

    res.json({
      success: true,
      message: 'Configuración de IA guardada y agente reiniciado.'
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
