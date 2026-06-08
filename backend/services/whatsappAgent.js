const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const { GoogleGenerativeAI, Type } = require('@google/generative-ai');
const db = require('../config/database');
const fs = require('fs');
const path = require('path');

let client = null;
let botStatus = 'disconnected'; // disabled, disconnected, loading, qr, ready
let latestQrDataUrl = null;
const authFolder = path.join(__dirname, '../../baileys_auth_info');

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

// Inicialización de WhatsApp usando Baileys
async function inicializarWhatsApp(io) {
  if (client) {
    console.log('[WA Agent] Cerrando instancia previa de WhatsApp...');
    try {
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
    return;
  }

  console.log('[WA Agent] Iniciando cliente de WhatsApp con Baileys...');
  botStatus = 'loading';
  latestQrDataUrl = null;
  io.to('admin').emit('whatsapp_status', { status: botStatus });

  try {
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    client = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }), // Ocultar los logs ruidosos de baileys
      browser: ['PuroSabor AI', 'Chrome', '1.0.0']
    });

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
          // El usuario cerró sesión en su celular
          fs.rmSync(authFolder, { recursive: true, force: true });
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
async function procesarMensajeEntrante(message, sock, io) {
  const remoteJid = message.key.remoteJid;
  const isGroup = remoteJid.endsWith('@g.us');
  if (isGroup) return; // Solo procesamos chats directos

  // Extraer el cuerpo de texto del mensaje
  const body = message.message?.conversation || message.message?.extendedTextMessage?.text;
  if (!body) return;

  const senderNumber = remoteJid.split('@')[0];
  const whitelistStr = await getConfig('whatsapp_whitelist');
  
  if (!whitelistStr) return;

  const whitelist = whitelistStr.split(',').map(num => num.trim().replace('+', ''));
  const isAuthorized = whitelist.some(num => senderNumber.endsWith(num) || num.endsWith(senderNumber));

  if (!isAuthorized) {
    console.log(`[WA Agent] Mensaje ignorado de no autorizado: ${senderNumber}`);
    return;
  }

  console.log(`[WA Agent] Mensaje de admin (${senderNumber}): "${body}"`);

  const apiKey = await getConfig('gemini_api_key') || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[WA Agent] Falta la API Key de Gemini.');
    await sock.sendMessage(remoteJid, { text: '🚨 Error: No hay API Key de Gemini configurada en el panel administrativo.' }, { quoted: message });
    return;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);

    const obtenerInventarioDeclaration = {
      name: "obtenerInventario",
      description: "Obtiene todo el inventario de productos actual, incluyendo sus IDs, nombres, categoría, precio y stock disponible.",
      parameters: { type: Type.OBJECT, properties: {}, required: [] }
    };

    const actualizarStockDeclaration = {
      name: "actualizarStock",
      description: "Establece el stock físico de un producto mediante su ID a un nuevo valor exacto.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.INTEGER, description: "El ID único del producto." },
          nuevoStock: { type: Type.INTEGER, description: "Nueva cantidad exacta de stock disponible." }
        },
        required: ["id", "nuevoStock"]
      }
    };

    const ajustarStockDeclaration = {
      name: "ajustarStock",
      description: "Aumenta o disminuye el stock de un producto específico sumando o restando una cantidad. Úsalo para 'llegaron 10' o 'resta 5'.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.INTEGER, description: "El ID único del producto." },
          cantidad: { type: Type.INTEGER, description: "Cantidad a sumar (positivo) o restar (negativo)." }
        },
        required: ["id", "cantidad"]
      }
    };

    const systemInstruction = 
      "Eres Puro Sabor IA, el asistente administrativo de inventario del restaurante Puro Sabor.\n" +
      "Tu propósito es ayudar al administrador a consultar y actualizar el inventario de productos y bebidas a través de WhatsApp.\n" +
      "Responde siempre en español, de forma muy concisa, profesional y directa al grano.\n" +
      "Si actualizas o consultas stock, confirma los cambios explícitamente mencionando el producto.\n" +
      "Para buscar productos, usa primero obtenerInventario para obtener los IDs precisos.\n" +
      "Usa ajustarStock o actualizarStock pasando los IDs correctos.";

    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: systemInstruction,
      tools: [{
        functionDeclarations: [ obtenerInventarioDeclaration, actualizarStockDeclaration, ajustarStockDeclaration ]
      }]
    });

    const chat = model.startChat();
    const result = await chat.sendMessage(body);
    const response = result.response;

    const functionCalls = response.getFunctionCalls();
    if (functionCalls && functionCalls.length > 0) {
      console.log(`[WA Agent] Gemini solicitó ejecutar ${functionCalls.length} función(es).`);
      const toolResponses = [];

      for (const call of functionCalls) {
        const { name, args } = call;
        let functionResult = null;

        try {
          if (name === "obtenerInventario") {
            const data = await getInventarioDb();
            functionResult = { inventario: data };
          } else if (name === "actualizarStock") {
            const res = await updateStockDb(args.id, args.nuevoStock);
            if (res.changes > 0) {
              io.to('admin').emit('producto_actualizado', { id: args.id, stock: Math.max(0, parseInt(args.nuevoStock)) });
            }
            functionResult = { success: res.changes > 0, id: args.id, nuevoStock: args.nuevoStock };
          } else if (name === "ajustarStock") {
            const res = await adjustStockDb(args.id, args.cantidad);
            if (res.changes > 0) {
              io.to('admin').emit('producto_actualizado', { id: args.id, stock: res.nuevoStock });
            }
            functionResult = { success: res.changes > 0, id: args.id, nuevoStock: res.nuevoStock, error: res.error };
          }
        } catch (dbErr) {
          functionResult = { success: false, error: dbErr.message };
        }

        toolResponses.push({
          functionResponse: { name, response: functionResult }
        });
      }

      const finalResult = await chat.sendMessage(toolResponses);
      await sock.sendMessage(remoteJid, { text: finalResult.response.text() }, { quoted: message });
    } else {
      await sock.sendMessage(remoteJid, { text: response.text() }, { quoted: message });
    }

  } catch (geminiErr) {
    console.error('[WA Agent] Error con Google Gemini:', geminiErr.message);
    await sock.sendMessage(remoteJid, { text: `⚠️ Ocurrió un error con el motor de IA: ${geminiErr.message}` }, { quoted: message });
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
      fs.rmSync(authFolder, { recursive: true, force: true });
    } catch (e) {}
    botStatus = 'disconnected';
    io.to('admin').emit('whatsapp_status', { status: botStatus, error: 'Sesión cerrada exitosamente.' });
    
    // Reiniciamos después de 2 segundos para generar QR de nuevo
    setTimeout(() => inicializarWhatsApp(io), 2000);
  }
};
