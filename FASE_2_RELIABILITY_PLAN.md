# FASE 2: Reliability & Resilience - PLAN DETALLADO

**Duración Estimada:** 8 horas  
**Fecha Inicio:** 2026-07-02  
**Objetivo:** Hacer el sistema resiliente a fallos, conexiones perdidas, y recuperable automáticamente

---

## El Problema (Sin FASE 2)

```
Escenario 1: Supabase se cae por 5 minutos
  → Conexión a BD falla
  → Bot no puede conectar
  → Crash silencioso sin logs
  → Usuario no recibe respuesta
  → Admin no sabe qué pasó

Escenario 2: WhatsApp API falla
  → Message no se envía
  → No hay retry
  → Usuario piensa bot está muerto
  → Admin manual necesario

Escenario 3: Bot se reinicia
  → Conexiones abiertas no cierran
  → Locks en BD quedan abiertos
  → Próxima conexión falla
  → Cascada de errores

Escenario 4: Cluster de 2 bots
  → Admin conecta en bot 1
  → Admin 2 conecta en bot 2
  → Estado desincronizado
  → Conflictos de datos
  → Corrupción de auth

Escenario 5: Server en producción se cae
  → Clientes quedan en estado "hablando con bot"
  → Bot desaparece sin aviso
  → Pérdida de conversación
  → Clientes frustrados
```

---

## Solución: 5 Subfases

### FASE 2.1: Database Connection Pooling & Retry Logic (2h)

**Problema:**
- Cada conexión a Supabase es nueva
- Si falla, crash inmediato
- Sin retry automático
- Sin limpieza de conexiones viejas

**Solución:**
1. **Connection Pool** - Pool.js con min/max connections
2. **Retry Logic** - Exponential backoff (1s, 2s, 4s, 8s, 16s)
3. **Health Checks** - Ping a BD cada 30s
4. **Connection Cleanup** - Cerrar conexiones inactivas

**Archivos:**
- `backend/config/database-pool.js` (NUEVO - 150 líneas)
- `backend/config/database.js` (MODIFICADO - agregar pool)
- `backend/server.js` (MODIFICADO - inicializar pool)

**Métrica de éxito:**
- [ ] Pool con min=2, max=10 conexiones
- [ ] Retry max 5 intentos con backoff exponencial
- [ ] Health check cada 30s
- [ ] Timeout de 5s por conexión

---

### FASE 2.2: Comprehensive Error Handling & Fallbacks (2h)

**Problema:**
- Errores no se manejan consistentemente
- Sin fallback cuando funciona algo
- Sin logging structured
- Sin diferenciación de errores recuperables vs fatales

**Solución:**
1. **Error Hierarchy** - Crear clases de error custom
2. **Try-Catch Wrappers** - En todos los puntos críticos
3. **Fallback Strategies** - Cache, retry, degraded mode
4. **Structured Logging** - JSON logs con contexto

**Clases de Error:**
```javascript
class DatabaseError extends Error {}        // Recuperable
class NetworkError extends Error {}         // Recuperable
class ValidationError extends Error {}      // No recuperable
class AuthenticationError extends Error {}  // No recuperable
class RateLimitError extends Error {}       // Recuperable (esperar)
class TimeoutError extends Error {}         // Recuperable (retry)
```

**Archivos:**
- `backend/utils/errorHandler.js` (NUEVO - 120 líneas)
- `backend/services/whatsappAgent.js` (MODIFICADO - agregar try-catch)
- `backend/routes/chatbots.js` (MODIFICADO - agregar error middleware)

**Métrica de éxito:**
- [ ] Todos los operaciones DB con try-catch
- [ ] Retry automático para NetworkError
- [ ] Fallback a cache cuando BD falla
- [ ] Structured logging en stderr

---

### FASE 2.3: Health Checks & Monitoring (1.5h)

**Problema:**
- Admin no sabe si bot está vivo
- No hay alertas cuando falla algo
- Sin métricas de uptime
- Sin debug info cuando algo anda mal

**Solución:**
1. **Health Check Endpoint** - GET /health
2. **Detailed Diagnostics** - GET /diagnostic
3. **Metrics Collector** - Uptime, errors, latency
4. **Alert System** - Notificar vía WhatsApp si algo falla

**Endpoints:**
```
GET /health
Response: {
  status: "ok" | "degraded" | "down",
  uptime: seconds,
  timestamp: ISO8601,
  checks: {
    database: "ok" | "error",
    whatsapp_admin: "ok" | "error",
    whatsapp_client: "ok" | "error",
    memory: "ok" | "error"
  }
}

GET /diagnostic
Response: {
  version: "1.0",
  environment: "production",
  uptime_hours: 48.5,
  total_errors: 3,
  last_error: {...},
  active_connections: 5,
  messages_processed: 12450,
  health_check_time_ms: 150
}
```

**Archivos:**
- `backend/routes/health.js` (NUEVO - 80 líneas)
- `backend/utils/metricsCollector.js` (NUEVO - 100 líneas)
- `backend/services/alertService.js` (NUEVO - 80 líneas)

**Métrica de éxito:**
- [ ] /health responde en <1s
- [ ] Muestra estado real de cada componente
- [ ] /diagnostic disponible en prod
- [ ] Métricas se actualizan cada 5 minutos

---

### FASE 2.4: State Synchronization en Cluster (1.5h)

**Problema:**
- 2 bots en cluster sin sincronización
- Admin auth en bot1, pero bot2 no sabe
- Media descargada en bot1, pero bot2 la pide de nuevo
- Conflictos de estado

**Solución:**
1. **Shared State via Redis** - Cache compartido
2. **Event Broadcasting** - WebSocket entre bots
3. **Lock Management** - Mutex para operaciones críticas
4. **State Reconciliation** - Sincronizar al iniciar

