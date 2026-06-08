require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// ── Socket.io ──────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

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

// ── Inicializar WhatsApp Agent ──────────────────────────────────────────────
const waAgent = require('./services/whatsappAgent');
waAgent.inicializarWhatsApp(io).catch(err => {
  console.error('[Server] Error al iniciar el agente de WhatsApp:', err.message);
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
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
  console.log(`[${new Date().toISOString().split('T')[1].slice(0, 8)}] ${req.method} ${req.url}`);
  next();
});

// ── Rutas API ──────────────────────────────────────────────────────────────
const authRoutes = require('./routes/auth');
const categoriasRoutes = require('./routes/categorias');
const productosRoutes = require('./routes/productos');
const mesasRoutes = require('./routes/mesas');
const configRoutes = require('./routes/config');
const inventarioRoutes = require('./routes/inventario');

app.use('/api/admin', authRoutes);
app.use('/api/categorias', categoriasRoutes);
app.use('/api/productos', productosRoutes);
app.use('/api/mesas', mesasRoutes);
app.use('/api/config', configRoutes);
app.use('/api/inventario', inventarioRoutes);

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
app.use((err, req, res, next) => {
  console.error('Error no controlado:', err.stack);
  res.status(500).json({
    success: false,
    message: 'Ocurrió un error en el servidor.',
    error: process.env.NODE_ENV === 'development' ? err.message : {}
  });
});

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
