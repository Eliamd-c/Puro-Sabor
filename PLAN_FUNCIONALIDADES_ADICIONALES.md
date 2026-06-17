# ✨ FUNCIONALIDADES ADICIONALES - AGENTE ATENCIÓN CLIENTE

**Versión:** 1.0  
**Estado:** Propuestas (Selecciona cuáles quieres)  
**Total Adicionales:** 12 mejoras  

---

## 🎯 ¿CUÁLES AGREGAR?

Lee cada una y marca con ✅ las que quieres implementar.

---

## 1️⃣ RECORDATORIO DE CUMPLEAÑOS 🎂

**¿Qué hace?**
- Registrar fecha de nacimiento del cliente
- El bot envía mensaje: "¡Feliz cumpleaños María! 🎉 Hoy tienes 10% descuento"
- Se envía automáticamente a las 10am

**Esfuerzo:** 3 horas  
**Impacto:** Medio (fidelización)

**Nueva tabla:**
```sql
CREATE TABLE clientes_cumpleaños (
  telefono VARCHAR(50) PRIMARY KEY,
  fecha_nacimiento DATE,
  descuento_cumple INTEGER DEFAULT 10 -- %
);
```

**Beneficio:**
- Cliente se siente especial
- Aumenta visitas ese día
- Costo del descuento << ingresos

---

## 2️⃣ SISTEMA DE RECOMENDACIONES INTELIGENTES 🎯

**¿Qué hace?**
- Registra qué platos compra cada cliente
- Si pregunta "¿Qué me recomiendas?", el bot sugiere basado en historial
- Ej: "Veo que amas las Migas. Prueba nuestras Costillas al carbón"

**Esfuerzo:** 4 horas  
**Impacto:** Alto (aumenta ticket promedio)

**Nueva tabla:**
```sql
CREATE TABLE cliente_compras (
  id SERIAL PRIMARY KEY,
  telefono VARCHAR(50),
  producto TEXT,
  fecha TIMESTAMP DEFAULT NOW()
);
```

**Lógica:**
```javascript
// Si pregunta por recomendación:
const favoritos = await obtenerComprasMasRecientes(telefono, 5);
// Respuesta: "Te recomendamos esto que ya te encanta"
```

---

## 3️⃣ ENCUESTA DE SATISFACCIÓN POST-COMPRA 📊

**¿Qué hace?**
- Después de 2 horas de un pedido: "¿Cómo estuvo tu comida? 1-5 ⭐"
- Registra feedback
- Si es < 3: Avisa al admin para contactar al cliente

**Esfuerzo:** 3 horas  
**Impacto:** Medio (calidad + retención)

**Nueva tabla:**
```sql
CREATE TABLE cliente_feedback (
  id SERIAL PRIMARY KEY,
  telefono VARCHAR(50),
  rating INTEGER, -- 1-5
  comentario TEXT,
  fecha TIMESTAMP DEFAULT NOW()
);
```

---

## 4️⃣ RASTREADOR DE PEDIDOS 🚚

**¿Qué hace?**
- Cliente pregunta: "¿Dónde está mi pedido?"
- Bot responde con estado (preparando/enviando/entregado)
- Enlace a track en tiempo real

**Esfuerzo:** 5 horas  
**Impacto:** Alto (experiencia cliente)

**Integración:**
- Conectar con tabla `mesas` existente
- Si estado = "listo": "Tu pedido está listo en caja"
- Si estado = "pagado": "Está siendo preparado 👨‍🍳"

---

## 5️⃣ PROGRAMA DE LEALTAD PUNTOS 🏆

**¿Qué hace?**
- Cada compra = +10 puntos
- 100 puntos = $5 descuento
- Cliente ve: "Tienes 45 puntos"

**Esfuerzo:** 6 horas  
**Impacto:** Alto (fidelización)

**Nueva tabla:**
```sql
CREATE TABLE cliente_puntos (
  telefono VARCHAR(50) PRIMARY KEY,
  saldo_puntos INTEGER DEFAULT 0,
  puntos_canjeados INTEGER DEFAULT 0
);
```

