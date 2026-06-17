# 🔐 AUDITORÍA DE SEGURIDAD - MÓDULO CHATBOT (WhatsApp IA)

**Fecha:** 2026-06-16  
**Archivo Principal:** `backend/services/whatsappAgent.js`  
**Nivel de Riesgo:** 🔴 ALTO  

---

## 📊 RESUMEN EJECUTIVO

| Categoría | Cantidad | Severidad |
|-----------|----------|-----------|
| **Vulnerabilidades Críticas** | 5 | 🔴 ALTA |
| **Vulnerabilidades Altas** | 7 | 🟠 MEDIA |
| **Mejoras de Código** | 8 | 🟡 BAJA |
| **Total Hallazgos** | 20 | - |

---

## 🔴 VULNERABILIDADES CRÍTICAS

### 1. **SSL Certificate Validation Disabled (CRÍTICO)**
**Línea:** 11-12  
**Severidad:** 🔴 CRÍTICA  
**Tipo:** Man-in-the-Middle (MITM) Attack

```javascript
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }  // ← VULNERABLE
});
```

**Problema:** La conexión a PostgreSQL no valida certificados SSL. Un atacante en la red podría interceptar credenciales de BD.

**Impacto:**
- Credenciales de BD expuestas
- Datos de clientes comprometidos
- Órdenes modificadas/robadas

**Solución:**
```javascript
ssl: process.env.NODE_ENV === 'production' 
  ? { rejectUnauthorized: true }  // Producción: validar
  : { rejectUnauthorized: false }  // Dev: permitir aceptado
```

---

### 2. **Admin Number Authorization Bypass**
**Línea:** 433  
**Severidad:** 🔴 CRÍTICA  
**Tipo:** Authentication Bypass

```javascript
const isAuthorized = authorizedNumbers.some(n => 
  senderNumber.endsWith(n) || n.endsWith(senderNumber)
);
```

**Problema:** Lógica de comparación peligrosa:
- Si `authorizedNumbers = ['5']` y `senderNumber = '1234567895'`
- Ambas condiciones se cumplen: `'1234567895'.endsWith('5')` = true
- Cualquiera con número terminado en ese dígito es autorizado

**Impacto:**
- Cualquier usuario puede acceder a funciones de admin
- Manipular inventario sin autorización
- Transferir clientes a "humanos"

**Caso de Ataque:**
```
Admin: +573001234567
Bot verifica: authorizedNumbers = ['3001234567']
Atacante: +573009999567
Result: '3009999567'.endsWith('567') → true ✗ AUTORIZADO
```

**Solución:**
```javascript
const isAuthorized = authorizedNumbers.includes(senderNumber);
```

---

### 3. **Path Traversal en Archivos Multimedia**
**Línea:** 594  
**Severidad:** 🔴 CRÍTICA  
**Tipo:** Directory Traversal / Arbitrary File Access

```javascript
const absolutePath = require('path').join(__dirname, '..', kbEntry.media_url);
if (require('fs').existsSync(absolutePath)) {
  // Enviar archivo desde disco
}
```

**Problema:** `media_url` viene de la BD sin validación. Si la BD es comprometida:

```
media_url = "../../.env"  → Accede a variables de entorno
media_url = "../../config/database.js"  → Accede a código
media_url = "../../../../etc/passwd"  → En Linux
```

**Impacto:**
- Acceso a archivos sensibles (.env, secretos)
- Exposición de código fuente
- Exposición de credenciales

**Solución:**
```javascript
const path = require('path');
const mediaPath = path.resolve(__dirname, '../uploads', path.basename(kbEntry.media_url));
const uploadsDir = path.resolve(__dirname, '../uploads');
if (!mediaPath.startsWith(uploadsDir)) throw new Error('Invalid path');
```

---

### 4. **Buffer Size DoS - Media Upload Sin Límite**
**Línea:** 412-417  
**Severidad:** 🔴 CRÍTICA  
**Tipo:** Denial of Service (Memory Exhaustion)

```javascript
const buffer = await downloadMediaMessage(
  message, 'buffer', {},
  { logger: pino({ level: 'silent' }) }
);
const mimeType = imageMsg ? imageMsg.mimetype : audioMsg.mimetype;
mediaPart = { inlineData: { data: buffer.toString('base64'), mimeType } };
```

