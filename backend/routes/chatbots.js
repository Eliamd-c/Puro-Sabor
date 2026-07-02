const express = require('express');
const router = express.Router();
const waAgent = require('../services/whatsappAgent');
const configService = require('../services/configService');
const { verificarJWT } = require('../middleware/auth');
const db = require('../config/database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
  asyncWrapper,
  normalizeError,
  DatabaseError,
  ValidationError,
  errorMiddleware
} = require('../utils/errorHandler');

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

// POST /api/chatbots/emergency/clean-locks (limpiar locks manualmente)
router.post('/emergency/clean-locks', verificarJWT, async (req, res, next) => {
  try {
    const ahora = Date.now();
    const ttl = 30000; // 30 segundos
    const hace30s = new Date(ahora - ttl);

    const result = await dbAsync.run(
      `DELETE FROM wa_auth WHERE key LIKE $1 AND updated_at < $2`,
      ['%lock_pid%', hace30s]
    );

    res.json({
      success: true,
      message: `Limpios ${result.changes} locks expirados`,
      changes: result.changes
    });

    console.log(`[Manual] Admin limpió ${result.changes} locks expirados`);
  } catch (err) {
    next(err);
  }
});

// POST /api/chatbots/:type/hard-reset (limpiar auth local y BD completamente)
router.post('/:type/hard-reset', verificarJWT, async (req, res, next) => {
  try {
    const type = req.params.type;
    const io = req.app.get('io');
    const bot = waAgent.getBot(type, io);
    const path = require('path');
    const fs = require('fs');

    console.log(`[WA Route ${type}] Iniciando HARD RESET...`);

    // 1. Limpiar carpeta de autenticación local
    const authFolder = path.join(__dirname, '..', `auth_${type}`);
    if (fs.existsSync(authFolder)) {
      fs.rmSync(authFolder, { recursive: true, force: true });
      console.log(`[WA Route ${type}] Carpeta ${authFolder} eliminada`);
    }

    // 2. Limpiar BD
    await dbAsync.run(
      `DELETE FROM wa_auth WHERE key LIKE $1`,
      [`${type}_%`]
    );
    console.log(`[WA Route ${type}] Credenciales en BD limpiadas`);

    // 3. Reset estado del bot
    bot.isReconnecting = false;
    bot.botStatus = 'disconnected';
    bot.latestQrDataUrl = null;
    await bot.releaseLockDB().catch(() => {});

    // 4. Habilitar bot
    const activeKey = type === 'client' ? 'whatsapp_bot_active' : 'whatsapp_admin_bot_active';
    await configService.setConfig(activeKey, '1');

    res.json({
      success: true,
      message: 'Hard reset completado. El QR se generará en 10 segundos.'
    });

    // 5. Inicializar inmediatamente
    setTimeout(() => {
      console.log(`[WA Route ${type}] Iniciando bot después de hard reset...`);
      bot.inicializarWhatsApp().catch(err => {
        console.error(`[WA Route ${type}] Error después de hard reset:`, err.message);
      });
    }, 1000);
  } catch (err) {
    console.error(`[WA Route] Error en hard-reset:`, err.message);
    res.status(500).json({
      success: false,
      message: 'Error: ' + err.message
    });
  }
});

// POST /api/chatbots/:type/reconnect
router.post('/:type/reconnect', verificarJWT, async (req, res, next) => {
  const { type } = req.params;
  try {
    const bot = waAgent.getBot(type, req.app.get('io'));
    if (!bot) return res.status(404).json({ success: false, message: 'Bot no encontrado' });

    bot.isReconnecting = false;
    bot.botStatus = 'disconnected';
    bot.latestQrDataUrl = null;
    await bot.releaseLockDB().catch(() => {});
    
    setTimeout(() => {
      bot.inicializarWhatsApp().catch(() => {});
    }, 1000);

    res.json({ success: true, message: 'Reconexión iniciada' });
  } catch (err) {
    next(err);
  }
});

