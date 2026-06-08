# 📋 GUÍA DE DESARROLLO - MENÚ INTERACTIVO PURO SABOR

## 📌 Visión General

Desarrollar una plataforma de menú web moderna e interactiva con dos módulos:
- **Módulo Público**: Visualización del menú con UX dinámica y animaciones
- **Módulo Admin**: Panel de administración para gestionar productos, precios, disponibilidad

---

## 🎯 Objetivos del Proyecto

✅ Menú web responsivo y moderno  
✅ Animaciones fluidas y transiciones dinámicas  
✅ Panel administrativo intuitivo  
✅ Base de datos para productos e inventario  
✅ Preparado para integración futura con WhatsApp API  
✅ Preparado para integración futura con sistema de inventario  

---

## 🛠️ Stack Tecnológico Recomendado

### Frontend (Módulo Público)
- **HTML5** + **CSS3** + **JavaScript Vanilla** o **React/Vue** (si prefieres framework)
- **Animaciones**: CSS3 Animations + Intersection Observer para lazy loading
- **Iconografía**: Font Awesome o Feather Icons
- **Responsive**: Mobile First, CSS Grid y Flexbox

### Backend (Módulo Admin)
- **Node.js + Express.js** (JavaScript full-stack)
  - O **Python + Flask/Django** (si prefieres Python)
- **Base de Datos**: SQLite (desarrollo) → PostgreSQL (producción)
- **Autenticación**: JWT tokens
- **API RESTful** para comunicación frontend-backend

### Hosting
- Servidor propio (cPanel, Plesk, o Linux directo)
- Node.js con PM2 para mantener la app activa
- Base de datos alojada en el mismo servidor

---

## 📂 Estructura de Carpetas

```
puro-sabor-menu/
│
├── public/                      # Carpeta servida al cliente (módulo público)
│   ├── index.html              # Página principal del menú
│   ├── css/
│   │   ├── styles.css          # Estilos generales
│   │   ├── animations.css      # Animaciones y transiciones
│   │   └── responsive.css      # Media queries
│   ├── js/
│   │   ├── main.js             # Lógica principal
│   │   ├── api.js              # Funciones para consumir API
│   │   └── utils.js            # Funciones auxiliares
│   └── assets/
│       ├── images/             # Imágenes de productos
│       ├── icons/
│       └── logos/
│
├── admin/                       # Módulo administrativo
│   ├── index.html              # Panel de login
│   ├── dashboard.html          # Dashboard principal
│   ├── productos.html          # Gestión de productos
│   ├── css/
│   │   ├── admin-styles.css
│   │   └── responsive.css
│   ├── js/
│   │   ├── auth.js             # Autenticación
│   │   ├── productos.js        # Lógica CRUD productos
│   │   └── api-admin.js        # Llamadas a API
│   └── assets/
│
├── backend/                     # Servidor Node.js/Express
│   ├── server.js               # Punto de entrada
│   ├── config/
│   │   ├── database.js         # Configuración BD
│   │   └── auth.js             # Configuración JWT
│   ├── routes/
│   │   ├── productos.js        # Rutas CRUD productos
│   │   ├── categorias.js       # Rutas categorías
│   │   └── admin-auth.js       # Rutas autenticación
│   ├── controllers/
│   │   ├── productosController.js
│   │   ├── categoriasController.js
│   │   └── authController.js
│   ├── models/
│   │   ├── Producto.js
│   │   ├── Categoria.js
│   │   └── Admin.js
│   ├── middleware/
│   │   └── auth.js             # Verificación de JWT
│   ├── database/
│   │   └── schema.sql          # Esquema inicial
│   └── package.json
│
├── .env                         # Variables de entorno (no subir a git)
├── .gitignore
└── README.md

```

---

## 🎨 MÓDULO 1: MENÚ PÚBLICO (Frontend)

### Características Principales

#### 1. **Interfaz Visual**
- **Header**: Logo + nombre restaurante + ícono carrito
- **Buscador**: Búsqueda en tiempo real por nombre/ingrediente
- **Filtros por Categoría**: Tabs deslizables (Bebidas, Entradas, Platos Principales, etc.)
- **Grid de Productos**: Tarjetas con imagen, nombre, descripción, precio
- **Indicador de Disponibilidad**: "No disponible" en gris + opacidad
- **Carrito Flotante**: Botón fijo en esquina inferior derecha

