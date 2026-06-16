# 📊 Informe de Oportunidades de Mejora - Puro Sabor

**Fecha:** 15 de junio de 2026  
**Proyecto:** Sitio Web Puro Sabor - Menú Interactivo y Panel Administrativo  
**Estado:** Análisis Completo

---

## 📋 Resumen Ejecutivo

El proyecto es una aplicación full-stack moderna para gestión de restaurante con menú digital interactivo, panel administrativo y integración con WhatsApp. Se han identificado **35+ oportunidades de mejora** organizadas en 7 categorías principales que pueden aumentar seguridad, performance, mantenibilidad y experiencia de usuario.

**Impacto Potencial:**
- 🔒 **Seguridad:** 8 mejoras críticas
- ⚡ **Performance:** 7 mejoras de impacto alto
- 🏗️ **Arquitectura:** 9 mejoras estructurales
- 📝 **Código:** 6 mejoras de calidad
- ✨ **UX/Frontend:** 5 mejoras de experiencia
- 📱 **Funcionalidades:** 4 nuevas capacidades

---

## 🔒 1. SEGURIDAD (Crítico)

### 1.1 **JWT Secret Hardcodeado** ⚠️ CRÍTICO
**Ubicación:** `backend/middleware/auth.js:26` y `backend/routes/auth.js:53`

**Problema:**
```javascript
const secret = process.env.JWT_SECRET || 'puro_sabor_secreto_super_seguro_2026';
```
- El secret por defecto es débil y predecible
- Cualquiera que acceda al código puede falsificar tokens
- No hay rotación de secrets

**Impacto:** Alto - Compromete toda la autenticación  
**Solución:**
- ✅ Obligar JWT_SECRET en variables de entorno
- ✅ Validar en startup si no existe
- ✅ Implementar rotación periódica de secrets

```javascript
// backend/middleware/auth.js - MEJORADO
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET must be defined in environment variables');
}

function verificarJWT(req, res, next) {
  // ... resto del código
  const decoded = jwt.verify(token, JWT_SECRET);
}
```

---

### 1.2 **SQL Injection en Adaptador PostgreSQL** ⚠️ CRÍTICO
**Ubicación:** `backend/config/database.js:18-22`

**Problema:**
```javascript
function convertQueryToPg(sql) {
  let i = 1;
  return sql.replace(/\?/g, () => `$${i++}`);  // Simplista, sin validación
}
```
- Conversión de placeholders es manual y frágil
- No usa prepared statements nativos de PostgreSQL
- Vulnerable si hay "?" en strings comentarios

**Impacto:** Crítico - Inyección SQL potencial  
**Solución:**
- ✅ Usar el cliente PostgreSQL directamente (queries parametrizadas)
- ✅ No hacer conversión manual de SQL

```javascript
// MEJORADO - Usar pg directamente
pool.query(pgSql, params, (err, result) => {
  // pg maneja automáticamente los placeholders
});
```

---

### 1.3 **CORS Abierto al Público** ⚠️ ALTO
**Ubicación:** `backend/server.js:14-15` y `backend/server.js:120`

**Problema:**
```javascript
cors: { origin: '*', methods: ['GET', 'POST'] }  // Socket.io
cors({ origin: true, credentials: true })        // Express
```
- Socket.io permite CUALQUIER origen
- Express permite CORS con credenciales de cualquier lugar
- Riesgo de CSRF

**Solución:**
```javascript
const allowedOrigins = [
  'https://restaurantepurosabor.com',
  'https://www.restaurantepurosabor.com',
  process.env.FRONTEND_URL
];

// Socket.io
const io = new Server(server, {
  cors: { 
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Express
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  optionsSuccessStatus: 200
}));
```

---

### 1.4 **Token en Query Parameters** ⚠️ ALTO
**Ubicación:** `backend/middleware/auth.js:15`

**Problema:**
```javascript
if (!token) {
  token = req.query.token;  // ❌ Inseguro
}
```
- Los query params se guardan en historial del navegador
- Los proxies pueden loggear URLs completas
- Los servidores pueden guardar logs con tokens

**Solución:** Eliminar acceso a tokens vía query params
```javascript
function verificarJWT(req, res, next) {
  let token = req.headers['authorization'];
  if (token?.startsWith('Bearer ')) {
    token = token.slice(7);
  } else if (req.cookies?.authToken) {
    token = req.cookies.authToken;
  }
  
  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'Token requerido' 
    });
  }
  // ...
}
```

---

### 1.5 **Contraseñas sin Validación** ⚠️ MEDIO
**Ubicación:** `backend/routes/auth.js` (creación de admins)

**Problema:**
- No hay validación de fortaleza de contraseña en `/api/admin/register`
- No hay rate limiting en login
- No hay protección contra fuerza bruta

