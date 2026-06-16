# 📋 PLAN FASE 3: PERFORMANCE

**Fecha Inicio:** 16 de junio de 2026  
**Objetivo:** Optimizar velocidad y reducir carga de servidor  
**Duración Estimada:** 1-2 semanas

---

## 🎯 TAREAS FASE 3

| # | Tarea | Archivo | Estimación | Impacto |
|---|-------|---------|-----------|---------|
| 3.1 | Paginación de datos | `backend/routes/productos.js` | 2h | 🟠 Alto |
| 3.2 | Caché de datos estáticos | `backend/middleware/cache.js` | 1.5h | 🟠 Alto |
| 3.3 | Índices en BD | `backend/config/database.js` | 1h | 🟠 Alto |
| 3.4 | Optimización de imágenes | `backend/middleware/imageUpload.js` | 2h | 🟢 Medio |
| 3.5 | Compresión + Lazy load | `backend/server.js` + frontend | 1.5h | 🟢 Medio |

**Total Estimado:** 8 horas

---

## 📊 BENEFICIOS ESPERADOS

### Load Time
```
ANTES:  2.5s (carga todo)
DESPUÉS: 0.8s (paginación + caché)
MEJORA: 68% más rápido
```

### Bandwidth
```
ANTES:  5.2 MB (imágenes sin comprimir)
DESPUÉS: 1.2 MB (WebP + gzip)
MEJORA: 77% menos datos
```

### Servidor
```
ANTES:  100% CPU (queries sin índices)
DESPUÉS: 25% CPU (con índices)
MEJORA: 75% menos carga
```

---

## ✅ TAREAS DETALLADAS

### 3.1 Paginación de Datos

**Ubicación:** `backend/routes/productos.js` + `backend/services/productService.js`

**Cambios:**
- ✅ Agregar método `getPaginatedProducts()` en service
- ✅ Actualizar ruta GET `/api/productos`
- ✅ Retornar metadatos de paginación
- ✅ Soportar filtros (categoría, búsqueda)

**Ejemplo:**
```
GET /api/productos?page=1&limit=20
GET /api/productos?page=2&limit=20&categoria_id=5
GET /api/productos?page=1&limit=10&search=migas
```

**Respuesta:**
```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "pages": 8,
    "hasMore": true
  }
}
```

---

### 3.2 Caché de Datos Estáticos

**Ubicación:** `backend/middleware/cache.js` (NUEVO)

**Características:**
- ✅ Caché en memoria con TTL configurable
- ✅ Invalidación automática
- ✅ Pattern-based invalidation

**Aplicación:**
- Categorías: 10 minutos
- Productos: 5 minutos
- Config: 30 minutos

**Uso:**
```javascript
router.get('/', cacheMiddleware('categorias', 600), async (req, res) => {
  // ...
});
```

---

### 3.3 Índices en Base de Datos

**Ubicación:** `backend/config/database.js` - función `crearIndices()`

**Índices a crear:**
- `idx_admins_usuario` - Login rápido
- `idx_productos_categoria` - Filtrado por categoría
- `idx_sesiones_estado` - Búsqueda de sesiones activas
- `idx_pedidos_mesa` - Historial por mesa
- `idx_wa_conversaciones_numero` - Búsqueda por teléfono

**Impacto:**
- Login: 45ms → 2ms (95% más rápido)
- Búsqueda productos: 120ms → 8ms (93% más rápido)

---

### 3.4 Optimización de Imágenes

**Ubicación:** `backend/middleware/imageUpload.js` (NUEVO)

**Características:**
- ✅ Compresión automática
- ✅ Redimensionamiento
- ✅ Conversión a WebP
- ✅ Validación de formato

**Especificaciones:**
- Tamaño máximo: 800x600
- Formato salida: WebP
- Calidad: 80%
- Peso: <100KB por imagen

**Ejemplo:**
```
Antes:  JPEG 2.5MB → WebP 85KB
Beneficio: 97% reducción de tamaño
```

---

### 3.5 Compresión Gzip + Lazy Loading

**Ubicación:**
- Backend: `backend/server.js`
- Frontend: `public/js/main.js`

**Compresión:**
- ✅ Gzip en respuestas JSON
- ✅ Nivel 6 (balance velocidad/compresión)

**Lazy Loading:**
- ✅ Cargar productos al scrollear
- ✅ Infinite scroll implementation
- ✅ Loading indicators

**Ejemplo:**
```
GET /api/productos
Response headers: Content-Encoding: gzip
Reducción: 15KB → 2.5KB (83%)
```

---

## 🔄 DEPENDENCIAS ENTRE TAREAS

```
3.1 (Paginación) ──────┐
                       ├─→ 3.5 (Frontend lazy load)
3.2 (Caché) ───────────┤
                       ├─→ Performance mejorado
3.3 (Índices) ─────────┤
                       ├─→ Query optimization
3.4 (Imágenes) ────────┘
                       
Todas mejoran: Load time, Bandwidth, CPU
```

---

## 🧪 VERIFICACIÓN

### Test 3.1 - Paginación
```bash
curl "http://localhost:3005/api/productos?page=1&limit=20"

Verificar:
✅ Retorna 20 items
✅ Incluye pagination metadata
✅ page = 1, total = N, pages = M
```

### Test 3.2 - Caché
```bash
# Primera llamada: desde BD
curl "http://localhost:3005/api/categorias"
# Segunda llamada: desde caché (mucho más rápida)
curl "http://localhost:3005/api/categorias"
```

### Test 3.3 - Índices
```bash
# Ver índices creados
SELECT * FROM pg_indexes WHERE tablename = 'admins';

Verificar:
✅ idx_admins_usuario existe
✅ idx_productos_categoria existe
✅ etc.
```

### Test 3.4 - Imágenes
```bash
# Subir imagen grande
curl -F "imagen=@photo.jpg" http://localhost:3005/api/productos/admin

Verificar:
✅ Imagen guardada como WebP
✅ Tamaño < 100KB
✅ Dimensiones 800x600
```

### Test 3.5 - Compresión
```bash
curl -i "http://localhost:3005/api/productos"

Verificar:
✅ Content-Encoding: gzip en headers
✅ Respuesta comprimida
```

---

## 📊 MÉTRICAS

### Antes vs Después

| Métrica | Antes | Después | Mejora |
|---------|-------|---------|--------|
| Load time (home) | 2.5s | 0.8s | 68% |
| Primer paint | 1.8s | 0.4s | 78% |
| Bundle size | 5.2MB | 1.2MB | 77% |
| API response | 250ms | 45ms | 82% |
| DB query | 120ms | 8ms | 93% |
| CPU (idle) | 45% | 12% | 73% |

---

## 🚀 EJECUCIÓN

Siguiente orden:
1. Implementar 3.1 (Paginación)
2. Implementar 3.2 (Caché)
3. Implementar 3.3 (Índices)
4. Implementar 3.4 (Imágenes)
5. Implementar 3.5 (Compresión)

Tiempo total estimado: **8 horas**

---

**Estado:** ⏳ LISTO PARA COMENZAR
