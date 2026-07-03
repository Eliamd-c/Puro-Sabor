// ── Cargar y validar variables de entorno ─────────────────────────────────
const env = require('./config/env');

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./config/swagger');

const logger = require('./config/logger');
const db = require('./config/database');
const dbAsync = require('./config/database-promise');
const { runAllTests: testSSL } = require('./config/test-db-ssl');
const redisClient = require('./config/redis-client');
const clusterSync = require('./utils/clusterSync');
const gracefulShutdownManager = require('./utils/gracefulShutdown');
const EventEmitter = require('events');

// Global event emitter for cluster events
global.eventEmitter = new EventEmitter();

// Override console to capture logs into winston
const originalLog = console.log;
const originalError = console.error;
console.log = function(...args) {
  logger.info(args.join(' '));
  originalLog.apply(console, args);
};
console.error = function(...args) {
  logger.error(args.join(' '));
  originalError.apply(console, args);
};

const app = express();

// Hostinger sirve la app detrás de un reverse proxy: sin esto, Express ve la IP
// del proxy en lugar de la del cliente y express-rate-limit lanza ValidationError
// por el header X-Forwarded-For (afecta el rate limiting del login).
app.set('trust proxy', 1);

const server = http.createServer(app);
const PORT = env.PORT;

// ── CORS Config ────────────────────────────────────────────────────────────
const allowedOrigins = [
  env.FRONTEND_URL,
  'https://www.restaurantepurosabor.com',
  'https://restaurantepurosabor.com',
  'http://restaurantepurosabor.com',
  'http://www.restaurantepurosabor.com',
  env.isDevelopment() ? 'http://localhost:3005' : null,
  env.isDevelopment() ? 'http://localhost:3000' : null
].filter(Boolean);

const { createAdapter } = require('@socket.io/postgres-adapter');
const { Pool } = require('pg');

const io = new Server(server, {
  cors: { 
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  },
  allowEIO3: true,
  transports: ['polling', 'websocket'],
  pingTimeout: 60000,
  pingInterval: 25000
});

// Configurar Postgres Adapter para sincronizar sockets entre múltiples procesos de Node en Hostinger
// NOTA SSL: el certificado del pooler de Supabase está firmado por la CA propia de
// Supabase; con rejectUnauthorized: true (sin proveer esa CA) la conexión siempre
// falla. La conexión sigue cifrada; ver SUPABASE_CA_CERT para verificación completa.
if (env.DATABASE_URL) {
  try {
    const socketPool = new Pool({
      connectionString: env.DATABASE_URL,
      ssl: process.env.SUPABASE_CA_CERT
        ? { rejectUnauthorized: true, ca: process.env.SUPABASE_CA_CERT }
        : { rejectUnauthorized: false }
    });
    
    // Crear tabla automáticamente si no existe para el adapter
    socketPool.query(`
      CREATE TABLE IF NOT EXISTS socket_io_attachments (
          id          bigserial UNIQUE,
          created_at  timestamptz DEFAULT NOW(),
          payload     bytea
      );
    `).catch(err => console.error('[Socket] Error creando tabla del adapter:', err));

    io.adapter(createAdapter(socketPool));
    console.log('[Socket] Postgres Adapter configurado correctamente.');
  } catch (err) {
    console.error('[Socket] Error configurando Postgres Adapter:', err);
  }
}

// Estado en memoria del carrito compartido por mesa
// { 'mesa_5': { items: [...], ultimaActividad: Date } }
const carritosMesa = {};