**Solución:**
```javascript
const passwordSchema = {
  minLength: 12,
  requireUppercase: true,
  requireNumbers: true,
  requireSpecialChars: true
};

function validarContraseña(password) {
  const errors = [];
  if (password.length < passwordSchema.minLength) 
    errors.push('Mínimo 12 caracteres');
  if (!/[A-Z]/.test(password)) 
    errors.push('Requiere mayúscula');
  if (!/[0-9]/.test(password)) 
    errors.push('Requiere número');
  if (!/[!@#$%^&*]/.test(password)) 
    errors.push('Requiere carácter especial');
  return errors;
}
```

---

### 1.6 **Falta Rate Limiting** ⚠️ MEDIO
**Ubicación:** Rutas API sin protección

**Problema:**
- Endpoints vulnerables a ataques de fuerza bruta
- Sin límite de requests por IP/usuario
- Login puede intentarse infinitas veces

**Solución:**
```bash
npm install express-rate-limit redis
```

```javascript
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // 5 intentos
  message: 'Demasiados intentos de login. Intenta más tarde.'
});

router.post('/login', loginLimiter, (req, res) => {
  // ...
});
```

---

### 1.7 **Sin Validación de Entrada** ⚠️ MEDIO
**Ubicación:** Todas las rutas API

**Problema:**
```javascript
router.post('/login', (req, res) => {
  const { usuario, password } = req.body;
  // Sin validación de tipos, length, caracteres
});
```

**Solución:**
```bash
npm install joi
```

```javascript
const schema = Joi.object({
  usuario: Joi.string().alphanum().min(3).max(30).required(),
  password: Joi.string().min(8).required()
});

router.post('/login', (req, res) => {
  const { error, value } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ success: false, message: error.details[0].message });
  }
  // ...
});
```

---

### 1.8 **Credenciales en .env sin Encriptación** ⚠️ BAJO
**Ubicación:** `.env`

**Problema:**
- API keys de Google Gemini almacenadas en texto plano
- WhatsApp credentials sin protección
- Database URL expuesta

**Solución en Production:**
- ✅ Usar AWS Secrets Manager / Azure Key Vault
- ✅ Nunca commitear .env (ya está en .gitignore)
- ✅ En Vercel/Heroku: usar variables de entorno del dashboard

```bash
# Para desarrollo local - crear .env.local con .env.example como referencia
echo ".env.local" >> .gitignore
```

---

## ⚡ 2. PERFORMANCE

### 2.1 **Sin Paginación de Datos** ⚠️ ALTO
**Ubicación:** `backend/routes/productos.js`, `backend/routes/categorias.js`

**Problema:**
- Si hay 1000+ productos, se carga TODO de una vez
- Primera carga lenta
- Alto uso de memoria del cliente

**Solución:**
```javascript
// backend/routes/productos.js
router.get('/', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;

  db.all(
    'SELECT * FROM productos WHERE activo = 1 LIMIT ? OFFSET ?',
    [limit, offset],
    (err, productos) => {
      db.get('SELECT COUNT(*) as total FROM productos WHERE activo = 1', [], (err, count) => {
        res.json({
          data: productos,
          pagination: {
            page,
            limit,
            total: count.total,
            pages: Math.ceil(count.total / limit)
          }
        });
      });
    }
  );
});
```

---

### 2.2 **Sin Caché de Datos Estáticos** ⚠️ MEDIO
**Ubicación:** Rutas GET para categorías y productos

**Problema:**
- Cada request consulta la BD
- Categorías casi nunca cambian
- Productos cambian ocasionalmente

**Solución:**
```bash
npm install node-cache
```

```javascript
const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 600 }); // 10 minutos

router.get('/categorias', (req, res) => {
  let categorias = cache.get('categorias');
  
  if (!categorias) {
    db.all('SELECT * FROM categorias WHERE activa = 1 ORDER BY orden', [], (err, data) => {
      cache.set('categorias', data);
      res.json(data);
    });
  } else {
    res.json(categorias);
  }
});
```

---

### 2.3 **Imágenes sin Optimización** ⚠️ MEDIO
**Ubicación:** `public/uploads/` - archivos de imagen

**Problema:**
- Sin compresión
- Sin redimensionamiento
- Sin WebP/formatos modernos
- Cargas lentas en móvil

**Solución:**
```bash
npm install sharp
```

```javascript
const sharp = require('sharp');
const multer = require('multer');

const upload = multer({ 
  dest: 'public/uploads/temp',
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

router.post('/upload-producto-imagen', upload.single('imagen'), async (req, res) => {
  try {
    const filename = `${Date.now()}.webp`;
    
    await sharp(req.file.path)
      .resize(800, 600, { fit: 'cover' })
      .webp({ quality: 80 })
      .toFile(`public/uploads/${filename}`);
    
    res.json({ success: true, url: `/uploads/${filename}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
