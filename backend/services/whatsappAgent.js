const { makeWASocket, DisconnectReason, Browsers, downloadMediaMessage, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const db = require('../config/database');
const { Pool } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Helpers para base de datos
function getConfig(key) {
  return new Promise((resolve) => {
    db.get('SELECT value FROM config WHERE key = ?', [key], (err, row) => {
      if (err) {
        console.error(`[WA Agent] Error leyendo config para ${key}:`, err.message);
        resolve(null);
      } else {
        resolve(row ? row.value : null);
      }
    });
  });
}

function getInventarioDb() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT p.id, p.nombre, c.nombre as categoria, p.precio, p.stock 
       FROM productos p 
       JOIN categorias c ON p.categoria_id = c.id 
       WHERE p.activo = 1`,
      [],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
}

function updateStockDb(id, nuevoStock) {
  return new Promise((resolve, reject) => {
    const stockLimpio = Math.max(0, parseInt(nuevoStock) || 0);
    db.run(
      `UPDATE productos SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [stockLimpio, id],
      function(err) {
        if (err) reject(err);
        else resolve({ changes: this.changes });
      }
    );
  });
}

function adjustStockDb(id, delta) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT stock, nombre FROM productos WHERE id = ?`, [id], (err, row) => {
      if (err) return reject(err);
      if (!row) return resolve({ changes: 0, error: 'Producto no encontrado' });
      
      const nuevoStock = Math.max(0, row.stock + (parseInt(delta) || 0));
      db.run(
        `UPDATE productos SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [nuevoStock, id],
        function(err) {
          if (err) reject(err);
          else resolve({ changes: this.changes, nuevoStock, nombre: row.nombre });
        }
      );
    });
  });
}

function guardarMensajeHistorial(numero, rol, contenido, botType) {
  return new Promise((resolve) => {
    // Usamos el número con sufijo para separar historiales
    db.run(
      'INSERT INTO wa_conversaciones (numero_telefono, rol, contenido) VALUES (?, ?, ?)',
      [`${numero}_${botType}`, rol, contenido],
      (err) => {
        if (err) console.error(`[WA Agent ${botType}] Error guardando historial:`, err.message);
        resolve();
      }
    );
  });
}

function obtenerHistorial(numero, botType, limite = 15) {
  return new Promise((resolve) => {
    db.all(
      `SELECT rol, contenido FROM wa_conversaciones 
       WHERE numero_telefono = ? 
       ORDER BY creado_en DESC LIMIT ?`,
      [`${numero}_${botType}`, limite],
      (err, rows) => {
        if (err) {
          console.error(`[WA Agent ${botType}] Error leyendo historial:`, err.message);
          resolve([]);
        } else {
          resolve((rows || []).reverse());
        }
      }
    );
  });
}

// --- Nuevos helpers para Fase 2 ---
function isChatPaused(telefono) {
  return new Promise((resolve) => {
    db.get('SELECT id FROM chatbots_paused WHERE telefono = ?', [telefono], (err, row) => {
      resolve(!!row);
    });
  });
}

function pauseChat(telefono, nombre, ultimoMensaje) {
  return new Promise((resolve) => {
    // Usamos el query de Postgres: ON CONFLICT(telefono) DO UPDATE...
    db.run(
      'INSERT INTO chatbots_paused (telefono, nombre_cliente, ultimo_mensaje) VALUES (?, ?, ?) ON CONFLICT (telefono) DO UPDATE SET ultimo_mensaje = EXCLUDED.ultimo_mensaje, fecha_pausa = CURRENT_TIMESTAMP',
      [telefono, nombre, ultimoMensaje],
      () => resolve()
    );
  });
}

function getKnowledgeBase() {
  return new Promise((resolve) => {
    db.all('SELECT id, pregunta, respuesta, media_url, media_type FROM chatbots_kb ORDER BY fecha_creacion DESC LIMIT 50', [], (err, rows) => {
      resolve(rows || []);
    });
  });
}