**Flujo:**
```
Cliente compra $50
  → +10 puntos
  → Saldo: 45 puntos
  → Bot: "Ganaste 10 puntos. Te faltan 55 para un descuento"
```

---

## 6️⃣ RESERVAS DE MESA DESDE WHATSAPP 📅

**¿Qué hace?**
- "Quiero reservar para 4 personas mañana 7pm"
- Bot responde: "✅ Reservado. Código: RES-2024-001"
- Admin recibe alerta

**Esfuerzo:** 4 horas  
**Impacto:** Medio (conveniencia)

**Integración:**
- Conectar con tabla `mesas` existente
- Función Gemini: `reservarMesa(fecha, personas, notas)`

---

## 7️⃣ NOTIFICACIONES DE STOCK BAJO 📉

**¿Qué hace?**
- Admin marca: "Costillas: stock bajo"
- Bot informa al cliente: "Solo nos quedan 2 porciones de Costillas"
- Crea urgencia de compra

**Esfuerzo:** 2 horas  
**Impacto:** Bajo-Medio

**Nueva tabla:**
```sql
CREATE TABLE productos_alerta (
  producto_id INTEGER PRIMARY KEY,
  stock_minimo INTEGER,
  enviar_notificacion INTEGER DEFAULT 1
);
```

---

## 8️⃣ CHAT MULTIIDIOMA 🌍

**¿Qué hace?**
- Detectar idioma del cliente (WhatsApp meta)
- Responder en Español, Inglés o Portugués
- Bot: "I see you speak English. Let me respond in English"

**Esfuerzo:** 2 horas  
**Impacto:** Bajo (si es local, poco valor)

**Lógica:**
```javascript
const idioma = message.pushName?.split(' ').length > 2 ? 'en' : 'es';
// Cambiar systemInstruction según idioma
```

---

## 9️⃣ HORARIO DE ATENCIÓN AUTOMÁTICO ⏰

**¿Qué hace?**
- Si fuera de horario: Bot responde automáticamente
- "No estamos abiertos. Abrimos mañana a las 6pm"
- Ofrece recibir recordatorio

**Esfuerzo:** 2 horas  
**Impacto:** Bajo (mejoría UX)

**Tabla existente:**
- Usar `wa_horarios` (ya la tienes del plan anterior)

---

## 🔟 CUPONES PERSONALIZADOS 🎟️

**¿Qué hace?**
- Admin genera cupón: "BIENVENIDA10" → 10% OFF
- Bot lo ofrece a clientes nuevos automáticamente
- "Usa BIENVENIDA10 en tu primer pedido"

**Esfuerzo:** 3 horas  
**Impacto:** Medio (adquisición)

**Nueva tabla:**
```sql
CREATE TABLE cupones (
  codigo VARCHAR(50) PRIMARY KEY,
  descuento_porcentaje INTEGER,
  descuento_fijo REAL,
  fecha_inicio TIMESTAMP,
  fecha_fin TIMESTAMP,
  para_clientes VARCHAR(50), -- 'nuevo', 'todos'
  activo INTEGER DEFAULT 1
);
```

---

## 1️⃣1️⃣ REFE A AMIGO 👥

**¿Qué hace?**
- Cliente invita amigo: "Te doy el código MARIA50"
- Amigo usa: +$5 para amigo, +$5 para María
- Tracking de referidos

**Esfuerzo:** 4 horas  
**Impacto:** Alto (adquisición barata)

**Nueva tabla:**
```sql
CREATE TABLE cliente_referidos (
  referidor VARCHAR(50),
  referido VARCHAR(50),
  descuento_referidor REAL,
  descuento_referido REAL,
  fecha TIMESTAMP DEFAULT NOW()
);
```

---

## 1️⃣2️⃣ ENCUESTA DE PRODUCTOS NUEVOS 🆕