// GET /api/chatbots/diagnose
router.get('/diagnose', async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const dbAsync = require('../config/database-promise');
    const { Pool } = require('pg');
    const pgPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

    const authAdminFolder = path.join(__dirname, '..', 'auth_admin');
    const authAdminExists = fs.existsSync(authAdminFolder);
    const authAdminFiles = authAdminExists ? fs.readdirSync(authAdminFolder) : [];

    const authClientFolder = path.join(__dirname, '..', 'auth_client');
    const authClientExists = fs.existsSync(authClientFolder);
    const authClientFiles = authClientExists ? fs.readdirSync(authClientFolder) : [];

    const dbLocks = await pgPool.query("SELECT * FROM wa_auth WHERE key LIKE '%lock%'");

    res.json({
      processId: process.pid,
      adminBotState: waAgent.getBot('admin', req.app.get('io'))?.botStatus,
      clientBotState: waAgent.getBot('client', req.app.get('io'))?.botStatus,
      fs: {
        authAdminExists,
        authAdminFilesCount: authAdminFiles.length,
        authClientExists,
        authClientFilesCount: authClientFiles.length
      },
      dbLocks: dbLocks.rows
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// POST /api/chatbots/:type/force-qr (limpiar auth y forzar nuevo QR)
router.post('/:type/force-qr', verificarJWT, async (req, res, next) => {
  try {
    const type = req.params.type;
    const io = req.app.get('io');
    const bot = waAgent.getBot(type, io);

    console.log(`[WA Route ${type}] Forzando limpieza de credenciales y nuevo QR...`);

    // Responder inmediatamente
    res.json({
      success: true,
      message: 'Limpiando auth y generando nuevo QR en 5-10 segundos...'
    });

    // 1. Limpiar auth en background
    bot.clearLocalAuth().catch(err => {
      console.error(`[WA Route ${type}] Error limpiando auth:`, err.message);
    });

    // 2. Reset estado del bot
    bot.isReconnecting = false;
    bot.botStatus = 'disconnected';
    bot.latestQrDataUrl = null;
    await bot.releaseLockDB().catch(() => {});

    // 3. Habilitar el bot
    const activeKey = type === 'client' ? 'whatsapp_bot_active' : 'whatsapp_admin_bot_active';
    await configService.setConfig(activeKey, '1').catch(err => {
      console.error(`[WA Route ${type}] Error habilitando bot:`, err.message);
    });

    // 4. Inicializar inmediatamente
    setTimeout(() => {
      bot.inicializarWhatsApp().catch(err => {
        console.error(`[WA Route ${type}] Error forzando QR:`, err.message);
      });
    }, 1000);
  } catch (err) {
    console.error(`[WA Route] Error en force-qr:`, err.message);
    res.status(500).json({
      success: false,
      message: 'Error limpiando auth: ' + err.message
    });
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
    const botMenuImagen = await configService.getConfig('bot_menu_imagen_url') || '';

    res.json({
      success: true,
      data: {
        gemini_api_key: geminiKey ? `${geminiKey.slice(0, 6)}...${geminiKey.slice(-6)}` : '',
        whatsapp_bot_active: botActive === '1',
        bot_horario_activo: botHorarioActivo,
        bot_mensaje_ausencia: botMensajeAusencia,
        bot_menu_url: botMenuUrl,
        bot_system_prompt: botSystemPrompt,
        bot_menu_imagen_url: botMenuImagen
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

    res.json({
      success: true,
      message: 'Configuración de IA guardada con éxito.'
    });

  } catch (err) {
    next(err);
  }
});

// POST /api/chatbots/menu-imagen — Subir la imagen del menú que envía el bot cliente
router.post('/menu-imagen', verificarJWT, upload.single('imagen'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No se recibió imagen.' });
    const url = '/uploads/media/' + req.file.filename;
    await configService.setConfig('bot_menu_imagen_url', url);
    res.json({ success: true, message: 'Imagen del menú guardada.', url });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/chatbots/menu-imagen — Quitar la imagen del menú
router.delete('/menu-imagen', verificarJWT, async (req, res, next) => {
  try {
    await configService.setConfig('bot_menu_imagen_url', '');
    res.json({ success: true, message: 'Imagen del menú eliminada.' });
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
  db.all('SELECT * FROM chatbots_kb ORDER BY prioridad DESC, fecha_creacion DESC', [], (err, rows) => {
    if (err) return next(err);
    res.json({ success: true, data: rows || [] });
  });
});

// POST /api/chatbots/kb
router.post('/kb', verificarJWT, upload.single('media'), (req, res, next) => {
  const { pregunta, respuesta, categoria, ejemplos_sinonimos, activa, prioridad } = req.body;
  if (!pregunta || !respuesta) return res.status(400).json({ success: false, message: 'Pregunta y respuesta son requeridas.' });

  let mediaUrl = null;
  let mediaType = null;

  if (req.file) {
    mediaUrl = '/uploads/media/' + req.file.filename;
    mediaType = req.file.mimetype.split('/')[0]; // 'image', 'video', 'audio'
  }

  const cat = categoria || 'general';
  const sin = ejemplos_sinonimos ? (Array.isArray(ejemplos_sinonimos) ? JSON.stringify(ejemplos_sinonimos) : ejemplos_sinonimos) : '[]';
  const act = activa !== undefined ? (parseInt(activa) || 0) : 1;
  const prio = prioridad !== undefined ? (parseInt(prioridad) || 0) : 0;

  db.run(
    'INSERT INTO chatbots_kb (pregunta, respuesta, media_url, media_type, categoria, ejemplos_sinonimos, activa, prioridad) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [pregunta, respuesta, mediaUrl, mediaType, cat, sin, act, prio],
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

// --- NUEVOS ENDPOINTS PARA AGENTE DE ATENCIÓN Y PANEL DE ENTRENAMIENTO ---

// ===== CLIENTES FRECUENTES =====
router.get('/clientes-frecuentes', verificarJWT, (req, res, next) => {
  db.all(
    `SELECT cf.*, ch.productos_favoritos, ch.notas_admin 
     FROM clientes_frecuentes cf 
     LEFT JOIN cliente_historial ch ON cf.telefono = ch.telefono 
     ORDER BY cf.nombre ASC`,
    [],
    (err, rows) => {
      if (err) return next(err);
      res.json({ success: true, data: rows || [] });
    }
  );
});

router.post('/clientes-frecuentes', verificarJWT, async (req, res, next) => {
  const { telefono, nombre, productos_favoritos, notas_admin } = req.body;
  if (!telefono || !nombre) {
    return res.status(400).json({ success: false, message: 'Teléfono y nombre son requeridos.' });
  }

  try {
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO clientes_frecuentes (telefono, nombre, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT (telefono) DO UPDATE SET nombre = EXCLUDED.nombre, updated_at = CURRENT_TIMESTAMP`,
        [telefono, nombre],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    const favoritosString = productos_favoritos ? (Array.isArray(productos_favoritos) ? JSON.stringify(productos_favoritos) : productos_favoritos) : '[]';
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO cliente_historial (telefono, productos_favoritos, notas_admin, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT (telefono) DO UPDATE SET productos_favoritos = EXCLUDED.productos_favoritos, notas_admin = EXCLUDED.notas_admin, updated_at = CURRENT_TIMESTAMP`,
        [telefono, favoritosString, notas_admin || ''],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    res.json({ success: true, message: 'Cliente frecuente guardado con éxito.' });
  } catch (err) {
    next(err);
  }
});

router.delete('/clientes-frecuentes/:telefono', verificarJWT, (req, res, next) => {
  const { telefono } = req.params;
  db.run('DELETE FROM clientes_frecuentes WHERE telefono = ?', [telefono], (err) => {
    if (err) return next(err);
    res.json({ success: true, message: 'Cliente frecuente eliminado.' });
  });
});

router.get('/cliente-perfil/:telefono', verificarJWT, (req, res, next) => {
  const { telefono } = req.params;
  db.get(
    `SELECT cf.*, ch.productos_favoritos, ch.notas_admin 
     FROM clientes_frecuentes cf 
     LEFT JOIN cliente_historial ch ON cf.telefono = ch.telefono 
     WHERE cf.telefono = ?`,
    [telefono],
    (err, row) => {
      if (err) return next(err);
      if (!row) return res.status(404).json({ success: false, message: 'Cliente no encontrado.' });
      res.json({ success: true, data: row });
    }
  );
});

// ===== PROMOCIONES =====
router.get('/promociones', verificarJWT, (req, res, next) => {
  db.all('SELECT * FROM promociones ORDER BY orden ASC, created_at DESC', [], (err, rows) => {
    if (err) return next(err);
    res.json({ success: true, data: rows || [] });
  });
});

router.post('/promociones', verificarJWT, upload.single('imagen'), (req, res, next) => {
  const { titulo, descripcion, imagen_tipo, orden, fecha_inicio, fecha_fin } = req.body;
  if (!titulo || !descripcion) {
    return res.status(400).json({ success: false, message: 'Título y descripción son requeridos.' });
  }

  let imagenUrl = null;
  let imgTipo = imagen_tipo || 'image';

  if (req.file) {
    imagenUrl = '/uploads/media/' + req.file.filename;
    if (!imagen_tipo) {
      imgTipo = req.file.mimetype.split('/')[0];
    }
  }

  const fInicio = fecha_inicio || null;
  const fFin = fecha_fin || null;
  const ord = parseInt(orden) || 0;

  db.run(
    `INSERT INTO promociones (titulo, descripcion, imagen_url, imagen_tipo, orden, fecha_inicio, fecha_fin) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [titulo, descripcion, imagenUrl, imgTipo, ord, fInicio, fFin],
    function(err) {
      if (err) return next(err);
      res.json({ success: true, message: 'Promoción guardada con éxito.' });
    }
  );
});

router.post('/promociones/:id/toggle', verificarJWT, (req, res, next) => {
  const { id } = req.params;
  db.get('SELECT activa FROM promociones WHERE id = ?', [id], (err, row) => {
    if (err) return next(err);
    if (!row) return res.status(404).json({ success: false, message: 'Promoción no encontrada.' });

    const nuevaActiva = row.activa === 1 ? 0 : 1;
    db.run('UPDATE promociones SET activa = ? WHERE id = ?', [nuevaActiva, id], (err) => {
      if (err) return next(err);
      res.json({ success: true, activa: nuevaActiva, message: 'Estado de promoción actualizado.' });
    });
  });
});

router.delete('/promociones/:id', verificarJWT, (req, res, next) => {
  const { id } = req.params;
  db.get('SELECT imagen_url FROM promociones WHERE id = ?', [id], (err, row) => {
    if (err) return next(err);
    if (!row) return res.status(404).json({ success: false, message: 'Promoción no encontrada.' });

    if (row.imagen_url) {
      const filePath = path.join(__dirname, '..', row.imagen_url);
      fs.unlink(filePath, (err) => {
        if (err && err.code !== 'ENOENT') {
          console.error('Error eliminando archivo de promo:', err.message);
        }
      });
    }

    db.run('DELETE FROM promociones WHERE id = ?', [id], (err) => {
      if (err) return next(err);
      res.json({ success: true, message: 'Promoción eliminada.' });
    });
  });
});

// ===== HORARIOS =====
router.get('/horarios', verificarJWT, (req, res, next) => {
  db.all('SELECT * FROM bot_horarios ORDER BY id ASC', [], (err, rows) => {
    if (err) return next(err);
    res.json({ success: true, data: rows || [] });
  });
});

router.post('/horarios', verificarJWT, (req, res, next) => {
  const { dia_semana, abierto, hora_apertura, hora_cierre } = req.body;
  if (!dia_semana) return res.status(400).json({ success: false, message: 'Día de la semana requerido.' });

  db.run(
    `INSERT INTO bot_horarios (dia_semana, abierto, hora_apertura, hora_cierre) 
     VALUES (?, ?, ?, ?)
     ON CONFLICT (dia_semana) DO UPDATE SET abierto = EXCLUDED.abierto, hora_apertura = EXCLUDED.hora_apertura, hora_cierre = EXCLUDED.hora_cierre`,
    [dia_semana, abierto ? 1 : 0, hora_apertura || '18:00', hora_cierre || '23:30'],
    (err) => {
      if (err) return next(err);
      res.json({ success: true, message: `Horario del día ${dia_semana} guardado.` });
    }
  );
});

// ===== CONTEXTO =====
router.get('/contexto', verificarJWT, (req, res, next) => {
  db.all('SELECT * FROM bot_contexto ORDER BY id DESC', [], (err, rows) => {
    if (err) return next(err);
    res.json({ success: true, data: rows || [] });
  });
});

router.post('/contexto', verificarJWT, (req, res, next) => {
  const { tipo, contenido } = req.body;
  if (!tipo || !contenido) return res.status(400).json({ success: false, message: 'Tipo y contenido son requeridos.' });

  db.run(
    'INSERT INTO bot_contexto (tipo, contenido) VALUES (?, ?)',
    [tipo, contenido],
    function(err) {
      if (err) return next(err);
      res.json({ success: true, message: 'Instrucción de contexto agregada con éxito.' });
    }
  );
});

router.delete('/contexto/:id', verificarJWT, (req, res, next) => {
  const { id } = req.params;
  db.run('DELETE FROM bot_contexto WHERE id = ?', [id], (err) => {
    if (err) return next(err);
    res.json({ success: true, message: 'Instrucción de contexto eliminada.' });
  });
});

// ===== TESTER =====
router.post('/test', verificarJWT, async (req, res, next) => {
  const { pregunta } = req.body;
  if (!pregunta) return res.status(400).json({ success: false, message: 'Pregunta requerida.' });

  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const apiKey = await configService.getConfig('gemini_api_key') || process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(400).json({ success: false, message: 'API Key de Gemini no configurada.' });

    // Cargar conocimiento y contexto
    const kb = await new Promise(resolve => {
      db.all('SELECT id, pregunta, respuesta FROM chatbots_kb WHERE activa = 1', [], (err, rows) => resolve(rows || []));
    });
    const ctx = await new Promise(resolve => {
      db.all('SELECT tipo, contenido FROM bot_contexto WHERE activo = 1', [], (err, rows) => resolve(rows || []));
    });
    const promos = await new Promise(resolve => {
      db.all('SELECT id, titulo, descripcion FROM promociones WHERE activa = 1', [], (err, rows) => resolve(rows || []));
    });

    let promptKb = '';
    if (kb.length > 0) {
      promptKb = '\nBASE DE CONOCIMIENTO (Q&As):\n' + kb.map(k => `Q: ${k.pregunta}\nA: ${k.respuesta}`).join('\n') + '\n';
    }

    let promptCtx = '';
    if (ctx.length > 0) {
      promptCtx = '\nINSTRUCCIONES EXTRA:\n' + ctx.map(c => `[${c.tipo.toUpperCase()}]: ${c.contenido}`).join('\n') + '\n';
    }

    let promptPromos = '';
    if (promos.length > 0) {
      promptPromos = '\nPROMOCIONES ACTIVAS:\n' + promos.map(p => `- [PROMO_ID:${p.id}] ${p.titulo}: ${p.descripcion}`).join('\n') + '\n';
    }

    const systemInstruction = 
      'Eres el recepcionista oficial de Puro Sabor.\n' +
      'REGLAS DE SIMULACIÓN DE TESTER:\n' +
      'Estás siendo evaluado en un entorno de pruebas.\n' +
      promptKb + promptCtx + promptPromos +
      '\nResponde brevemente simulando ser el bot real.';

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', systemInstruction });
    
    const result = await model.generateContent(pregunta);
    const text = result.response.text();

    res.json({ success: true, respuesta: text });
  } catch (err) {
    next(err);
  }
});

// ===== ANALYTICS =====
router.get('/analytics', verificarJWT, async (req, res, next) => {
  try {
    const totalConversaciones = await new Promise(resolve => {
      db.get('SELECT COUNT(DISTINCT telefono) as count FROM chatbot_logs', [], (err, row) => resolve(row?.count || 0));
    });

    const totalHandoffs = await new Promise(resolve => {
      db.get("SELECT COUNT(*) as count FROM chatbot_logs WHERE tipo = 'handoff'", [], (err, row) => resolve(row?.count || 0));
    });

    const totalMensajes = await new Promise(resolve => {
      db.get('SELECT COUNT(*) as count FROM chatbot_logs', [], (err, row) => resolve(row?.count || 0));
    });

    const totalPromos = await new Promise(resolve => {
      db.get("SELECT COUNT(*) as count FROM chatbot_logs WHERE tipo = 'promo_enviada'", [], (err, row) => resolve(row?.count || 0));
    });

    const preguntasFrecuentes = await new Promise(resolve => {
      db.all(
        `SELECT mensaje_usuario as pregunta, COUNT(*) as veces 
         FROM chatbot_logs 
         WHERE mensaje_usuario IS NOT NULL AND mensaje_usuario != ''
         GROUP BY mensaje_usuario 
         ORDER BY veces DESC LIMIT 5`,
        [],
        (err, rows) => resolve(rows || [])
      );
    });

    res.json({
      success: true,
      data: {
        total_conversaciones: parseInt(totalConversaciones) || 0,
        preguntas_unicas: parseInt(totalConversaciones) || 0,
        handoffs: parseInt(totalHandoffs) || 0,
        total_mensajes: parseInt(totalMensajes) || 0,
        total_promociones_enviadas: parseInt(totalPromos) || 0,
        preguntas_frecuentes: preguntasFrecuentes,
        satisfaccion: 95
      }
    });
  } catch (err) {
    next(err);
  }
});

// ===== ADMIN AUTHORIZATION (FASE 1.2) =====
const adminAuthService = require('../services/adminAuthService');

// POST /api/chatbots/admin/authorize-number/initiate
// Inicia proceso 2FA: valida número y envía OTP
router.post('/admin/authorize-number/initiate', verificarJWT, async (req, res, next) => {
  try {
    const { number } = req.body;
    if (!number) {
      return res.status(400).json({
        success: false,
        error: 'Número de teléfono requerido'
      });
    }

    // 1. Validar formato E.164
    const validation = adminAuthService.validateE164Format(number);
    if (!validation.valid) {
      await adminAuthService.logAccessAttempt(number, 'invalid_format', validation.error);
      return res.status(400).json({
        success: false,
        error: validation.error
      });
    }

    // 2. Iniciar 2FA
    const result = await adminAuthService.initiate2FA(validation.normalized);
    if (!result.success) {
      return res.status(500).json(result);
    }

    res.json({
      success: true,
      message: result.message,
      number: validation.normalized
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/chatbots/admin/authorize-number/verify
// Verifica código OTP y autoriza número
router.post('/admin/authorize-number/verify', verificarJWT, async (req, res, next) => {
  try {
    const { number, code } = req.body;
    if (!number || !code) {
      return res.status(400).json({
        success: false,
        error: 'Número y código OTP requeridos'
      });
    }

    // 1. Validar formato
    const validation = adminAuthService.validateE164Format(number);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error
      });
    }

    // 2. Verificar OTP
    const result = await adminAuthService.verify2FA(validation.normalized, code);
    if (!result.success) {
      return res.status(401).json(result);
    }

    res.json({
      success: true,
      message: result.message,
      number: validation.normalized
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/chatbots/admin/whitelist
// Lista números autorizados
router.get('/admin/whitelist', verificarJWT, async (req, res, next) => {
  try {
    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT numero, autorizado_en, activo FROM admin_whitelist ORDER BY autorizado_en DESC`,
        [],
        (err, rows) => err ? reject(err) : resolve(rows || [])
      );
    });

    res.json({
      success: true,
      data: rows
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/chatbots/admin/whitelist/:number
// Revoca acceso a un número
router.delete('/admin/whitelist/:number', verificarJWT, async (req, res, next) => {
  try {
    const { number } = req.params;

    // Validar formato
    const validation = adminAuthService.validateE164Format(number);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error
      });
    }

    // Revocar acceso
    const result = await adminAuthService.revokeAdminAccess(validation.normalized);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/chatbots/admin/whitelist/logs
// Ver historial de intentos de acceso
router.get('/admin/whitelist/logs', verificarJWT, async (req, res, next) => {
  try {
    const { number, limit = 100 } = req.query;

    const logs = await adminAuthService.getAccessLog(number, parseInt(limit));

    res.json({
      success: true,
      data: logs
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
