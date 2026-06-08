const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { GoogleGenerativeAI, Type } = require('@google/generative-ai');
const db = require('../config/database');
const { exec } = require('child_process');

let client = null;
let botStatus = 'disconnected'; // disabled, disconnected, loading, qr, authenticated, ready
let latestQrDataUrl = null;

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

function downloadChromeIfMissing() {
  return new Promise((resolve, reject) => {
    console.log('[WA Agent] Verificando/Instalando navegador Chrome para Puppeteer...');
    // Ejecutar la instalación del navegador compatible con Puppeteer
    exec('npx puppeteer browsers install chrome', (error, stdout, stderr) => {
      if (error) {
        console.error('[WA Agent] Error al verificar/descargar Chrome:', error.message);
        reject(error);
      } else {
        console.log('[WA Agent] Verificación de Chrome completada:', stdout.trim());
        resolve(stdout);
      }
    });
  });
}

// Inicialización de WhatsApp
async function inicializarWhatsApp(io) {
  // Destruir cliente existente si hay uno
  if (client) {
    console.log('[WA Agent] Cerrando instancia previa de WhatsApp...');
    try {
      await client.destroy();
    } catch (e) {
      console.error('[WA Agent] Error al destruir cliente previo:', e.message);
    }
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

  console.log('[WA Agent] Iniciando cliente de WhatsApp...');
  botStatus = 'loading';
  latestQrDataUrl = null;
  io.to('admin').emit('whatsapp_status', { status: botStatus });

  // Asegurar que Chrome esté descargado (crítico para Hostinger)
  try {
    await downloadChromeIfMissing();
  } catch (err) {
    console.warn('[WA Agent] Advertencia al descargar Chrome, continuando por si ya existe:', err.message);
  }

  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process'
      ],
      headless: true
    }
  });

  client.on('qr', async (qr) => {
    console.log('[WA Agent] QR recibido.');
    botStatus = 'qr';
    try {
      latestQrDataUrl = await qrcode.toDataURL(qr);
      io.to('admin').emit('whatsapp_status', { status: botStatus, qr: latestQrDataUrl });
    } catch (err) {
      console.error('[WA Agent] Error generando QR Data URL:', err);
    }
  });

  client.on('authenticated', () => {
    console.log('[WA Agent] Cliente autenticado.');
    botStatus = 'authenticated';
    latestQrDataUrl = null;
    io.to('admin').emit('whatsapp_status', { status: botStatus });
  });

  client.on('auth_failure', (msg) => {
    console.error('[WA Agent] Falló autenticación de WhatsApp:', msg);
    botStatus = 'disconnected';
    latestQrDataUrl = null;
    io.to('admin').emit('whatsapp_status', { status: botStatus, error: msg });
  });

  client.on('ready', () => {
    console.log('[WA Agent] Cliente de WhatsApp listo y escuchando.');
    botStatus = 'ready';
    latestQrDataUrl = null;
    io.to('admin').emit('whatsapp_status', { status: botStatus });
  });

  client.on('disconnected', (reason) => {
    console.log('[WA Agent] Cliente desconectado de WhatsApp:', reason);
    botStatus = 'disconnected';
    latestQrDataUrl = null;
    io.to('admin').emit('whatsapp_status', { status: botStatus });
  });

  client.on('message', async (message) => {
    try {
      await procesarMensajeEntrante(message, io);
    } catch (err) {
      console.error('[WA Agent] Error al procesar mensaje:', err.message);
    }
  });

  try {
    await client.initialize();
  } catch (err) {
    console.error('[WA Agent] Error inicializando cliente de WhatsApp:', err.message);
    botStatus = 'disconnected';
    io.to('admin').emit('whatsapp_status', { status: botStatus, error: err.message });
  }
}