**¿Qué hace?**
- "Estamos pensando en agregar Pizzas. ¿Te gustaría?"
- Cliente vota: Sí/No/Tal vez
- Admin ve resultados: "78% dice sí a pizzas"

**Esfuerzo:** 3 horas  
**Impacto:** Bajo (research)

**Nueva tabla:**
```sql
CREATE TABLE encuestas (
  id SERIAL PRIMARY KEY,
  titulo TEXT,
  opciones JSONB, -- ["Sí", "No", "Tal vez"]
  activa INTEGER DEFAULT 1
);

CREATE TABLE encuesta_respuestas (
  id SERIAL PRIMARY KEY,
  encuesta_id INTEGER,
  telefono VARCHAR(50),
  respuesta TEXT,
  fecha TIMESTAMP DEFAULT NOW()
);
```

---

## 📊 COMPARATIVA DE FUNCIONALIDADES

| # | Nombre | Horas | Impacto | Complejidad | Prioridad |
|---|--------|-------|--------|-------------|-----------|
| 1 | Cumpleaños | 3h | Medio | ⭐ | P3 |
| 2 | Recomendaciones | 4h | Alto | ⭐⭐⭐ | P1 |
| 3 | Satisfacción | 3h | Medio | ⭐⭐ | P2 |
| 4 | Rastreador Pedidos | 5h | Alto | ⭐⭐⭐ | P1 |
| 5 | Programa Lealtad | 6h | Alto | ⭐⭐⭐ | P1 |
| 6 | Reservas | 4h | Medio | ⭐⭐ | P2 |
| 7 | Alerta Stock | 2h | Bajo | ⭐ | P3 |
| 8 | Multiidioma | 2h | Bajo | ⭐ | P3 |
| 9 | Horario Auto | 2h | Bajo | ⭐ | P3 |
| 10 | Cupones | 3h | Medio | ⭐⭐ | P2 |
| 11 | Referidos | 4h | Alto | ⭐⭐⭐ | P1 |
| 12 | Encuestas | 3h | Bajo | ⭐⭐ | P3 |

---

## 🎯 RECOMENDACIÓN POR OBJETIVO

### **Si quieres AUMENTAR VENTAS:**
✅ Recomendaciones (2)  
✅ Programa Lealtad (5)  
✅ Referidos (11)  
**Total: 14 horas**

### **Si quieres MEJORAR EXPERIENCIA:**
✅ Rastreador Pedidos (4)  
✅ Cumpleaños (1)  
✅ Satisfacción (3)  
**Total: 12 horas**

### **Si quieres LO BÁSICO:**
✅ Cumpleaños (1)  
✅ Cupones (10)  
**Total: 6 horas**

### **COMBO RECOMENDADO (Mejor ROI):**
✅ Recomendaciones (2)  
✅ Programa Lealtad (5)  
✅ Referidos (11)  
✅ Cupones (10)  
**Total: 20 horas (junto con el plan principal)**

---

## 💡 MI RECOMENDACIÓN

**Fase 1 (Plan Principal):** 20h  
**Fase 2a (Recomendaciones):** 4h → Aumenta ventas 15-20%  
**Fase 2b (Programa Lealtad):** 6h → Retención +30%  
**Fase 2c (Referidos):** 4h → Nuevos clientes baratos  

**Total con todo:** 34 horas = 1 semana

---

## ✅ ¿CUÁLES QUIERES?

Marca las que te interesan y empezamos:

- [ ] 1 - Cumpleaños 🎂
- [ ] 2 - Recomendaciones 🎯
- [ ] 3 - Satisfacción 📊
- [ ] 4 - Rastreador 🚚
- [ ] 5 - Lealtad 🏆
- [ ] 6 - Reservas 📅
- [ ] 7 - Alerta Stock 📉
- [ ] 8 - Multiidioma 🌍
- [ ] 9 - Horario Auto ⏰
- [ ] 10 - Cupones 🎟️
- [ ] 11 - Referidos 👥
- [ ] 12 - Encuestas 🆕

---

**¿Cuáles te gustan?**

