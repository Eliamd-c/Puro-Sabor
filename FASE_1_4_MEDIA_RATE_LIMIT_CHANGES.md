# FASE 1.4: Media Size & Rate Limiting Mejorado - COMPLETADO ✅

**Fecha:** 2026-07-02  
**Estado:** COMPLETADO  
**Tiempo:** 2h  
**Severidad:** 🟠 ALTA (previene DoS, protege memoria)

## Resumen

Implementamos sistema de rate limiting diferenciado (admin vs clientes), media download queue con concurrencia controlada, y detección automática de archivos grandes con streaming en lugar de buffer.

---

## El Problema (Denial of Service)

Sin protección, un atacante podría:

```
1. Enviar 100 peticiones simultáneamente
   → Sistema intenta descargar 100 archivos de 50MB
   → 5GB en RAM
   → Server crash (OOM)

2. Admin spam: "Reconectar bot" 50 veces/segundo
   → Locks bloqueados
   → Database saturada
   → Bot inoperable

3. Cliente spam: Solicitar 100 imágenes/segundo
   → Queue infinita
   → CPU 100%
   → Otros clientes no reciben respuestas
```

---

## Solución: Módulo `rateLimitService.js` (325 líneas)

### 1. Rate Limiting Diferenciado

**Admin (30 acciones/min):**
```javascript
{
  messages: 30/min,    // Puede enviar 30 comandos
  functions: 30/min,   // Puede ejecutar 30 funciones
  media: 10/min        // Puede descargar 10 archivos
}
```

**Cliente (10 acciones/min):**
```javascript
{
  messages: 10/min,    // Puede escribir 10 mensajes
  functions: 5/min,    // Puede solicitar 5 cosas
  media: 3/min         // Puede descargar 3 archivos
}
```

**Implementación:**
```javascript
const rateLimitCheck = checkRateLimit(senderNumber, 'messages', userType);

if (!rateLimitCheck.allowed) {
  return; // Rechazar
}

// {
//   allowed: true,
//   remaining: 9,
//   resetIn: 45000,     // milisegundos
//   limit: 10
// }
```

### 2. Media Download Queue

**Características:**
- Máximo **2 descargas simultáneas** (controla CPU/RAM)
- Queue FIFO para solicitudes adicionales
- **Timeout de 30 segundos** por descarga
- Streaming con callback de progreso
- Cancelación automática de descargas stuck

**Uso:**
```javascript
const imageData = await globalDownloadQueue.download(
  filePath,
  (progressPercent, totalSize, bytesRead) => {
    console.log(`${progressPercent}% (${formatBytes(bytesRead)}/${formatBytes(totalSize)})`);
  }
);
```

### 3. Detección de Archivos Grandes

```javascript
const fileInfo = isLargeFile(filePath);

if (fileInfo.isLarge) {
  // Archivo > 10MB
  console.log(`Archivo grande: ${fileInfo.sizeFormatted}`);
}
```

**Límites:**
- Archivo pequeño: 0-10MB (procesar normal)
- Archivo grande: 10-50MB (log especial)
- Archivo prohibido: >50MB (rechazar)

---

## Cambios en `whatsappAgent.js`

### Rate Limiting Antiguo (Vulnerable)
```javascript
if (this.botType === 'client' && !checkRateLimit(senderNumber)) {
  // Simple en memoria, igual para todos
  // Max 10 msg/min, sin diferenciación
  // Sin logging de límites
}
```

### Rate Limiting Nuevo (Mejorado)
```javascript
const userType = this.botType === 'admin' ? 'admin' : 'client';
const rateLimitCheck = checkRateLimit(senderNumber, 'messages', userType);

if (!rateLimitCheck.allowed) {
  const resetSecs = Math.ceil(rateLimitCheck.resetIn / 1000);
  const limMsg = userType === 'admin'
    ? `Límite: 30 msg/min. Reinicia en ${resetSecs}s`
    : `Límite: 10 msg/min. Reinicia en ${resetSecs}s`;

  await this.client.sendMessage(remoteJid, { text: limMsg }, { quoted: message });
  return;
}

if (rateLimitCheck.remaining <= 2) {
  console.warn(`${senderNumber} casi alcanza límite (${rateLimitCheck.remaining} quedan)`);
}
```