**Problema:** No hay validación de tamaño. Un atacante podría:
1. Enviar video de 500MB
2. Se descarga completo en memoria
3. `toString('base64')` lo multiplica por 1.33x
4. Server crash por memory exhaustion

**Impacto:**
- Crash del servidor
- Indisponibilidad del bot

**Caso de Ataque:**
```
User sends: 500MB video file
→ downloadMediaMessage: 500MB en RAM
→ toString('base64'): 665MB más
→ Total: ~1.2GB
→ Node OOM → CRASH
```

**Solución:**
```javascript
const MAX_MEDIA_SIZE = 5 * 1024 * 1024; // 5MB
const mediaSize = imageMsg?.fileLength || audioMsg?.fileLength || 0;
if (mediaSize > MAX_MEDIA_SIZE) {
  throw new Error('Archivo muy grande (máx 5MB)');
}
```

---

### 5. **Race Condition en Lock Distribuido**
**Línea:** 211-231  
**Severidad:** 🔴 CRÍTICA  
**Tipo:** Concurrency Race Condition

```javascript
async tryAcquireLockDB() {
  const res = await pgPool.query(
    'SELECT value, updated_at FROM wa_auth WHERE key = $1', 
    [this.LOCK_KEY]
  );
  
  if (res.rows.length > 0) {
    // Check si lock está vencido
    if (lockPid !== myPid && lockTime > expiry) {
      return false;  // Lock activo
    }
  }
  
  // Aquí hay race: otro proceso podría haber adquirido entre SELECT y INSERT
  await pgPool.query(
    'INSERT INTO wa_auth (key, value, updated_at) VALUES ($1, $2, NOW()) ...',
    [this.LOCK_KEY, myPid]
  );
  return true;
}
```

**Problema:** Entre el SELECT (línea 216) y el INSERT (línea 226), otro proceso podría:
1. Leer que el lock expiró
2. Intentar adquirir
3. **Ambos escriben al mismo tiempo → Ambos creen que tienen el lock**

**Impacto:**
- Múltiples instancias de bot activas simultáneamente
- Mensajes duplicados
- Estado inconsistente

**Solución:**
```javascript
const result = await pgPool.query(
  `UPDATE wa_auth SET value = $1, updated_at = NOW() 
   WHERE key = $2 AND (
     value = $3 OR 
     updated_at < NOW() - INTERVAL '30 seconds'
   ) RETURNING *`,
  [myPid, this.LOCK_KEY, oldPid]
);
return result.rowCount === 1; // Atomic: solo 1 ganador
```

---

## 🟠 VULNERABILIDADES ALTAS

### 6. **API Key Exposure en Logs**
**Línea:** 519-528  
**Severidad:** 🟠 ALTA  
**Tipo:** Credential Exposure

```javascript
const apiKey = await getConfig('gemini_api_key') || process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
```

**Problema:**
- Si hay error, la key podría exponerse en logs de error
- `console.error()` podría incluir la key
- Logs no rotados = permanentes

**Solución:**
```javascript
const apiKey = await getConfig('gemini_api_key') || process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
if (apiKey.length < 20) throw new Error('Invalid GEMINI_API_KEY');

// Nunca loguear la key
console.log('Using Gemini API: configured');
```

---

### 7. **Error Information Disclosure**
**Línea:** 632  
**Severidad:** 🟠 ALTA  
**Tipo:** Information Disclosure

```javascript
await this.client.sendMessage(remoteJid, { 
  text: `⚠️ Error IA: ${err.message}` 
}, { quoted: message });
```

**Problema:** El mensaje de error se envía al usuario. Puede revelar:
- Nombres de funciones internas
- Paths de archivos
- Nombres de servicios
- Detalles de infraestructura

**Ejemplo Malo:**
```
Error IA: Cannot find module '/app/backend/config/database.js'
→ Usuario aprende estructura de directorios
```

**Solución:**
```javascript
const isAdmin = authorizedNumbers.includes(senderNumber);
const errorMsg = isAdmin 
  ? `Error IA: ${err.message}`  // Admin ve detalles
  : '⚠️ Error procesando tu mensaje. Intenta de nuevo.';  // Cliente ve genérico
```

---

### 8. **Mezcla de SQLite y PostgreSQL Inconsistente**
**Línea:** 17-42 (SQLite) vs 151-232 (PostgreSQL)  
**Severidad:** 🟠 ALTA  
**Tipo:** Data Consistency Bug

