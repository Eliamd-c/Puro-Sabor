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
        console.log(`[WA Agent ${this.botType}] 🔒 Otro proceso ya tiene el control. Ignorando.`);
        return;
      }
    } catch (err) {
      console.error(`[WA Agent ${this.botType}] Error verificando lock:`, err.message);
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
          console.log(`[WA Agent ${this.botType}] Conexión cerrada. Reconectar:`, shouldReconnect);
          
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
      const horarioActivo = await getConfig('bot_horario_activo') === '1';
      const mensajeAusencia = await getConfig('bot_mensaje_ausencia') || 'Iniciamos atención el sábado desde las 6 pm.';

      systemInstruction = 
        'Eres el recepcionista oficial de Puro Sabor.\n' +
        `ESTADO: ${horarioActivo ? 'ABIERTO' : 'CERRADO'}.\n` +
        (!horarioActivo ? `REGLA 1: Debes mencionar: "${mensajeAusencia}".\n` : '') +
        'REGLA 2: Si piden menú, precios o hacer pedido, entrega siempre este link: 👉 ' + dominio + '\n' +
        'Diles a los clientes que armen su pedido tocando el botón de carrito en ese enlace.';
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
          await this.client.sendMessage(remoteJid, { text: finalText }, { quoted: message });
          await guardarMensajeHistorial(senderNumber, 'model', finalText, this.botType);
          this.emitMessage({ type: 'out', sender: 'Bot IA', text: finalText, time: new Date().toLocaleTimeString() });
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
  }
};