function isWithinBusinessHours() {
  return new Promise((resolve) => {
    // Colombia está en la zona horaria UTC-5 permanentemente (sin horario de verano)
    const now = new Date();
    const colombiaTime = new Date(now.getTime() - (5 * 60 * 60 * 1000));
    
    const dias = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    const hoy = dias[colombiaTime.getUTCDay()];
    
    const currentHours = colombiaTime.getUTCHours().toString().padStart(2, '0');
    const currentMinutes = colombiaTime.getUTCMinutes().toString().padStart(2, '0');
    const currentTimeStr = `${currentHours}:${currentMinutes}`;

    console.log(`[WA Agent] Validando horario. Hora local calculada (Colombia UTC-5): ${currentTimeStr} del día ${hoy}`);

    db.get('SELECT abierto, hora_apertura, hora_cierre FROM bot_horarios WHERE dia_semana = ?', [hoy], (err, row) => {
      if (err || !row) {
        console.log(`[WA Agent] No se encontró horario en la base de datos para el día ${hoy}. Por defecto: ABIERTO.`);
        resolve(true); // Abierto por defecto
        return;
      }
      
      if (row.abierto === 0) {
        console.log(`[WA Agent] El restaurante está cerrado todo el día ${hoy} según la configuración.`);
        resolve(false);
        return;
      }
      
      const start = row.hora_apertura;
      const end = row.hora_cierre;
      
      console.log(`[WA Agent] Horario programado para ${hoy}: ${start} a ${end}. Hora actual: ${currentTimeStr}`);
      
      if (start <= end) {
        const check = currentTimeStr >= start && currentTimeStr <= end;
        console.log(`[WA Agent] Rango de horario normal. ¿Está abierto?: ${check}`);
        resolve(check);
      } else {
        // Horario nocturno que cruza la medianoche (ej: 18:00 a 02:00)
        const check = currentTimeStr >= start || currentTimeStr <= end;
        console.log(`[WA Agent] Rango de horario nocturno. ¿Está abierto?: ${check}`);
        resolve(check);
      }
    });
  });
}