// Procesar mensajes entrantes con Gemini y Function Calling
async function procesarMensajeEntrante(message, io) {
  // Solo procesar chats individuales de texto por simplicidad
  if (message.body === undefined || message.isGroup) return;

  const senderNumber = message.from.split('@')[0];
  const whitelistStr = await getConfig('whatsapp_whitelist');
  
  if (!whitelistStr) {
    console.log('[WA Agent] Sin números autorizados configurados. Mensaje ignorado.');
    return;
  }

  const whitelist = whitelistStr.split(',').map(num => num.trim().replace('+', ''));
  const isAuthorized = whitelist.some(num => senderNumber.endsWith(num) || num.endsWith(senderNumber));

  if (!isAuthorized) {
    console.log(`[WA Agent] Mensaje ignorado del número no autorizado: ${senderNumber}`);
    return;
  }

  console.log(`[WA Agent] Mensaje recibido de admin (${senderNumber}): "${message.body}"`);

  const apiKey = await getConfig('gemini_api_key') || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[WA Agent] No se puede procesar mensaje: Falta la API Key de Gemini.');
    await message.reply('🚨 Error: No hay API Key de Gemini configurada. Por favor, configúrala en el Dashboard de Inventario.');
    return;
  }

  try {
    // Inicializar Gemini
    const genAI = new GoogleGenerativeAI(apiKey);

    // Definición de las funciones disponibles para Gemini
    const obtenerInventarioDeclaration = {
      name: "obtenerInventario",
      description: "Obtiene todo el inventario de productos actual, incluyendo sus IDs, nombres, categoría, precio y stock disponible.",
      parameters: {
        type: Type.OBJECT,
        properties: {},
        required: []
      }
    };

    const actualizarStockDeclaration = {
      name: "actualizarStock",
      description: "Establece el stock (cantidad física) de un producto específico mediante su ID a un nuevo valor exacto.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          id: {
            type: Type.INTEGER,
            description: "El ID único del producto en el inventario."
          },
          nuevoStock: {
            type: Type.INTEGER,
            description: "La nueva cantidad exacta de stock disponible en inventario."
          }
        },
        required: ["id", "nuevoStock"]
      }
    };

    const ajustarStockDeclaration = {
      name: "ajustarStock",
      description: "Aumenta o disminuye el stock de un producto específico mediante su ID sumando o restando una cantidad (delta). Úsalo cuando te digan expresiones como 'llegaron 10 más' (cantidad: 10) o 'resta 5 de stock' (cantidad: -5).",
      parameters: {
        type: Type.OBJECT,
        properties: {
          id: {
            type: Type.INTEGER,
            description: "El ID único del producto."
          },
          cantidad: {
            type: Type.INTEGER,
            description: "La cantidad a sumar (positivo) o restar (negativo) al stock actual."
          }
        },
        required: ["id", "cantidad"]
      }
    };

    const systemInstruction = 
      "Eres Puro Sabor IA, el asistente administrativo de inventario del restaurante Puro Sabor.\n" +
      "Tu propósito es ayudar al administrador a consultar y actualizar el inventario de productos y bebidas a través de WhatsApp.\n" +
      "Responde siempre en español, de forma muy concisa, profesional y directa al grano.\n" +
      "Si actualizas o consultas stock, confirma los cambios realizados de manera explícita indicando el producto y su cantidad final.\n" +
      "Si el usuario pide hacer algo que requiera buscar información, primero usa obtenerInventario para saber los IDs de los productos correspondientes.\n" +
      "Si el usuario te dice por ejemplo 'agrega 10 a las migas de pollo' o 'llegaron 5 cocacolas', localiza el producto correcto en el inventario por su ID y usa ajustarStock o actualizarStock.";

    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: systemInstruction,
      tools: [{
        functionDeclarations: [
          obtenerInventarioDeclaration,
          actualizarStockDeclaration,
          ajustarStockDeclaration
        ]
      }]
    });

    const chat = model.startChat();
    const result = await chat.sendMessage(message.body);
    const response = result.response;

    // Verificar si el modelo solicitó llamar a alguna función
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
            console.log('[WA Agent] Función obtenerInventario ejecutada correctamente.');
          } else if (name === "actualizarStock") {
            const res = await updateStockDb(args.id, args.nuevoStock);
            if (res.changes > 0) {
              io.to('admin').emit('producto_actualizado', { id: args.id, stock: Math.max(0, parseInt(args.nuevoStock)) });
            }
            functionResult = { success: res.changes > 0, id: args.id, nuevoStock: args.nuevoStock };
            console.log(`[WA Agent] Función actualizarStock ejecutada para ID ${args.id} (nuevoStock: ${args.nuevoStock}).`);
          } else if (name === "ajustarStock") {
            const res = await adjustStockDb(args.id, args.cantidad);
            if (res.changes > 0) {
              io.to('admin').emit('producto_actualizado', { id: args.id, stock: res.nuevoStock });
            }
            functionResult = { success: res.changes > 0, id: args.id, nuevoStock: res.nuevoStock, error: res.error };
            console.log(`[WA Agent] Función ajustarStock ejecutada para ID ${args.id} (delta: ${args.cantidad}, nuevoStock: ${res.nuevoStock}).`);
          }
        } catch (dbErr) {
          console.error(`[WA Agent] Error en DB al ejecutar función ${name}:`, dbErr.message);
          functionResult = { success: false, error: dbErr.message };
        }

        toolResponses.push({
          functionResponse: {
            name,
            response: functionResult
          }
        });
      }

      // Enviar de vuelta las respuestas de las funciones para que Gemini formule la respuesta final
      const finalResult = await chat.sendMessage(toolResponses);
      await message.reply(finalResult.response.text());
    } else {
      // Respuesta directa en texto
      await message.reply(response.text());
    }

  } catch (geminiErr) {
    console.error('[WA Agent] Error con Google Gemini:', geminiErr.message);
    await message.reply(`⚠️ Ocurrió un error con el motor de IA (Gemini): ${geminiErr.message}`);
  }
}

module.exports = {
  inicializarWhatsApp,
  getBotStatus: () => botStatus,
  getLatestQr: () => latestQrDataUrl,
  reloadConfig: async (io) => {
    console.log('[WA Agent] Recargando configuración y reiniciando bot...');
    await inicializarWhatsApp(io);
  }
};
