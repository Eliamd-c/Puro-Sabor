# Fix: Estado de Mesas en Tiempo Real — "viendo" siempre en 0

**Fecha:** 2026-06-17  
**Afecta:** Panel Admin → Sección "Estado de Mesas en Tiempo Real"  
**Síntoma:** Las tarjetas de mesa siempre muestran "Esperando clientes..." aunque haya clientes navegando el menú.

---

## 1. Causa Raíz

### Arquitectura del problema

El servidor corre en **Hostinger con LiteSpeed + Passenger** en modo multi-proceso. Esto significa que hay N procesos Node.js corriendo en paralelo, cada uno con su propia memoria.

El contador `viendo` se calcula así en `GET /api/mesas`:

```js
// routes/mesas.js — líneas 129-136
const sockets = await io.in(sala).fetchSockets();
const adapterSize = io.sockets.adapter.rooms.get(sala)?.size || 0;
viendo = Math.max(sockets.length, adapterSize);
```

**El fallo ocurre porque:**

1. El cliente abre `/mesa/3` → su socket se conecta al **Proceso A**
2. `socket.join('mesa_3')` ocurre en **Proceso A** → `rooms['mesa_3']` tiene 1 socket en ese proceso
3. El servidor emite `mesa_actualizada` al admin (funciona vía Postgres Adapter)
4. El admin recibe el evento y llama `GET /api/mesas` (petición HTTP)
5. LiteSpeed enruta esa petición HTTP al **Proceso B**
6. En el **Proceso B**, `io.sockets.adapter.rooms.get('mesa_3')` es `undefined` → `adapterSize = 0`
7. `fetchSockets()` con el Postgres Adapter debería cruzar procesos, pero hay un try/catch que silencia el error y devuelve 0 como fallback
8. Resultado: `viendo = 0` → "Esperando clientes..."

### Por qué `fetchSockets()` falla silenciosamente

```js
// El try/catch actual oculta el fallo real
try {
  const sockets = await io.in(sala).fetchSockets(); // puede timeout o lanzar error
  viendo = sockets.length; // si falló, nunca llega aquí
} catch (e) {
  viendo = io.sockets.adapter.rooms.get(sala)?.size || 0; // Proceso B → 0
}
```

---

## 2. La Solución

**Estrategia:** Abandonar `fetchSockets()` y rastrear `viendo` directamente en **PostgreSQL** con actualizaciones atómicas. Como todos los procesos comparten la misma base de datos, el contador siempre será exacto sin importar qué proceso maneja la petición HTTP.

### Flujo corregido

```
Cliente abre /mesa/3
      ↓
Socket conecta al Proceso A
      ↓
unirse_mesa → UPDATE mesas SET viendo = viendo + 1 WHERE numero = 3
      ↓  (PostgreSQL, compartido entre todos los procesos)
emit 'mesa_actualizada' al admin
      ↓
Admin llama GET /api/mesas (puede ir al Proceso B)
      ↓
SELECT * FROM mesas  →  mesa.viendo = 1  ✓
      ↓
"👀 1 persona(s) mirando el menú"
```

---

## 3. Cambios de Código

### Cambio 1: `backend/config/database.js`

**Qué hace:** Agrega la columna `viendo` a la tabla `mesas` y la resetea a 0 cada vez que el servidor arranca (evita contadores zombis si el server se cayó con clientes conectados).

Dentro de la función `inicializarTablas()`, después de la creación de la tabla `mesas` (línea ~187), agregar:

```js
// Agregar columna viendo si no existe (migracion segura)
await pool.query(`ALTER TABLE mesas ADD COLUMN IF NOT EXISTS viendo INTEGER DEFAULT 0`);

// Resetear contadores al arrancar (evita zombis por crash o reinicio)
await pool.query(`UPDATE mesas SET viendo = 0`);
```

**Ubicación exacta:** Al final del bloque `try` de `inicializarTablas()`, justo antes de `console.log('✅ Tablas verificadas/creadas en Postgres.')`.

---

### Cambio 2: `backend/server.js`