io.on('connection', (socket) => {
  console.log(`[Socket] Cliente conectado: ${socket.id}`);

  // ── Cliente se une a una sala de mesa ──
  socket.on('unirse_mesa', async (mesaNumero) => {
    socket.mesaNumero = mesaNumero;
    const sala = mesaNumero === 'general' ? 'mesa_general' : `mesa_${mesaNumero}`;
    socket.join(sala);

    // Enviar el carrito actual al nuevo integrante
    const carritoActual = carritosMesa[sala] || { items: [] };
    socket.emit('carrito_actualizado', carritoActual.items);
    console.log(`[Socket] ${socket.id} se unió a ${sala}`);
    
    // Incrementar contador de viewers en DB (funciona cross-proceso)
    if (mesaNumero !== 'general') {
      try {
        await dbAsync.run(
          'UPDATE mesas SET viendo = viendo + 1 WHERE numero = ?',
          [mesaNumero]
        );
        // Verificar el valor real después del UPDATE
        const row = await dbAsync.get('SELECT viendo FROM mesas WHERE numero = ?', [mesaNumero]);
        console.log(`[Socket] Mesa ${mesaNumero} — viendo actualizado a: ${row ? row.viendo : 'ERROR: mesa no encontrada'}`);
      } catch (e) {
        console.error(`[Socket] Error incrementando viendo para mesa ${mesaNumero}:`, e.message);
      }
    }

    // Notificar al admin que la mesa tiene actividad (clientes viendo menú)
    const adminRoom = io.sockets.adapter.rooms.get('admin');
    console.log(`[Socket] Emitiendo mesa_actualizada al admin. Admin sockets en este proceso: ${adminRoom ? adminRoom.size : 0}`);
    io.to('admin').emit('mesa_actualizada', { mesa: mesaNumero });
  });

  // ── Admin se une al panel de administración ──
  socket.on('unirse_admin', () => {
    socket.join('admin');
    console.log(`[Socket] Admin conectado: ${socket.id}`);

    // Enviar estado actual de los bots a este nuevo admin (no depender de que
    // el evento se emita justo cuando el socket ya está conectado)
    try {
      const waAgent = require('./services/whatsappAgent');
      ['client', 'admin'].forEach(type => {
        const bot = waAgent.getBot(type, io);
        if (bot) {
          socket.emit(`whatsapp_${type}_status`, {
            status: bot.botStatus,
            qr: bot.latestQrDataUrl
          });
        }
      });
    } catch (_) {}
  });

  // ── Actualizar carrito (alguien agregó/quitó un item) ──
  socket.on('actualizar_carrito', ({ mesaNumero, items }) => {
    const sala = mesaNumero === 'general' ? 'mesa_general' : `mesa_${mesaNumero}`;
    
    // Guardar estado en memoria
    carritosMesa[sala] = { items, ultimaActividad: new Date() };

    // Broadcast a todos en la misma mesa (excepto al emisor)
    socket.to(sala).emit('carrito_actualizado', items);
  });

  // ── Notificar producto agregado por un comensal específico ──
  socket.on('item_agregado_grupo', ({ mesaNumero, cliente, producto }) => {
    const sala = mesaNumero === 'general' ? 'mesa_general' : `mesa_${mesaNumero}`;
    // Reenviar a todos en la sala excepto al que lo agregó
    socket.to(sala).emit('notificar_item_agregado', { cliente, producto });
  });

  // ── Pedido confirmado: limpiar carrito de la sala ──
  socket.on('pedido_enviado', ({ mesaNumero, resumen }) => {
    const sala = mesaNumero === 'general' ? 'mesa_general' : `mesa_${mesaNumero}`;
    
    // Limpiar carrito en memoria
    carritosMesa[sala] = { items: [], ultimaActividad: new Date() };

    // Notificar a todos en la mesa que el pedido fue enviado
    io.to(sala).emit('carrito_actualizado', []);
    io.to(sala).emit('pedido_confirmado', resumen);
  });

  socket.on('disconnect', async () => {
    console.log(`[Socket] Cliente desconectado: ${socket.id}`);
    if (socket.mesaNumero && socket.mesaNumero !== 'general') {
      try {
        await dbAsync.run(
          'UPDATE mesas SET viendo = GREATEST(0, viendo - 1) WHERE numero = ?',
          [socket.mesaNumero]
        );
      } catch (e) {
        console.error(`[Socket] Error decrementando viendo para mesa ${socket.mesaNumero}:`, e.message);
      }
      io.to('admin').emit('mesa_actualizada', { mesa: socket.mesaNumero });
    }
  });
});

// Guardar io en la app para usarlo en las rutas
app.set('io', io);