#### 2. **Animaciones Dinámicas**
```
- Fade-in suave al cargar productos
- Hover en tarjetas: elevación (box-shadow) + escala ligera
- Transición de colores en botones
- Animación de pulse en "Agregar al carrito"
- Slider horizontal suave para categorías
- Contador de artículos en carrito con animación de bump
- Modal de detalles con entrada desde abajo (slide-up)
```

#### 3. **Modal de Producto**
Cuando hace clic en una tarjeta:
- Imagen grande del producto
- Nombre, descripción completa, precio
- Botón "Agregar al Carrito"
- Cantidad seleccionable
- Cerrar con X o clic fuera

#### 4. **Carrito de Compras**
- Vista lateral deslizable (slide-in desde derecha)
- Lista de productos con cantidad + precio
- Botón para eliminar items
- Total calculado automáticamente
- Botón "Continuar" (preparado para siguiente fase: datos cliente)

#### 5. **Responsive Design**
- Mobile: Stack vertical, menú de categorías horizontal deslizable
- Tablet: 2 columnas de productos
- Desktop: 3-4 columnas

### Flujo de Datos (Frontend)

```
1. Página carga → API GET /api/productos
2. Se renderizan tarjetas de productos
3. Usuario filtra por categoría → API GET /api/productos?categoria=X
4. Usuario busca → Filtro local en JavaScript
5. Usuario agrega al carrito → Guardado en localStorage
6. Usuario abre carrito → Se muestra desde localStorage
```

---

## 🔧 MÓDULO 2: PANEL ADMINISTRATIVO

### Características Principales

#### 1. **Autenticación**
- Login con usuario y contraseña
- Tokens JWT con expiración (24 horas)
- Sesión segura (httpOnly cookies)

#### 2. **Dashboard**
- Bienvenida al administrador
- Estadísticas rápidas:
  - Total de productos
  - Productos sin stock
  - Últimas acciones registradas
  - Gráfico simple de productos por categoría

#### 3. **Gestión de Productos (CRUD)**

**Tabla de Productos:**
- Listado paginado de todos los productos
- Columnas: Imagen, Nombre, Categoría, Precio, Stock, Disponible (toggle)
- Botones: Editar, Eliminar
- Búsqueda rápida

**Crear Producto:**
- Formulario con campos:
  - Nombre (requerido)
  - Descripción
  - Categoría (dropdown)
  - Precio (número)
  - Stock inicial
  - Disponible (toggle)
  - Imagen (upload)
- Validación en frontend y backend
- Confirmar y guardar

**Editar Producto:**
- Cargar datos en formulario
- Modificar campos
- Guardar cambios
- Confirmación de éxito

**Eliminar Producto:**
- Confirmación antes de eliminar
- Soft-delete (marcar como inactivo) recomendado

#### 4. **Gestión de Categorías**
- CRUD simple para categorías
- Orden personalizado (drag-and-drop opcional)
- Asignar color o ícono a cada categoría

#### 5. **Gestión de Stock**
- Vista rápida de productos con bajo stock
- Alertas cuando stock < 5
- Actualizar stock desde tabla
- Historial de cambios (opcional para V2)

---

## 💾 BASE DE DATOS - Esquema

### Tabla: `categorias`
```sql
CREATE TABLE categorias (
  id INT PRIMARY KEY AUTO_INCREMENT,
  nombre VARCHAR(100) NOT NULL UNIQUE,
  descripcion TEXT,
  orden INT DEFAULT 0,
  activa BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Tabla: `productos`
```sql
CREATE TABLE productos (
  id INT PRIMARY KEY AUTO_INCREMENT,
  nombre VARCHAR(150) NOT NULL,
  descripcion TEXT,
  precio DECIMAL(10, 2) NOT NULL,
  categoria_id INT NOT NULL,
  stock INT DEFAULT 0,
  imagen_url VARCHAR(255),
  disponible BOOLEAN DEFAULT TRUE,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (categoria_id) REFERENCES categorias(id)
);
```

### Tabla: `admins` (usuarios admin)
```sql
CREATE TABLE admins (
  id INT PRIMARY KEY AUTO_INCREMENT,
  usuario VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  email VARCHAR(150),
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP
);
```

---

## 🔌 API REST - Endpoints

### Productos (Públicos)
```
GET  /api/productos              → Lista todos (con filtros opcionales)
GET  /api/productos?categoria=X  → Filtrar por categoría
GET  /api/productos/:id          → Detalle de un producto
```

### Productos (Admin - Requiere Autenticación)
```
POST   /api/admin/productos                → Crear producto
GET    /api/admin/productos                → Lista completa (con pagina)
GET    /api/admin/productos/:id            → Detalle para editar
PUT    /api/admin/productos/:id            → Actualizar producto
DELETE /api/admin/productos/:id            → Eliminar (soft-delete)
PATCH  /api/admin/productos/:id/stock      → Actualizar solo stock
```

### Categorías (Admin)
```
GET    /api/admin/categorias     → Lista todas
POST   /api/admin/categorias     → Crear categoría
PUT    /api/admin/categorias/:id → Actualizar
DELETE /api/admin/categorias/:id → Eliminar
```

### Autenticación
```
POST /api/admin/login            → Login (devuelve JWT)
POST /api/admin/logout           → Logout
POST /api/admin/refresh-token    → Renovar token
```

### Ejemplo Response (GET /api/productos)
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "nombre": "Hamburguesa Clásica",
      "descripcion": "Carne 100% res, lechuga, tomate",
      "precio": 12.99,
      "categoria": "Platos Principales",
      "stock": 25,
      "disponible": true,
      "imagen_url": "/assets/images/hamburguesa.jpg"
    }
  ]
}
```