**Problema:** El código usa AMBAS BDs:
- `db.get()`, `db.all()`, `db.run()` → SQLite
- `pgPool.query()` → PostgreSQL

```javascript
// Función getConfig usa SQLite
function getConfig(key) {
  return new Promise((resolve) => {
    db.get('SELECT value FROM config WHERE key = ?', [key], (err, row) => {
```

**Impacto:**
- Actualizaciones van a una BD, lecturas de otra
- Config nunca se refleja
- Lock no sincroniza
- Data inconsistente

**Solución:**
Migrar TODAS las operaciones a PostgreSQL (que ya tienes):
```javascript
async function getConfig(key) {
  const result = await pgPool.query(
    'SELECT value FROM config WHERE key = $1',
    [key]
  );
  return result.rows.length > 0 ? result.rows[0].value : null;
}
```

---

### 9. **Rate Limiting Ausente**
**Línea:** 396-450  
**Severidad:** 🟠 ALTA  
**Tipo:** Denial of Service

```javascript
async procesarMensajeEntrante(message) {
  // Sin verificación de rate limit
  // Usuario puede enviar 1000 mensajes/segundo
}
```

**Impacto:**
- Spam masivo agota API de Gemini
- Consumo de crédito ($$$)
- Otros usuarios no pueden usar

**Caso de Ataque:**
```
for (let i = 0; i < 1000; i++) {
  sendWhatsAppMessage('hola');  // 1000 llamadas a Gemini
}
→ Costo: $0.001 * 1000 = $1 en segundos
```

---

### 10. **No Validation en KB ID**
**Línea:** 586-590  
**Severidad:** 🟠 ALTA  
**Tipo:** SQL Injection (Integer Bypass)

```javascript
const kbId = mediaIdMatch[1];  // String sin validar
const kbEntry = await new Promise(resolve => {
  db.get('SELECT media_url, media_type FROM chatbots_kb WHERE id = ?', [kbId], ...
```

**Problema:** `kbId` es string pero se usa como número. Aunque usa `?` (parametrizado), debería validar:
```
kbId = "1 OR 1=1"  → ¿Funciona?
kbId = "1; DROP TABLE chatbots_kb"  → ¿Funciona?
```

**Solución:**
```javascript
const kbId = parseInt(mediaIdMatch[1], 10);
if (isNaN(kbId) || kbId < 1) throw new Error('Invalid KB ID');
```

---

### 11. **Unhandled Promise Rejection**
**Línea:** 258, 345  
**Severidad:** 🟠 ALTA  
**Tipo:** Unhandled Exception

```javascript
setTimeout(() => this.inicializarWhatsApp(), 5000);
```

**Problema:** Si `inicializarWhatsApp()` rechaza una promesa, nunca se captura.

**Solución:**
```javascript
setTimeout(() => {
  this.inicializarWhatsApp().catch(err => {
    console.error('Reconnect failed:', err.message);
  });
}, 5000);
```

---

### 12. **Message History sin Límite de Memoria**
**Línea:** 529-533  
**Severidad:** 🟠 ALTA  
**Tipo:** Memory Leak

```javascript
const historialPrevio = await obtenerHistorial(senderNumber, this.botType, 15);
const historialGemini = historialPrevio.map(h => ({
  role: h.rol === 'user' ? 'user' : 'model',
  parts: [{ text: h.contenido }]
}));
```

**Problema:**
- Cada conversación acumula historial
- Después de 100 conversaciones × 15 mensajes = 1500 entradas en memoria
- Historial nunca se limpia
- Conversaciones antiguas permanecen en RAM

**Impacto:**
- Memory leak gradual
- Server lento con el tiempo
- Crash after semanas

**Solución:**
```javascript
// Limitar a últimos 5 días
const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
db.run('DELETE FROM wa_conversaciones WHERE creado_en < ?', [fiveDaysAgo]);
```

---

## 🟡 OPORTUNIDADES DE MEJORA

### 13. **Hardcoded Browser Fingerprint**
**Línea:** 304  
**Problema:** `Browsers.macOS('Desktop')` puede violar TOS de WhatsApp y trigger bans

### 14. **No Encryption para Datos Sensibles**
**Problema:** Conversations se guardan en plaintext en BD

