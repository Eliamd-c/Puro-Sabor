const { makeWASocket, DisconnectReason, Browsers, downloadMediaMessage, proto, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const db = require('../config/database');
const { Pool } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

// Pool directo a Supabase para operaciones de auth (evita conflictos con el adaptador principal)
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

let client = null;
let botStatus = 'disconnected'; // disabled, disconnected, loading, qr, ready
let latestQrDataUrl = null;

// Evitar múltiples intentos de reconexión paralelos
let isReconnecting = false;

// ─── Adaptador de Auth en Supabase ───────────────────────────────────────────
// Reemplaza useMultiFileAuthState (que usa /tmp) por una versión que usa la BD.
async function useSupabaseAuthState() {
  async function readData(key) {
    try {
      const res = await pgPool.query('SELECT value FROM wa_auth WHERE key = $1', [key]);
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
      [key, serialized]
    );
  }

  async function removeData(key) {
    await pgPool.query('DELETE FROM wa_auth WHERE key = $1', [key]);
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

// ─── Lock distribuido en Supabase ────────────────────────────────────────────
// Reemplaza el lock de archivo en /tmp por uno en la base de datos.
const LOCK_KEY = 'whatsapp_lock_pid';
const LOCK_TTL_MS = 30000; // 30 segundos sin renovar = lock muerto

async function tryAcquireLockDB() {
  const myPid = process.pid.toString();
  const now = new Date();
  const expiry = new Date(now.getTime() - LOCK_TTL_MS);

  // Intentar leer el lock actual
  const res = await pgPool.query('SELECT value, updated_at FROM wa_auth WHERE key = $1', [LOCK_KEY]);

  if (res.rows.length > 0) {
    const lockPid = res.rows[0].value;
    const lockTime = new Date(res.rows[0].updated_at);

    // Si el lock es nuestro o está expirado, lo tomamos
    if (lockPid !== myPid && lockTime > expiry) {
      return false; // Otro proceso activo tiene el lock
    }
  }

  // Tomar/renovar el lock
  await pgPool.query(
    `INSERT INTO wa_auth (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [LOCK_KEY, myPid]
  );
  return true;
}

async function releaseLockDB() {
  await pgPool.query('DELETE FROM wa_auth WHERE key = $1', [LOCK_KEY]);
}

async function clearSupabaseAuth() {
  await pgPool.query("DELETE FROM wa_auth WHERE key != $1", [LOCK_KEY]);
}

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

// (Lock de archivo eliminado — reemplazado por tryAcquireLockDB() basado en Supabase)

// Inicialización de WhatsApp usando Baileys con Auth en Supabase
async function inicializarWhatsApp(io) {
  if (isReconnecting) return;

  try {
    const hasLock = await tryAcquireLockDB();
    if (!hasLock) {
      console.log('[WA Agent] 🔒 Otro proceso ya tiene el control de WhatsApp en Supabase. Ignorando.');
      return;
    }
  } catch (err) {
    console.error('[WA Agent] Error verificando lock en Supabase:', err.message);
    return;
  }

  isReconnecting = true;

  if (client) {
    console.log('[WA Agent] Cerrando instancia previa de WhatsApp...');
    try {
      client.ev.removeAllListeners('connection.update');
      client.end(undefined);
    } catch (e) {}
    client = null;
  }

  const active = await getConfig('whatsapp_bot_active');
  if (active === '0') {
    console.log('[WA Agent] El agente de WhatsApp está desactivado en la configuración.');
    botStatus = 'disabled';
    latestQrDataUrl = null;
    io.to('admin').emit('whatsapp_status', { status: botStatus });
    isReconnecting = false;
    await releaseLockDB();
    return;
  }

  console.log('[WA Agent] Iniciando cliente de WhatsApp con Baileys (Auth en Supabase)...');
  botStatus = 'loading';
  latestQrDataUrl = null;
  io.to('admin').emit('whatsapp_status', { status: botStatus });

  try {
    const { state, saveCreds } = await useSupabaseAuthState();

    client = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: Browsers.macOS('Desktop'),
      syncFullHistory: false
    });

    isReconnecting = false;

    client.ev.on('creds.update', saveCreds);

    client.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('[WA Agent] QR recibido.');
        botStatus = 'qr';
        try {
          latestQrDataUrl = await qrcode.toDataURL(qr);
          io.to('admin').emit('whatsapp_status', { status: botStatus, qr: latestQrDataUrl });
        } catch (err) {
          console.error('[WA Agent] Error generando QR:', err);
        }
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log('[WA Agent] Conexión cerrada. Reconectar:', shouldReconnect);
        
        if (statusCode === DisconnectReason.loggedOut) {
          // El usuario cerró sesión en su celular — borrar credenciales de Supabase
          try {
            await clearSupabaseAuth();
            console.log('[WA Agent] Sesión cerrada remotamente. Auth limpiada de Supabase.');
          } catch(e) {
            console.error('[WA Agent] Error limpiando auth tras logout remoto:', e.message);
          }
        }

        botStatus = 'disconnected';
        latestQrDataUrl = null;
        io.to('admin').emit('whatsapp_status', { status: botStatus, error: lastDisconnect?.error?.message });
        
        if (shouldReconnect) {
          setTimeout(() => inicializarWhatsApp(io), 3000);
        }
      } else if (connection === 'open') {
        console.log('[WA Agent] Cliente de WhatsApp conectado y listo.');
        botStatus = 'ready';
        latestQrDataUrl = null;
        io.to('admin').emit('whatsapp_status', { status: botStatus });
      }
    });

    client.ev.on('messages.upsert', async (m) => {
      if (m.type !== 'notify') return;
      const message = m.messages[0];
      
      // Ignorar mensajes enviados por el propio bot
      if (message.key.fromMe) return;

      // --- DEBUG PARA EL FRONTEND ---
      const sender = message.key.remoteJid;
      io.to('admin').emit('whatsapp_message', { 
        type: 'error', 
        sender: 'DEBUG-SYSTEM', 
        text: `Recibido paquete de WA de: ${sender}. Procesando...`,
        time: new Date().toLocaleTimeString()
      });

      try {
        await procesarMensajeEntrante(message, client, io);
      } catch (err) {
        console.error('[WA Agent] Error al procesar mensaje:', err.message);
      }
    });

  } catch (err) {
    console.error('[WA Agent] Error fatal inicializando Baileys:', err.message);
    botStatus = 'disconnected';
    io.to('admin').emit('whatsapp_status', { status: botStatus, error: err.message });
  }
}

// Procesar mensajes entrantes con Gemini
// ─── Helpers de historial de conversación ────────────────────────────────────

function guardarMensajeHistorial(numero, rol, contenido) {
  return new Promise((resolve) => {
    db.run(
      'INSERT INTO wa_conversaciones (numero_telefono, rol, contenido) VALUES (?, ?, ?)',
      [numero, rol, contenido],
      (err) => {
        if (err) console.error('[WA Agent] Error guardando historial:', err.message);
        resolve();
      }
    );
  });
}

function obtenerHistorial(numero, limite = 15) {
  return new Promise((resolve) => {
    db.all(
      `SELECT rol, contenido FROM wa_conversaciones 
       WHERE numero_telefono = ? 
       ORDER BY creado_en DESC LIMIT ?`,
      [numero, limite],
      (err, rows) => {
        if (err) {
          console.error('[WA Agent] Error leyendo historial:', err.message);
          resolve([]);
        } else {
          // Revertir el orden para que el más antiguo quede primero
          resolve((rows || []).reverse());
        }
      }
    );
  });
}

// ─── Ejecutar llamada de función de Gemini ────────────────────────────────────

async function ejecutarFuncion(name, args, io) {
  if (name === 'obtenerInventario') {
    const data = await getInventarioDb();
    return { inventario: data };
  }
  if (name === 'actualizarStock') {
    const res = await updateStockDb(args.id, args.nuevoStock);
    if (res.changes > 0) {
      io.to('admin').emit('producto_actualizado', { id: args.id, stock: Math.max(0, parseInt(args.nuevoStock)) });
    }
    return { success: res.changes > 0, id: args.id, nuevoStock: args.nuevoStock };
  }
  if (name === 'ajustarStock') {
    const res = await adjustStockDb(args.id, args.cantidad);
    if (res.changes > 0) {
      io.to('admin').emit('producto_actualizado', { id: args.id, stock: res.nuevoStock });
    }
    return { success: res.changes > 0, id: args.id, nuevoStock: res.nuevoStock, nombre: res.nombre, error: res.error };
  }
  return { error: `Función desconocida: ${name}` };
}

// ─── Procesador principal de mensajes entrantes ───────────────────────────────

async function procesarMensajeEntrante(message, sock, io) {
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
      console.log('[WA Agent] Descargando archivo multimedia adjunto...');
      const buffer = await downloadMediaMessage(
        message, 'buffer', {},
        { logger: pino({ level: 'silent' }) }
      );
      const mimeType = imageMsg ? imageMsg.mimetype : audioMsg.mimetype;
      mediaPart = { inlineData: { data: buffer.toString('base64'), mimeType } };
      console.log(`[WA Agent] Media descargada: ${mimeType}`);
    } catch (err) {
      console.error('[WA Agent] Error descargando media:', err.message);
      io.to('admin').emit('whatsapp_message', { type: 'error', sender: 'Sistema', text: 'Error procesando imagen o audio.', time: new Date().toLocaleTimeString() });
    }
  }

  if (!body && !mediaPart) {
    io.to('admin').emit('whatsapp_message', { type: 'error', sender: 'DEBUG', text: 'El mensaje no tiene cuerpo de texto ni multimedia legible.', time: new Date().toLocaleTimeString() });
    return;
  }

  const senderNumber = remoteJid.split('@')[0];
  const whitelistStr = await getConfig('whatsapp_whitelist');

  if (!whitelistStr) {
    io.to('admin').emit('whatsapp_message', { type: 'error', sender: 'DEBUG', text: 'La lista blanca está vacía en BD.', time: new Date().toLocaleTimeString() });
    return;
  }

  const whitelist = whitelistStr.split(',').map(n => n.trim().replace('+', ''));
  const isAuthorized = whitelist.some(n => senderNumber.endsWith(n) || n.endsWith(senderNumber));

  // Lógica "Cerebro Doble" (Admin vs Cliente)
  let systemInstruction = '';
  let tools = [];

  if (isAuthorized) {
    console.log(`[WA Agent] Mensaje de ADMIN (${senderNumber}): "${body}"`);
    io.to('admin').emit('whatsapp_message', { type: 'in', sender: `Admin (${senderNumber})`, text: body || '[Imagen/Audio]', time: new Date().toLocaleTimeString() });

    // Herramientas de Admin
    tools = [{
      functionDeclarations: [
        {
          name: 'obtenerInventario',
          description: 'Obtiene todo el inventario de productos actual con sus IDs, nombres, categoría, precio y stock.',
          parameters: { type: SchemaType.OBJECT, properties: {}, required: [] }
        },
        {
          name: 'actualizarStock',
          description: 'Establece el stock de un producto a un valor exacto usando su ID.',
          parameters: {
            type: SchemaType.OBJECT,
            properties: {
              id: { type: SchemaType.INTEGER, description: 'ID único del producto.' },
              nuevoStock: { type: SchemaType.INTEGER, description: 'Nueva cantidad exacta de stock.' }
            },
            required: ['id', 'nuevoStock']
          }
        },
        {
          name: 'ajustarStock',
          description: "Suma o resta stock a un producto. Úsalo para 'llegaron 10' (cantidad positiva) o 'se usaron 5' (cantidad negativa).",
          parameters: {
            type: SchemaType.OBJECT,
            properties: {
              id: { type: SchemaType.INTEGER, description: 'ID único del producto.' },
              cantidad: { type: SchemaType.INTEGER, description: 'Cantidad a sumar (+) o restar (-).' }
            },
            required: ['id', 'cantidad']
          }
        }
      ]
    }];

    systemInstruction =
      'Eres Puro Sabor IA, el asistente administrativo de inventario del restaurante Puro Sabor.\n' +
      'Tu propósito es ayudar al administrador a consultar y actualizar el inventario a través de WhatsApp.\n' +
      'Puedes recibir texto e imágenes.\n' +
      'Responde siempre en español, de forma concisa, profesional y directa.\n' +
      'REGLA OBLIGATORIA: Cuando actualices o ajustes el stock, SIEMPRE confirma la operación indicando el nombre del producto y la cantidad exacta resultante.\n' +
      'Para encontrar un producto, usa primero obtenerInventario para obtener los IDs correctos antes de modificar.';

  } else {
    console.log(`[WA Agent] Mensaje de CLIENTE (${senderNumber}): "${body}"`);
    io.to('admin').emit('whatsapp_message', { type: 'in', sender: `Cliente (${senderNumber})`, text: body || '[Imagen/Audio]', time: new Date().toLocaleTimeString() });

    const dominio = await getConfig('dominio_base') || 'https://restaurantepurosabor.com';
    const horarioActivo = await getConfig('bot_horario_activo') === '1';
    const mensajeAusencia = await getConfig('bot_mensaje_ausencia') || 'Iniciamos atención el sábado desde las 6 pm.';

    systemInstruction = 
      'Eres el asistente virtual y recepcionista oficial de Puro Sabor.\n' +
      'Atiendes a los clientes de manera MUY amable, cordial y rápida.\n' +
      `ESTADO ACTUAL DEL RESTAURANTE: ${horarioActivo ? 'ABIERTO' : 'CERRADO'}.\n` +
      (!horarioActivo ? `REGLA ESTRICTA 1: El restaurante está cerrado. En tu primera respuesta de la conversación, DEBES mencionar la siguiente información exacta: "${mensajeAusencia}".\n` : '') +
      'REGLA ESTRICTA 2: Si el cliente te pide el menú, ver los platos, o hacer un pedido, DEBES entregarle este enlace directo al menú web interactivo: 👉 ' + dominio + '\n' +
      'Instruye al cliente que puede armar su pedido agregando productos al carrito dentro de esa misma página web y luego enviarlo por aquí.\n' +
      'No inventes precios ni platos que no conozcas. Tu principal objetivo es enviar a los clientes a la página del menú para que hagan el pedido allá.';
  }

  // Guardar mensaje del usuario en el historial
  if (body) await guardarMensajeHistorial(senderNumber, 'user', body);

  const apiKey = await getConfig('gemini_api_key') || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    if (isAuthorized) await sock.sendMessage(remoteJid, { text: '🚨 Error: No hay API Key de Gemini configurada.' }, { quoted: message });
    return;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);

    // ─── Recuperar historial y construir contexto deslizante ─────────────────
    const historialPrevio = await obtenerHistorial(senderNumber, 15);
    const historialGemini = historialPrevio.map(h => ({
      role: h.rol === 'user' ? 'user' : 'model',
      parts: [{ text: h.contenido }]
    }));

    const modelConfig = {
      model: 'gemini-2.5-flash',
      systemInstruction
    };
    if (tools && tools.length > 0) {
      modelConfig.tools = tools;
    }
    const model = genAI.getGenerativeModel(modelConfig);

    const chat = model.startChat({ history: historialGemini });

    // ─── Mensaje inicial con soporte multimedia ───────────────────────────────
    let contentParts = [];
    if (mediaPart) contentParts.push(mediaPart);
    if (body) contentParts.push(body);

    // Emitir estado al administrador
    io.to('admin').emit('whatsapp_message', { 
      type: 'system', 
      sender: 'Sistema', 
      text: '🤖 Bot está analizando y respondiendo...', 
      time: new Date().toLocaleTimeString() 
    });

    let result = await chat.sendMessage(contentParts);

    // ─── Bucle de Function Calling (Gemini 2.5 while-loop pattern) ───────────
    let iteraciones = 0;
    const MAX_ITERACIONES = 5;

    while (iteraciones < MAX_ITERACIONES) {
      iteraciones++;
      const response = result.response;
      const functionCalls = response.functionCalls();

      if (!functionCalls || functionCalls.length === 0) {
        // Respuesta final de texto
        const finalText = response.text();
        await sock.sendMessage(remoteJid, { text: finalText }, { quoted: message });
        await guardarMensajeHistorial(senderNumber, 'model', finalText);
        io.to('admin').emit('whatsapp_message', { type: 'out', sender: 'Bot IA', text: finalText, time: new Date().toLocaleTimeString() });
        break;
      }

      console.log(`[WA Agent] Gemini solicitó ${functionCalls.length} función(es). Iteración ${iteraciones}`);

      // Ejecutar todas las funciones pedidas y armar las respuestas
      const toolResponseParts = [];
      for (const call of functionCalls) {
        const functionResult = await ejecutarFuncion(call.name, call.args, io);
        console.log(`[WA Agent] Función "${call.name}" ejecutada. Resultado:`, JSON.stringify(functionResult).slice(0, 120));
        toolResponseParts.push({
          functionResponse: {
            name: call.name,
            response: { output: functionResult }
          }
        });
      }

      // Enviar respuestas de funciones de vuelta a Gemini
      result = await chat.sendMessage(toolResponseParts);
    }

    if (iteraciones >= MAX_ITERACIONES) {
      console.warn('[WA Agent] Se alcanzó el límite de iteraciones del bucle de funciones.');
      await sock.sendMessage(remoteJid, { text: '⚠️ La IA tardó demasiado en procesar tu solicitud. Por favor, inténtalo de nuevo.' }, { quoted: message });
    }

  } catch (geminiErr) {
    console.error('[WA Agent] Error con Google Gemini:', geminiErr.message);
    const errorText = `⚠️ Ocurrió un error con el motor de IA: ${geminiErr.message}`;
    await sock.sendMessage(remoteJid, { text: errorText }, { quoted: message });
    io.to('admin').emit('whatsapp_message', { type: 'error', sender: 'Sistema', text: errorText, time: new Date().toLocaleTimeString() });
  }
}



module.exports = {
  inicializarWhatsApp,
  getBotStatus: () => botStatus,
  getLatestQr: () => latestQrDataUrl,
  reloadConfig: async (io) => {
    console.log('[WA Agent] Recargando configuración y reiniciando bot...');
    await inicializarWhatsApp(io);
  },
  logoutWhatsApp: async (io) => {
    console.log('[WA Agent] Cerrando sesión y borrando credenciales...');
    if (client) {
      try {
        await client.logout();
      } catch (e) {
        console.error('[WA Agent] Error al hacer logout:', e.message);
      }
    }
    try {
      await clearSupabaseAuth();
      await releaseLockDB();
      console.log('[WA Agent] Credenciales eliminadas de Supabase.');
    } catch (e) {
      console.error('[WA Agent] Error limpiando auth en Supabase:', e.message);
    }
    botStatus = 'disconnected';
    io.to('admin').emit('whatsapp_status', { status: botStatus, error: 'Sesión cerrada exitosamente.' });

    // Reiniciamos después de 2 segundos para generar QR de nuevo
    setTimeout(() => inicializarWhatsApp(io), 2000);
  }
};