**Archivos:**
- `backend/config/redis-client.js` (NUEVO - 80 líneas)
- `backend/utils/clusterSync.js` (NUEVO - 120 líneas)
- `backend/services/whatsappAgent.js` (MODIFICADO - usar redis)

**Métrica de éxito:**
- [ ] Admin auth se propaga entre bots en <500ms
- [ ] Media whitelist sincronizada
- [ ] Locks previenen race conditions
- [ ] Sincronización al startup completa

---

### FASE 2.5: Graceful Shutdown & Cleanup (1h)

**Problema:**
- Señal SIGTERM mata bot abruptamente
- Conexiones no se cierran
- Locks en BD quedan activos
- Clientes quedan en limbo

**Solución:**
1. **Signal Handlers** - SIGTERM, SIGINT
2. **Connection Cleanup** - Cerrar todas las conexiones
3. **Lock Release** - Liberar locks en BD
4. **Draining** - Esperar a que terminen operaciones en vuelo
5. **Notificación** - Avisar a clientes antes de desconectar

**Flujo:**
```
SIGTERM recibido
  ↓
1. Marcar como "shutting_down"
  ↓
2. Detener aceptar nuevos mensajes
  ↓
3. Esperar 10s para terminar operaciones en vuelo
  ↓
4. Cerrar conexiones:
   - BD connections
   - WhatsApp sockets
   - Redis
   ↓
5. Liberar locks
  ↓
6. Exit(0)
```

**Archivos:**
- `backend/utils/gracefulShutdown.js` (NUEVO - 100 líneas)
- `backend/server.js` (MODIFICADO - agregar signal handlers)

**Métrica de éxito:**
- [ ] Shutdown tarda max 15 segundos
- [ ] Todos los sockets cerrados
- [ ] Locks liberados en BD
- [ ] Log de shutdown clean

---

## Diagrama de Integración

```
┌─────────────────────────────────────────────────────┐
│                  Express Server                      │
│  ┌────────────────────────────────────────────────┐ │
│  │  2.5: Graceful Shutdown                        │ │
│  │  - SIGTERM handler                             │ │
│  │  - Cleanup connections                         │ │
│  └────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────┤
│ 2.3: Health Checks & Monitoring                     │
│  - GET /health → checks database, whatsapp         │
│  - GET /diagnostic → detailed metrics              │
└─────────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────────┐
│  2.1: Database Connection Pooling                   │
│  ┌────────────────────────────────────────────────┐ │
│  │ Connection Pool (min=2, max=10)                │ │
│  │ - Retry with exponential backoff               │ │
│  │ - Health checks every 30s                      │ │
│  └────────────────────────────────────────────────┘ │
│         ↓ (queries with retry)                      │
│      Supabase (PostgreSQL)                          │
└─────────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────────┐
│  2.2: Error Handling                                │
│  ┌────────────────────────────────────────────────┐ │
│  │ DatabaseError → Retry 5 veces                  │ │
│  │ NetworkError → Fallback a cache                │ │
│  │ ValidationError → Retornar 400                 │ │
│  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────────────┐
│  2.4: Cluster State Sync (Redis)                    │
│  ┌────────────────────────────────────────────────┐ │
│  │ Admin Auth State                               │ │
│  │ Media Whitelist                                │ │
│  │ Active Sessions                                │ │
│  └────────────────────────────────────────────────┘ │
│         ↓ (share state between bots)                │
│      Redis Cache                                    │
└─────────────────────────────────────────────────────┘
```

---

## Timeline

| Fase | Tarea | Duración | Estimado Fin |
|------|-------|----------|--------------|
| 2.1 | DB Pooling + Retry | 2h | 14:00 |
| 2.2 | Error Handling | 2h | 16:00 |
| 2.3 | Health Checks | 1.5h | 17:30 |
| 2.4 | Cluster Sync | 1.5h | 19:00 |
| 2.5 | Graceful Shutdown | 1h | 20:00 |
| **Total** | | **8h** | |

---

## Testing Checklist

Para cada subfase:

### 2.1 Testing
- [ ] Connection pool inicia con 2 conexiones
- [ ] Pool expande a 10 en high load
- [ ] Health check falla y se recupera
- [ ] Retry con backoff exponencial funciona
- [ ] Max 5 reintentos, luego error

### 2.2 Testing
- [ ] DatabaseError se retenta automáticamente
- [ ] NetworkError usa cache fallback
- [ ] Logs tienen contexto JSON
- [ ] Error messages son claros

### 2.3 Testing
- [ ] /health responde OK
- [ ] /diagnostic muestra métricas
- [ ] Status degrada si algo falla
- [ ] Alert se envía vía WhatsApp

### 2.4 Testing
- [ ] Redis conecta y funciona
- [ ] Admin auth se propaga a bot 2
- [ ] Media whitelist sincronizada
- [ ] Locks previenen race conditions

### 2.5 Testing
- [ ] SIGTERM handler ejecuta
- [ ] Conexiones cierran ordenadamente
- [ ] Locks se liberan en 5s
- [ ] Shutdown completa en <15s

---

## Success Criteria

✅ **FASE 2 está completa cuando:**

1. Sistema recupera automáticamente de caídas de BD
2. /health y /diagnostic endpoints funcionan
3. Admin auth sincroniza entre bots en cluster
4. Shutdown es limpio sin deadlocks
5. Todos los escenarios de error tienen handling explícito

---

## Próximo Paso

Una vez completada FASE 2, sistema será:
- ✅ **Seguro** (FASE 1)
- ✅ **Confiable** (FASE 2)
- ⏳ **Rápido** (FASE 3 - Performance Optimization)

---

**Generado:** 2026-07-02  
**Por:** Claude Code  
**Ready para:** Adelante con 2.1
