# 📋 PLAN DETALLADO: BOT WHATSAPP PURO SABOR

## 🎯 RESUMEN EJECUTIVO

- **MVP (Phase 1):** 2 semanas, 11-12 horas de desarrollo
- **Full Implementation (Phase 2):** 3 semanas total, 24 horas
- **Phase 3 (Optional Polish):** +1 semana si quieres UX premium

---

## 📊 FASE 0: PREPARACIÓN BD (1-2 horas)

### 4 Tablas Nuevas a Crear

```sql
CREATE TABLE wa_plantillas (
  id SERIAL PRIMARY KEY,
  trigger VARCHAR(255) UNIQUE,
  respuesta TEXT,
  tipo VARCHAR(50), -- ubicacion, horarios, menu, general
  activa INTEGER DEFAULT 1,
  orden INTEGER DEFAULT 0
);

CREATE TABLE wa_horarios (
  id SERIAL PRIMARY KEY,
  dia_semana INTEGER, -- 0-6 (domingo-sábado)
  hora_apertura VARCHAR(5),
  hora_cierre VARCHAR(5),
  abierto INTEGER DEFAULT 1
);

CREATE TABLE wa_ordenes (
  id SERIAL PRIMARY KEY,
  numero_cliente VARCHAR(50),
  codigo_orden VARCHAR(20) UNIQUE, -- PS-20250616-A7K2
  items_json TEXT,
  total REAL,
  estado VARCHAR(50) DEFAULT 'pendiente'
);

CREATE TABLE wa_conversaciones_analytics (
  id SERIAL PRIMARY KEY,
  numero_cliente VARCHAR(50),
  resumen TEXT,
  fecha DATE
);
```

Con datos iniciales (plantillas predefinidas, horarios 7 días)

---

## 🚀 PHASE 1: MVP (TIER 1) - SEMANA 1

**11-12 horas de desarrollo | 4 mejoras principales**

### ✅ Mejora 1: Menú Dinámico (2 horas)

**Cliente pregunta:** "¿Qué bebidas tienen?"  
**Bot responde:** Lista completa de bebidas disponibles

**Cambios:**
- `backend/services/whatsappProductService.js` (NEW)
- Función Gemini: `obtenerProductosPorCategoria()`
- DB query: Productos con stock > 0

---

### ✅ Mejora 2: Templates Rápidas (3 horas)

**Cliente pregunta:** "horarios"  
**Bot responde:** Inmediatamente (sin Gemini)

**Cambios:**
- `backend/services/whatsappTemplateService.js` (NEW)
- `backend/routes/whatsappTemplates.js` (NEW)
- Verificación de triggers ANTES de llamar Gemini
- Admin puede agregar/editar templates en panel

**API:**
```
GET/POST/PUT/DELETE /api/wa/templates
```

---

### ✅ Mejora 3: Productos Agotados (1 hora)

**Admin pregunta:** "qué está agotado"  
**Bot responde:** Lista de productos con stock = 0

**Cambios:**
- Función Gemini: `obtenerProductosAgotados()`
- Helper DB: query productos donde stock = 0

---

### ✅ Mejora 4: Dashboard Conversaciones (4 horas)

**Admin ve:**
- Últimas conversaciones
- Clientes únicos
- Conversaciones por día
- Historial de cada cliente

**Cambios:**
- `backend/routes/whatsappConversations.js` (NEW)
- `public/admin/wa-conversations.html` (NEW)
- 3 APIs nuevas:
  ```
  GET /api/wa/conversations (últimas)
  GET /api/wa/conversations/:numero (por cliente)
  GET /api/wa/conversations/summary (resumen diario)
  ```

---

## 🎯 PHASE 2: CORE FEATURES (TIER 2) - SEMANA 2

**13 horas de desarrollo | 4 mejoras avanzadas**

### ✅ Mejora 5: Crear Órdenes desde WhatsApp (5 horas)

**Cliente:** "Quiero 2 Migas con Res, 1 Limonada"  
**Bot:** Crea orden, genera código PS-20250616-A7K2, notifica admin

**Cambios:**
- `backend/services/whatsappOrderService.js` (NEW)
- Función Gemini: `crearOrden(items, notas)`
- BD: Guardar en `wa_ordenes`
- Real-time: Socket.io notificación a admin
- Validación: Stock suficiente

---

### ✅ Mejora 6: Horarios Complejos 7 Días (3 horas)

**En lugar de:** "Abierto: Sí/No"  
**Ahora:** Matriz horaria por día
```
Lunes-Viernes: 18:00 - 23:30
Sábado: 18:00 - 23:30
Domingo: 12:00 - 21:00
```

**Cambios:**
- `backend/services/whatsappHorarioService.js` (NEW)
- `backend/routes/whatsappHorarios.js` (NEW)
- Admin puede editar horarios sin reiniciar bot
- APIs:
  ```
  GET /api/wa/horarios
  PUT /api/wa/horarios/:dia
  ```

---

### ✅ Mejora 7: Contexto Horario (2 horas)

**Si es fuera de horario:**
- Bot reconoce que está cerrado
- Responde: "Abrimos mañana sábado de 6 PM a 11:30 PM"
- Ofrece hacer pedido para después

**Cambios:**
- Lógica en `whatsappAgent.js`
- Consultar `wa_horarios` antes de construir systemInstruction
- Contexto dinámico según día/hora actual

---

### ✅ Mejora 8: Búsqueda Avanzada (3 horas)

**Cliente:** "Algo con pollo"  
**Bot:** Retorna todos productos con "pollo" en nombre/descripción

