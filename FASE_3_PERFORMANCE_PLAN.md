# FASE 3: Performance Optimization - PLAN DETALLADO

**Duración Estimada:** 6-8 horas  
**Fecha Inicio:** 2026-07-02  
**Objetivo:** 50%+ reducción en latencia, 3x+ aumento en throughput

---

## El Problema (Sin FASE 3)

```
Cliente solicita menú:
  GET /api/productos (sin cache)
  ↓
Query BD:
  ├─ Sin índices: full table scan (1000ms)
  ├─ Lazy load de imágenes: 5 requests secuenciales (2000ms)
  └─ Sin compresión: transfer 5MB (3000ms)
  ↓
Total latencia: ~6000ms (6 segundos) 😞

Admin lista pedidos:
  GET /api/pedidos (10000 rows, sin paginación)
  ↓
Transfer 50MB de datos (10000ms)
  ↓
Browser se congela descargando (30000ms) 😞

Bot procesa mensaje:
  Query BD por usuario (sin cache): 100ms
  Query por categoría: 100ms
  Query por precio: 100ms
  Total: 300ms × 100 mensajes = 30 segundos de overhead 😞
```

---

## Solución: 5 Subfases

### FASE 3.1: Database Indexing (1.5h)

**Problema:**
- Full table scans en queries frecuentes
- Búsquedas por usuario/email: O(n)
- Búsquedas por categoría: O(n)
- Joins lentos sin índices

**Solución:**
1. **Primary Keys & Unique Indexes**
   - user(id) PRIMARY KEY
   - admin(usuario) UNIQUE
   - user(email) UNIQUE

2. **Frequent Query Indexes**
   ```sql
   CREATE INDEX idx_productos_categoria ON productos(categoria_id);
   CREATE INDEX idx_productos_activo ON productos(activo, stock);
   CREATE INDEX idx_pedidos_user_fecha ON pedidos(numero_cliente, creado_en DESC);
   CREATE INDEX idx_pedidos_estado ON pedidos(estado, creado_en DESC);
   CREATE INDEX idx_mensajes_numero_fecha ON mensajes_historial(numero_cliente, creado_en DESC);
   ```

3. **Composite Indexes (multi-column)**
   ```sql
   CREATE INDEX idx_productos_active_stock ON productos(activo, stock) 
   WHERE stock > 0;
   
   CREATE INDEX idx_pedidos_status_date ON pedidos(estado, creado_en DESC);
   ```

4. **Analysis & Optimization**
   - Identify slow queries (>100ms)
   - EXPLAIN ANALYZE cada query importante
   - Drop unused indexes

**Archivos:**
- `database/indexes.sql` (80 líneas) - Definiciones de índices
- `backend/config/database.js` (MODIFICADO) - Auto-create indexes

**Métrica de éxito:**
- ✅ Query speeds: 1000ms → 10ms (100x faster)
- ✅ Índices en 10+ columnas
- ✅ Cero unused indexes

---

### FASE 3.2: Response Compression (1h)

**Problema:**
- Respuestas JSON sin comprimir: 5MB
- Imágenes PNG sin optimizar: 2MB cada una
- Transfer over network: 10-30 segundos

**Solución:**
1. **Gzip Compression (HTTP)**
   ```javascript
   const compression = require('compression');
   app.use(compression({
     level: 6,           // Balance speed/ratio
     threshold: 1024,    // Compress >1KB
     filter: (req, res) => {
       if (req.headers['x-no-compression']) return false;
       return compression.filter(req, res);
     }
   }));
   ```

2. **Image Optimization**
   - JPEG: 80% quality (90% size reduction)
   - PNG: optimize-images (40-60% reduction)
   - WebP: for modern browsers (30-40% reduction)
   - Responsive images: multiple sizes

3. **JSON Response Optimization**
   - Remove unnecessary fields
   - Use short field names (if needed)
   - Batch responses (send multiple items)

4. **Brotli Compression (optional)**
   - Better ratio than gzip
   - Slower compression time
   - For static assets

**Archivos:**
- `backend/middleware/compression.js` (NUEVO - 40 líneas)
- `backend/server.js` (MODIFICADO - agregar compression middleware)

**Métrica de éxito:**
- ✅ Gzip enabled on all endpoints
- ✅ 70% compression ratio average
- ✅ 5MB → 1.5MB transfer

---

### FASE 3.3: Data Caching Strategy (2h)