---

## 🎬 Flujo Completo de Datos

### Flujo Cliente (Menú Público)

```
1. CARGA INICIAL
   ├─ Frontend solicita: GET /api/productos
   ├─ Backend consulta: SELECT * FROM productos WHERE activo=1
   └─ Frontend renderiza: Tarjetas con animaciones fade-in

2. FILTRADO POR CATEGORÍA
   ├─ Usuario hace clic en "Bebidas"
   ├─ Frontend solicita: GET /api/productos?categoria=Bebidas
   ├─ Transición suave entre productos
   └─ Animación de slide en categorías

3. BÚSQUEDA EN TIEMPO REAL
   ├─ Usuario escribe en buscador
   ├─ Frontend filtra localmente (sin llamar API)
   └─ Anima aparición/desaparición de tarjetas

4. AGREGAR AL CARRITO
   ├─ Usuario hace clic "Agregar"
   ├─ Modal se abre con detalles
   ├─ Selecciona cantidad
   ├─ Confirma
   ├─ Datos guardados en localStorage
   └─ Ícono carrito actualiza cantidad (con animación)

5. VER CARRITO
   ├─ Usuario abre carrito lateral
   ├─ Carga datos desde localStorage
   ├─ Muestra total
   └─ Botón "Continuar" (próxima fase)
```

### Flujo Admin (Panel de Control)

```
1. LOGIN
   ├─ Admin ingresa usuario/contraseña
   ├─ Frontend POST: /api/admin/login
   ├─ Backend valida y genera JWT
   ├─ Frontend guarda token en httpOnly cookie
   └─ Redirecciona a dashboard

2. VER PRODUCTOS
   ├─ Frontend solicita: GET /api/admin/productos
   ├─ Backend valida JWT en middleware
   ├─ Devuelve lista completa con paginación
   └─ Renderiza tabla con opciones editar/eliminar

3. CREAR PRODUCTO
   ├─ Admin abre formulario
   ├─ Carga imagen (se sube a carpeta /assets)
   ├─ Completa datos
   ├─ Valida en frontend
   ├─ POST: /api/admin/productos (con JWT)
   ├─ Backend inserta en BD
   └─ Tabla se actualiza automáticamente

4. EDITAR PRODUCTO
   ├─ Admin hace clic en editar
   ├─ GET: /api/admin/productos/:id
   ├─ Formulario se precarga con datos
   ├─ Modifica campos
   ├─ PUT: /api/admin/productos/:id
   ├─ Backend actualiza
   └─ Confirmación visual de éxito

5. ELIMINAR PRODUCTO
   ├─ Admin hace clic en eliminar
   ├─ Modal de confirmación
   ├─ DELETE: /api/admin/productos/:id
   ├─ Backend marca como inactivo
   └─ Tabla se actualiza
```

---

## 🎨 Elementos de Animación Específicos

### 1. **Entrada de Productos**
```css
/* Fade-in cascada */
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.producto-card {
  animation: fadeInUp 0.5s ease-out forwards;
}
```

### 2. **Hover en Tarjetas**
```css
.producto-card:hover {
  transform: translateY(-8px);
  box-shadow: 0 12px 24px rgba(0,0,0,0.15);
  transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}
```

