const { makeWASocket, DisconnectReason, Browsers, downloadMediaMessage, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const db = require('../config/database');
const dbAsync = require('../config/database-promise');
const { Pool } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: true }
    : { rejectUnauthorized: false },
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

// ── Rate limiting en memoria (10 msg/min por número) ───────────
const _rateLimits = new Map();
const RATE_MAX = 10, RATE_WINDOW = 60_000;
function checkRateLimit(num) {
  const now = Date.now();
  let entry = _rateLimits.get(num);
  if (!entry || now > entry.reset) { _rateLimits.set(num, { count: 1, reset: now + RATE_WINDOW }); return true; }
  if (entry.count >= RATE_MAX) return false;
  entry.count++;
  return true;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of _rateLimits) if (now > v.reset + RATE_WINDOW) _rateLimits.delete(k); }, 3_600_000);

// ── Límites de tamaño de media ──────────────────────────────────
const MAX_MEDIA = { image: 5 * 1024 * 1024, audio: 10 * 1024 * 1024, default: 5 * 1024 * 1024 };

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
  return new Promise(async (resolve, reject) => {
    try {
      const res = await pgPool.query(
        `SELECT p.id, p.nombre, c.nombre as categoria, p.precio, p.stock, p.tiene_variantes,
          (SELECT json_agg(json_build_object('id', v.id, 'nombre', v.nombre, 'stock', v.stock))
           FROM producto_variantes v WHERE v.producto_id = p.id) as variantes
         FROM productos p 
         JOIN categorias c ON p.categoria_id = c.id 
         WHERE p.activo = 1`
      );
      resolve(res.rows);
    } catch (err) {
      reject(err);
    }
  });
}