**Cambios:**
- Función Gemini: `buscarProductos(termino)`
- DB query: ILIKE búsqueda (case-insensitive)
- Retornar hasta 10 resultados

---

## 💎 PHASE 3: POLISH (OPCIONAL) - SEMANA 3

**7 horas | UX Premium**

### ✅ Mejora 9: Botones de Respuesta Rápida (2 horas)

```
¿Qué deseas ver?
[Ver Bebidas] [Ver Platos] [Hablar con Soporte]
```

Usar mensajes interactivos de Baileys

---

### ✅ Mejora 10: Confirmación con Código (2 horas)

```
✅ Tu orden ha sido creada exitosamente!

📋 Código: PS-20250616-A7K2
💰 Total: $45.000

Guarda este código para referencias futuras
```

---

### ✅ Mejora 11: Resumen Diario para Admin (3 horas)

**Cada noche a las 11:59 PM:**
```
📊 Resumen del Día:
• 24 mensajes totales
• 8 clientes únicos
• 5 órdenes creadas
• $230.000 en ventas
```

Usar `node-cron` para job schedulado

---

## 📁 ARCHIVOS A CREAR/MODIFICAR

### Archivos Nuevos:
```
backend/services/whatsappProductService.js
backend/services/whatsappTemplateService.js
backend/services/whatsappOrderService.js
backend/services/whatsappHorarioService.js

backend/routes/whatsappTemplates.js
backend/routes/whatsappConversations.js
backend/routes/whatsappOrders.js
backend/routes/whatsappHorarios.js

public/admin/wa-conversations.html
public/admin/wa-templates.html
public/admin/wa-ordenes.html
```

### Archivos a Modificar:
```
backend/services/whatsappAgent.js (CRÍTICO - agregar funciones Gemini)
backend/server.js (agregar rutas nuevas)
backend/config/database.js (crear tablas en inicialización)
```

---

## ⏱️ TIMELINE REALISTA

| Fase | Mejoras | Horas | Semana | Estado |
|------|---------|-------|--------|--------|
| **0** | Preparación BD | 1-2 | Prep | Scripts SQL |
| **1** | 1-4 (MVP) | 11-12 | Semana 1 | Menú + Templates + Admin |
| **2** | 5-8 | 13 | Semana 2 | Órdenes + Horarios |
| **3** | 9-11 (Opt) | 7 | Semana 3 | UX Premium |
| **TOTAL** | - | **32-33h** | **3 semanas** | Production |

---

## 🎯 ORDEN CRÍTICO DE IMPLEMENTACIÓN

1. **Phase 0** ← Crear tablas en BD
2. **Mejora 1** ← Menu dinámico (base para búsqueda)
3. **Mejora 2** ← Templates (rápido, genera valor inmediato)
4. **Mejora 3** ← Ver agotados (admin benefit)
5. **Mejora 4** ← Dashboard (visible, refleja valor)
6. **Mejora 5** ← Órdenes (core del sistema)
7. **Mejora 6** ← Horarios (independiente)
8. **Mejora 7** ← Contexto horario (depende de 6)
9. **Mejora 8** ← Búsqueda (depende de 1)
10. **Mejora 9-11** ← Polish (nice-to-have)

---

## ⚠️ RIESGOS Y MITIGACIONES

| Riesgo | Probabilidad | Impacto | Solución |
|--------|--------------|--------|----------|
| Gemini timeout | Media | Bajo | Limitar resultados a 10 |
| Stock race condition | Baja | Alto | Usar transacciones DB |
| Plantillas bloquean Gemini | Media | Medio | Validar triggers en UI |
| Órdenes se pierden | Baja | Alto | Guardar TODOS en BD |
| Sincronización horaria | Baja | Bajo | Server timezone, no cliente |

---

## 🧪 TESTING CHECKLIST

### Phase 1:
- [ ] Cliente pide menú por categoría
- [ ] Templates responden en <1s
- [ ] Admin ve agotados
- [ ] Dashboard muestra conversaciones
- [ ] No hay latencia regresiva

### Phase 2:
- [ ] Orden genera código único
- [ ] Horarios actualizables
- [ ] Mensaje "cerrado" fuera de horario
- [ ] Búsqueda retorna resultados

### Phase 3:
- [ ] Botones interactivos funcionan
- [ ] Confirmación tiene código
- [ ] Resumen diario se envía

---

## 🚦 PRÓXIMOS PASOS

**¿Cuál es tu preferencia?**

1. **Iniciar Phase 1 ahora** (menú dinámico + templates)
2. **Empezar por mejora específica** (cuál?)
3. **Quieres que escriba el código** para Phase 1?
4. **Solo necesitas el plan escrito** para ejecutar yourself?

---

## 📝 Notas Técnicas

### Dependencies Nuevas:
```json
{
  "node-cron": "^3.0.3",
  "joi": "^17.9.2"
}
```

### Variables de Entorno:
```
WA_ADMIN_NUMBER=xxx
GEMINI_API_KEY=xxx
```

### Database Indices Recomendados:
```sql
CREATE INDEX idx_wa_ordenes_numero ON wa_ordenes(numero_cliente);
CREATE INDEX idx_wa_ordenes_estado ON wa_ordenes(estado);
CREATE INDEX idx_wa_plantillas_trigger ON wa_plantillas(trigger);
CREATE INDEX idx_wa_conversaciones_numero ON wa_conversaciones_analytics(numero_cliente);
```

---

**Última actualización:** 2026-06-16  
**Status:** Plan Aprobado - Listo para Implementación  
**Versión:** 1.0
