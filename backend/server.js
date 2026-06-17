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
  socket.on('unirse_mesa', (mesaNumero) => {
    socket.mesaNumero = mesaNumero;
    const sala = mesaNumero === 'general' ? 'mesa_general' : `mesa_${mesaNumero}`;
    socket.join(sala);

    // Enviar el carrito actual al nuevo integrante
    const carritoActual = carritosMesa[sala] || { items: [] };
    socket.emit('carrito_actualizado', carritoActual.items);
    console.log(`[Socket] ${socket.id} se unió a ${sala}`);
    
    // Notificar al admin que la mesa tiene actividad (clientes viendo menú)
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

  socket.on('disconnect', () => {
    console.log(`[Socket] Cliente desconectado: ${socket.id}`);
    if (socket.mesaNumero) {
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

// ── Swagger Documentation ──────────────────────────────────────────────────
app.use('/api-docs', swaggerUi.serve);
app.get('/api-docs', swaggerUi.setup(swaggerSpecs, {
  swaggerOptions: {
    persistAuthorization: true
  }
}));

// ── Rutas API ──────────────────────────────────────────────────────────────
const authRoutes = require('./routes/auth');
const categoriasRoutes = require('./routes/categorias');
const productosRoutes = require('./routes/productos');
const mesasRoutes = require('./routes/mesas');
const configRoutes = require('./routes/config');
const inventarioRoutes = require('./routes/inventario');
const chatbotsRoutes = require('./routes/chatbots');

app.use('/api/admin', authRoutes);
app.use('/api/categorias', categoriasRoutes);
app.use('/api/productos', productosRoutes);
app.use('/api/mesas', mesasRoutes);
app.use('/api/config', configRoutes);
app.use('/api/inventario', inventarioRoutes);
app.use('/api/chatbots', chatbotsRoutes);

// ── Archivos estáticos ─────────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// Módulo Público en la raíz '/'
app.use('/', express.static(path.join(__dirname, '..', 'public')));

// Módulo Mesa en '/mesa'
app.use('/mesa', express.static(path.join(__dirname, '..', 'public', 'mesa')));

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