```

---

### 2.4 **Sin Índices en BD** ⚠️ MEDIO
**Ubicación:** `backend/config/database.js`

**Problema:**
- Búsquedas por usuario en login son lentas (sin índice)
- Búsquedas de productos por categoría sin optimizar
- Queries complejas sin análisis EXPLAIN

**Solución:**
```javascript
async function inicializarTablas() {
  // ... crear tablas ...
  
  // Agregar índices
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_admins_usuario 
    ON admins(usuario)
  `);
  
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_productos_categoria 
    ON productos(categoria_id)
  `);
  
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sesiones_mesa_estado 
    ON sesiones_mesa(estado)
  `);
  
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_pedidos_mesa 
    ON pedidos(mesa_numero, creado_en DESC)
  `);
}
```

---

### 2.5 **Socket.io sin Compresión** ⚠️ BAJO
**Ubicación:** `backend/server.js:14-16`

**Problema:**
- Mensajes no comprimidos en WebSockets
- Aumenta consumo de ancho de banda

**Solución:**
```javascript
const io = new Server(server, {
  cors: { /* ... */ },
  transports: ['websocket', 'polling'],
  perMessageDeflate: {
    threshold: 1024,
    zlibDeflateOptions: {
      chunkSize: 1024,
      memLevel: 7,
      level: 3
    }
  }
});
```

---

### 2.6 **Lazy Loading de Componentes** ⚠️ MEDIO
**Ubicación:** `public/js/main.js`

**Problema:**
- Toda la lógica en un solo archivo
- Sin code splitting

**Solución:** Modularizar el código
```javascript
// public/js/modules/cart.js
export class Cart {
  constructor() { /* ... */ }
  add(item) { /* ... */ }
}

// public/js/modules/menu.js
export class Menu {
  constructor() { /* ... */ }
  render() { /* ... */ }
}

// public/js/main.js
import { Cart } from './modules/cart.js';
import { Menu } from './modules/menu.js';

