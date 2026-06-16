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

// GET /api/chatbots/config-ai
router.get('/config-ai', verificarJWT, async (req, res, next) => {
  try {
    const geminiKey = await configService.getConfig('gemini_api_key') || '';
    const botActive = await configService.getConfig('whatsapp_bot_active') || '0';
    const botHorarioActivo = await configService.getConfig('bot_horario_activo') || '0';
    const botMensajeAusencia = await configService.getConfig('bot_mensaje_ausencia') || '';
    const botMenuUrl = await configService.getConfig('bot_menu_url') || '';
    const botSystemPrompt = await configService.getConfig('bot_system_prompt') || '';

    res.json({
      success: true,
      data: {
        gemini_api_key: geminiKey ? `${geminiKey.slice(0, 6)}...${geminiKey.slice(-6)}` : '',
        whatsapp_bot_active: botActive === '1',
        bot_horario_activo: botHorarioActivo,
        bot_mensaje_ausencia: botMensajeAusencia,
        bot_menu_url: botMenuUrl,
        bot_system_prompt: botSystemPrompt
      }
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/chatbots/config-ai
router.post('/config-ai', verificarJWT, async (req, res, next) => {
  const { gemini_api_key, whatsapp_bot_active, bot_horario_activo, bot_mensaje_ausencia, bot_menu_url, bot_system_prompt } = req.body;
  const io = req.app.get('io');

  try {
    if (gemini_api_key && !gemini_api_key.includes('...') && gemini_api_key.trim().length > 5) {
      await configService.setConfig('gemini_api_key', gemini_api_key.trim());
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
    if (bot_menu_url !== undefined) {
      await configService.setConfig('bot_menu_url', bot_menu_url);
    }
    if (bot_system_prompt !== undefined) {
      await configService.setConfig('bot_system_prompt', bot_system_prompt);
    }

    // Only reload the client bot since this config is for the client bot
    const clientBot = waAgent.getBot('client', io);
    if (clientBot) {
      clientBot.reloadConfig().catch(err => {
        console.error('[WA Route client] Error al recargar la configuración del agente:', err.message);
      });
    }

    res.json({
      success: true,
      message: 'Configuración de IA guardada y agente recargado.'
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