**Qué hace:** Incrementa `viendo` cuando un socket se une a una sala de mesa, y lo decrementa cuando se desconecta.

#### 2a. Agregar el require de dbAsync al inicio del archivo

Después de `const logger = require('./config/logger');` (línea ~13), agregar:

```js
const dbAsync = require('./config/database-promise');
```

#### 2b. Reemplazar el handler `unirse_mesa` (líneas 89-101)

**Antes:**
```js
socket.on('unirse_mesa', (mesaNumero) => {
  socket.mesaNumero = mesaNumero;
  const sala = mesaNumero === 'general' ? 'mesa_general' : `mesa_${mesaNumero}`;
  socket.join(sala);

  const carritoActual = carritosMesa[sala] || { items: [] };
  socket.emit('carrito_actualizado', carritoActual.items);
  console.log(`[Socket] ${socket.id} se unió a ${sala}`);
  
  // Notificar al admin que la mesa tiene actividad (clientes viendo menú)
  io.to('admin').emit('mesa_actualizada', { mesa: mesaNumero });
});
```

**Después:**
```js
socket.on('unirse_mesa', async (mesaNumero) => {
  socket.mesaNumero = mesaNumero;
  const sala = mesaNumero === 'general' ? 'mesa_general' : `mesa_${mesaNumero}`;
  socket.join(sala);

  const carritoActual = carritosMesa[sala] || { items: [] };
  socket.emit('carrito_actualizado', carritoActual.items);
  console.log(`[Socket] ${socket.id} se unió a ${sala}`);

  // Incrementar contador de viewers en DB (funciona cross-proceso)
  if (mesaNumero !== 'general') {
    try {
      await dbAsync.run(
        'UPDATE mesas SET viendo = viendo + 1 WHERE numero = ?',
        [mesaNumero]
      );
    } catch (e) {
      console.error(`[Socket] Error incrementando viendo para mesa ${mesaNumero}:`, e.message);
    }
  }

  io.to('admin').emit('mesa_actualizada', { mesa: mesaNumero });
});
```

#### 2c. Reemplazar el handler `disconnect` (líneas 139-144)

**Antes:**
```js
socket.on('disconnect', () => {
  console.log(`[Socket] Cliente desconectado: ${socket.id}`);
  if (socket.mesaNumero) {
    io.to('admin').emit('mesa_actualizada', { mesa: socket.mesaNumero });
  }
});
```

**Después:**
```js
socket.on('disconnect', async () => {
  console.log(`[Socket] Cliente desconectado: ${socket.id}`);
  if (socket.mesaNumero && socket.mesaNumero !== 'general') {
    try {
      await dbAsync.run(
        'UPDATE mesas SET viendo = GREATEST(0, viendo - 1) WHERE numero = ?',
        [socket.mesaNumero]
      );
    } catch (e) {
      console.error(`[Socket] Error decrementando viendo para mesa ${socket.mesaNumero}:`, e.message);
    }
    io.to('admin').emit('mesa_actualizada', { mesa: socket.mesaNumero });
  }
});
```

**Por qué `GREATEST(0, viendo - 1)`:** Evita que el contador llegue a negativo en caso de desconexiones dobles o condiciones de carrera.

---

### Cambio 3: `backend/routes/mesas.js`

**Qué hace:** Elimina el `fetchSockets()` y usa el valor `viendo` directamente de la fila de la DB, que ya es correcto gracias a los cambios en `server.js`.

#### Reemplazar el bloque de cálculo de `viendo` en `GET /api/mesas` (líneas 125-136)

**Antes:**
```js
const data = await Promise.all(mesas.map(async (mesa) => {
  const sala = `mesa_${mesa.numero}`;
  let viendo = 0;
  if (io) {
    try {
      const sockets = await io.in(sala).fetchSockets();
      const adapterSize = io.sockets.adapter.rooms.get(sala)?.size || 0;
      viendo = Math.max(sockets.length, adapterSize);
    } catch (e) {
      viendo = io.sockets.adapter.rooms.get(sala)?.size || 0;
    }
  }
  
  const sesion = await dbAsync.get( ...
```

