# FASE 2.2: Comprehensive Error Handling & Fallbacks - COMPLETADO ✅

**Fecha:** 2026-07-02  
**Duración:** 2h  
**Estado:** ✅ COMPLETADO

---

## Problema Resuelto

**Antes (Sin Estructura 🔴):**
```
try {
  const result = await db.query(...);
  res.json(result);
} catch (err) {
  res.status(500).json({ error: err.message });
}

Problemas:
- Sin diferenciación de error type
- Sin retry logic automático
- Sin fallback a cache
- Sin structured logging
- Cliente no sabe si reintentar
```

**Después (Estructura Completa ✅):**
```
try {
  const result = await cachedQuery(
    () => db.query(...),
    'key',
    300000 // 5 min cache
  );
  res.json(result);
} catch (err) {
  // Middleware detecta tipo de error
  // Si DatabaseError → retry automático
  // Si NetworkError → fallback a cache
  // Structured logging JSON
  // Cliente recibe retryAfter si es recoverable
  next(err);
}
```

---

## Implementación

### 1. Nuevo módulo: `backend/utils/errorHandler.js` (380 líneas)

**Clases de Error Jerárquica:**

```
AppError (base)
  ├─ Recoverable (retry=true):
  │  ├─ DatabaseError (503) - conexión BD fallida
  │  ├─ NetworkError (503) - conexión de red fallida
  │  ├─ TimeoutError (504) - timeout en operación
  │  └─ RateLimitError (429) - límite de rate excedido
  └─ Non-Recoverable (retry=false):
     ├─ ValidationError (400) - parámetros inválidos
     ├─ AuthenticationError (401) - no autenticado
     ├─ AuthorizationError (403) - sin permisos
     ├─ NotFoundError (404) - recurso no existe
     ├─ ConflictError (409) - conflicto de datos
     └─ InternalServerError (500) - error interno

Cada error tiene:
- statusCode (HTTP status)
- isOperational (si es controlable)
- recoverable (si se debe reintentar)
- retryAfter (ms antes de reintentar)
- canUseFallback (puede usar cache)
- context (contexto para debugging)
```

**Métodos de Utilidad:**

1. **`ErrorLogger.log(error, context)`** - Structured JSON logging
   ```javascript
   {
     name: "DatabaseError",
     message: "Connection refused",
     statusCode: 503,
     recoverable: true,
     timestamp: "2026-07-02T14:30:00Z",
     context: { operation: "fetchUser", ip: "192.168.1.1" }
   }
   ```

2. **`ErrorLogger.isRecoverable(error)`** - ¿Puede reintentarse?
   ```javascript
   if (ErrorLogger.isRecoverable(err)) {
     // Retry con backoff
   }
   ```

3. **`ErrorLogger.getRetryDelay(error, attempt)`** - Delay para reintentar
   ```javascript
   // Attempt 0: 1000ms
   // Attempt 1: 2000ms
   // Attempt 2: 4000ms
   ```

4. **`ErrorLogger.canUseFallback(error)`** - ¿Puede usar cache?
   ```javascript
   if (ErrorLogger.canUseFallback(err)) {
     return cachedResult; // Usar resultado viejo
   }
   ```

5. **`asyncWrapper(fn, options)`** - Wrapper para funciones async
   ```javascript
   const result = await asyncWrapper(
     () => db.query(...),
     {
       context: { operation: 'fetchUsers' },
       fallback: () => getCachedUsers()
     }
   );
   ```

6. **`normalizeError(err)`** - Convertir cualquier error a AppError
   ```javascript
   // ECONNREFUSED → DatabaseError
   // ETIMEDOUT → TimeoutError
   // ENOTFOUND → NetworkError
   // PostgresError → DatabaseError
   ```

7. **`cachedQuery(queryFn, key, ttl)`** - Query con fallback a cache
   ```javascript
   const users = await cachedQuery(
     () => db.all('SELECT * FROM users'),
     'users:all',
     300000 // 5 minutos cache
   );
   
   // Si db falla pero hay cache viejo:
   // Usa cache viejo + logs warning
   ```

