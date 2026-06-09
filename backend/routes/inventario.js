const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verificarJWT } = require('../middleware/auth');
const waAgent = require('../services/whatsappAgent');

// Helper para obtener configuración de la DB
function getConfig(key) {
  return new Promise((resolve) => {
    db.get('SELECT value FROM config WHERE key = ?', [key], (err, row) => {
      if (err) resolve(null);
      else resolve(row ? row.value : null);
    });
  });
}

// Helper para guardar configuración en la DB
function setConfig(key, value) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO config (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      [key, String(value)],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

// Helper para enmascarar la clave API
function maskApiKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '********';
  return `${key.slice(0, 6)}...${key.slice(-6)}`;
}

// GET /api/inventario/config-ai — Obtener configuración del agente de IA y WhatsApp (Admin)
router.get('/config-ai', verificarJWT, async (req, res) => {
  try {
    const geminiKey = await getConfig('gemini_api_key') || '';
    const whitelist = await getConfig('whatsapp_whitelist') || '';
    const botActive = await getConfig('whatsapp_bot_active') || '0';

    res.json({
      success: true,
      data: {
        gemini_api_key: maskApiKey(geminiKey),
        whatsapp_whitelist: whitelist,
        whatsapp_bot_active: botActive === '1',
        bot_status: waAgent.getBotStatus(),
        bot_qr: waAgent.getLatestQr()
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Error al obtener la configuración de IA.',
      error: err.message
    });
  }
});

// POST /api/inventario/config-ai — Guardar la configuración de IA y WhatsApp (Admin)
router.post('/config-ai', verificarJWT, async (req, res) => {
  const { gemini_api_key, whatsapp_whitelist, whatsapp_bot_active } = req.body;
  const io = req.app.get('io');

  try {
    // 1. Guardar la clave de Gemini solo si no está enmascarada y tiene contenido
    if (gemini_api_key && !gemini_api_key.includes('...') && gemini_api_key.trim().length > 5) {
      await setConfig('gemini_api_key', gemini_api_key.trim());
    }

    // 2. Guardar la lista blanca (SIEMPRE, independiente de la API key)
    if (whatsapp_whitelist !== undefined) {
      const whitelistLimpia = whatsapp_whitelist
        .split(',')
        .map(n => n.trim())
        .filter(n => n.length > 0)
        .join(',');
      await setConfig('whatsapp_whitelist', whitelistLimpia);
    }

    // 3. Guardar el estado activo del bot (SIEMPRE)
    if (whatsapp_bot_active !== undefined) {
      const activeVal = whatsapp_bot_active ? '1' : '0';
      await setConfig('whatsapp_bot_active', activeVal);
    }

    // Recargar el bot de WhatsApp con la nueva configuración en segundo plano
    waAgent.reloadConfig(io).catch(err => {
      console.error('[WA Route] Error al recargar la configuración del agente:', err.message);
    });

    res.json({
      success: true,
      message: 'Configuración de IA guardada y agente reiniciado.'
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Error al guardar la configuración de IA.',
      error: err.message
    });
  }
});

// POST /api/inventario/whatsapp/reconnect — Forzar reconexión manual del bot (Admin)
router.post('/whatsapp/reconnect', verificarJWT, async (req, res) => {
  const io = req.app.get('io');
  try {
    await setConfig('whatsapp_bot_active', '1'); // Forzar activación
    waAgent.reloadConfig(io).catch(err => {
      console.error('[WA Route] Error al reconectar el bot:', err.message);
    });

    res.json({
      success: true,
      message: 'Se ha solicitado la reconexión de WhatsApp.'
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Error al solicitar la reconexión.',
      error: err.message
    });
  }
});

// POST /api/inventario/whatsapp/logout — Cerrar sesión y desvincular dispositivo (Admin)
router.post('/whatsapp/logout', verificarJWT, async (req, res) => {
  const io = req.app.get('io');
  try {
    await waAgent.logoutWhatsApp(io);
    res.json({
      success: true,
      message: 'Se ha cerrado la sesión de WhatsApp exitosamente.'
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Error al cerrar sesión.',
      error: err.message
    });
  }
});

module.exports = router;