### 3. **Pulse en Botón Agregar**
```css
@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7); }
  50% { box-shadow: 0 0 0 10px rgba(59, 130, 246, 0); }
}

button.add-to-cart:hover {
  animation: pulse 1.5s infinite;
}
```

### 4. **Carrito Deslizable**
```css
.cart-sidebar {
  transform: translateX(100%);
  transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.cart-sidebar.open {
  transform: translateX(0);
}
```

### 5. **Indicador de Stock**
```
Si stock = 0:
  ├─ Tarjeta con opacidad 0.5
  ├─ Badge rojo "No disponible"
  └─ Botón deshabilitado

Si stock < 5:
  ├─ Badge amarillo "Pocas unidades"
  └─ Botón habilitado
```

---

## 🔒 Seguridad

### Frontend
- Validar datos antes de enviar
- Sanitizar inputs (contra XSS)
- localStorage sin datos sensibles

### Backend
- Autenticación con JWT
- Verificación de permisos en cada ruta
- Validar todos los inputs
- Rate limiting en endpoints
- CORS configurado correctamente
- Contraseñas hasheadas (bcrypt)
- Variables sensibles en .env

### Ejemplos
```javascript
// Middleware de autenticación
function verificarJWT(req, res, next) {
  const token = req.cookies.authToken;
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}
```

---

## 📱 Respuestas Esperadas

### Éxito (200)
```json
{ "success": true, "message": "Producto creado", "data": {...} }
```

### Error Validación (400)
```json
{ "success": false, "errors": { "nombre": "Campo requerido" } }
```

### No Autorizado (401)
```json
{ "success": false, "message": "No autenticado" }
```

### No Encontrado (404)
```json
{ "success": false, "message": "Producto no existe" }
```

---

## 🚀 Fases de Desarrollo Recomendadas

### **Fase 1: MVP (2-3 semanas)**
✅ Menú público básico con 2-3 categorías  
✅ Panel admin CRUD productos  
✅ Base de datos SQLite local  
✅ Autenticación admin básica  

### **Fase 2: Pulido (1 semana)**
✅ Animaciones completas  
✅ Responsive design perfecto  
✅ Migrar a PostgreSQL  
✅ Deploy en hosting propio  

### **Fase 3: Futuro (Siguiente fase del proyecto)**
✅ Integración WhatsApp API  
✅ Sistema de órdenes  
✅ Tarjeta de fidelización  
✅ Integración inventario  

---

## 📋 Checklist de Implementación

### Backend
- [ ] Proyecto Node.js inicializado
- [ ] Base de datos schema creada
- [ ] Rutas GET productos funcional
- [ ] Rutas CRUD admin con JWT
- [ ] Validaciones en servidor
- [ ] Manejo de errores estándar
- [ ] CORS configurado
- [ ] Subida de imágenes funcionando

### Frontend Público
- [ ] Estructura HTML semántica
- [ ] Estilos base y responsive
- [ ] Consumo API GET productos
- [ ] Filtro por categoría
- [ ] Buscador en tiempo real
- [ ] Modal de producto
- [ ] Carrito con localStorage
- [ ] Animaciones CSS implementadas
- [ ] Testing en móvil/tablet/desktop

### Frontend Admin
- [ ] Página login
- [ ] Autenticación con JWT
- [ ] Dashboard básico
- [ ] Tabla CRUD productos
- [ ] Formulario crear/editar
- [ ] Modal de confirmación delete
- [ ] Validaciones frontend
- [ ] Manejo de errores amigable

---

## 💻 Comandos de Inicio Rápido (Node.js/Express)

```bash
# Inicializar proyecto
npm init -y

# Instalar dependencias base
npm install express cors dotenv bcryptjs jsonwebtoken mysql2 sequelize multer

# Instalar en desarrollo
npm install --save-dev nodemon

# Crear estructura carpetas
mkdir -p public/css public/js public/assets/images
mkdir -p admin/css admin/js
mkdir -p backend/config backend/routes backend/controllers backend/models backend/middleware

# Ejecutar servidor (desarrollo)
npm start  # asume script: "start": "nodemon backend/server.js"
```

---

## 📞 Próximas Fases

Cuando el menú esté listo (Fase 1-2), pasaremos a:
1. Integración con WhatsApp API para recibir órdenes
2. Sistema de pedidos y seguimiento
3. Tarjeta de fidelización digital
4. Integración con inventario

---

**Última actualización:** 2026-05-18  
**Autor:** Guía de Desarrollo - Puro Sabor  
**Estado:** Documento Vivo (se actualizará durante desarrollo)