function updateStockDb(id, nombre, nuevoStock, es_variante = false) {
  return new Promise((resolve, reject) => {
    const stockLimpio = Math.max(0, parseInt(nuevoStock) || 0);
    let query = '';
    let params = [];
    
    const tabla = es_variante ? 'producto_variantes' : 'productos';

    if (id) {
      query = `UPDATE ${tabla} SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
      params = [stockLimpio, id];
    } else if (nombre) {
      query = `UPDATE ${tabla} SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE nombre ILIKE ?`;
      params = [stockLimpio, `%${nombre}%`];
    } else {
      return reject(new Error('Se requiere id o nombre'));
    }
    
    db.run(query, params, function(err) {
      if (err) reject(err);
      else resolve({ changes: this.changes });
    });
  });
}

function adjustStockDb(id, nombre, delta, es_variante = false) {
  return new Promise((resolve, reject) => {
    let selectQuery = '';
    let selectParams = [];
    const tabla = es_variante ? 'producto_variantes' : 'productos';

    if (id) {
      selectQuery = `SELECT id, stock, nombre FROM ${tabla} WHERE id = ?`;
      selectParams = [id];
    } else if (nombre) {
      selectQuery = `SELECT id, stock, nombre FROM ${tabla} WHERE nombre ILIKE ? LIMIT 1`;
      selectParams = [`%${nombre}%`];
    } else {
      return reject(new Error('Se requiere id o nombre'));
    }

    db.get(selectQuery, selectParams, (err, row) => {
      if (err) return reject(err);
      if (!row) return resolve({ changes: 0, error: 'Producto o variante no encontrado' });
      
      const nuevoStock = Math.max(0, row.stock + (parseInt(delta) || 0));
      db.run(
        `UPDATE ${tabla} SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [nuevoStock, row.id],
        function(err) {
          if (err) reject(err);
          else resolve({ changes: this.changes, id: row.id, nuevoStock, nombre: row.nombre, es_variante });
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
    // Forzar que el campo 'time' enviado al Monitor sea la hora local de Colombia (UTC-5)
    try {
      const now = new Date();
      const colombiaTime = new Date(now.getTime() - (5 * 60 * 60 * 1000));
      const hours = colombiaTime.getUTCHours();
      const minutes = colombiaTime.getUTCMinutes().toString().padStart(2, '0');
      const seconds = colombiaTime.getUTCSeconds().toString().padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      data.time = `${displayHours}:${minutes}:${seconds} ${ampm}`;
    } catch (e) {
      console.error('[WA Agent] Error al formatear la hora del mensaje para el monitor:', e);
    }
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
      const res = await updateStockDb(args.id, args.nombre, args.nuevoStock, args.es_variante);
      if (res.changes > 0) {
        this.io.to('admin').emit('producto_actualizado', { id: args.id, stock: Math.max(0, parseInt(args.nuevoStock)), es_variante: args.es_variante });
      }
      return { success: true, cambios: res.changes, notas: 'Se avisó al dashboard por web sockets' };
    }
    if (name === 'ajustarStock') {
      const res = await adjustStockDb(args.id, args.nombre, args.cantidad, args.es_variante);
      if (res.changes > 0) {
        this.io.to('admin').emit('producto_actualizado', { id: res.id, stock: res.nuevoStock, es_variante: res.es_variante });
      }
      return { success: true, ...res };
    }
    // NUEVAS FUNCIONES PARA IA ADMIN
    if (name === 'crearProducto') {
      try {
        const cat = await dbAsync.get('SELECT id FROM categorias WHERE nombre LIKE ? LIMIT 1', [`%${args.categoria}%`]);
        const catId = cat ? cat.id : 1;
        const res = await dbAsync.run(
          `INSERT INTO productos (nombre, precio, descripcion, categoria_id, stock, activo) VALUES (?, ?, ?, ?, ?, 1)`,
          [args.nombre, args.precio, args.descripcion || '', catId, args.stock || 0]
        );
        return { success: true, message: `Producto creado con id ${res.lastID}` };
      } catch (err) { return { error: err.message }; }
    }
    if (name === 'editarProducto') {
      try {
        let updates = [];
        let params = [];
        if (args.precio) { updates.push('precio = ?'); params.push(args.precio); }
        if (args.stock !== undefined) { updates.push('stock = ?'); params.push(args.stock); }
        if (args.activo !== undefined) { updates.push('activo = ?'); params.push(args.activo); }
        if (updates.length === 0) return { error: 'Nada que actualizar' };
        params.push(args.id);
        const res = await dbAsync.run(`UPDATE productos SET ${updates.join(', ')} WHERE id = ?`, params);
        return { success: true, changes: res.changes };
      } catch (err) { return { error: err.message }; }
    }
    if (name === 'obtenerVentasHoy') {
      try {
        // Ventas reales desde pedidos pagados
        const ventas = await dbAsync.get(
          `SELECT COUNT(*) as total_pedidos, COALESCE(SUM(total), 0) as ingresos
           FROM pedidos WHERE estado = 'pagado' AND DATE(creado_en) = CURRENT_DATE`
        );
        // Gastos registrados en caja
        const gastos = await dbAsync.get(
          `SELECT COALESCE(SUM(monto), 0) as gastos FROM caja_registros
           WHERE tipo = 'gasto' AND DATE(fecha) = CURRENT_DATE`
        );
        const ingresos = parseFloat(ventas?.ingresos || 0);
        const totalGastos = parseFloat(gastos?.gastos || 0);
        return {
          hoy: {
            total_pedidos: parseInt(ventas?.total_pedidos || 0),
            ingresos,
            gastos: totalGastos,
            balance: ingresos - totalGastos
          }
        };
      } catch (err) { return { error: err.message }; }
    }
    if (name === 'registrarGasto') {
      try {
        const res = await dbAsync.run(
          `INSERT INTO caja_registros (tipo, descripcion, monto, categoria, creado_por) VALUES ('gasto', ?, ?, ?, 'whatsapp_bot')`,
          [args.descripcion, args.monto, args.categoria || 'General']
        );
        return { success: true, message: 'Gasto registrado', id: res.lastID };
      } catch (err) { return { error: err.message }; }
    }
    if (name === 'obtenerInsumos') {
      try {
        const rows = await dbAsync.all('SELECT * FROM insumos ORDER BY categoria, nombre');
        return { insumos: rows };
      } catch (err) { return { error: err.message }; }
    }
    if (name === 'actualizarInsumo') {
      try {
        let query = '';
        let params = [];
        if (args.id) {
          query = 'UPDATE insumos SET cantidad = ? WHERE id = ?';
          params = [args.nueva_cantidad, args.id];
        } else if (args.nombre) {
          query = 'UPDATE insumos SET cantidad = ? WHERE nombre ILIKE ?';
          params = [args.nueva_cantidad, `%${args.nombre}%`];
        } else {
          return { error: 'Se requiere id o nombre del insumo' };
        }
        const res = await dbAsync.run(query, params);
        return { success: true, changes: res.changes };
      } catch (err) { return { error: err.message }; }
    }
    if (name === 'crearInsumo') {
      try {
        const res = await dbAsync.run(
          `INSERT INTO insumos (nombre, categoria, cantidad, unidad, stock_minimo) VALUES (?, ?, ?, ?, ?)`,
          [args.nombre, args.categoria || 'General', args.cantidad || 0, args.unidad || 'unidades', args.stock_minimo || 0]
        );
        return { success: true, id: res.lastID };
      } catch (err) { return { error: err.message }; }
    }
    if (name === 'registrarCompraInsumo') {
      try {
        const { insumo_id, cantidad_comprada, costo_total } = args;
        const costo_unitario = costo_total / cantidad_comprada;
        
        // 1. Obtener insumo actual
        const insumo = await dbAsync.get('SELECT cantidad, costo_promedio FROM insumos WHERE id = ?', [insumo_id]);
        if (!insumo) return { error: `No existe el insumo con ID ${insumo_id}` };
        
        // 2. Calcular nuevo costo promedio ponderado
        const cant_actual = parseFloat(insumo.cantidad || 0);
        const costo_prom_actual = parseFloat(insumo.costo_promedio || 0);
        const valor_inventario_actual = cant_actual * costo_prom_actual;
        
        const nueva_cant = cant_actual + cantidad_comprada;
        const nuevo_costo_promedio = nueva_cant > 0 ? (valor_inventario_actual + costo_total) / nueva_cant : 0;
        
        // 3. Actualizar insumo
        await dbAsync.run(
          'UPDATE insumos SET cantidad = ?, costo_promedio = ? WHERE id = ?',
          [nueva_cant, nuevo_costo_promedio, insumo_id]
        );
        
        // 4. Registrar en historial de compras
        await dbAsync.run(
          'INSERT INTO compras_insumos (insumo_id, cantidad, costo_total, costo_unitario) VALUES (?, ?, ?, ?)',
          [insumo_id, cantidad_comprada, costo_total, costo_unitario]
        );
        
        // 5. Registrar gasto en la caja diaria
        await dbAsync.run(
          `INSERT INTO caja_registros (tipo, descripcion, monto, categoria, creado_por) VALUES ('gasto', ?, ?, 'Insumos', 'whatsapp_bot')`,
          [`Compra insumo #${insumo_id} cant: ${cantidad_comprada}`, costo_total]
        );
        
        return { success: true, nuevo_stock: nueva_cant, nuevo_costo_promedio };
      } catch (err) { return { error: err.message }; }
    }
    
    if (name === 'costearProducto') {
      try {
        const producto = await dbAsync.get('SELECT nombre, precio FROM productos WHERE id = ?', [args.producto_id]);
        if (!producto) return { error: `Producto no encontrado` };
        
        const recetas = await dbAsync.all(
          `SELECT r.cantidad_usada, i.nombre, i.costo_promedio 
           FROM recetas r JOIN insumos i ON r.insumo_id = i.id 
           WHERE r.producto_id = ?`,
          [args.producto_id]
        );
        
        let costo_materia_prima = 0;
        recetas.forEach(r => {
          costo_materia_prima += (r.cantidad_usada * (r.costo_promedio || 0));
        });
        
        // Asumimos el costo fijo operativo de ventas ($3.824 por ejemplo, o lo dejamos como variable)
        const costo_fijo_estimado = 3824; 
        const costo_total = costo_materia_prima + costo_fijo_estimado;
        const ganancia = producto.precio - costo_total;
        
        return { 
          producto: producto.nombre, 
          precio_venta: producto.precio,
          desglose: recetas.map(r => `${r.cantidad_usada} de ${r.nombre} a $${r.costo_promedio} c/u`),
          costo_materia_prima,
          costo_fijo_estimado,
          costo_total,
          ganancia_neta: ganancia,
          rentabilidad_porcentaje: (ganancia / producto.precio) * 100
        };
      } catch (err) { return { error: err.message }; }
    }

    if (name === 'consultarVentas') {
      try {
        const periodo = args.periodo || 'hoy'; // hoy | ayer | semana | mes
        let condicion = '';
        if (periodo === 'hoy')    condicion = "DATE(creado_en) = CURRENT_DATE";
        else if (periodo === 'ayer')   condicion = "DATE(creado_en) = CURRENT_DATE - INTERVAL '1 day'";
        else if (periodo === 'semana') condicion = "creado_en >= CURRENT_DATE - INTERVAL '7 days'";
        else if (periodo === 'mes')    condicion = "creado_en >= CURRENT_DATE - INTERVAL '30 days'";
        else condicion = "DATE(creado_en) = CURRENT_DATE";

        const resumen = await dbAsync.get(
          `SELECT COUNT(*) as total_pedidos,
                  COALESCE(SUM(total), 0) as ingresos_brutos,
                  COUNT(CASE WHEN tipo_pedido='local' THEN 1 END) as pedidos_local,
                  COUNT(CASE WHEN tipo_pedido='domicilio' THEN 1 END) as pedidos_domicilio,
                  AVG(total) as ticket_promedio
           FROM pedidos WHERE estado = 'pagado' AND ${condicion}`
        );
        const gastos = await dbAsync.get(
          `SELECT COALESCE(SUM(monto), 0) as total_gastos FROM caja_registros
           WHERE tipo = 'gasto' AND ${condicion.replace('creado_en', 'fecha')}`
        );
        const ingresos = parseFloat(resumen?.ingresos_brutos || 0);
        const totalGastos = parseFloat(gastos?.total_gastos || 0);
        return {
          periodo,
          total_pedidos: parseInt(resumen?.total_pedidos || 0),
          ingresos_brutos: ingresos,
          gastos: totalGastos,
          ganancia_estimada: ingresos - totalGastos,
          pedidos_local: parseInt(resumen?.pedidos_local || 0),
          pedidos_domicilio: parseInt(resumen?.pedidos_domicilio || 0),
          ticket_promedio: Math.round(parseFloat(resumen?.ticket_promedio || 0))
        };
      } catch (err) { return { error: err.message }; }
    }

    if (name === 'pedidosActivos') {
      try {
        const activos = await dbAsync.all(
          `SELECT id, estado, mesa_numero, nombre_cliente, total, tipo_pedido,
                  creado_en,
                  EXTRACT(EPOCH FROM (NOW() - creado_en))/60 as minutos_transcurridos
           FROM pedidos WHERE estado IN ('pendiente','preparando')
           ORDER BY creado_en ASC`
        );
        return {
          total: activos.length,
          pedidos: activos.map(p => ({
            id: p.id,
            estado: p.estado,
            mesa: p.mesa_numero > 0 ? `Mesa ${p.mesa_numero}` : 'Para llevar',
            cliente: p.nombre_cliente || 'Sin nombre',
            total: parseFloat(p.total),
            tipo: p.tipo_pedido,
            minutos: Math.round(parseFloat(p.minutos_transcurridos || 0)),
            alerta: parseFloat(p.minutos_transcurridos || 0) > 20 ? '⚠️ DEMORADO' : '✅'
          }))
        };
      } catch (err) { return { error: err.message }; }
    }

    if (name === 'topProductos') {
      try {
        const periodo = args.periodo || 'hoy';
        let condicion = '';
        if (periodo === 'hoy')    condicion = "DATE(p.creado_en) = CURRENT_DATE";
        else if (periodo === 'semana') condicion = "p.creado_en >= CURRENT_DATE - INTERVAL '7 days'";
        else if (periodo === 'mes')    condicion = "p.creado_en >= CURRENT_DATE - INTERVAL '30 days'";
        else condicion = "DATE(p.creado_en) = CURRENT_DATE";

        // Aplanamos el JSON de items en la app layer (PostgreSQL no tiene json_each fácil sin extensión)
        const pedidos = await dbAsync.all(
          `SELECT items_json FROM pedidos WHERE estado = 'pagado' AND ${condicion}`
        );
        const conteo = {};
        for (const p of pedidos) {
          try {
            const items = JSON.parse(p.items_json || '[]');
            for (const it of items) {
              if (!conteo[it.nombre]) conteo[it.nombre] = { nombre: it.nombre, cantidad: 0, ingresos: 0 };
              conteo[it.nombre].cantidad += it.cantidad;
              conteo[it.nombre].ingresos += it.cantidad * parseFloat(it.precio);
            }
          } catch (_) {}
        }
        const top = Object.values(conteo).sort((a, b) => b.cantidad - a.cantidad).slice(0, 10);
        return { periodo, top_productos: top };
      } catch (err) { return { error: err.message }; }
    }

    if (name === 'ventasPorAuxiliar') {
      try {
        const periodo = args.periodo || 'hoy';
        let condicion = period => {
          if (periodo === 'hoy')    return "DATE(creado_en) = CURRENT_DATE";
          if (periodo === 'semana') return "creado_en >= CURRENT_DATE - INTERVAL '7 days'";
          if (periodo === 'mes')    return "creado_en >= CURRENT_DATE - INTERVAL '30 days'";
          return "DATE(creado_en) = CURRENT_DATE";
        };
        const rows = await dbAsync.all(
          `SELECT creado_por, COUNT(*) as total_pedidos, COALESCE(SUM(total),0) as total_ventas
           FROM pedidos WHERE estado = 'pagado' AND ${condicion(periodo)}
           GROUP BY creado_por ORDER BY total_ventas DESC`
        );
        return {
          periodo,
          por_auxiliar: rows.map(r => ({
            auxiliar: r.creado_por || 'Sin registrar',
            pedidos: parseInt(r.total_pedidos),
            ventas: parseFloat(r.total_ventas)
          }))
        };
      } catch (err) { return { error: err.message }; }
    }

    if (name === 'marcarProductoAgotado') {
      try {
        let res;
        if (args.id) {
          res = await dbAsync.run('UPDATE productos SET activo = 0, stock = 0 WHERE id = ?', [args.id]);
        } else if (args.nombre) {
          res = await dbAsync.run('UPDATE productos SET activo = 0, stock = 0 WHERE nombre ILIKE ?', [`%${args.nombre}%`]);
        } else {
          return { error: 'Se requiere id o nombre del producto' };
        }
        if (res.changes > 0) this.io.to('admin').emit('producto_actualizado', { id: args.id, stock: 0, activo: 0 });
        return { success: true, changes: res.changes, mensaje: 'Producto marcado como agotado y desactivado' };
      } catch (err) { return { error: err.message }; }
    }

    if (name === 'cambiarPrecio') {
      try {
        let res;
        const nuevoPrecio = parseFloat(args.nuevo_precio);
        if (isNaN(nuevoPrecio) || nuevoPrecio < 0) return { error: 'Precio inválido' };
        if (args.id) {
          res = await dbAsync.run('UPDATE productos SET precio = ? WHERE id = ?', [nuevoPrecio, args.id]);
        } else if (args.nombre) {
          res = await dbAsync.run('UPDATE productos SET precio = ? WHERE nombre ILIKE ?', [nuevoPrecio, `%${args.nombre}%`]);
        } else {
          return { error: 'Se requiere id o nombre del producto' };
        }
        return { success: true, changes: res.changes, nuevo_precio: nuevoPrecio };
      } catch (err) { return { error: err.message }; }
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
        const mediaType = imageMsg ? 'image' : 'audio';
        const fileSize = imageMsg?.fileLength || audioMsg?.fileLength || 0;
        const maxSize = MAX_MEDIA[mediaType] || MAX_MEDIA.default;
        if (fileSize > maxSize) {
          const msg = `❌ Archivo muy grande (${(fileSize/1024/1024).toFixed(1)}MB). Máx: ${(maxSize/1024/1024).toFixed(0)}MB`;
          await this.client.sendMessage(remoteJid, { text: msg }, { quoted: message });
          return;
        }
        console.log(`[WA Agent ${this.botType}] Descargando ${mediaType} (${(fileSize/1024).toFixed(0)}KB)...`);
        const buffer = await downloadMediaMessage(message, 'buffer', {}, { logger: pino({ level: 'silent' }) });
        if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('Buffer vacío');
        const mimeType = imageMsg ? imageMsg.mimetype : audioMsg.mimetype;
        mediaPart = { inlineData: { data: buffer.toString('base64'), mimeType } };
      } catch (err) {
        console.error(`[WA Agent ${this.botType}] Error descargando media:`, err.message);
        this.emitMessage({ type: 'error', sender: 'Sistema', text: 'Error procesando imagen o audio.', time: new Date().toLocaleTimeString() });
      }
    }

    if (!body && !mediaPart) return;

    const senderNumber = remoteJid.split('@')[0];

    // --- Seguridad Admin: match EXACTO ---
    if (this.botType === 'admin') {
      const adminNumbersStr = await getConfig('admin_whatsapp_numbers') || '';
      const authorizedNumbers = adminNumbersStr.split(',').map(n => n.trim().replace(/^\+/, '')).filter(Boolean);
      if (!authorizedNumbers.includes(senderNumber)) {
        console.log(`[WA Agent admin] Acceso denegado: ${senderNumber}`);
        return;
      }
    }

    // --- Rate limiting (solo clientes) ---
    if (this.botType === 'client' && !checkRateLimit(senderNumber)) {
      await this.client.sendMessage(remoteJid, { text: 'Estás escribiendo muy rápido. Espera un momento e intenta de nuevo.' }, { quoted: message });
      return;
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

      // --- INTERCEPTAR PEDIDO ENVIADO DESDE LA APLICACIÓN ---
      const isOrderSummary = body && (
        body.includes('Quiero hacer un pedido') && 
        (body.includes('Total') || body.includes('▪') || body.includes('•') || body.includes('x '))
      );

      if (isOrderSummary) {
        console.log(`[WA Agent client] Interceptado resumen de pedido de ${senderNumber}. Iniciando handoff humano.`);
        
        const orderConfirmMsg = '¡Hola! Hemos recibido el detalle de tu pedido correctamente. 📝\n\nUn asesor humano revisará los datos en este instante para confirmar tu pedido, dirección/mesa y método de pago para enviarlo a la cocina de inmediato. ¡Muchas gracias por tu compra! 🍖';
        
        // 1. Enviar mensaje de confirmación al cliente
        await this.client.sendMessage(remoteJid, { text: orderConfirmMsg }, { quoted: message });
        
        // 2. Guardar en el historial de chat
        await guardarMensajeHistorial(senderNumber, 'model', orderConfirmMsg, this.botType);
        
        // 3. Emitir al Monitor de Actividad en tiempo real
        this.emitMessage({ type: 'out', sender: 'Bot IA (Pedido)', text: orderConfirmMsg });
        
        // 4. Pausar el bot para este cliente (activar asistencia humana)
        await pauseChat(senderNumber, message.pushName || 'Cliente', body);
        
        // 5. Registrar analítica
        await logChatbotInteraction(senderNumber, message.pushName || 'Cliente', 'pedido_recibido', body, orderConfirmMsg);
        
        // 6. Enviar alerta por WhatsApp a los administradores
        const adminNumbersStr = await getConfig('admin_whatsapp_numbers') || '';
        const authorizedNumbers = adminNumbersStr.split(',').map(n => n.trim().replace('+', '')).filter(Boolean);
        const adminBot = bots.admin?.client;
        if (adminBot) {
          const alertMsg = `🚨 *Nuevo Pedido Recibido via WhatsApp*\nEl cliente ${senderNumber} (${message.pushName || 'Cliente'}) acaba de enviar un pedido.\n\n*Detalles del pedido:*\n${body}\n\nIngresa al panel web para responder y gestionarlo.`;
          for (const adminNum of authorizedNumbers) {
            try {
              await adminBot.sendMessage(`${adminNum}@s.whatsapp.net`, { text: alertMsg });
            } catch (e) {}
          }
        }
        
        // 7. Notificar por Socket a la pantalla de administración
        this.io.emit('whatsapp_handoff_requested');
        return; // Detener flujo para no procesar con Gemini
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
            description: 'Actualiza el stock exacto de un producto o variante por ID o Nombre.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                id: { type: SchemaType.INTEGER, description: 'ID del producto o variante (opcional si se da el nombre)' },
                nombre: { type: SchemaType.STRING, description: 'Nombre del producto o variante (opcional si se da el ID)' },
                nuevoStock: { type: SchemaType.INTEGER, description: 'Nuevo stock exacto' },
                es_variante: { type: SchemaType.BOOLEAN, description: 'Indica si el id/nombre pertenece a una variante en vez de un producto principal' }
              },
              required: ['nuevoStock']
            }
          },
          {
            name: 'ajustarStock',
            description: "Suma o resta stock a un producto o variante por ID o Nombre.",
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                id: { type: SchemaType.INTEGER, description: 'ID del producto o variante (opcional si se da el nombre)' },
                nombre: { type: SchemaType.STRING, description: 'Nombre del producto o variante (opcional si se da el ID)' },
                cantidad: { type: SchemaType.INTEGER, description: 'Cantidad a sumar (+) o restar (-)' },
                es_variante: { type: SchemaType.BOOLEAN, description: 'Indica si el id/nombre pertenece a una variante en vez de un producto principal' }
              },
              required: ['cantidad']
            }
          },
          {
            name: 'crearProducto',
            description: 'Añade un nuevo plato/producto al menú del restaurante.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                nombre: { type: SchemaType.STRING, description: 'Nombre del producto' },
                precio: { type: SchemaType.NUMBER, description: 'Precio de venta' },
                categoria: { type: SchemaType.STRING, description: 'Categoría (Migas, Bebidas, etc)' },
                descripcion: { type: SchemaType.STRING, description: 'Opcional. Descripción del plato' },
                stock: { type: SchemaType.INTEGER, description: 'Opcional. Stock inicial' }
              },
              required: ['nombre', 'precio', 'categoria']
            }
          },
          {
            name: 'editarProducto',
            description: 'Edita precio, stock o disponibilidad de un producto existente.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                id: { type: SchemaType.INTEGER, description: 'ID del producto' },
                precio: { type: SchemaType.NUMBER, description: 'Opcional. Nuevo precio' },
                stock: { type: SchemaType.INTEGER, description: 'Opcional. Nuevo stock' },
                activo: { type: SchemaType.INTEGER, description: 'Opcional. 1 para activo, 0 para desactivado' }
              },
              required: ['id']
            }
          },
          {
            name: 'obtenerVentasHoy',
            description: 'Consulta los ingresos totales, gastos y balance del día actual.',
            parameters: { type: SchemaType.OBJECT, properties: {}, required: [] }
          },
          {
            name: 'registrarGasto',
            description: 'Registra un gasto en la caja del día (compras, salarios, etc).',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                descripcion: { type: SchemaType.STRING, description: 'Qué se compró o pagó' },
                monto: { type: SchemaType.NUMBER, description: 'Costo total' },
                categoria: { type: SchemaType.STRING, description: 'Categoría (Ej: Insumos, Servicios)' }
              },
              required: ['descripcion', 'monto']
            }
          },
          {
            name: 'obtenerInsumos',
            description: 'Obtiene el inventario interno de insumos (vasos, servilletas, etc).',
            parameters: { type: SchemaType.OBJECT, properties: {}, required: [] }
          },
          {
            name: 'actualizarInsumo',
            description: 'Actualiza el stock de un insumo interno.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                id: { type: SchemaType.INTEGER, description: 'ID del insumo' },
                nombre: { type: SchemaType.STRING, description: 'Nombre del insumo (si no se sabe el ID)' },
                nueva_cantidad: { type: SchemaType.NUMBER, description: 'Nueva cantidad total disponible' }
              },
              required: ['nueva_cantidad']
            }
          },
          {
            name: 'crearInsumo',
            description: 'Registra un nuevo insumo interno en el sistema.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                nombre: { type: SchemaType.STRING, description: 'Nombre (Ej: Vasos 7oz)' },
                categoria: { type: SchemaType.STRING, description: 'Ej: Desechables, Aseo' },
                cantidad: { type: SchemaType.NUMBER, description: 'Stock inicial' },
                unidad: { type: SchemaType.STRING, description: 'Ej: unidades, paquetes, kg' },
                stock_minimo: { type: SchemaType.NUMBER, description: 'Stock de alerta' }
              },
              required: ['nombre', 'cantidad']
            }
          },
          {
            name: 'registrarCompraInsumo',
            description: 'Registra la compra de un insumo, actualiza el stock y recalcula su costo promedio.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                insumo_id: { type: SchemaType.INTEGER, description: 'ID del insumo' },
                cantidad_comprada: { type: SchemaType.NUMBER, description: 'Cantidad ingresada' },
                costo_total: { type: SchemaType.NUMBER, description: 'Costo total pagado por esa cantidad' }
              },
              required: ['insumo_id', 'cantidad_comprada', 'costo_total']
            }
          },
          {
            name: 'costearProducto',
            description: 'Calcula el costo actual de un plato basandose en su receta y los costos promedios.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                producto_id: { type: SchemaType.INTEGER, description: 'ID del producto/plato' }
              },
              required: ['producto_id']
            }
          },
          {
            name: 'consultarVentas',
            description: 'Consulta ventas reales (pedidos pagados) + gastos + ganancia estimada para un período.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                periodo: { type: SchemaType.STRING, description: 'hoy | ayer | semana | mes' }
              },
              required: []
            }
          },
          {
            name: 'pedidosActivos',
            description: 'Muestra pedidos pendientes y en preparación ahora mismo, con tiempo transcurrido y alertas de demora.',
            parameters: { type: SchemaType.OBJECT, properties: {}, required: [] }
          },
          {
            name: 'topProductos',
            description: 'Los productos más vendidos en un período dado.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                periodo: { type: SchemaType.STRING, description: 'hoy | semana | mes' }
              },
              required: []
            }
          },
          {
            name: 'ventasPorAuxiliar',
            description: 'Ventas desglosadas por cada auxiliar/mesera que creó pedidos.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                periodo: { type: SchemaType.STRING, description: 'hoy | semana | mes' }
              },
              required: []
            }
          },
          {
            name: 'marcarProductoAgotado',
            description: 'Desactiva un producto y pone su stock en 0. Útil cuando se acaba algo en cocina.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                id: { type: SchemaType.INTEGER, description: 'ID del producto (opcional si se da nombre)' },
                nombre: { type: SchemaType.STRING, description: 'Nombre del producto (opcional si se da ID)' }
              },
              required: []
            }
          },
          {
            name: 'cambiarPrecio',
            description: 'Cambia el precio de un producto por nombre o ID.',
            parameters: {
              type: SchemaType.OBJECT,
              properties: {
                id: { type: SchemaType.INTEGER, description: 'ID del producto (opcional si se da nombre)' },
                nombre: { type: SchemaType.STRING, description: 'Nombre del producto (opcional si se da ID)' },
                nuevo_precio: { type: SchemaType.NUMBER, description: 'Nuevo precio de venta' }
              },
              required: ['nuevo_precio']
            }
          }
        ]
      }];

      systemInstruction =
        'Eres el Gerente Asistente IA de Puro Sabor.\n' +
        'Ayudas al administrador a manejar el negocio. Tus capacidades son:\n' +
        '1. GESTION DE INVENTARIOS: Consulta y edita productos del MENÚ e INSUMOS. Los productos pueden tener variantes.\n' +
        '2. GESTION DE PRODUCTOS: Crea, edita, desactiva productos. Si te piden agregar algo que no existe, úsalas. NUNCA digas que no puedes crear productos.\n' +
        '3. CAJA Y FINANZAS: Registra gastos, consulta ventas reales (consultarVentas), compara períodos.\n' +
        '4. OPERACIÓN EN TIEMPO REAL: pedidosActivos te da los pedidos abiertos ahora mismo. topProductos y ventasPorAuxiliar dan inteligencia de negocio.\n' +
        '5. PRECIOS RÁPIDOS: cambiarPrecio acepta nombre del producto, no necesitas el ID.\n' +
        '6. AGOTADOS RÁPIDO: marcarProductoAgotado acepta nombre, lo desactiva al instante.\n' +
        '7. VISION E IMAGENES: Si el administrador envía una FOTO (factura, lista de compras, recibo), analízala, identifica insumos y usa crearInsumo/actualizarInsumo. Extrae precios y registrarGasto.\n' +
        'REGLA: Confirma SIEMPRE con el usuario los montos y cambios antes de ejecutar acciones destructivas o registrar gastos.';
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

      // Obtener hora local de Colombia para inyectar al prompt de la IA
      const now = new Date();
      const colombiaTime = new Date(now.getTime() - (5 * 60 * 60 * 1000));
      const dias = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
      const hoyName = dias[colombiaTime.getUTCDay()];
      const hour = colombiaTime.getUTCHours().toString().padStart(2, '0');
      const min = colombiaTime.getUTCMinutes().toString().padStart(2, '0');
      const timeStrLocal = `${hour}:${min}`;

      systemInstruction = 
        'Eres el recepcionista oficial de Puro Sabor.\n' +
        (customPrompt ? `${customPrompt}\n` : '') +
        ruleSaludo +
        `FECHA Y HORA ACTUAL (Colombia): ${hoyName}, ${timeStrLocal}.\n` +
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
      
      // Filtrar mensajes automáticos de ausencia para que no confundan a Gemini en el historial
      const historialFiltrado = historialPrevio.filter(h => {
        const text = h.contenido || '';
        return !text.includes('fuera de nuestro horario de servicio') && 
               !text.includes('iniciaremos atención este próximo') &&
               !text.includes('mensaje de ausencia');
      });

      // Normalizar historial para Gemini (estrictamente user -> model -> user -> model)
      let historialGemini = [];
      let expectedRole = 'user';
      for (const h of historialFiltrado) {
        const role = h.rol === 'user' ? 'user' : 'model';
        if (role === expectedRole) {
          historialGemini.push({ role, parts: [{ text: h.contenido || ' ' }] });
          expectedRole = expectedRole === 'user' ? 'model' : 'user';
        } else {
          // Si el rol es el mismo que el anterior, concatenar el texto
          if (historialGemini.length > 0) {
            historialGemini[historialGemini.length - 1].parts[0].text += '\n' + (h.contenido || ' ');
          }
        }
      }
      
      // Gemini exige que el historial (si existe) inicie siempre con 'user'
      if (historialGemini.length > 0 && historialGemini[0].role === 'model') {
        historialGemini.shift();
      }
      // Gemini exige que el último elemento del historial previo sea 'model' si el siguiente input va a ser 'user'
      // Pero startChat lo maneja bien siempre y cuando el último del historial no sea del mismo rol que el que sigue
      if (historialGemini.length > 0 && historialGemini[historialGemini.length - 1].role === 'user') {
          // Remover el último 'user' o agregar un dummy 'model'
          historialGemini.push({ role: 'model', parts: [{ text: 'Entendido.' }] });
      }

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
            const promoId = parseInt(promoIdMatch[1], 10);
            if (!isNaN(promoId) && promoId > 0) {
              const promoEntry = await new Promise(resolve => {
                db.get('SELECT imagen_url, imagen_tipo FROM promociones WHERE id = ?', [promoId], (err, row) => resolve(row));
              });
              if (promoEntry && promoEntry.imagen_url) {
                const _path = require('path'), _fs = require('fs');
                const uploadsDir = _path.resolve(__dirname, '..', 'uploads');
                const safePath = _path.resolve(uploadsDir, _path.basename(promoEntry.imagen_url));
                if (safePath.startsWith(uploadsDir) && _fs.existsSync(safePath)) {
                  let mediaPayload = {};
                  if (promoEntry.imagen_tipo === 'video') mediaPayload = { video: { url: safePath }, caption: cleanText };
                  else if (promoEntry.imagen_tipo === 'pdf') mediaPayload = { document: { url: safePath }, caption: cleanText };
                  else mediaPayload = { image: { url: safePath }, caption: cleanText };
                  await this.client.sendMessage(remoteJid, mediaPayload, { quoted: message });
                  await guardarMensajeHistorial(senderNumber, 'model', cleanText || '(Promoción enviada)', this.botType);
                  this.emitMessage({ type: 'out', sender: 'Bot IA', text: cleanText || '(Promoción enviada)', time: new Date().toLocaleTimeString() });
                  await logChatbotInteraction(senderNumber, message.pushName || 'Cliente', 'promo_enviada', body, cleanText, { promo_id: promoId });
                  break;
                }
              }
            }
          }

          // B. Evaluar si tiene etiqueta de Base de Conocimientos
          let mediaIdMatch = finalText.match(/\[SEND_MEDIA:(\d+)\]/);
          if (mediaIdMatch) {
            cleanText = finalText.replace(/\[SEND_MEDIA:\d+\]/g, '').trim();
            const kbId = parseInt(mediaIdMatch[1], 10);
            if (!isNaN(kbId) && kbId > 0) {
              const kbEntry = await new Promise(resolve => {
                db.get('SELECT media_url, media_type FROM chatbots_kb WHERE id = ?', [kbId], (err, row) => resolve(row));
              });
              if (kbEntry && kbEntry.media_url) {
                const _path = require('path'), _fs = require('fs');
                const uploadsDir = _path.resolve(__dirname, '..', 'uploads');
                const safePath = _path.resolve(uploadsDir, _path.basename(kbEntry.media_url));
                if (safePath.startsWith(uploadsDir) && _fs.existsSync(safePath)) {
                  let mediaPayload = {};
                  if (kbEntry.media_type === 'video') mediaPayload = { video: { url: safePath }, caption: cleanText };
                  else if (kbEntry.media_type === 'audio') mediaPayload = { audio: { url: safePath }, ptt: true };
                  else mediaPayload = { image: { url: safePath }, caption: cleanText };
                  await this.client.sendMessage(remoteJid, mediaPayload, { quoted: message });
                  if (kbEntry.media_type === 'audio' && cleanText) await this.client.sendMessage(remoteJid, { text: cleanText });
                  await guardarMensajeHistorial(senderNumber, 'model', cleanText || '(Multimedia enviado)', this.botType);
                  this.emitMessage({ type: 'out', sender: 'Bot IA', text: cleanText || '(Multimedia enviado)', time: new Date().toLocaleTimeString() });
                  await logChatbotInteraction(senderNumber, message.pushName || 'Cliente', 'respuesta_kb', body, cleanText, { kb_id: kbId });
                  break;
                }
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
      console.error(`[WA Agent ${this.botType}] Error Gemini:`, err.code || err.name, process.env.NODE_ENV !== 'production' ? err.message : '');
      if (this.botType === 'admin') {
        await this.client.sendMessage(remoteJid, { text: '⚠️ Error procesando tu solicitud. Intenta de nuevo o revisa la configuración en el panel.' }, { quoted: message });
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

    // ── Alertas proactivas de stock bajo (cada 30 min) ──────────
    async function enviarAlertasStock() {
      const bot = bots.admin;
      if (!bot || bot.botStatus !== 'ready' || !bot.client) return;
      try {
        const adminNumbersStr = await getConfig('admin_whatsapp_numbers') || '';
        const admins = adminNumbersStr.split(',').map(n => n.trim().replace(/^\+/, '')).filter(Boolean);
        if (!admins.length) return;

        // Productos con stock ≤ stock_minimo
        const prodBajos = await dbAsync.all(
          `SELECT nombre, stock, stock_minimo FROM productos WHERE activo = 1 AND stock_minimo > 0 AND stock <= stock_minimo`
        );
        // Insumos con cantidad ≤ stock_minimo
        const insumoBajos = await dbAsync.all(
          `SELECT nombre, cantidad, stock_minimo, unidad FROM insumos WHERE stock_minimo > 0 AND cantidad <= stock_minimo`
        );

        if (!prodBajos.length && !insumoBajos.length) return;

        let msg = '⚠️ *Alerta de Stock Bajo — Puro Sabor*\n\n';
        if (prodBajos.length) {
          msg += '*Productos del menú:*\n' + prodBajos.map(p => `• ${p.nombre}: ${p.stock} unidades (mín: ${p.stock_minimo})`).join('\n') + '\n\n';
        }
        if (insumoBajos.length) {
          msg += '*Insumos:*\n' + insumoBajos.map(i => `• ${i.nombre}: ${i.cantidad} ${i.unidad} (mín: ${i.stock_minimo})`).join('\n');
        }
        msg += '\n\n_Responde al bot admin para actualizar stock._';

        for (const adminNum of admins) {
          try { await bot.client.sendMessage(`${adminNum}@s.whatsapp.net`, { text: msg }); } catch(_) {}
        }
        console.log(`[WA Proactivo] Alerta de stock enviada a ${admins.length} admins`);
      } catch (err) {
        console.error('[WA Proactivo] Error en alerta de stock:', err.message);
      }
    }

    // ── Resumen diario automático al cierre (23:30 hora Colombia) ─
    async function programarResumenDiario() {
      const now = new Date();
      const colombia = new Date(now.getTime() - 5 * 3600_000);
      const h = colombia.getUTCHours(), m = colombia.getUTCMinutes();
      // Calcular ms hasta las 23:30 Colombia
      const targetH = 23, targetM = 30;
      let msHasta = ((targetH - h) * 60 + (targetM - m)) * 60_000;
      if (msHasta <= 0) msHasta += 24 * 3600_000;

      setTimeout(async function enviar() {
        const bot = bots.admin;
        if (bot && bot.botStatus === 'ready' && bot.client) {
          try {
            const adminNumbersStr = await getConfig('admin_whatsapp_numbers') || '';
            const admins = adminNumbersStr.split(',').map(n => n.trim().replace(/^\+/, '')).filter(Boolean);

            const ventas = await dbAsync.get(
              `SELECT COUNT(*) as total_pedidos, COALESCE(SUM(total),0) as ingresos
               FROM pedidos WHERE estado = 'pagado' AND DATE(creado_en) = CURRENT_DATE`
            );
            const gastos = await dbAsync.get(
              `SELECT COALESCE(SUM(monto),0) as gastos FROM caja_registros
               WHERE tipo = 'gasto' AND DATE(fecha) = CURRENT_DATE`
            );
            // Top 3 productos del día
            const pedidosDia = await dbAsync.all(
              `SELECT items_json FROM pedidos WHERE estado = 'pagado' AND DATE(creado_en) = CURRENT_DATE`
            );
            const conteo = {};
            for (const p of pedidosDia) {
              try { JSON.parse(p.items_json || '[]').forEach(i => { conteo[i.nombre] = (conteo[i.nombre] || 0) + i.cantidad; }); } catch(_) {}
            }
            const top3 = Object.entries(conteo).sort((a,b) => b[1]-a[1]).slice(0,3).map(([n,c]) => `• ${n} (×${c})`).join('\n');

            const ingresos = parseFloat(ventas?.ingresos || 0);
            const totalGastos = parseFloat(gastos?.gastos || 0);
            const msg = `🌙 *Resumen del Día — Puro Sabor*\n\n` +
              `📦 Pedidos atendidos: ${ventas?.total_pedidos || 0}\n` +
              `💰 Ingresos: $${ingresos.toLocaleString('es-CO')}\n` +
              `💸 Gastos: $${totalGastos.toLocaleString('es-CO')}\n` +
              `📊 Ganancia estimada: $${(ingresos - totalGastos).toLocaleString('es-CO')}\n` +
              (top3 ? `\n🏆 *Top productos:*\n${top3}` : '') +
              `\n\n_Buen trabajo hoy. ¡Hasta mañana! 🔥_`;

            for (const adminNum of admins) {
              try { await bot.client.sendMessage(`${adminNum}@s.whatsapp.net`, { text: msg }); } catch(_) {}
            }
            console.log('[WA Proactivo] Resumen diario enviado');
          } catch (err) {
            console.error('[WA Proactivo] Error en resumen diario:', err.message);
          }
        }
        // Reprogramar para el día siguiente
        setTimeout(enviar, 24 * 3600_000);
      }, msHasta);
      console.log(`[WA Proactivo] Resumen diario programado en ${Math.round(msHasta/60000)} minutos`);
    }

    // Iniciar alertas y resumen (con delay de 2 min para que el bot esté listo)
    setTimeout(() => {
      enviarAlertasStock();
      setInterval(enviarAlertasStock, 30 * 60_000);
      programarResumenDiario();
    }, 2 * 60_000);
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