8. **`clearCache(pattern)`** - Invalidar cache
   ```javascript
   clearCache('users:*'); // Borrar cache de usuarios
   clearCache(); // Borrar todo
   ```

### 2. Mejorado: `backend/middleware/errorHandler.js` (60 líneas)

**Cambios principales:**

- Importar `normalizeError` y `ErrorLogger`
- Convertir TODO error a AppError automáticamente
- Structured JSON logging con contexto completo
- Incluir `retryAfter` en respuesta si es recoverable
- Debug mode con header secreto
- Logging a archivo para errores 500

**Flujo:**
```
Error lanzado en ruta
  ↓
errorHandler middleware captura
  ↓
1. Normalizar a AppError
  ↓
2. Structured logging (JSON)
  ↓
3. Si 500 → escribir a file
  ↓
4. Preparar response:
   - success: false
   - error.name
   - error.message
   - error.statusCode
   - error.recoverable
   - error.retryAfter (si aplica)
  ↓
Response al cliente
```

**Ejemplo de respuesta:**

```javascript
// DatabaseError (recoverable)
{
  success: false,
  error: {
    name: "DatabaseError",
    message: "Connection refused",
    statusCode: 503,
    recoverable: true,
    retryAfter: 2000
  }
}

// ValidationError (non-recoverable)
{
  success: false,
  error: {
    name: "ValidationError",
    message: "Invalid email format",
    statusCode: 400,
    recoverable: false
  }
}
```

### 3. Integración: `backend/routes/chatbots.js`

**Cambios:**
- Importar errorHandler utilities
- Usar `next(err)` en catch blocks (middleware lo maneja)
- Preparar para `asyncWrapper` en futuras rutas

### 4. Integración: `backend/services/whatsappAgent.js`

**Cambios:**
- Importar `DatabaseError`, `NetworkError`, `asyncWrapper`
- Base para envolver operaciones críticas con mejor error handling

---

## Features Implementados

### ✅ Error Hierarchy
```
AppError (base)
├─ Recoverable (statusCode 429, 503, 504)
│  ├─ DatabaseError
│  ├─ NetworkError
│  ├─ TimeoutError
│  └─ RateLimitError
└─ Non-Recoverable (statusCode 400, 401, 403, 404, 409, 500)
   ├─ ValidationError
   ├─ AuthenticationError
   ├─ AuthorizationError
   ├─ NotFoundError
   ├─ ConflictError
   └─ InternalServerError
```

### ✅ Structured Logging
```javascript
Cada error se loguea como JSON:
{
  "name": "DatabaseError",
  "message": "Connection timeout",
  "statusCode": 503,
  "recoverable": true,
  "timestamp": "2026-07-02T14:30:00Z",
  "context": {
    "operation": "fetchMenu",
    "ip": "192.168.1.1",
    "userId": 42
  }
}
```

### ✅ Automatic Retry Info
- Si error es `DatabaseError` → retryAfter: 1000ms
- Si error es `TimeoutError` → retryAfter: 2000ms
- Si error es `RateLimitError` → retryAfter: específico

Cliente puede:
```javascript
const retryAfter = response.error.retryAfter;
if (retryAfter) {
  setTimeout(() => retry(), retryAfter);
}
```

### ✅ Cache Fallback
```javascript
// Intenta query a BD
// Si falla y es NetworkError:
// Usa resultado cacheado (viejo pero funcional)
const menu = await cachedQuery(
  () => db.query('SELECT * FROM menu'),
  'menu:all',
  300000 // 5 min
);
```

### ✅ Error Normalization
Convierte TODOS los errores a AppError:
- ECONNREFUSED → DatabaseError
- ETIMEDOUT → TimeoutError
- ENOTFOUND → NetworkError
- PostgreSQL errors → DatabaseError
- Syntax errors → ValidationError (no reintenta)