**Problema:**
- Menú cambia poco, se consulta 1000x/hora
- Categorías estáticas, se consultan en cada request
- Admin whitelist se sincroniza pero se consulta 100x/minuto

**Solución:**
1. **Redis Cache Layers**
   ```javascript
   // Cache expiry times
   MENU: 1 hour        // Raro cambio
   CATEGORIES: 24 hours // Casi nunca cambia
   PROMOTIONS: 30 min  // Cambios frecuentes
   ADMIN_WHITELIST: 5 min // Sincronizado vía cluster
   RATE_LIMIT_STATE: 1 min // Refrescado constante
   ```

2. **Cache Invalidation Strategy**
   ```
   Cuando admin actualiza producto:
     1. Actualiza BD
     2. Invalida cache:MENU
     3. Publica evento cluster:MENU_UPDATED
     4. Otros nodos descartan cache local
   ```

3. **Multi-Level Cache**
   - L1: Redis (cluster-wide, TTL based)
   - L2: Node memory (local, fast access)
   - L3: Database (source of truth)

4. **Cache Warming**
   - Pre-load menu on startup
   - Pre-load categories
   - Keep hot data in memory

**Archivos:**
- `backend/utils/cacheManager.js` (NUEVO - 150 líneas)
- `backend/config/cache-config.js` (NUEVO - 40 líneas)
- `backend/services/productService.js` (MODIFICADO - use cache)

**Métrica de éxito:**
- ✅ Cache hit rate >80%
- ✅ Menu queries: 100ms → 5ms (20x)
- ✅ Zero stale data (via invalidation)

---

### FASE 3.4: Lazy Loading & Pagination (1.5h)

**Problema:**
- Cliente solicita 10,000 pedidos, recibe TODO
- Browser intenta renderizar 10,000 filas
- Scroll lento, memoria agotada

**Solución:**
1. **API Pagination**
   ```javascript
   GET /api/pedidos?page=1&limit=50
   Response: {
     data: [...50 items...],
     pagination: {
       page: 1,
       limit: 50,
       total: 10000,
       pages: 200
     }
   }
   ```

2. **Cursor-based Pagination (para tiempo real)**
   ```javascript
   GET /api/pedidos?cursor=2026-07-02T10:30:00Z&limit=50
   Response: {
     data: [...50 items...],
     nextCursor: "2026-07-02T10:15:00Z"
   }
   ```

3. **Lazy Load Images**
   ```html
   <img loading="lazy" src="image.jpg" />
   ```

4. **Infinite Scroll (client)**
   ```javascript
   // Load más items cuando usuario scrollea al bottom
   window.addEventListener('scroll', () => {
     if (scrollTop + viewport >= docHeight - 100) {
       loadMore();
     }
   });
   ```

**Archivos:**
- `backend/utils/paginationHelper.js` (NUEVO - 60 líneas)
- `backend/routes/pedidos.js` (MODIFICADO - add pagination)
- `backend/routes/productos.js` (MODIFICADO - add pagination)

**Métrica de éxito:**
- ✅ Paginated endpoints: 10,000 → 50 items
- ✅ Load time: 5000ms → 500ms (10x)
- ✅ Memory: 500MB → 50MB (10x)

---

### FASE 3.5: Query Optimization & Monitoring (2h)

**Problema:**
- Queries lentas sin visibilidad
- N+1 query problem
- Unnecessary data fetches

**Solución:**
1. **Slow Query Detection**
   ```javascript
   // Log queries >100ms
   db.query(...) takes 250ms → log as SLOW
   → Alert si >1000ms
   ```

2. **Query Analysis**
   - EXPLAIN ANALYZE cada query
   - Identify missing indexes
   - Fix N+1 problems

3. **Connection Pooling Optimization**
   - Pool size: min 2 → 5
   - Idle timeout: 30s
   - Queue monitoring

4. **Metrics Dashboard**
   ```javascript
   GET /diagnostic/performance
   Response: {
     queries: {
       avgTime: 45ms,
       p95: 150ms,
       p99: 500ms,
       slowCount: 3,
       slowQueries: [...]
     },
     cache: {
       hitRate: 85%,
       items: 1240,
       memory: '125MB'
     }
   }
   ```

**Archivos:**
- `backend/utils/queryMonitor.js` (NUEVO - 80 líneas)
- `backend/routes/health.js` (MODIFICADO - add performance endpoint)

