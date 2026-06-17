const express = require('express');
const router = express.Router();
const waAgent = require('../services/whatsappAgent');
const configService = require('../services/configService');
const { verificarJWT } = require('../middleware/auth');
const db = require('../config/database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/media');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'));
  }
});
const upload = multer({ storage });

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

// --- FASE 2: ASISTENCIA HUMANA ---

// GET /api/chatbots/paused
router.get('/paused', verificarJWT, (req, res, next) => {
  db.all('SELECT * FROM chatbots_paused ORDER BY fecha_pausa DESC', [], (err, rows) => {
    if (err) return next(err);
    res.json({ success: true, data: rows || [] });
  });
});

// POST /api/chatbots/reply
router.post('/reply', verificarJWT, async (req, res, next) => {
  const { telefono, pregunta, respuesta } = req.body;
  if (!telefono || !respuesta) return res.status(400).json({ success: false, message: 'Faltan datos.' });

  try {
    const io = req.app.get('io');
    const clientBot = waAgent.getBot('client', io);
    
    // 1. Enviar mensaje por WhatsApp Client Bot
    if (clientBot && clientBot.client) {
      await clientBot.client.sendMessage(telefono + '@s.whatsapp.net', { text: respuesta });
      // Guardar historial manualmente
      await waAgent.guardarMensajeHistorial(telefono, 'model', respuesta, 'client');
      // Emitir al monitor
      clientBot.emitMessage({ type: 'out', sender: 'Asesor Humano', text: respuesta, time: new Date().toLocaleTimeString() });
    }

    // 2. Insertar en Base de Conocimientos si hay pregunta
    if (pregunta) {
      await new Promise((resolve) => {
        db.run('INSERT INTO chatbots_kb (pregunta, respuesta) VALUES (?, ?)', [pregunta, respuesta], () => resolve());
      });
    }

    // 3. Remover de Pausados
    await new Promise((resolve) => {
      db.run('DELETE FROM chatbots_paused WHERE telefono = ?', [telefono], () => resolve());
    });

    res.json({ success: true, message: 'Respuesta enviada y bot reactivado.' });
  } catch (err) {
    next(err);
  }
});

// POST /api/chatbots/resume
router.post('/resume', verificarJWT, (req, res, next) => {
  const { telefono } = req.body;
  db.run('DELETE FROM chatbots_paused WHERE telefono = ?', [telefono], (err) => {
    if (err) return next(err);
    res.json({ success: true, message: 'Chat reactivado sin enviar respuesta.' });
  });
});

// --- FASE 3: GESTOR DE CONOCIMIENTO (KB) ---

// GET /api/chatbots/kb
router.get('/kb', verificarJWT, (req, res, next) => {
  db.all('SELECT * FROM chatbots_kb ORDER BY fecha_creacion DESC', [], (err, rows) => {
    if (err) return next(err);
    res.json({ success: true, data: rows || [] });
  });
});

// POST /api/chatbots/kb
router.post('/kb', verificarJWT, upload.single('media'), (req, res, next) => {
  const { pregunta, respuesta } = req.body;
  if (!pregunta || !respuesta) return res.status(400).json({ success: false, message: 'Pregunta y respuesta son requeridas.' });

  let mediaUrl = null;
  let mediaType = null;

  if (req.file) {
    mediaUrl = '/uploads/media/' + req.file.filename;
    mediaType = req.file.mimetype.split('/')[0]; // 'image', 'video', 'audio'
  }

  db.run(
    'INSERT INTO chatbots_kb (pregunta, respuesta, media_url, media_type) VALUES (?, ?, ?, ?)',
    [pregunta, respuesta, mediaUrl, mediaType],
    function(err) {
      if (err) return next(err);
      res.json({ success: true, message: 'Regla agregada a la Base de Conocimientos.' });
    }
  );
});

// DELETE /api/chatbots/kb/:id
router.delete('/kb/:id', verificarJWT, (req, res, next) => {
  const { id } = req.params;
  db.run('DELETE FROM chatbots_kb WHERE id = ?', [id], (err) => {
    if (err) return next(err);
    res.json({ success: true, message: 'Regla eliminada.' });
  });
});

module.exports = router;