// ── Limpiar locks expirados al iniciar ────────────────────────────────────────
async function limpiarLocksExpirados() {
  try {
    // La edad del lock se calcula DENTRO de Postgres (NOW() - updated_at).
    // Comparar updated_at contra el reloj de Node mezclaba el reloj de
    // Supabase con el de Hostinger: con cualquier skew/zona horaria esta
    // limpieza borraba locks ACTIVOS y desataba robo de sesión en bucle.
    const res = await dbAsync.run(
      `DELETE FROM wa_auth
       WHERE key LIKE $1 AND updated_at < NOW() - INTERVAL '30 seconds'`,
      ['%lock_pid%']
    );

    if (res && res.changes > 0) {
      console.log(`[Startup] ✅ ${res.changes} locks expirados eliminados`);
    }
  } catch (err) {
    console.error('[Startup] Error limpiando locks:', err.message);
  }
}

// Ejecutar limpieza al iniciar
limpiarLocksExpirados();

// ── Inicializar WhatsApp Agent Dual ───────────────────────────────────────────
const waAgent = require('./services/whatsappAgent');
waAgent.inicializarTodos(io).catch(err => {
  console.error('[Server] Error al iniciar los agentes de WhatsApp:', err.message);
});

// ── Job automático: limpiar locks cada hora ────────────────────────────────────
setInterval(async () => {
  try {
    // Edad calculada dentro de Postgres — ver nota en limpiarLocksExpirados()
    const deleted = await dbAsync.run(
      `DELETE FROM wa_auth
       WHERE key LIKE $1 AND updated_at < NOW() - INTERVAL '30 seconds'`,
      ['%lock_pid%']
    );

    if (deleted.changes > 0) {
      console.log(`[Housekeeping] Limpiados ${deleted.changes} locks expirados`);
    }
  } catch (err) {
    console.error('[Housekeeping] Error limpiando locks:', err.message);
  }
}, 60 * 60 * 1000); // Cada hora

// ── Timeout automático: revisar mesas con +2h de inactividad ──────────────
setInterval(() => {
  db.get("SELECT value FROM config WHERE key = 'mesas_timeout_horas'", [], (err, row) => {
    const horas = row ? parseInt(row.value) : 2;
    const limite = new Date(Date.now() - horas * 60 * 60 * 1000).toISOString();

    db.all(
      `SELECT id, mesa_numero FROM sesiones_mesa WHERE estado = 'activa' AND ultima_actividad < ?`,
      [limite],
      (err, sesiones) => {
        if (!sesiones || sesiones.length === 0) return;
        sesiones.forEach(sesion => {
          db.run(
            `UPDATE sesiones_mesa SET estado = 'cerrada', cerrada_en = CURRENT_TIMESTAMP, cerrada_por = 'sistema-timeout' WHERE id = ?`,
            [sesion.id],
            () => {
              const sala = `mesa_${sesion.mesa_numero}`;
              delete carritosMesa[sala];
              io.to(sala).emit('mesa_cerrada', {
                mesa: sesion.mesa_numero,
                mensaje: 'La sesión de la mesa fue reiniciada automáticamente.'
              });
              io.to('admin').emit('mesa_actualizada', { mesa: sesion.mesa_numero, estado: 'libre' });
              console.log(`[Timeout] Mesa ${sesion.mesa_numero} reiniciada automáticamente.`);
            }
          );
        });
      }
    );
  });
}, 30 * 60 * 1000); // Revisar cada 30 minutos

// ── Middlewares ────────────────────────────────────────────────────────────
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  optionsSuccessStatus: 200
}));

// FASE 3.2: Response Compression - Gzip + Optimization
// Note: Brotli middleware disabled (was interfering with Set-Cookie headers)
const compressionMiddleware = require('./middleware/compression');
app.use(compressionMiddleware.gzip());       // Gzip (all browsers, stable)
// app.use(compressionMiddleware.brotli());  // Brotli disabled - was breaking cookies
app.use(compressionMiddleware.optimize());   // Remove unnecessary fields
app.use(compressionMiddleware.stats());      // Track compression metrics

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cookie parser middleware - REQUIRED for res.cookie() to work
app.use(cookieParser());

const uploadsPath = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}
app.use('/uploads', express.static(uploadsPath));