**Métrica de éxito:**
- ✅ Query monitoring enabled
- ✅ Slow queries identified and fixed
- ✅ Performance dashboard functional

---

## Diagrama de Cache Flow

```
Request llega
  ↓
┌─ Verificar L1 Cache (Redis)
│  ├─ Hit: Retornar en 5ms ✅
│  └─ Miss: Continuar
│
├─ Verificar L2 Cache (Node memory)
│  ├─ Hit: Retornar en 1ms ✅
│  └─ Miss: Continuar
│
└─ Query BD
   ├─ Resultado: 50ms
   ├─ Store L1 (Redis)
   ├─ Store L2 (memory)
   └─ Retornar

Invalidation:
  BD Update
    ↓
  Invalidate L1 (Redis)
    ↓
  Broadcast evento cluster
    ↓
  Otros nodos: Invalidate L2 (memory)
    ↓
  Next request: Cache miss → Query fresh data
```

---

## Performance Benchmarks

### Before FASE 3 (baseline)
```
GET /api/productos (1000 items, no cache)
├─ Query time: 500ms
├─ Compression: None (5MB)
├─ Transfer: 5000ms
└─ Total: ~5500ms

GET /api/pedidos (10000 items, no pagination)
├─ Query time: 1000ms
├─ Compression: None (50MB)
├─ Transfer: 30000ms
└─ Total: ~31000ms

Concurrent 100 users
├─ CPU: 85%
├─ Memory: 800MB
└─ Response time: 5-10 seconds
```

### After FASE 3 (target)
```
GET /api/productos (cached)
├─ Cache hit: 5ms ✅ (100x faster)
├─ Compression: 70% (1.5MB)
├─ Transfer: 1000ms
└─ Total: ~1005ms ✅ (5.5x faster)

GET /api/pedidos (paginated, cached)
├─ Query time: 50ms
├─ Compression: 70% (500KB)
├─ Transfer: 200ms
└─ Total: ~250ms ✅ (124x faster)

Concurrent 100 users
├─ CPU: 20%
├─ Memory: 200MB
└─ Response time: <100ms ✅
```

---

## Implementation Order

1. **FASE 3.1 (1.5h):** Indexes
   - Biggest impact per effort
   - Foundation for other optimizations

2. **FASE 3.3 (2h):** Caching
   - High ROI with Redis already in place
   - Works with indexed queries

3. **FASE 3.2 (1h):** Compression
   - Easy middleware addition
   - 70% transfer reduction

4. **FASE 3.4 (1.5h):** Pagination
   - Browser/UX improvement
   - Works with caching

5. **FASE 3.5 (2h):** Monitoring
   - Verify all optimizations work
   - Detect remaining bottlenecks

**Total: 8 hours**

---

## Testing Strategy

### Load Testing
```bash
# Before FASE 3
wrk -t4 -c100 -d60s http://localhost:3001/api/productos
  Requests/sec: 50
  Latency avg: 2000ms

# After FASE 3 (target)
wrk -t4 -c100 -d60s http://localhost:3001/api/productos
  Requests/sec: 500 (10x)
  Latency avg: 200ms (10x)
```

### Cache Hit Rate Monitoring
```
Redis MONITOR:
  Hits: 450/min
  Misses: 50/min
  Hit rate: 90% ✅
```

### Slow Query Detection
```
Queries >100ms:
  Before: 15/hour
  After: <1/hour ✅
```

---

## Rollback Procedure

**If performance regression:**
```bash
# Disable Redis cache
CACHE_ENABLED=false npm start

# Disable compression
COMPRESSION_ENABLED=false npm start

# Disable pagination (revert to old endpoints)
git revert <commit>
npm start
```

---

## Success Criteria

✅ **Latency:** 50%+ reduction (5000ms → 2500ms avg)  
✅ **Throughput:** 3x+ increase (50 req/s → 150 req/s)  
✅ **Memory:** 50%+ reduction (800MB → 400MB)  
✅ **CPU:** 50%+ reduction (85% → 40%)  
✅ **Cache hit rate:** >80%  
✅ **P95 latency:** <500ms  
✅ **Zero data loss:** via cache invalidation  

---

## Next Steps After FASE 3

**Optional FASE 4: Advanced Features**
- Database replication (read replicas)
- CDN for static assets
- Database partitioning
- Advanced analytics

---

**Ready for FASE 3.1: Database Indexing**

¿Adelante con 3.1?