### 15. **Missing Input Validation en Stock**
**Línea:** 46, 64  
**Problema:** `parseInt()` sin validación de rango negativo

### 16. **No Timeout en Gemini API**
**Línea:** 547  
**Problema:** `sendMessage()` sin timeout. Puede hang infinitamente.

### 17. **Database Connection Pooling**
**Problema:** pgPool nunca se cierra. Memory leak en production.

### 18. **No Encryption en API Keys de Config**
**Problema:** config table guarda GEMINI_API_KEY en plaintext

### 19. **Múltiples instancias de GoogleGenerativeAI**
**Línea:** 528  
**Problema:** Crea nuevo cliente cada mensaje. Debería reutilizar.

### 20. **No Fallback para Historial Fallido**
**Línea:** 529  
**Problema:** Si la BD de historial falla, Gemini pierde contexto

---

## 📋 PLAN DE REMEDIACIÓN

### FASE 1: CRÍTICO (24h)

| # | Vulnerabilidad | Esfuerzo | Impacto |
|---|---|---|---|
| 1 | SSL Certificate Validation | 15min | 🔴 CRÍTICO |
| 2 | Admin Number Bypass | 30min | 🔴 CRÍTICO |
| 3 | Path Traversal | 1h | 🔴 CRÍTICO |
| 4 | Buffer DoS | 1h | 🔴 CRÍTICO |
| 5 | Distributed Lock | 2h | 🔴 CRÍTICO |

**Tiempo Total:** ~5 horas

### FASE 2: ALTO (48h)

| # | Vulnerabilidad | Esfuerzo | Impacto |
|---|---|---|---|
| 6 | API Key Exposure | 1h | 🟠 ALTO |
| 7 | Error Disclosure | 1h | 🟠 ALTO |
| 8 | SQLite/PostgreSQL Split | 3h | 🟠 ALTO |
| 9 | Rate Limiting | 2h | 🟠 ALTO |
| 10 | KB ID Validation | 30min | 🟠 ALTO |
| 11 | Promise Rejections | 30min | 🟠 ALTO |
| 12 | Memory Leak en Historial | 1h | 🟠 ALTO |

**Tiempo Total:** ~9 horas

### FASE 3: MEJORAS (1 semana)

- [ ] Encriptación en config de API keys
- [ ] Reutilización de GoogleGenerativeAI client
- [ ] Encryption en conversations
- [ ] Proper DB connection cleanup
- [ ] Timeout en Gemini API
- [ ] Mejor manejo de errores

---

## 🛠️ ARCHIVOS A MODIFICAR

```
backend/services/whatsappAgent.js       (CRÍTICO - 80% del trabajo)
backend/config/database.js              (Migrar SQLite → PostgreSQL)
backend/config/env.js                   (Agregar validaciones)
backend/middleware/rateLimiter.js       (NUEVO - Rate limiting)
backend/config/security.js              (NUEVO - Configuración seguridad)
```

---

## ✅ CHECKLIST DE IMPLEMENTACIÓN

### Antes de cualquier despliegue:

- [ ] SSL: `rejectUnauthorized: true` en producción
- [ ] Admin numbers: Usar `===` exacto, no `endsWith`
- [ ] Media files: Sandboxed en `/uploads`, sin traversal
- [ ] Buffer size: Máximo 5MB
- [ ] Lock: Usar UPDATE atomic, no SELECT + INSERT
- [ ] Rate limiting: 10 msgs/min por usuario
- [ ] Error messages: Genéricos para clientes, detallados para admin
- [ ] SQLite/PostgreSQL: Migrar completamente a PostgreSQL
- [ ] Historial: Limpiar cada 5 días
- [ ] API Keys: Nunca loguear, solo longitud

---

## 📊 RESUMEN DE SEVERIDAD

```
🔴 CRÍTICO:  5 vulnerabilidades
   - MITM por SSL
   - Auth bypass
   - Path traversal
   - DoS memory
   - Race condition

🟠 ALTO:     7 vulnerabilidades
   - Credential exposure
   - Error disclosure
   - Data inconsistency
   - Rate limit missing
   - Input validation

🟡 BAJO:     8 mejoras
   - Memory leaks
   - Performance
   - Code quality
```

---

**Estado:** 🔴 REQUIERE ACCIÓN INMEDIATA  
**Prioridad:** P0 - Crítica para seguridad  
**Fecha Revisión:** 2026-06-16