**Después:**
```js
const data = await Promise.all(mesas.map(async (mesa) => {
  // viendo se mantiene actualizado en la DB por los eventos de socket (server.js)
  const viendo = mesa.viendo || 0;
  
  const sesion = await dbAsync.get( ...
```

**También:** La variable `io` ya no se necesita en esta ruta. Eliminar la línea:
```js
// Eliminar esta línea — ya no se usa
const io = req.app.get('io');
```

---

## 4. Orden de Aplicación

Aplicar los cambios en este orden para evitar estados inconsistentes:

1. **`database.js`** primero — la columna debe existir antes de que el servidor intente escribir en ella
2. **`server.js`** — el servidor necesita la columna para los handlers de socket
3. **`routes/mesas.js`** — la ruta lee el valor que el servidor escribe

Luego **reiniciar el servidor** para que:
- La migración de `ALTER TABLE` corra
- El `UPDATE mesas SET viendo = 0` resetee contadores sucios

---

## 5. Verificación

### Prueba manual paso a paso

1. Abrir el panel admin → `/admin/mesas`
2. En otra pestaña/dispositivo, abrir `/mesa/3`
3. En el panel admin, la Mesa 3 debe cambiar de **"Esperando clientes..."** a **"👀 1 persona(s) mirando el menú"** en menos de 2 segundos
4. Cerrar la pestaña del cliente → la Mesa 3 debe volver a **"Esperando clientes..."**
5. Abrir `/mesa/3` desde 2 dispositivos distintos → debe mostrar **"👀 2 persona(s) mirando el menú"**

### Verificar en DB

```sql
-- Ver contadores en tiempo real
SELECT numero, nombre, viendo FROM mesas ORDER BY numero;

-- Debe mostrar:
-- numero | nombre | viendo
-- -------+--------+-------
--   1    | Mesa 1 |   0
--   2    | Mesa 2 |   0
--   3    | Mesa 3 |   1   ← cuando hay alguien viendo
```

### Verificar endpoint de debug existente

```
GET /api/mesas/debug/sockets
```

Este endpoint ya existía para diagnóstico. Puede compararse con el valor `viendo` de la DB para confirmar que ambos coinciden.

---

## 6. Consideraciones Adicionales

### Reset automático al reiniciar
El `UPDATE mesas SET viendo = 0` en `inicializarTablas()` garantiza que si el servidor se reinicia mientras hay clientes conectados, los contadores empiezan desde 0. Los clientes seguirán conectados por el socket y el servidor recibirá sus `unirse_mesa` nuevamente cuando la sesión de socket se reconecte (10 intentos configurados en el cliente).

### Concurrencia
PostgreSQL maneja `UPDATE ... SET viendo = viendo + 1` de forma atómica. Múltiples procesos pueden actualizar la misma fila simultáneamente sin condiciones de carrera gracias al locking a nivel de fila de PostgreSQL.

### Clientes que recargan la página
Cada recarga genera un nuevo socket. El socket viejo se desconecta (decrementa) y el nuevo se conecta (incrementa). El net effect es 0, lo cual es correcto.

### Mesa "general"
El menú general (`/mesa/general`) está excluido del tracking porque no corresponde a una fila en la tabla `mesas`. El código ya tiene `if (mesaNumero !== 'general')` para este caso.

---

## 7. Archivos Modificados (resumen)

| Archivo | Tipo de cambio |
|---|---|
| `backend/config/database.js` | Agregar `ALTER TABLE mesas ADD COLUMN IF NOT EXISTS viendo` + reset al inicio |
| `backend/server.js` | `unirse_mesa` y `disconnect` actualizan `viendo` en DB |
| `backend/routes/mesas.js` | Leer `mesa.viendo` de DB en lugar de `fetchSockets()` |

**Líneas eliminadas:** ~10 (el bloque de `fetchSockets()` con try/catch)  
**Líneas agregadas:** ~15 (las dos llamadas a `dbAsync.run()` en los handlers de socket)  
**Cambio neto:** simplificación del código, más confiable en producción multi-proceso