const xss = require('xss-clean');
app.use(xss());

// FASE 3.4: Pagination middleware
const { paginationMiddleware } = require('./utils/paginationHelper');
app.use(paginationMiddleware);

app.use((req, res, next) => {
  logger.info({ method: req.method, url: req.url });
  next();
});

// ── Normalizar URLs con múltiples slashes (ej: //mesa/2 -> /mesa/2) ────
app.use((req, res, next) => {
  if (req.url.match(/\/{2,}/)) {
    const cleanUrl = req.url.replace(/\/{2,}/g, '/');
    return res.redirect(301, cleanUrl);
  }
  next();
});

// ── Swagger Documentation ──────────────────────────────────────────────────
app.use('/api-docs', swaggerUi.serve);
app.get('/api-docs', swaggerUi.setup(swaggerSpecs, {
  swaggerOptions: {
    persistAuthorization: true
  }
}));

// ── Health Checks (FASE 2.3) ──────────────────────────────────────────────
const healthRoutes = require('./routes/health');
const metricsCollector = require('./utils/metricsCollector');
const alertService = require('./services/alertService');

// Middleware to track request metrics
app.use((req, res, next) => {
  req.startTime = Date.now();
  const originalSend = res.send;

  res.send = function(data) {
    const responseTime = Date.now() - req.startTime;
    metricsCollector.recordRequest(req.method, req.path, res.statusCode, responseTime);
    return originalSend.call(this, data);
  };

  next();
});

app.use('/', healthRoutes);

// ── Rutas API ──────────────────────────────────────────────────────────────
const authRoutes = require('./routes/auth');
const categoriasRoutes = require('./routes/categorias');
const productosRoutes = require('./routes/productos');
const mesasRoutes = require('./routes/mesas');
const pedidosRoutes = require('./routes/pedidos');
const configRoutes = require('./routes/config');
const inventarioRoutes = require('./routes/inventario');
const chatbotsRoutes = require('./routes/chatbots');
const insumosRoutes = require('./routes/insumos');
const cajaRoutes = require('./routes/caja');

app.use('/api/admin', authRoutes);
app.use('/api/categorias', categoriasRoutes);
app.use('/api/productos', productosRoutes);
app.use('/api/mesas', mesasRoutes);
app.use('/api/pedidos', pedidosRoutes);
app.use('/api/config', configRoutes);
app.use('/api/inventario', inventarioRoutes);
app.use('/api/chatbots', chatbotsRoutes);
app.use('/api/insumos', insumosRoutes);
app.use('/api/caja', cajaRoutes);

// ── Archivos estáticos ─────────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// Módulo Público en la raíz '/'
app.use('/', express.static(path.join(__dirname, '..', 'public')));

// Módulo Mesa en '/mesa'
app.use('/mesa', express.static(path.join(__dirname, '..', 'public', 'mesa')));

// Módulo Mesera/Auxiliar en '/mesera' y '/auxiliar-de-venta'
app.use('/mesera', express.static(path.join(__dirname, '..', 'public', 'mesera')));
app.use('/auxiliar-de-venta', express.static(path.join(__dirname, '..', 'public', 'mesera')));

// Módulo Cocina (KDS) en '/cocina'
app.use('/cocina', express.static(path.join(__dirname, '..', 'public', 'cocina')));

// Módulo Admin en '/admin'
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));

// ── Rutas comodín ──────────────────────────────────────────────────────────
// Mesa: cualquier ruta /mesa/* sirve el index.html de la carpeta mesa
app.get('/mesa', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'mesa', 'index.html'));
});
app.get('/mesa/*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'mesa', 'index.html'));
});

// Mesera/Auxiliar: cualquier ruta /mesera/* y /auxiliar-de-venta/* sirven el index.html
app.get('/mesera', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'mesera', 'index.html'));
});
app.get('/mesera/*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'mesera', 'index.html'));
});
app.get('/auxiliar-de-venta', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'mesera', 'index.html'));
});
app.get('/auxiliar-de-venta/*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'mesera', 'index.html'));
});

// Cocina (KDS)
app.get('/cocina', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'cocina', 'index.html'));
});
app.get('/cocina/*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'cocina', 'index.html'));
});