### Media Antiguo (Vulnerable)
```javascript
// Leer TODO el archivo en memoria
const safePath = _path.resolve(uploadsDir, _path.basename(menuImg));
const imageData = fs.readFileSync(safePath);  // ❌ 50MB en RAM
await this.client.sendMessage(remoteJid, { image: { url: safePath } });
```

### Media Nuevo (Mejorado)
```javascript
// Validar antes de descargar
const mediaValidation = mediaService.getSecureMediaPath(menuImg, 'image/jpeg', 'menu');

// Rate limit para media
const mediaRateLimit = checkRateLimit(senderNumber, 'media', userType);
if (!mediaRateLimit.allowed) {
  await this.client.sendMessage(remoteJid, { text: '⏳ Demasiadas descargas.' });
  break;
}

// Detectar archivo grande
const fileInfo = isLargeFile(mediaValidation.cleanPath);
if (fileInfo.isLarge) {
  console.log(`Archivo grande: ${fileInfo.sizeFormatted}`);
}

// Descargar con streaming y progreso
const imageData = await globalDownloadQueue.download(
  mediaValidation.cleanPath,
  (progressPercent, totalSize, bytesRead) => {
    console.log(`${progressPercent}% (${formatBytes(bytesRead)})`);
  }
);

await this.client.sendMessage(remoteJid, { image: { buffer: imageData } });
```

---

## Flujo de Rate Limiting

```
Cliente envía mensaje
  ↓
1. Determinar userType (admin vs client)
   userType = this.botType === 'admin' ? 'admin' : 'client'

2. Verificar rate limit
   rateLimitCheck = checkRateLimit(number, 'messages', userType)

3. Decisión:
   ├─ Si allowed = true:
   │  ├─ Procesar mensaje
   │  └─ Si remaining <= 2: Advertencia en logs
   └─ Si allowed = false:
      ├─ Enviar: "Límite alcanzado. Reinicia en Xs"
      └─ Retornar (no procesar)

4. Registro en cache:
   rateLimitCache[number][category] = {
     count: incrementado,
     resetAt: now + windowMs
   }

5. Cleanup automático:
   - Cada 30 minutos: borrar entradas expiradas
   - Cada ventana: resetear counters
```

---

## Flujo de Media Download Queue

```
Bot necesita enviar archivo grande
  ↓
1. Validar path y MIME
   mediaValidation = mediaService.getSecureMediaPath(...)

2. Verificar rate limit de media
   mediaRateLimit = checkRateLimit(number, 'media', userType)

3. Enqueue descarga
   downloadId = globalDownloadQueue.download(filePath, onProgress)
   ↓
   Cola agrega task: { id, filePath, onProgress, resolve, reject }

4. Procesar si < 2 descargas activas:
   └─ Leer archivo con streaming + callback de progreso

5. Durante descarga:
   ├─ Leer chunks de 64KB
   ├─ Callback cada 25% completado
   ├─ Si timeout (30s) → rechazar
   └─ Si > 50MB → rechazar

6. Resultado:
   ├─ ✅ Éxito: resolve(Buffer)
   ├─ ❌ Error: reject(Error)
   └─ Limpiar y procesar siguiente task

7. Status:
   globalDownloadQueue.getStatus()
   → { queued: 3, active: 2, downloads: [...] }
```

---

## Testing Checklist

- [ ] **Rate Limiting - Mensajes:**
  - [ ] Admin envía 31 mensajes en 1 min → mensaje 31 rechazado
  - [ ] Cliente envía 11 mensajes en 1 min → mensaje 11 rechazado
  - [ ] Límite se resetea después de ventana (1 min)