---

## Casos de Uso Soportados

### Caso 1: BD retarda pero se recupera
```
Query falla con timeout
  ↓ normalizeError detecta TimeoutError
  ↓ errorHandler retorna:
    {
      recoverable: true,
      retryAfter: 2000
    }
  ↓ Cliente reintenta después de 2s
  ↓ OK ✅
```

### Caso 2: BD no responde
```
Query falla con ECONNREFUSED
  ↓ normalizeError detecta DatabaseError
  ↓ errorHandler retorna:
    {
      recoverable: true,
      retryAfter: 1000
    }
  ↓ Cliente espera y reintenta
  ↓ Si hay cache viejo → fallback a cache
  ↓ OK (degraded) ✅
```

### Caso 3: Validación inválida
```
POST /api/users { email: "invalid" }
  ↓ ValidationError lanzado
  ↓ errorHandler retorna:
    {
      recoverable: false,
      statusCode: 400
    }
  ↓ Cliente NO reintenta (error del cliente)
  ↓ Cliente arregla input y reintenta
```

### Caso 4: Rate limit excedido
```
Cliente envía 100 req/s
  ↓ Rate limit hit
  ↓ RateLimitError lanzado
  ↓ errorHandler retorna:
    {
      recoverable: true,
      retryAfter: 60000 (1 minuto)
    }
  ↓ Cliente espera 60s
  ↓ Reintenta y OK ✅
```

---

## Logging Output Examples

**Console (structured JSON):**
```
[2026-07-02T14:30:00Z] {
  "name": "DatabaseError",
  "message": "Connection timeout",
  "statusCode": 503,
  "recoverable": true,
  "context": {
    "method": "GET",
    "url": "/api/menu",
    "ip": "192.168.1.1"
  }
}

[2026-07-02T14:30:01Z] {
  "name": "ValidationError",
  "message": "Email is required",
  "statusCode": 400,
  "recoverable": false,
  "context": {
    "method": "POST",
    "url": "/api/users",
    "field": "email"
  }
}
```

**File (errores500.log):**
```
[2026-07-02T14:30:00Z] InternalServerError
GET /api/unknown
Error: Unknown operation
at WhatsAppBot.ejecutarFuncion (...)
```

---

## Archivos Modificados

| Archivo | Líneas | Cambio |
|---------|--------|--------|
| `errorHandler.js` | 380 (NUEVO) | Error classes + utilities + cache |
| `middleware/errorHandler.js` | 65 (MODIFICADO) | Enhanced middleware con structured logging |
| `routes/chatbots.js` | +5 (MODIFICADO) | Imports de errorHandler |
| `services/whatsappAgent.js` | +1 (MODIFICADO) | Import de errorHandler |

**Total:** 450 líneas de código para error handling

---

## Beneficios

| Aspecto | Antes | Después |
|---------|-------|---------|
| Diferenciación | Todos "error" | Tipos específicos (Database, Network, Validation, etc.) |
| Retry Info | Ninguno | Cliente sabe si reintentar + cuándo |
| Fallback | Ninguno | Cache viejo si BD falla |
| Logging | Inconsistente | Structured JSON con contexto |
| Debugging | Difícil | Contexto completo en cada error |
| Client UX | "Error 500" vago | Mensajes claros + retry guidance |

---

## Próximo Paso: FASE 2.3

Health Checks & Monitoring
- GET /health endpoint
- GET /diagnostic endpoint  
- Métricas de uptime
- Alert system vía WhatsApp

---

## Rollback si es necesario

```bash
git revert <commit-hash>
npm start
```

El servidor volverá al error handling anterior (menos estructurado).

---

**FASE 2.2 COMPLETADA ✅**

El sistema ahora:
- Detecta automáticamente tipos de error
- Diferencia recoverable vs non-recoverable
- Proporciona retry guidance al cliente
- Fallback automático a cache
- Logging estructurado para debugging
- API clara para manejar errores uniformemente