document.addEventListener('DOMContentLoaded', () => {
  const cart = new Cart();
  const menu = new Menu();
  // ...
});
```

---

### 2.7 **Sin Compresión Gzip** ⚠️ BAJO
**Ubicación:** `backend/server.js`

**Problema:**
- Respuestas JSON sin comprimir
- Aumenta tráfico de red

**Solución:**
```bash
npm install compression
```

```javascript
const compression = require('compression');
app.use(compression());
```

---

## 🏗️ 3. ARQUITECTURA

### 3.1 **Callbacks en Lugar de Promises/Async-Await** ⚠️ ALTO
**Ubicación:** Todas las rutas - patrón de callbacks con `db.run`, `db.get`, `db.all`

**Problema:**
```javascript
// Callback Hell / Pyramid of Doom
db.get('SELECT * FROM admins WHERE usuario = ?', [usuario], (err, admin) => {
  if (err) return res.status(500).json(...);
  if (!admin) return res.status(401).json(...);
  
  bcrypt.compare(password, admin.password_hash, (err, isMatch) => {
    if (err) return res.status(500).json(...);
    if (!isMatch) return res.status(401).json(...);
    
    db.run('UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [admin.id]);
    // Más callbacks anidados...
  });
});
```

- Difícil de mantener
- Propenso a errores
- Sin manejo de errores consistente

**Solución:** Promisificar la capa de datos
```bash
npm install util
```

```javascript
// backend/config/database-promise.js
const util = require('util');

const dbAsync = {
  run: util.promisify(db.run.bind(db)),
  get: util.promisify(db.get.bind(db)),
  all: util.promisify(db.all.bind(db))
};

module.exports = dbAsync;

// Uso en rutas:
router.post('/login', async (req, res) => {
  try {
    const { usuario, password } = req.body;
    
    const admin = await dbAsync.get(
      'SELECT * FROM admins WHERE usuario = ? AND activo = 1',
      [usuario]
    );
    
    if (!admin) {
      return res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
    }
    
    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
    }
    
    await dbAsync.run('UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [admin.id]);
    
    const token = jwt.sign(
      { id: admin.id, usuario: admin.usuario, email: admin.email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.json({ success: true, token, admin: { id: admin.id, usuario: admin.usuario } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error en el servidor', error: error.message });
  }
});
```

---

### 3.2 **Falta Estructura de Servicios** ⚠️ MEDIO
**Ubicación:** Lógica de negocio dispersa en las rutas

**Problema:**
- Lógica de negocio en las rutas en lugar de servicios
- Difícil de testear
- Duplicación de código

**Solución:** Crear capa de servicios
```javascript
// backend/services/authService.js
class AuthService {
  async login(usuario, password) {
    const admin = await dbAsync.get(
      'SELECT * FROM admins WHERE usuario = ? AND activo = 1',
      [usuario]
    );
    
    if (!admin) throw new Error('Credenciales incorrectas');
    
    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) throw new Error('Credenciales incorrectas');
    
    await dbAsync.run(
      'UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
      [admin.id]
    );
    
    const token = jwt.sign(
      { id: admin.id, usuario: admin.usuario, email: admin.email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    return { token, admin };
  }
}

module.exports = new AuthService();

// backend/routes/auth.js
const authService = require('../services/authService');

router.post('/login', async (req, res) => {
  try {
    const result = await authService.login(req.body.usuario, req.body.password);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(401).json({ success: false, message: error.message });
  }
});
```

---

### 3.3 **Sin Validación de Esquema** ⚠️ MEDIO
**Ubicación:** Todas las rutas API

**Problema:**
- Sin validación centralizada de entrada
- Difícil de mantener reglas de validación
- Sin documentación de qué campos son necesarios

**Solución:**
```bash
npm install joi
```

```javascript
// backend/schemas/index.js
const Joi = require('joi');

module.exports = {
  loginSchema: Joi.object({
    usuario: Joi.string().alphanum().min(3).max(30).required(),
    password: Joi.string().min(8).required()
  }),
  
  productoSchema: Joi.object({
    nombre: Joi.string().max(255).required(),
    descripcion: Joi.string().allow(''),
    precio: Joi.number().positive().required(),
    categoria_id: Joi.number().integer().required(),
    stock: Joi.number().integer().min(0),
    imagen_url: Joi.string().uri().allow('')
  })
};

// Middleware de validación reutilizable
const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Validación fallida',
      errors: error.details.map(d => d.message)
    });
  }
  req.body = value;
  next();
};

// Uso:
router.post('/login', validate(schemas.loginSchema), async (req, res) => {
  // req.body ya está validado
});
```

---

### 3.4 **Sin Manejo de Errores Centralizado** ⚠️ MEDIO
**Ubicación:** `backend/server.js:198-205`

**Problema:**
```javascript
app.use((err, req, res, next) => {
  console.error('Error no controlado:', err.stack);
  res.status(500).json({
    success: false,
    message: 'Ocurrió un error en el servidor.',
    error: process.env.NODE_ENV === 'development' ? err.message : {}
  });
});
```
- Handler genérico al final
- Sin tipología de errores
- Sin logs estructurados

**Solución:**
```javascript
// backend/errors/AppError.js
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;

// backend/middleware/errorHandler.js
const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  
  const response = {
    success: false,
    message: err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  };
  
  // Log estructurado
  console.error({
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    statusCode: err.statusCode,
    message: err.message,
    userId: req.admin?.id
  });
  
  res.status(err.statusCode).json(response);
};

// Uso:
router.post('/login', async (req, res, next) => {
  try {
    const result = await authService.login(req.body.usuario, req.body.password);
    res.json({ success: true, ...result });
  } catch (error) {
    next(new AppError(error.message, 401));
  }
});

app.use(errorHandler);
```

---

### 3.5 **Rutas sin Documentación** ⚠️ BAJO
**Ubicación:** `backend/routes/`

**Problema:**
- Sin documentación de endpoints
- Sin swagger/OpenAPI
- Difícil para frontend developers

**Solución:**
```bash
npm install swagger-jsdoc swagger-ui-express
```

```javascript
// backend/swagger.js
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Puro Sabor API',
      version: '1.0.0',
      description: 'API para Restaurante Puro Sabor'
    },
    servers: [{ url: '/api' }]
  },
  apis: ['./backend/routes/*.js']
};

const specs = swaggerJsdoc(options);

module.exports = { swaggerUi, specs };

// backend/server.js
const { swaggerUi, specs } = require('./swagger');
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

// En rutas:
/**
 * @swagger
 * /admin/login:
 *   post:
 *     summary: Login de administrador
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               usuario:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login exitoso
 */
```

---

### 3.6 **Variables de Entorno sin Validación** ⚠️ BAJO
**Ubicación:** `backend/server.js:1`

**Problema:**
```javascript
require('dotenv').config();
// Sin validar que las variables necesarias existan
const PORT = process.env.PORT || 3000; // Fallback puede ocultar problemas
```

**Solución:**
```javascript
// backend/config/env.js
require('dotenv').config();

const requiredEnvs = [
  'DATABASE_URL',
  'JWT_SECRET',
  'NODE_ENV'
];

const missingEnvs = requiredEnvs.filter(env => !process.env[env]);
if (missingEnvs.length > 0) {
  throw new Error(`Variables de entorno faltantes: ${missingEnvs.join(', ')}`);
}

