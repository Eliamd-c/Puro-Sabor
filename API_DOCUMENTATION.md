# 📚 API DOCUMENTATION - PURO SABOR

## 🚀 Quick Start

### Swagger UI
Accede a la documentación interactiva en:
```
http://localhost:3005/api-docs
```

---

## 📋 Base Information

**API Base URL**: `http://localhost:3005/api`  
**Authentication**: JWT Bearer Token  
**Response Format**: JSON  
**Content-Type**: `application/json`

---

## 🔐 Authentication

### Login
```bash
POST /api/admin/login
Content-Type: application/json

{
  "usuario": "admin",
  "password": "Admin@123456"
}
```

**Response**:
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": 1,
    "usuario": "admin"
  }
}
```

### Using Token
```bash
Authorization: Bearer <your-token-here>
```

---

## 📚 Endpoints

### 1. Categorías

#### GET /api/categorias
Obtener todas las categorías (público, cacheado 10 min)

```bash
curl http://localhost:3005/api/categorias
```

**Response**:
```json
[
  {
    "id": 1,
    "nombre": "Migas al Carbón",
    "descripcion": "Nuestra especialidad",
    "orden": 1,
    "activa": 1
  },
  {
    "id": 2,
    "nombre": "Bebidas",
    "descripcion": "Acompañamientos",
    "orden": 2,
    "activa": 1
  }
]
```

#### GET /api/categorias/admin
Obtener categorías (admin, cacheado 5 min)

```bash
curl -H "Authorization: Bearer <token>" http://localhost:3005/api/categorias/admin
```

#### POST /api/categorias/admin
Crear categoría (requiere autenticación)

```bash
curl -X POST http://localhost:3005/api/categorias/admin \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "nombre": "Postres",
    "descripcion": "Dulces artesanales"
  }'
```

#### PUT /api/categorias/admin/:id
Actualizar categoría

```bash
curl -X PUT http://localhost:3005/api/categorias/admin/3 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "nombre": "Postres Gourmet",
    "descripcion": "Postres premium"
  }'
```

#### DELETE /api/categorias/admin/:id
Eliminar categoría

```bash
curl -X DELETE http://localhost:3005/api/categorias/admin/3 \
  -H "Authorization: Bearer <token>"
```

---

### 2. Productos

#### GET /api/productos
Obtener productos con paginación

**Query Parameters**:
- `page` (int, default: 1) - Número de página
- `limit` (int, default: 20) - Items por página
- `categoria_id` (int) - Filtrar por categoría
- `search` (string) - Buscar por nombre o descripción

```bash
# Obtener primera página
curl http://localhost:3005/api/productos

# Con paginación
curl http://localhost:3005/api/productos?page=2&limit=10

# Buscar
curl http://localhost:3005/api/productos?search=limonada

# Filtrar por categoría
curl http://localhost:3005/api/productos?categoria_id=2

# Combinado
curl http://localhost:3005/api/productos?search=miga&categoria_id=1&page=1&limit=20
```

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "nombre": "Limonada Natural",
      "descripcion": "Refrescante y natural",
      "precio": 6000,
      "categoria_id": 2,
      "stock": 50,
      "disponible": 1,
      "imagen_url": "/assets/images/limonada.png"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": "45",
    "pages": 3,
    "hasMore": true
  }
}
```

#### GET /api/productos/admin/list
Obtener todos los productos (admin)

```bash
curl -H "Authorization: Bearer <token>" http://localhost:3005/api/productos/admin/list
```

#### POST /api/productos/admin
Crear producto (requiere autenticación)

```bash
curl -X POST http://localhost:3005/api/productos/admin \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: multipart/form-data" \
  -F "nombre=Nuevo Producto" \
  -F "precio=15000" \
  -F "categoria_id=1" \
  -F "descripcion=Descripción" \
  -F "imagen=@/path/to/image.jpg"
```

**Request Body** (JSON):
```json
{
  "nombre": "Migas con Res",
  "descripcion": "Especialidad de la casa",
  "precio": 25000,
  "categoria_id": 1,
  "stock": 50
}
```

---

### 3. Mesas

#### GET /api/mesas/activas
Obtener mesas activas (requiere autenticación)

```bash
curl -H "Authorization: Bearer <token>" http://localhost:3005/api/mesas/activas
```

**Response**:
```json
{
  "success": true,
  "sesiones": [
    {
      "id": 1,
      "numero": 1,
      "estado": "activa",
      "ultima_actividad": "2026-06-16T10:30:00.000Z"
    }
  ]
}
```

#### GET /api/mesas/:numero/estado
Obtener estado de una mesa

```bash
curl http://localhost:3005/api/mesas/1/estado
```

#### POST /api/mesas
Crear nueva mesa (requiere autenticación)

```bash
curl -X POST http://localhost:3005/api/mesas \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "numero": 7,
    "nombre": "Mesa 7"
  }'
```

---

## 📊 Error Handling

### Errores Comunes

#### 400 Bad Request
```json
{
  "success": false,
  "message": "Validación fallida: campo requerido"
}
```

#### 401 Unauthorized
```json
{
  "success": false,
  "message": "Token no proporcionado o inválido"
}
```

#### 404 Not Found
```json
{
  "success": false,
  "message": "Recurso no encontrado"
}
```

#### 500 Server Error
```json
{
  "success": false,
  "message": "Error interno del servidor"
}
```

---

## 🔒 Security Notes

- ✅ Todos los parámetros están validados
- ✅ JWT requerido para endpoints protegidos
- ✅ Prepared statements previenen SQL injection
- ✅ XSS protection activo
- ✅ Rate limiting en endpoints sensibles
- ✅ CORS configurado para dominios permitidos

---

## ⚡ Performance Tips

### Caching
- Categorías: 10 minutos (público) / 5 minutos (admin)
- Invalidación automática en cambios
- Browser caching vía headers HTTP

### Paginación
- Siempre usa `limit` para mejor performance
- Default: 20 items por página
- Máximo: 100 items por página

### Búsqueda
- Usa `search` en lugar de cargar todo
- Resultados limitados a 100 por defecto
- Case-insensitive

---

## 📲 Using with Frontend

### Fetch API
```javascript
// Login
const response = await fetch('/api/admin/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    usuario: 'admin',
    password: 'Admin@123456'
  })
});

const { token } = await response.json();
localStorage.setItem('token', token);

// Using token
const productsResponse = await fetch('/api/productos?page=1&limit=20', {
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('token')}`
  }
});
```

---

## 🧪 Testing Endpoints

### Using Swagger UI
1. Abre `http://localhost:3005/api-docs`
2. Click en "Try it out"
3. Ingresa parámetros
4. Click "Execute"

### Using cURL
```bash
# Obtener categorías
curl http://localhost:3005/api/categorias

# Obtener productos con paginación
curl "http://localhost:3005/api/productos?page=1&limit=5"

# Buscar
curl "http://localhost:3005/api/productos?search=limonada"
```

### Using Postman
1. Importa la colección desde `/api-docs`
2. Variables: `{{base_url}}` = `http://localhost:3005`
3. Authentica con JWT token

---

## 📞 Support

Para más información:
- Documentación: http://localhost:3005/api-docs
- GitHub: https://github.com/...
- Email: soporte@restaurantepurosabor.com

---

**Versión**: 1.0.0  
**Última actualización**: 2026-06-16  
**Status**: ✅ Production Ready