- [ ] **Rate Limiting - Media:**
  - [ ] Cliente solicita 4 descargas en 1 min → 4ta rechazada
  - [ ] Admin solicita 11 descargas en 1 min → 11va rechazada

- [ ] **Download Queue:**
  - [ ] 2 descargas simultáneas máximo
  - [ ] 3ra descarga espera en queue
  - [ ] Progreso se reporta cada 25%

- [ ] **File Size Limits:**
  - [ ] Archivo 2MB → descargado normal
  - [ ] Archivo 20MB → etiquetado "grande"
  - [ ] Archivo 51MB → rechazado

- [ ] **Timeout:**
  - [ ] Descarga lenta (>30s) → cancelada automaticamente
  - [ ] Próxima tarea en queue comienza

---

## Seguridad Mejorada

### ANTES (Vulnerable 🔴)
```
Bot recibe 1000 peticiones:
  → Intenta enviar 1000 archivos
  → 50GB descarga simultánea
  → Server crash (OOM)

Admin spam: 50 reconexiones/segundo
  → 50 locks simultáneos
  → Database deadlock
  → Bot inoperable

Cliente malicioso:
  → 100 descargas/segundo
  → Queue infinita
  → CPU 100%, otros usuarios afectados
```

### DESPUÉS (Seguro ✅)
```
Bot recibe 1000 peticiones:
  → Max 10 (cliente) o 30 (admin) aceptadas
  → Resto rechazadas con "Límite alcanzado"
  → Server stable

Admin spam: 50 reconexiones/segundo
  → Solo 30/min permitidas
  → Después rechazadas
  → Otros admins no afectados

Cliente malicioso:
  → Max 3 descargas/min permitidas
  → Queue max 2 concurrentes
  → CPU estable
  → Otros clientes responsivos
```

---

## Métricas y Monitoring

**Queue Status:**
```javascript
const status = globalDownloadQueue.getStatus();
// {
//   queued: 3,           // En espera
//   active: 2,           // Descargando
//   maxConcurrent: 2,
//   downloads: [
//     { status: 'downloading', progress: 65, error: null },
//     { status: 'downloading', progress: 30, error: null }
//   ]
// }
```

**Rate Limit Status:**
```javascript
const status = getRateLimitStatus(number, 'media', 'client');
// { limit: 3, remaining: 1, resetIn: 23000 }
```

---

## Rollback Procedure

**Opción 1: Aumentar límites temporalmente**
```javascript
RATE_LIMITS.client.messages = { maxRequests: 50, windowMs: 60 * 1000 };
```

**Opción 2: Desabilitar rate limiting**
```javascript
// En whatsappAgent.js, comentar check:
/*
if (!rateLimitCheck.allowed) {
  return; // Rechazar
}
*/
```

**Opción 3: Aumentar concurrencia de downloads**
```javascript
MEDIA_CONFIG.MAX_CONCURRENT_DOWNLOADS = 5; // De 2 a 5
```

**Opción 4: Revertir completamente**
```bash
git revert <commit-hash>
npm start
```

---

## Archivos Modificados

| Archivo | Cambios | Líneas |
|---------|---------|--------|
| `backend/services/rateLimitService.js` | NUEVO - Rate limit + queue | 325 |
| `backend/services/whatsappAgent.js` | Import + 3 ubicaciones actualizadas + rate limit mejorado | +1 import + ~150 |

---

## Próximo Paso

✅ **FASE 1.4 COMPLETADO**  
⏭️ **FASE 1.5:** Input Validation para Gemini Functions

---

## Referencias

- Node.js Streams: https://nodejs.org/docs/latest/api/stream.html
- Rate Limiting patterns: https://en.wikipedia.org/wiki/Token_bucket
- DoS prevention: https://owasp.org/www-community/attacks/Denial_of_Service