// Admin: rutas específicas de administración
app.get('/admin/mesas*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'admin', 'mesas.html'));
});
app.get('/admin/inventario*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'admin', 'inventario.html'));
});

// Público
app.get('*', (req, res, next) => {
  if (req.url.startsWith('/api') || req.url.startsWith('/admin') || req.url.startsWith('/uploads') || req.url.startsWith('/mesa')) {
    return next();
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Manejo de errores ──────────────────────────────────────────────────────
const errorHandler = require('./middleware/errorHandler');
app.use(errorHandler);

// ── Iniciar servidor ───────────────────────────────────────────────────────
async function startServer() {
  // 1. Inicializar connection pool con retry logic
  console.log('\n[Server] Inicializando connection pool...\n');
  try {
    await db.initializePool();
    console.log('[Server] ✅ Connection pool initialized successfully\n');
  } catch (err) {
    console.error('[Server] ❌ Failed to initialize connection pool:', err.message);
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }

  // 2. Inicializar Redis y cluster sync (FASE 2.4)
  console.log('[Server] Inicializando Redis y cluster sync...\n');
  try {
    await redisClient.initialize();
    await clusterSync.initialize();
    console.log('[Server] ✅ Redis and cluster sync initialized\n');
  } catch (err) {
    console.warn('[Server] ⚠️ Redis initialization failed (cluster mode disabled):', err.message);
    // Non-fatal - system can work without Redis but won't have cluster sync
  }

  // 3. Ejecutar validación SSL antes de iniciar
  console.log('[Server] Ejecutando validación de SSL...\n');
  try {
    const sslValid = await testSSL();
    if (!sslValid && process.env.NODE_ENV === 'production') {
      // WARNING: No bloquear startup - permitir que Hostinger continúe
      console.warn('[Server] ⚠️ ADVERTENCIA: Validación SSL falló en producción, pero continuando...');
      // No hacer process.exit(1) - dejar que el servidor inicie
    }
  } catch (err) {
    console.error('[Server] ❌ Error durante validación SSL:', err.message);
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }

  server.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`🚀 SERVIDOR PURO SABOR ACTIVO`);
    console.log(`👉 Menú Público:   http://localhost:${PORT}`);
    console.log(`👉 Mesa (ejemplo): http://localhost:${PORT}/mesa/1`);
    console.log(`👉 Mesa General:   http://localhost:${PORT}/mesa/general`);
    console.log(`👉 Panel Admin:    http://localhost:${PORT}/admin`);
    console.log(`👉 Panel Mesas:    http://localhost:${PORT}/admin/mesas`);
    console.log(`==================================================`);

    // Initialize graceful shutdown (FASE 2.5)
    gracefulShutdownManager.initialize(server, io);

    // Start periodic health checks (FASE 2.3)
    startHealthCheckInterval();
  });
}

/**
 * Start periodic health checks every 30 seconds
 */
function startHealthCheckInterval() {
  const healthCheckIntervalMs = 30000; // 30 seconds

  const checkHealth = async () => {
    try {
      const waAgent = require('./services/whatsappAgent');
      const adminBot = waAgent.getBot('admin');
      const clientBot = waAgent.getBot('client');

      // Update WhatsApp bot status
      metricsCollector.updateWhatsAppStatus('admin', adminBot?.botStatus || 'disconnected');
      metricsCollector.updateWhatsAppStatus('client', clientBot?.botStatus || 'disconnected');

      // Get health snapshot
      const db = require('./config/database');
      const poolManager = db.getPoolManager?.();
      const health = metricsCollector.getHealthSnapshot(poolManager);

      // Check alerts
      await alertService.checkAndAlert(health, metricsCollector.metrics);
    } catch (err) {
      console.error('[HealthCheck] Error during periodic check:', err.message);
    }
  };

  // Run immediately, then every 30 seconds
  checkHealth();
  setInterval(checkHealth, healthCheckIntervalMs);
  console.log('[HealthCheck] Periodic health checks started (every 30s)');
}

startServer().catch(err => {
  console.error('[Server] Error fatal al iniciar:', err);
  process.exit(1);
});
