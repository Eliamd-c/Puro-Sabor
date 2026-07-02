# FASE 2.3: Health Checks & Monitoring - COMPLETADO ✅

**Fecha:** 2026-07-02  
**Duración:** 1.5h  
**Estado:** ✅ COMPLETADO

---

## Problema Resuelto

**Antes (Ciego 🔴):**
```
Sistema está down
  ↓
Admin no lo sabe
  ↓
Clientes se quejan
  ↓
Admin por fin se da cuenta
  ↓
Demasiado tarde - pérdida de negocio
```

**Después (Monitoreado ✅):**
```
Sistema empieza a degradarse
  ↓
Health checks detectan en <30s
  ↓
Alert enviado a admin vía WhatsApp
  ↓
Admin toma acción inmediata
  ↓
Downtime minimizado
```

---

## Implementación

### 1. Nuevo módulo: `backend/utils/metricsCollector.js` (300 líneas)

**MetricsCollector - Recopila métricas del sistema:**

```javascript
class MetricsCollector {
  // Tracks:
  ├─ uptime (desde que inició)
  ├─ requests (total, success, error, avg response time)
  ├─ errors (por tipo: database, network, validation, etc)
  ├─ database (connections, queries, health %)
  ├─ whatsapp (admin/client status, messages processed)
  └─ memory (uso, CPU load)
}
```

**Métodos principales:**

1. **`recordRequest(method, path, statusCode, responseTime)`**
   - Registra cada request
   - Calcula promedio de tiempo de respuesta
   - Cuenta éxitos y errores

2. **`recordError(errorType)`**
   - Incrementa contador de errores por tipo
   - Rastrea en errorCounts para análisis

3. **`updateDatabaseMetrics(poolStats, queryTime)`**
   - Pool size (total, idle, active)
   - Query success/fail rate
   - Average query time

4. **`updateWhatsAppStatus(botType, status, messagesProcessed)`**
   - Admin/client bot status
   - Total messages processed

5. **`getHealthSnapshot()`** - Retorna estado de salud
   ```javascript
   {
     status: 'ok' | 'degraded' | 'down',
     uptime: '2h 15m',
     checks: {
       database: 'ok',
       whatsapp_admin: 'ok',
       whatsapp_client: 'degraded',
       memory: 'ok',
       errorRate: 'ok'
     }
   }
   ```

6. **`getDiagnostic()`** - Info completa para debugging
   ```javascript
   {
     version: '2.0',
     environment: 'production',
     health: 'degraded',
     uptime: 7920,
     system: { memory, cpu, platform },
     requests: { total, success, error rate },
     database: { pool stats, query health },
     whatsapp: { admin, client },
     errors: { by type, top errors },
     checks: { all component statuses }
   }
   ```

### 2. Nuevo módulo: `backend/services/alertService.js` (250 líneas)

**AlertService - Envía alertas vía WhatsApp:**

```javascript
class AlertService {
  alertThresholds = {
    errorRatePercent: 20,       // Alert si >20% errores
    memoryUsagePercent: 85,     // Alert si >85% memoria
    responseTimeMs: 5000,       // Alert si avg >5s
    databaseHealthPercent: 70   // Alert si <70% health
  }
}
```

**Métodos principales:**

1. **`sendAlert(severity, title, message, details)`**
   - Envía alert a todos los admins via WhatsApp
   - Formatea mensajes con emoji y contexto
   - Cooldown de 5 minutos por tipo de alert (evita spam)

2. **`checkAndAlert(health, metrics)`**
   - Compara métricas contra thresholds
   - Envía alerts si se exceden limits
   - Detecta:
     - Error rate alto
     - Database health bajo
     - Memory usage alto
     - Response time lento
     - WhatsApp bots desconectados
     - Sistema degradado/down

3. **`getAlertHistory(limit)`** - Últimos N alerts
4. **`getAlertStatus()`** - Resumen de alerts en la última hora

**Severidades de Alerta:**
```
🚨 CRITICAL  - Sistema down, acción inmediata
❌ ERROR     - Componente crítico fallido
⚠️  WARNING   - Degradación, watch closely
ℹ️  INFO      - Informativos
```

### 3. Nuevo módulo: `backend/routes/health.js` (160 líneas)

**Endpoints:**

#### 1. `GET /health` - Quick Health Check
```javascript
// Responde en <1 segundo
Response: {
  status: 'ok' | 'degraded' | 'down',
  timestamp: ISO8601,
  uptime: segundos,
  checks: {
    database: 'ok' | 'error',
    whatsapp_admin: 'ok' | 'error',
    whatsapp_client: 'ok' | 'error',
    memory: 'ok' | 'warning',
    errorRate: 'ok' | 'warning' | 'error'
  }
}
```

#### 2. `GET /diagnostic` - Detailed Diagnostics
```javascript
// Info completa del sistema
Response: {
  diagnostic: {
    version: '2.0',
    environment: 'production',
    health: status,
    uptime: 7920,
    system: { platform, arch, memory, cpu },
    requests: { total, success, fail, errorRate, avgTime },
    database: { poolSize, queries, health % },
    whatsapp: { adminStatus, clientStatus, messagesProcessed },
    errors: { total, byType, topErrors },
    checks: { all statuses }
  },
  alerts: {
    status: { recentCount, critical, error, warning },
    recent: [ ... ]
  }
}
```

#### 3. `GET /health/db` - Database Only
```javascript
Response: {
  status: 'ok' | 'error',
  database: 'PostgreSQL/Supabase',
  queryTime: '12ms',
  timestamp: ISO8601
}
```