module.exports = {
  PORT: process.env.PORT || 3000,
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  NODE_ENV: process.env.NODE_ENV || 'development',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY
};

// Uso:
const env = require('./config/env');
const PORT = env.PORT;
```

---

### 3.7 **Configuración de Mesas Hardcodeada** ⚠️ MEDIO
**Ubicación:** `backend/config/database.js:237-239`

**Problema:**
```javascript
for (let i = 1; i <= 6; i++) {
  db.run('INSERT INTO mesas (numero, nombre) VALUES (?, ?)', [i, `Mesa ${i}`]);
}
```
- Número de mesas fijo
- Difícil de cambiar sin modificar código

**Solución:**
```javascript
// Mover a config o usar variable de entorno
const NUM_MESAS = parseInt(process.env.NUM_MESAS || '6');

function sembrarMesasIniciales() {
  db.get('SELECT COUNT(*) as count FROM mesas', (err, row) => {
    if (!err && row && parseInt(row.count) === 0) {
      for (let i = 1; i <= NUM_MESAS; i++) {
        db.run('INSERT INTO mesas (numero, nombre) VALUES (?, ?)', [i, `Mesa ${i}`]);
      }
    }
  });
}
```

---

### 3.8 **Socket.io sin Namespaces** ⚠️ BAJO
**Ubicación:** `backend/server.js:13-76`

**Problema:**
```javascript
io.on('connection', (socket) => {
  socket.on('unirse_mesa', (mesaNumero) => { /* ... */ });
  socket.on('actualizar_carrito', ({ mesaNumero, items }) => { /* ... */ });
  // Todo en el mismo namespace
});
```
- Difícil de mantener múltiples eventos
- Sin organización lógica
- Difícil de escalar

**Solución:**
```javascript
// backend/sockets/carrito.js
module.exports = (io) => {
  const cartNamespace = io.of('/carrito');
  
  cartNamespace.on('connection', (socket) => {
    socket.on('unirse_mesa', (mesaNumero) => {
      socket.join(`mesa_${mesaNumero}`);
      // ...
    });
    
    socket.on('actualizar_carrito', ({ mesaNumero, items }) => {
      socket.to(`mesa_${mesaNumero}`).emit('carrito_actualizado', items);
    });
  });
};

// backend/server.js
const carritoSocket = require('./sockets/carrito');
carritoSocket(io);
```

---

### 3.9 **Sin Logs Estructurados** ⚠️ BAJO
**Ubicación:** `backend/server.js:139` - usa console.log

**Problema:**
```javascript
console.log(`[${new Date().toISOString().split('T')[1].slice(0, 8)}] ${req.method} ${req.url}`);
```
- Logs difíciles de parsear
- Sin niveles de severidad
- Difícil de buscar/analizar

**Solución:**
```bash
npm install winston
```

```javascript
// backend/config/logger.js
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

module.exports = logger;

// Uso:
const logger = require('./config/logger');

