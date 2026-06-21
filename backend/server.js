// ── Cargar y validar variables de entorno ─────────────────────────────────
const env = require('./config/env');

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./config/swagger');

const logger = require('./config/logger');
const dbAsync = require('./config/database-promise');

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
if (env.DATABASE_URL) {
  try {
    const socketPool = new Pool({
      connectionString: env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
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

// ── Inicializar WhatsApp Agent Dual ───────────────────────────────────────────
const waAgent = require('./services/whatsappAgent');
waAgent.inicializarTodos(io).catch(err => {
  console.error('[Server] Error al iniciar los agentes de WhatsApp:', err.message);
});

// ── Timeout automático: revisar mesas con +2h de inactividad ──────────────
const db = require('./config/database');
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

// Compresión Gzip para reducir tamaño de respuestas
const compression = require('compression');
app.use(compression({
  filter: (req, res) => {
    // No comprimir si el cliente lo rechaza
    if (req.headers['x-no-compression']) {
      return false;
    }
    // Usar el filter default (comprime basado en Content-Type)
    return compression.filter(req, res);
  },
  level: 6 // Nivel 6: buen balance entre velocidad y compresión
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uploadsPath = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}
app.use('/uploads', express.static(uploadsPath));

const xss = require('xss-clean');
app.use(xss());

app.use((req, res, next) => {
  req.cookies = {};
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    cookieHeader.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      if (parts.length >= 2) {
        req.cookies[parts[0].trim()] = parts.slice(1).join('=').trim();
      }
    });
  }
  next();
});

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

// ── Healthcheck (para monitoreo / uptime) ──────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await dbAsync.get('SELECT 1 AS ok');
    res.json({ status: 'ok', db: 'up', uptime: Math.round(process.uptime()), ts: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'degraded', db: 'down', error: err.message });
  }
});

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
server.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`🚀 SERVIDOR PURO SABOR ACTIVO`);
  console.log(`👉 Menú Público:   http://localhost:${PORT}`);
  console.log(`👉 Mesa (ejemplo): http://localhost:${PORT}/mesa/1`);
  console.log(`👉 Mesa General:   http://localhost:${PORT}/mesa/general`);
  console.log(`👉 Panel Admin:    http://localhost:${PORT}/admin`);
  console.log(`👉 Panel Mesas:    http://localhost:${PORT}/admin/mesas`);
  console.log(`==================================================`);
});

// ── Apagado ordenado (graceful shutdown) ────────────────────────────────────
let cerrando = false;
function apagadoOrdenado(signal) {
  if (cerrando) return;
  cerrando = true;
  console.log(`[Server] ${signal} recibido. Cerrando ordenadamente...`);

  // Dejar de aceptar nuevas conexiones HTTP y terminar las en curso
  server.close(() => {
    console.log('[Server] Servidor HTTP cerrado.');
    try { io.close(); } catch (_) {}
    process.exit(0);
  });

  // Si algo queda colgado, forzar salida a los 15s
  setTimeout(() => {
    console.error('[Server] Cierre forzado tras timeout.');
    process.exit(1);
  }, 15000).unref();
}

process.on('SIGTERM', () => apagadoOrdenado('SIGTERM'));
process.on('SIGINT', () => apagadoOrdenado('SIGINT'));

// Evitar que una promesa rechazada sin manejar tumbe el proceso
process.on('unhandledRejection', (reason) => {
  console.error('[Server] Promesa rechazada sin manejar:', reason?.message || reason);
});