#### 4. `GET /health/whatsapp` - WhatsApp Bots Only
```javascript
Response: {
  status: 'ok' | 'error',
  whatsapp: {
    admin: { status, connected, qrAvailable },
    client: { status, connected, qrAvailable }
  }
}
```

### 4. Integración: `backend/server.js`

**Cambios:**
- Importar metricsCollector y alertService
- Middleware para rastrear requests (req/res timing)
- Registrar rutas health
- Iniciar health checks periódicos cada 30s

**Flujo de Health Checks:**
```
Cada 30 segundos:
  1. Obtener estado de bots WhatsApp
  2. Recopilar snapshot de métricas
  3. Ejecutar checkAndAlert()
  4. Si hay problemas → Enviar alerts vía WhatsApp
```

---

## Features Implementados

### ✅ Comprehensive Metrics Collection
- Requests: total, success, errors, avg response time
- Database: pool size, query health %, avg query time
- WhatsApp: status de ambos bots, messages processed
- Memory: usage %, CPU load average
- Errors: contador por tipo

### ✅ Health Status Determination
```
Status = 'ok' si:
  - Error rate < 10%
  - Database health > 80%
  - Both WhatsApp bots connected
  - Memory < 85%

Status = 'degraded' si:
  - Error rate 10-30%
  - Database health 50-80%
  - 1 WhatsApp bot disconnected
  - Memory 85-95%

Status = 'down' si:
  - Error rate > 30%
  - Database health < 50%
  - Both WhatsApp bots disconnected
  - Memory > 95%
```

### ✅ Automatic Alert System
```
Si error rate > 20% → WARNING alert
Si database health < 70% → ERROR alert
Si memory > 85% → WARNING alert
Si response time > 5s → WARNING alert
Si WhatsApp bot disconnected → ERROR/CRITICAL alert
Si sistema = down → CRITICAL alert
```

### ✅ Request Metrics Tracking
- Middleware captura timing de cada request
- Calcula promedio automáticamente
- Detecta slowness

### ✅ Periodic Health Checks
- Cada 30 segundos
- Actualiza estado de componentes
- Ejecuta checks de alertas
- Log en console

---

## API Usage Examples

### Monitoreo Simple (Health)
```bash
curl http://localhost:3001/health
# Respuesta rápida (<1s) con estado general
```

### Debugging Completo (Diagnostic)
```bash
curl http://localhost:3001/diagnostic
# Info detallada para troubleshooting
```

### Database Only
```bash
curl http://localhost:3001/health/db
# Verificar conexión a BD
```

### WhatsApp Status
```bash
curl http://localhost:3001/health/whatsapp
# Ver estado de bots
```

---

## Alert Examples

**High Error Rate Alert:**
```
⚠️ *WARNING: Error Rate High*

Error rate has reached 25%

*Detalles:*
• error_rate: 25%
• total_requests: 1000
• failed_requests: 250

2026-07-02 14:30:00
```

**Database Health Alert:**
```
❌ *ERROR: Database Health Low*

Database health is at 65%

*Detalles:*
• health_percent: 65%
• successful_queries: 650
• failed_queries: 350
• active_connections: 8

2026-07-02 14:30:00
```

**Bot Disconnected Alert:**
```
🚨 *CRITICAL: Admin WhatsApp Bot Down*

The admin WhatsApp bot has disconnected

*Detalles:*
• status: error

2026-07-02 14:30:00
```

---

## Monitoring Dashboard (Manual)

Puedes monitorear el sistema visitando:
```
GET /health          → Estado general
GET /diagnostic      → Datos completos
GET /health/db       → Solo BD
GET /health/whatsapp → Solo bots
```

O setup scripts de monitoreo:
```bash
# Monitor cada 10s
watch -n 10 'curl -s http://localhost:3001/health | jq'

# Alert si status != ok
while true; do
  status=$(curl -s http://localhost:3001/health | jq -r .status)
  if [ "$status" != "ok" ]; then
    echo "⚠️ System status: $status"
  fi
  sleep 30
done
```

---

## Archivos Modificados

| Archivo | Líneas | Cambio |
|---------|--------|--------|
| `metricsCollector.js` | 300 (NUEVO) | Sistema de métricas |
| `alertService.js` | 250 (NUEVO) | Sistema de alertas |
| `routes/health.js` | 160 (NUEVO) | Endpoints de health |
| `server.js` | +35 | Middleware + health checks |

**Total:** 745 líneas de código para monitoring

---

## Beneficios

| Aspecto | Antes | Después |
|---------|-------|---------|
| Visibilidad | Ninguna | 4 endpoints + alerts |
| Alertas | Manual | Automático vía WhatsApp |
| Response Time | Desconocido | Métrica + alert |
| DB Health | A ciegas | % de health + alerts |
| Downtime detection | Horas | <30 segundos |
| Admin awareness | Pasiva | Proactiva (alerts) |

---

## Próximo Paso: FASE 2.4

State Synchronization en Cluster
- Redis shared state
- Sincronización de auth entre bots
- Lock management
- Event broadcasting

---

## Rollback si es necesario

```bash
git revert <commit-hash>
npm start
```

Los endpoints health volverán al anterior (simple).

---

**FASE 2.3 COMPLETADA ✅**

El sistema ahora:
- Rastrea todas las métricas importantes
- Determina estado de salud automáticamente
- Envía alertas vía WhatsApp a admins
- Expone endpoints para monitoring
- Ejecuta health checks cada 30 segundos
- Detecta problemas en <30 segundos