function logChatbotInteraction(telefono, nombreCliente, tipo, mensajeUsuario, respuestaBot, detalles = {}) {
  return new Promise((resolve) => {
    const detStr = JSON.stringify(detalles);
    db.run(
      `INSERT INTO chatbot_logs (telefono, nombre_cliente, tipo, mensaje_usuario, respuesta_bot, detalles)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [telefono, nombreCliente || 'Anónimo', tipo, mensajeUsuario || '', respuestaBot || '', detStr],
      (err) => {
        if (err) console.error('[WA Agent] Error guardando log analítico:', err.message);
        resolve();
      }
    );
  });
}
// ----------------------------------

class WhatsAppBot {
  constructor(botType, io) {
    this.botType = botType; // 'client' o 'admin'
    this.io = io;
    this.client = null;
    this.botStatus = 'disconnected'; // disabled, disconnected, loading, qr, ready
    this.latestQrDataUrl = null;
    this.isReconnecting = false;
    this.LOCK_KEY = `whatsapp_lock_pid_${this.botType}`;
    this.LOCK_TTL_MS = 30000;
  }

  async useSupabaseAuthState() {
    const prefix = `${this.botType}_`;
    
    async function readData(key) {
      try {
        const res = await pgPool.query('SELECT value FROM wa_auth WHERE key = $1', [prefix + key]);
        if (res.rows.length === 0) return null;
        return JSON.parse(res.rows[0].value, BufferJSON.reviver);
      } catch {
        return null;
      }
    }

    async function writeData(key, value) {
      const serialized = JSON.stringify(value, BufferJSON.replacer);
      await pgPool.query(
        `INSERT INTO wa_auth (key, value, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [prefix + key, serialized]
      );
    }

    async function removeData(key) {
      await pgPool.query('DELETE FROM wa_auth WHERE key = $1', [prefix + key]);
    }

    const creds = (await readData('creds')) || initAuthCreds();

    return {
      state: {
        creds,
        keys: {
          get: async (type, ids) => {
            const data = {};
            for (const id of ids) {
              const val = await readData(`${type}-${id}`);
              if (val) data[id] = val;
            }
            return data;
          },
          set: async (data) => {
            for (const [type, typeData] of Object.entries(data)) {
              for (const [id, val] of Object.entries(typeData)) {
                const key = `${type}-${id}`;
                if (val) {
                  await writeData(key, val);
                } else {
                  await removeData(key);
                }
              }
            }
          }
        }
      },
      saveCreds: async () => {
        await writeData('creds', creds);
      }
    };
  }

  async tryAcquireLockDB() {
    const myPid = process.pid.toString();
    const now = new Date();
    const expiry = new Date(now.getTime() - this.LOCK_TTL_MS);

    const res = await pgPool.query('SELECT value, updated_at FROM wa_auth WHERE key = $1', [this.LOCK_KEY]);

    if (res.rows.length > 0) {
      const lockPid = res.rows[0].value;
      const lockTime = new Date(res.rows[0].updated_at);
      if (lockPid !== myPid && lockTime > expiry) {
        return false;
      }
    }

    await pgPool.query(
      `INSERT INTO wa_auth (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [this.LOCK_KEY, myPid]
    );
    return true;
  }

  async releaseLockDB() {
    await pgPool.query('DELETE FROM wa_auth WHERE key = $1', [this.LOCK_KEY]);
  }

  async clearSupabaseAuth() {
    const prefix = `${this.botType}_`;
    await pgPool.query("DELETE FROM wa_auth WHERE key LIKE $1 AND key != $2", [`${prefix}%`, this.LOCK_KEY]);
  }

  emitStatus(extra = {}) {
    this.io.to('admin').emit(`whatsapp_${this.botType}_status`, { status: this.botStatus, ...extra });
  }

  emitMessage(data) {
    this.io.to('admin').emit(`whatsapp_${this.botType}_message`, data);
  }

  async inicializarWhatsApp() {
    if (this.isReconnecting) return;

    try {
      const hasLock = await this.tryAcquireLockDB();
      if (!hasLock) {
        console.log(`[WA Agent ${this.botType}] 🔒 Otro proceso ya tiene el control. Reintentando en 5s...`);
        setTimeout(() => this.inicializarWhatsApp(), 5000);
        return;
      }
    } catch (err) {
      console.error(`[WA Agent ${this.botType}] Error verificando lock:`, err.message);
      setTimeout(() => this.inicializarWhatsApp(), 5000);
      return;
    }

    this.isReconnecting = true;

    if (this.client) {
      console.log(`[WA Agent ${this.botType}] Cerrando instancia previa...`);
      try {
        this.client.ev.removeAllListeners('connection.update');
        this.client.end(undefined);
      } catch (e) {}
      this.client = null;
    }

    const activeConfigKey = this.botType === 'client' ? 'whatsapp_bot_active' : 'whatsapp_admin_bot_active';
    const active = await getConfig(activeConfigKey);
    
    // Asumimos activo por defecto si no existe la config, o si es 1
    if (active === '0') {
      console.log(`[WA Agent ${this.botType}] Desactivado en la configuración.`);
      this.botStatus = 'disabled';
      this.latestQrDataUrl = null;
      this.emitStatus();
      this.isReconnecting = false;
      await this.releaseLockDB();
      return;
    }

    console.log(`[WA Agent ${this.botType}] Iniciando cliente de WhatsApp...`);
    this.botStatus = 'loading';
    this.latestQrDataUrl = null;
    this.emitStatus();

    try {
      const { state, saveCreds } = await this.useSupabaseAuthState();

      this.client = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: false
      });

      this.isReconnecting = false;

      this.client.ev.on('creds.update', saveCreds);

      this.client.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          console.log(`[WA Agent ${this.botType}] QR recibido.`);
          this.botStatus = 'qr';
          try {
            this.latestQrDataUrl = await qrcode.toDataURL(qr);
            this.emitStatus({ qr: this.latestQrDataUrl });
          } catch (err) {
            console.error(`[WA Agent ${this.botType}] Error generando QR:`, err);
          }
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          console.log(`[WA Agent ${this.botType}] Conexión cerrada. Reconectar:`, shouldReconnect, 'Razón:', lastDisconnect?.error?.message, 'Code:', statusCode);
          
          if (statusCode === DisconnectReason.loggedOut) {
            try {
              await this.clearSupabaseAuth();
              console.log(`[WA Agent ${this.botType}] Sesión cerrada remotamente. Auth limpiada.`);
            } catch(e) {
              console.error(`[WA Agent ${this.botType}] Error limpiando auth:`, e.message);
            }
          }

          this.botStatus = 'disconnected';
          this.latestQrDataUrl = null;
          this.emitStatus({ error: lastDisconnect?.error?.message });
          
          if (shouldReconnect) {
            setTimeout(() => this.inicializarWhatsApp(), 3000);
          }
        } else if (connection === 'open') {
          console.log(`[WA Agent ${this.botType}] Conectado y listo.`);
          this.botStatus = 'ready';
          this.latestQrDataUrl = null;
          this.emitStatus();
        }
      });

      this.client.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        const message = m.messages[0];
        if (message.key.fromMe) return;

        try {
          await this.procesarMensajeEntrante(message);
        } catch (err) {
          console.error(`[WA Agent ${this.botType}] Error al procesar mensaje:`, err.message);
        }
      });

    } catch (err) {
      console.error(`[WA Agent ${this.botType}] Error fatal:`, err.message);
      this.botStatus = 'disconnected';
      this.emitStatus({ error: err.message });
    }
  }

  async ejecutarFuncion(name, args) {
    if (name === 'obtenerInventario') {
      const data = await getInventarioDb();
      return { inventario: data };
    }
    if (name === 'actualizarStock') {
      const res = await updateStockDb(args.id, args.nuevoStock);
      if (res.changes > 0) {
        this.io.to('admin').emit('producto_actualizado', { id: args.id, stock: Math.max(0, parseInt(args.nuevoStock)) });
      }
      return { success: res.changes > 0, id: args.id, nuevoStock: args.nuevoStock };
    }
    if (name === 'ajustarStock') {
      const res = await adjustStockDb(args.id, args.cantidad);
      if (res.changes > 0) {
        this.io.to('admin').emit('producto_actualizado', { id: args.id, stock: res.nuevoStock });
      }
      return { success: res.changes > 0, id: args.id, nuevoStock: res.nuevoStock, nombre: res.nombre, error: res.error };
    }
    return { error: `Función desconocida: ${name}` };
  }

  async procesarMensajeEntrante(message) {
    const remoteJid = message.key.remoteJid;
    const isGroup = remoteJid.endsWith('@g.us');
    if (isGroup) return;

    const imageMsg = message.message?.imageMessage;
    const audioMsg = message.message?.audioMessage;
    const textMsg = message.message?.conversation || message.message?.extendedTextMessage?.text;

    let body = textMsg || (imageMsg ? imageMsg.caption : '');
    let isMedia = !!(imageMsg || audioMsg);
    let mediaPart = null;

    if (isMedia) {
      try {
        console.log(`[WA Agent ${this.botType}] Descargando multimedia...`);
        const buffer = await downloadMediaMessage(
          message, 'buffer', {},
          { logger: pino({ level: 'silent' }) }
        );
        const mimeType = imageMsg ? imageMsg.mimetype : audioMsg.mimetype;
        mediaPart = { inlineData: { data: buffer.toString('base64'), mimeType } };
      } catch (err) {
        console.error(`[WA Agent ${this.botType}] Error descargando media:`, err.message);
        this.emitMessage({ type: 'error', sender: 'Sistema', text: 'Error procesando imagen o audio.', time: new Date().toLocaleTimeString() });
      }
    }

    if (!body && !mediaPart) return;

    const senderNumber = remoteJid.split('@')[0];
    
    // --- Seguridad Admin ---
    if (this.botType === 'admin') {
      const adminNumbersStr = await getConfig('admin_whatsapp_numbers') || '';
      const authorizedNumbers = adminNumbersStr.split(',').map(n => n.trim().replace('+', '')).filter(Boolean);
      
      const isAuthorized = authorizedNumbers.some(n => senderNumber.endsWith(n) || n.endsWith(senderNumber));
      
      if (!isAuthorized) {
        console.log(`[WA Agent admin] Mensaje ignorado. Número NO autorizado: ${senderNumber}`);
        return;
      }
    }

    this.emitMessage({ type: 'in', sender: senderNumber, text: body || '[Imagen/Audio]', time: new Date().toLocaleTimeString() });

    if (this.botType === 'client') {
      const paused = await isChatPaused(senderNumber);
      if (paused) {
        console.log(`[WA Agent client] Chat en pausa para ${senderNumber}. Ignorando IA.`);
        return;
      }

      // --- VALIDACIÓN AUTOMÁTICA DE HORARIOS ---
      const horarioActivo = await getConfig('bot_horario_activo') === '1';
      const mensajeAusencia = await getConfig('bot_mensaje_ausencia') || '¡Hola! Gracias por contactarte con Puro Sabor. 🍖 Te informamos que iniciaremos atención este próximo Sábado a partir de las 6:00 de la tarde.';
      
      let estaAbierto = true;
      if (horarioActivo) {
        estaAbierto = await isWithinBusinessHours();
      }

      if (!estaAbierto) {
        console.log(`[WA Agent client] Bot cerrado. Enviando mensaje de ausencia.`);
        await this.client.sendMessage(remoteJid, { text: mensajeAusencia }, { quoted: message });
        await guardarMensajeHistorial(senderNumber, 'model', mensajeAusencia, this.botType);
        this.emitMessage({ type: 'out', sender: 'Bot IA (Ausencia)', text: mensajeAusencia, time: new Date().toLocaleTimeString() });
        
        // Registrar analítica
        await logChatbotInteraction(senderNumber, message.pushName || 'Cliente', 'cierre_automatico', body, mensajeAusencia);
        return;
      }
    }

    let systemInstruction = '';
    let tools = [];

    if (this.botType === 'admin') {
      tools = [{
        functionDeclarations: [
          {
            name: 'obtenerInventario',
            description: 'Obtiene el inventario completo.',
            parameters: { type: SchemaType.OBJECT, properties: {}, required: [] }
          },
          {
            name: 'actualizarStock',
            description: 'Actualiza el stock exacto de un producto por ID.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                id: { type: SchemaType.INTEGER, description: 'ID del producto' },
                nuevoStock: { type: SchemaType.INTEGER, description: 'Nuevo stock exacto' }
              },
              required: ['id', 'nuevoStock']
            }
          },
          {
            name: 'ajustarStock',
            description: "Suma o resta stock a un producto.",
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                id: { type: SchemaType.INTEGER, description: 'ID del producto' },
                cantidad: { type: SchemaType.INTEGER, description: 'Cantidad a sumar (+) o restar (-)' }
              },
              required: ['id', 'cantidad']
            }
          }
        ]
      }];

      systemInstruction =
        'Eres Puro Sabor IA, asistente administrativo.\n' +
        'Ayudas al administrador a consultar y actualizar inventario.\n' +
        'REGLA: Confirma nombre y nuevo stock exacto al actualizar.';
    } else {
      const dominio = await getConfig('dominio_base') || 'https://restaurantepurosabor.com';
      const menuUrl = await getConfig('bot_menu_url') || dominio;
      const customPrompt = await getConfig('bot_system_prompt') || '';
      
      // A. Consultar Cliente Frecuente
      const clienteFrecuente = await new Promise(resolve => {
        db.get(
          `SELECT cf.nombre, cf.visitas_count, ch.productos_favoritos, ch.notas_admin 
           FROM clientes_frecuentes cf 
           LEFT JOIN cliente_historial ch ON cf.telefono = ch.telefono 
           WHERE cf.telefono = ? OR ? LIKE '%' || cf.telefono`, 
          [senderNumber, senderNumber], 
          (err, row) => resolve(row)
        );
      });

      let ruleSaludo = '';
      if (clienteFrecuente) {
        // Incrementar visitas
        db.run('UPDATE clientes_frecuentes SET visitas_count = visitas_count + 1, ultima_visita = CURRENT_TIMESTAMP WHERE telefono = ?', [senderNumber]);
        
        const favs = clienteFrecuente.productos_favoritos ? JSON.parse(clienteFrecuente.productos_favoritos) : [];
        const favsText = favs.length > 0 ? ` Sus platos favoritos son: ${favs.join(', ')}.` : '';
        const notasText = clienteFrecuente.notas_admin ? ` Notas y preferencias del cliente: ${clienteFrecuente.notas_admin}.` : '';
        
        ruleSaludo = `REGLA CLIENTE FRECUENTE: El cliente actual es un CLIENTE FRECUENTE llamado "${clienteFrecuente.nombre}" (tiene ${clienteFrecuente.visitas_count} visitas previas). Salúdalo afectuosamente por su nombre de manera familiar y cálida al inicio del chat.${favsText}${notasText}\n`;
      } else {
        ruleSaludo = `REGLA CLIENTE NUEVO: Este es un cliente nuevo. Salúdalo amablemente de forma general sin asumir su nombre.\n`;
      }

      // B. Cargar Promociones Activas
      const promos = await new Promise(resolve => {
        db.all(
          `SELECT id, titulo, descripcion, imagen_url 
           FROM promociones 
           WHERE activa = 1 
             AND (fecha_inicio IS NULL OR fecha_inicio <= CURRENT_TIMESTAMP)
             AND (fecha_fin IS NULL OR fecha_fin >= CURRENT_TIMESTAMP)
           ORDER BY orden ASC`,
          [],
          (err, rows) => resolve(rows || [])
        );
      });
      
      let promosText = '';
      if (promos.length > 0) {
        promosText = '\nPROMOCIONES ACTIVAS DEL RESTAURANTE:\n' + promos.map(p => {
          let line = `- [PROMO_ID:${p.id}] ${p.titulo}: ${p.descripcion}`;
          if (p.imagen_url) {
            line += ` (Tiene imagen publicitaria asociada)`;
          }
          return line;
        }).join('\n') + '\n';
      }

      // C. Cargar Instrucciones Adicionales de Contexto
      const ctxRules = await new Promise(resolve => {
        db.all('SELECT tipo, contenido FROM bot_contexto WHERE activo = 1', [], (err, rows) => resolve(rows || []));
      });
      let ctxText = '';
      if (ctxRules.length > 0) {
        ctxText = '\nREGLAS DE CONTEXTO ADICIONALES:\n' + ctxRules.map(r => `[${r.tipo.toUpperCase()}]: ${r.contenido}`).join('\n') + '\n';
      }

      const kb = await getKnowledgeBase();
      let kbText = '';
      if (kb.length > 0) {
        kbText = '\nBASE DE CONOCIMIENTO (Aprende de aquí):\n' + kb.map(k => `[ID:${k.id}] Q: ${k.pregunta}\nA: ${k.respuesta}`).join('\n') + '\n';
      }

      systemInstruction = 
        'Eres el recepcionista oficial de Puro Sabor.\n' +
        (customPrompt ? `${customPrompt}\n` : '') +
        ruleSaludo +
        'ESTADO: ABIERTO.\n' +
        'REGLA 2: Para realizar pedidos, ver el menú completo o consultar precios, entrega siempre el enlace de nuestro menú digital: 👉 ' + menuUrl + '. Explica al cliente que toda la plataforma de pedidos está allí para que ordene de forma rápida y segura. No intentes tomar el pedido directamente en este chat.\n' +
        'REGLA 3 (HANDOFF): Si el cliente pide hablar con un humano, asesor, o pregunta algo que no sabes (no está en la Base de Conocimiento ni en las Promociones), responde ÚNICAMENTE con la palabra exacta: [HUMAN_HANDOFF]. No añadas ningún otro texto.\n' +
        'REGLA 4 (PROMOCIONES): Si respondes sobre una promoción que tiene imagen publicitaria asociada, DEBES incluir al final exacto de tu respuesta la etiqueta: [SEND_PROMO:id] (por ejemplo, [SEND_PROMO:1]) para que el sistema le envíe la imagen.\n' +
        'REGLA 5 (MULTIMEDIA): Si respondes basándote en una entrada de la BASE DE CONOCIMIENTO que tiene un [ID:x], DEBES incluir al final de tu respuesta la etiqueta exacta [SEND_MEDIA:x].\n' +
        promosText +
        ctxText +
        kbText;
    }

    if (body) await guardarMensajeHistorial(senderNumber, 'user', body, this.botType);

    const apiKey = await getConfig('gemini_api_key') || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      if (this.botType === 'admin') {
        await this.client.sendMessage(remoteJid, { text: '🚨 Error: API Key no configurada.' }, { quoted: message });
      }
      return;
    }

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const historialPrevio = await obtenerHistorial(senderNumber, this.botType, 15);
      const historialGemini = historialPrevio.map(h => ({
        role: h.rol === 'user' ? 'user' : 'model',
        parts: [{ text: h.contenido }]
      }));

      const modelConfig = { model: 'gemini-2.5-flash', systemInstruction };
      if (tools && tools.length > 0) modelConfig.tools = tools;
      const model = genAI.getGenerativeModel(modelConfig);

      const chat = model.startChat({ history: historialGemini });

      let contentParts = [];
      if (mediaPart) contentParts.push(mediaPart);
      if (body) contentParts.push(body);

      this.emitMessage({ type: 'system', sender: 'Sistema', text: '🤖 Procesando...', time: new Date().toLocaleTimeString() });

      let result = await chat.sendMessage(contentParts);
      let iteraciones = 0;

      while (iteraciones < 5) {
        iteraciones++;
        const response = result.response;
        const functionCalls = response.functionCalls();

        if (!functionCalls || functionCalls.length === 0) {
          const finalText = response.text();
          
          if (finalText.trim().includes('[HUMAN_HANDOFF]')) {
            await pauseChat(senderNumber, message.pushName || 'Cliente', body);
            const handoffMsg = 'Un momento por favor, te estoy transfiriendo con un asesor humano. 🧑‍💼';
            await this.client.sendMessage(remoteJid, { text: handoffMsg }, { quoted: message });
            await guardarMensajeHistorial(senderNumber, 'model', handoffMsg, this.botType);
            this.emitMessage({ type: 'out', sender: 'Bot IA (Handoff)', text: handoffMsg, time: new Date().toLocaleTimeString() });
            
            // Guardar analítica
            await logChatbotInteraction(senderNumber, message.pushName || 'Cliente', 'handoff', body, handoffMsg);

            // Notify admin via Admin Bot
            const adminNumbersStr = await getConfig('admin_whatsapp_numbers') || '';
            const authorizedNumbers = adminNumbersStr.split(',').map(n => n.trim().replace('+', '')).filter(Boolean);
            const adminBot = bots.admin?.client;
            if (adminBot) {
              const alertMsg = `🚨 *Asistencia Requerida*\nEl cliente ${senderNumber} necesita ayuda.\nÚltimo mensaje: "${body}"\n\nIngresa al panel web para responderle.`;
              for (const adminNum of authorizedNumbers) {
                try {
                  await adminBot.sendMessage(`${adminNum}@s.whatsapp.net`, { text: alertMsg });
                } catch(e){}
              }
            }
            this.io.emit('whatsapp_handoff_requested');
            break;
          }

          let cleanText = finalText;

          // A. Evaluar si tiene etiqueta de Promoción
          let promoIdMatch = finalText.match(/\[SEND_PROMO:(\d+)\]/);
          if (promoIdMatch) {
            cleanText = finalText.replace(/\[SEND_PROMO:\d+\]/g, '').trim();
            const promoId = promoIdMatch[1];
            
            const promoEntry = await new Promise(resolve => {
              db.get('SELECT imagen_url, imagen_tipo FROM promociones WHERE id = ?', [promoId], (err, row) => resolve(row));
            });

            if (promoEntry && promoEntry.imagen_url) {
              const absolutePath = require('path').join(__dirname, '..', promoEntry.imagen_url);
              if (require('fs').existsSync(absolutePath)) {
                let mediaPayload = {};
                if (promoEntry.imagen_tipo === 'video') mediaPayload = { video: { url: absolutePath }, caption: cleanText };
                else if (promoEntry.imagen_tipo === 'pdf') mediaPayload = { document: { url: absolutePath }, caption: cleanText };
                else mediaPayload = { image: { url: absolutePath }, caption: cleanText };
                
                await this.client.sendMessage(remoteJid, mediaPayload, { quoted: message });
                await guardarMensajeHistorial(senderNumber, 'model', cleanText || '(Promoción enviada)', this.botType);
                this.emitMessage({ type: 'out', sender: 'Bot IA', text: cleanText || '(Promoción enviada)', time: new Date().toLocaleTimeString() });
                
                // Guardar analítica
                await logChatbotInteraction(senderNumber, message.pushName || 'Cliente', 'promo_enviada', body, cleanText, { promo_id: promoId });
                break;
              }
            }
          }
          
          // B. Evaluar si tiene etiqueta de Base de Conocimientos (Fase 3)
          let mediaIdMatch = finalText.match(/\[SEND_MEDIA:(\d+)\]/);
          if (mediaIdMatch) {
            cleanText = finalText.replace(/\[SEND_MEDIA:\d+\]/g, '').trim();
            const kbId = mediaIdMatch[1];
            
            // Buscar media_url en DB
            const kbEntry = await new Promise(resolve => {
              db.get('SELECT media_url, media_type FROM chatbots_kb WHERE id = ?', [kbId], (err, row) => resolve(row));
            });

            if (kbEntry && kbEntry.media_url) {
              const absolutePath = require('path').join(__dirname, '..', kbEntry.media_url);
              if (require('fs').existsSync(absolutePath)) {
                let mediaPayload = {};
                if (kbEntry.media_type === 'video') mediaPayload = { video: { url: absolutePath }, caption: cleanText };
                else if (kbEntry.media_type === 'audio') mediaPayload = { audio: { url: absolutePath }, ptt: true };
                else mediaPayload = { image: { url: absolutePath }, caption: cleanText };
                
                await this.client.sendMessage(remoteJid, mediaPayload, { quoted: message });
                if (kbEntry.media_type === 'audio' && cleanText) {
                  await this.client.sendMessage(remoteJid, { text: cleanText });
                }
                await guardarMensajeHistorial(senderNumber, 'model', cleanText || '(Multimedia enviado)', this.botType);
                this.emitMessage({ type: 'out', sender: 'Bot IA', text: cleanText || '(Multimedia enviado)', time: new Date().toLocaleTimeString() });
                
                // Guardar analítica
                await logChatbotInteraction(senderNumber, message.pushName || 'Cliente', 'respuesta_kb', body, cleanText, { kb_id: kbId });
                break;
              }
            }
          }

          // C. Enviar respuesta de texto estándar
          await this.client.sendMessage(remoteJid, { text: cleanText }, { quoted: message });
          await guardarMensajeHistorial(senderNumber, 'model', cleanText, this.botType);
          this.emitMessage({ type: 'out', sender: 'Bot IA', text: cleanText, time: new Date().toLocaleTimeString() });

          // Guardar analítica
          const isFreq = await new Promise(resolve => {
            db.get('SELECT telefono FROM clientes_frecuentes WHERE telefono = ?', [senderNumber], (err, row) => resolve(!!row));
          });
          const logType = isFreq ? 'saludo_frecuente' : 'saludo_nuevo';
          await logChatbotInteraction(senderNumber, message.pushName || 'Cliente', logType, body, cleanText);
          break;
        }

        const toolResponseParts = [];
        for (const call of functionCalls) {
          const functionResult = await this.ejecutarFuncion(call.name, call.args);
          toolResponseParts.push({
            functionResponse: { name: call.name, response: { output: functionResult } }
          });
        }
        result = await chat.sendMessage(toolResponseParts);
      }

    } catch (err) {
      console.error(`[WA Agent ${this.botType}] Error Gemini:`, err.message);
      if (this.botType === 'admin') {
        await this.client.sendMessage(remoteJid, { text: `⚠️ Error IA: ${err.message}` }, { quoted: message });
      }
    }
  }

  async logout() {
    console.log(`[WA Agent ${this.botType}] Cerrando sesión...`);
    if (this.client) {
      try { await this.client.logout(); } catch (e) {}
    }
    try {
      await this.clearSupabaseAuth();
      await this.releaseLockDB();
    } catch (e) {}
    this.botStatus = 'disconnected';
    this.emitStatus({ error: 'Sesión cerrada.' });
    setTimeout(() => this.inicializarWhatsApp(), 2000);
  }
}

const bots = {};

module.exports = {
  getBot: (type, io) => {
    if (!bots[type]) {
      bots[type] = new WhatsAppBot(type, io);
    }
    return bots[type];
  },
  inicializarTodos: async (io) => {
    const clientBot = module.exports.getBot('client', io);
    const adminBot = module.exports.getBot('admin', io);
    await Promise.all([
      clientBot.inicializarWhatsApp(),
      adminBot.inicializarWhatsApp()
    ]);
  },
  guardarMensajeHistorial,
  notificarPedidoMesaAdmin: async (mesaNumero, items, total) => {
    const adminBot = bots.admin?.client;
    if (!adminBot) return;
    
    const getConfig = require('./configService').getConfig;
    const adminNumbersStr = await getConfig('admin_whatsapp_numbers') || '';
    const authorizedNumbers = adminNumbersStr.split(',').map(n => n.trim().replace('+', '')).filter(Boolean);
    
    let itemsTexto = items.map(i => `- ${i.cantidad}x ${i.nombre}`).join('\n');
    const msg = `🍔 *¡Nuevo Pedido! (Mesa ${mesaNumero})*\n\n${itemsTexto}\n\n*Total:* $${total}`;
    
    for (const adminNum of authorizedNumbers) {
      try {
        await adminBot.sendMessage(`${adminNum}@s.whatsapp.net`, { text: msg });
      } catch(e){}
    }
  }
};