app.use((req, res, next) => {
  logger.info({
    method: req.method,
    url: req.url,
    ip: req.ip,
    timestamp: new Date().toISOString()
  });
  next();
});
```

---

## 📝 4. CÓDIGO Y MANTENIBILIDAD

### 4.1 **Variables Mal Nombradas** ⚠️ BAJO
**Ubicación:** `public/js/main.js` y otros archivos

**Problema:**
```javascript
let agp = {};      // ¿Qué es agp?
let catMigas = {}; // Específico para Migas, no generalizable
let fabCart = {};  // FAB es poco claro
```

**Solución:**
```javascript
let productsGroupedByName = {};
let defaultCategory = {};
let cartFloatingActionButton = {};
```

---

### 4.2 **Sin Comentarios en Lógica Compleja** ⚠️ BAJO
**Ubicación:** `public/js/main.js:85-120` (agrupación de productos)

**Problema:**
```javascript
function agruparProductos(lista) {
  const agp = {};
  lista.forEach(prod => {
    const match = prod.nombre.match(/^(.*?)\s*\((.*?)\)$/i);
    // ¿Por qué este regex? ¿Qué espera?
```

**Solución:**
```javascript
function agruparProductos(lista) {
  // Agrupa productos con variantes (ej: "Migas (Pequeña)", "Migas (Grande)")
  // El formato esperado es: NombreBase (Variante)
  const productsGroupedByName = {};
  lista.forEach(prod => {
    // Extrae "NombreBase" y "Variante" del patrón: "NombreBase (Variante)"
    const match = prod.nombre.match(/^(.*?)\s*\((.*?)\)$/i);
    
    if (match) {
      const baseName = match[1].trim();
      const variant = match[2].trim();
      
      // ...
```

---

### 4.3 **Sin TypeScript** ⚠️ BAJO
**Ubicación:** Proyecto entero

**Problema:**
- Errores de tipo en runtime
- Sin autocompletado de IDE
- Difícil de refactorizar

**Solución:** Migración gradual a TypeScript (puede ser proyecto separado)
```bash
npm install --save-dev typescript @types/node @types/express
npx tsc --init
```

---

### 4.4 **Sin Testing** ⚠️ MEDIO
**Ubicación:** Sin directorio `test/` o `__tests__/`

**Problema:**
- Cambios rompen sin saber
- Sin confianza en refactorización
- Bugs en producción

**Solución:**
```bash
npm install --save-dev jest supertest
```

```javascript
// backend/routes/__tests__/auth.test.js
const request = require('supertest');
const app = require('../../server');

describe('POST /api/admin/login', () => {
  it('debe retornar 401 con credenciales inválidas', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ usuario: 'fake', password: 'wrong' });
    
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
  
  it('debe retornar token con credenciales válidas', async () => {
    // Crear usuario de prueba primero
    const res = await request(app)
      .post('/api/admin/login')
      .send({ usuario: 'admin', password: 'password' });
    
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });
});

// package.json - agregar:
"test": "jest"
```

---

### 4.5 **Funciones Muy Largas** ⚠️ BAJO
**Ubicación:** `public/js/main.js` - función `init()` y `renderMenu()`

**Problema:**
- Funciones de 50+ líneas
- Múltiples responsabilidades
- Difícil de testear

**Solución:** Dividir en funciones más pequeñas
```javascript
// Antes: init() hace todo
async function init() {
  mostrarCarga();
  categorias = await API.getCategorias();
  productos = await API.getProductos();
  const catMigas = categorias.find(c => c.nombre.toLowerCase().includes('migas'));
  if (catMigas) categoriaActiva = catMigas.id;
  renderCategorias();
  renderMenu();
  configurarEventos();
}

// Después: funciones separadas
async function cargarDatos() {
  const [categorias_, productos_] = await Promise.all([
    API.getCategorias(),
    API.getProductos()
  ]);
  categorias = categorias_;
  productos = productos_;
}

function establecerCategoriaDefecto() {
  const catMigas = categorias.find(c => c.nombre.toLowerCase().includes('migas'));
  categoriaActiva = catMigas?.id || '';
}

async function init() {
  mostrarCarga();
  await cargarDatos();
  establecerCategoriaDefecto();
  renderCategorias();
  renderMenu();
  configurarEventos();
}
```

---

### 4.6 **Sin Versionado de API** ⚠️ BAJO
**Ubicación:** Rutas en `backend/routes/` sin versionado

**Problema:**
```
/api/productos
/api/categorias
```
- Sin forma de mantener retrocompatibilidad
- Cambios rompen clientes viejos

**Solución:**
```javascript
// Agrupar por versión
app.use('/api/v1/categorias', categoriasRoutes);
app.use('/api/v1/productos', productosRoutes);

// O con routing específico
app.use('/api/v2/', require('./routes/v2'));
app.use('/api/v1/', require('./routes/v1'));
```

---

## ✨ 5. UX / FRONTEND

### 5.1 **Sin Indicadores de Carga en Operaciones Async** ⚠️ BAJO
**Ubicación:** `public/js/main.js` - llamadas a API

**Problema:**
```javascript
btnCheckout.addEventListener('click', () => {
  enviarPedido(); // ¿Cuánto tarda? ¿Se envió?
});
```
- Sin feedback visual
- Usuario puede hacer click varias veces
- Sin manejo de errores visible

**Solución:**
```javascript
const btnCheckout = document.getElementById('btn-checkout');
let isProcessing = false;

btnCheckout.addEventListener('click', async () => {
  if (isProcessing) return;
  
  isProcessing = true;
  btnCheckout.disabled = true;
  btnCheckout.innerHTML = '<span class="spinner"></span> Enviando...';
  
  try {
    await enviarPedido();
    btnCheckout.innerHTML = '✅ Pedido enviado';
    setTimeout(() => {
      btnCheckout.innerHTML = 'Confirmar Pedido';
      btnCheckout.disabled = false;
      isProcessing = false;
    }, 2000);
  } catch (error) {
    btnCheckout.innerHTML = '❌ Error al enviar';
    setTimeout(() => {
      btnCheckout.innerHTML = 'Confirmar Pedido';
      btnCheckout.disabled = false;
      isProcessing = false;
    }, 2000);
  }
});
```

---

### 5.2 **Sin Validación de Campos en Frontend** ⚠️ BAJO
**Ubicación:** Formularios en admin

**Problema:**
- Sin validación antes de enviar
- Campos vacíos se envían al servidor
- Mala UX

**Solución:**
```javascript
const formProducto = document.getElementById('form-producto');
const inputNombre = document.getElementById('input-nombre');
const inputPrecio = document.getElementById('input-precio');

formProducto.addEventListener('submit', (e) => {
  e.preventDefault();
  
  const errors = [];
  
  if (!inputNombre.value.trim()) {
    errors.push('El nombre es requerido');
    inputNombre.classList.add('error');
  }
  
  if (!inputPrecio.value || isNaN(inputPrecio.value) || inputPrecio.value <= 0) {
    errors.push('El precio debe ser un número positivo');
    inputPrecio.classList.add('error');
  }
  
  if (errors.length > 0) {
    mostrarError(errors.join('\n'));
    return;
  }
  
  enviarFormulario();
});
```

---

### 5.3 **Sin Manejo de Errores de Red en Frontend** ⚠️ BAJO
**Ubicación:** `public/js/api.js`

**Problema:**
```javascript
async function getProductos() {
  const response = await fetch('/api/productos');
  return response.json();
  // ¿Qué pasa si no hay conexión?
}
```

**Solución:**
```javascript
async function getProductos() {
  try {
    const response = await fetch('/api/productos', {
      signal: AbortSignal.timeout(5000) // 5s timeout
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('La solicitud tardó demasiado. Revisa tu conexión.');
    }
    if (error instanceof TypeError) {
      throw new Error('Error de conexión. Revisa tu conexión a internet.');
    }
    throw error;
  }
}
```

---

### 5.4 **Sin PWA / Instalabilidad** ⚠️ BAJO
**Ubicación:** Falta `manifest.json` y service worker

**Problema:**
- No se puede instalar como app
- Sin offline support
- Sin acceso de escritorio

**Solución:**
```bash
npm install workbox-webpack-plugin  # Si usas webpack
# O crear manualmente:
```

```json
// public/manifest.json
{
  "name": "Puro Sabor - Menú Interactivo",
  "short_name": "Puro Sabor",
  "description": "Menú digital y sistema de pedidos del Restaurante Puro Sabor",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#FF6B35",
  "icons": [
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

```html
<!-- public/index.html -->
<head>
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#FF6B35">
</head>
```

---

### 5.5 **Sin Dark Mode** ⚠️ BAJO
**Ubicación:** Estilos CSS

**Problema:**
- Solo tema claro
- Fuerza al usuario a ojos cansados de noche

**Solución:**
```css
/* public/css/styles.css */
:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f5f5f5;
  --text-primary: #000000;
  --text-secondary: #666666;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #1a1a1a;
    --bg-secondary: #2a2a2a;
    --text-primary: #ffffff;
    --text-secondary: #cccccc;
  }
}

body {
  background-color: var(--bg-primary);
  color: var(--text-primary);
}
```

---

## 📱 6. NUEVAS FUNCIONALIDADES

### 6.1 **Sistema de Pedidos Recurrentes** 
**Impacto:** Aumenta ventas y facilita clientes regulares

**Descripción:**
Permitir que clientes ordenen "platos favoritos" que puedan reutilizar

```javascript
// backend/routes/pedidos.js
router.post('/guardar-favorito', verificarJWT, async (req, res) => {
  // Guardar carrito actual como favorito
  const { nombre, items } = req.body;
  const usuarioId = req.admin?.id;
  
  await dbAsync.run(
    'INSERT INTO pedidos_favoritos (usuario_id, nombre, items_json) VALUES (?, ?, ?)',
    [usuarioId, nombre, JSON.stringify(items)]
  );
  
  res.json({ success: true, message: 'Favorito guardado' });
});
```

---

### 6.2 **Notificaciones en Tiempo Real**
**Impacto:** Mejor comunicación con clientes

**Descripción:**
- Confirmación de pedido
- Estimado de tiempo
- Notificación cuando está listo

```javascript
// Usando Socket.io ya configurado
socket.emit('pedido_confirmado', {
  numero: 123,
  estimado: 15,
  mensaje: 'Tu pedido será listo en ~15 minutos'
});
```

---

### 6.3 **Sistema de Reseñas/Valoraciones**
**Impacto:** Feedback de clientes, social proof

**Descripción:**
QR al final del pedido para valorar

```javascript
// backend/routes/reviews.js
router.post('/crear', async (req, res) => {
  const { pedido_id, calificacion, comentario } = req.body;
  
  await dbAsync.run(
    'INSERT INTO reviews (pedido_id, calificacion, comentario) VALUES (?, ?, ?)',
    [pedido_id, calificacion, comentario]
  );
  
  res.json({ success: true });
});
```

---

### 6.4 **Estadísticas y Reportes**
**Impacto:** Toma de decisiones basada en datos

**Descripción:**
- Productos más vendidos
- Horarios pico
- Ingresos por período
- Tendencias

```javascript
// backend/routes/reportes.js
router.get('/productos-populares', verificarJWT, async (req, res) => {
  const reportes = await dbAsync.all(`
    SELECT 
      p.nombre,
      COUNT(*) as veces_ordenado,
      SUM(p.precio) as ingresos_totales
    FROM pedidos_items pi
    JOIN productos p ON pi.producto_id = p.id
    WHERE pi.creado_en > NOW() - INTERVAL '30 days'
    GROUP BY p.id
    ORDER BY veces_ordenado DESC
    LIMIT 10
  `);
  
  res.json(reportes);
});
```

---

## 📊 7. MATRIZ DE PRIORIZACIÓN

| **Mejora** | **Categoría** | **Impacto** | **Esfuerzo** | **Prioridad** |
|-----------|-----------|-----------|-----------|-----------|
| JWT Secret Hardcodeado | Seguridad | 🔴 Crítico | 🟢 Bajo | 🔴 P0 |
| SQL Injection | Seguridad | 🔴 Crítico | 🟡 Medio | 🔴 P0 |
| CORS Abierto | Seguridad | 🔴 Alto | 🟢 Bajo | 🔴 P0 |
| Token en Query | Seguridad | 🔴 Alto | 🟢 Bajo | 🔴 P0 |
| Rate Limiting | Seguridad | 🟠 Medio | 🟡 Medio | 🟠 P1 |
| Callbacks → Async/Await | Arquitectura | 🟠 Medio | 🔴 Alto | 🟠 P1 |
| Paginación | Performance | 🟠 Medio | 🟡 Medio | 🟠 P1 |
| Validación de Esquemas | Arquitectura | 🟠 Medio | 🟡 Medio | 🟠 P1 |
| Tests | Código | 🟠 Medio | 🔴 Alto | 🟡 P2 |
| Caché | Performance | 🟡 Bajo | 🟡 Medio | 🟡 P2 |
| Optimización de Imágenes | Performance | 🟡 Bajo | 🟡 Medio | 🟡 P2 |
| Índices BD | Performance | 🟡 Bajo | 🟢 Bajo | 🟡 P2 |
| TypeScript | Código | 🟡 Bajo | 🔴 Alto | 🟡 P3 |
| PWA | Frontend | 🟡 Bajo | 🟡 Medio | 🟡 P3 |

---

## 🚀 PLAN DE ACCIÓN RECOMENDADO

### **Fase 1: Seguridad (Semana 1-2)** - CRÍTICO
- [ ] 1.1 JWT Secret obligatorio
- [ ] 1.2 Usar prepared statements nativos de PG
- [ ] 1.3 CORS a dominios específicos
- [ ] 1.4 Remover token de query params
- [ ] 1.6 Rate limiting en login

### **Fase 2: Arquitectura Base (Semana 3-4)** - IMPORTANTE
- [ ] 3.1 Promisificar base de datos
- [ ] 3.2 Crear capa de servicios
- [ ] 3.3 Validación con Joi
- [ ] 3.4 Error handling centralizado
- [ ] 3.9 Logs estructurados con Winston

### **Fase 3: Performance (Semana 5)**
- [ ] 2.1 Paginación de datos
- [ ] 2.2 Node-cache para datos estáticos
- [ ] 2.4 Índices en BD
- [ ] 2.7 Gzip compression

### **Fase 4: Testing & QA (Semana 6)**
- [ ] 4.4 Tests unitarios e integración
- [ ] Documentación con Swagger

### **Fase 5: UX/Features (Semana 7+)**
- [ ] 5.1-5.5 Mejoras frontend
- [ ] 6.1-6.4 Nuevas funcionalidades

---

## 📚 RECURSOS RECOMENDADOS

- **Seguridad:** [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- **Testing:** [Jest Documentation](https://jestjs.io/)
- **Validación:** [Joi Documentation](https://joi.dev/)
- **Logs:** [Winston Logger](https://github.com/winstonjs/winston)
- **API Docs:** [Swagger/OpenAPI](https://swagger.io/)

---

## 📝 CONCLUSIÓN

El proyecto tiene una **base sólida** pero necesita **mejoras en seguridad y arquitectura** antes de escalar. Las recomendaciones están prorizadas para maximizar impacto con esfuerzo mínimo.

**Próximos pasos:**
1. Revisar con el equipo esta lista
2. Seleccionar mejoras según roadmap
3. Crear issues en el sistema de tracking
4. Asignar puntos de esfuerzo
5. Comenzar con Fase 1 (Seguridad)

---

**Generado por:** Claude Code  
**Análisis de:** Sitio Web Puro Sabor  
**Última actualización:** 2026-06-15
