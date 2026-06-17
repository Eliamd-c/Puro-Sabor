# 📱 PLAN: AGENTE DE ATENCIÓN AL CLIENTE CON CLIENTES FRECUENTES Y PROMOCIONES

**Versión:** 2.0 (Mejorado)  
**Estado:** Listo para Implementación  
**Estimación:** 20 horas  
**Prioridad:** P1 - Funcionalidad Core  

---

## 🎯 OBJETIVO

Transformar el bot de WhatsApp de un "tomador de pedidos" a un **"Agente de Atención al Cliente"** que:
- ✅ Saluda clientes frecuentes por nombre
- ✅ Muestra promociones activas con imágenes
- ✅ Redirige pedidos al menú web
- ✅ Transfiere a humano cuando no sabe
- ✅ Registra todas las interacciones para analytics

---

## 📊 BASE DE DATOS (PostgreSQL/Supabase)

### Tabla 1: `clientes_frecuentes`

```sql
CREATE TABLE clientes_frecuentes (
  telefono VARCHAR(50) PRIMARY KEY,
  nombre VARCHAR(255) NOT NULL,
  visitas_count INTEGER DEFAULT 1,
  ultima_visita TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_clientes_frecuentes_telefono ON clientes_frecuentes(telefono);
```

**Campos:**
- `telefono`: Número WhatsApp (ej: `573142146407`)
- `nombre`: Nombre del cliente
- `visitas_count`: Cuántas veces ha hablado con el bot
- `ultima_visita`: Cuándo fue la última vez

---

### Tabla 2: `promociones`

```sql
CREATE TABLE promociones (
  id SERIAL PRIMARY KEY,
  titulo VARCHAR(255) NOT NULL,
  descripcion TEXT NOT NULL,
  imagen_url TEXT, -- Ruta local: /uploads/media/promo-1.jpg
  imagen_tipo VARCHAR(50) DEFAULT 'image', -- image, video, pdf
  activa INTEGER DEFAULT 1,
  orden INTEGER DEFAULT 0, -- Para ordenar visualización
  fecha_inicio TIMESTAMP,
  fecha_fin TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_promociones_activa ON promociones(activa);
CREATE INDEX idx_promociones_orden ON promociones(orden);
```

**Campos:**
- `titulo`: "2x1 en Costillas"
- `descripcion`: Descripción completa
- `imagen_url`: Ruta del archivo (ej: `/uploads/media/promo-1.jpg`)
- `imagen_tipo`: tipo de media (image, video, pdf)
- `activa`: 1=visible, 0=oculta
- `fecha_inicio/fin`: Validez de la promoción
- `orden`: 1=primera, 2=segunda, etc

---

### Tabla 3: `chatbot_logs` (NEW - Para Analytics)

```sql
CREATE TABLE chatbot_logs (
  id SERIAL PRIMARY KEY,
  telefono VARCHAR(50),
  nombre_cliente VARCHAR(255),
  tipo VARCHAR(50), -- 'saludo_frecuente', 'saludo_nuevo', 'promo_enviada', 'handoff'
  mensaje_usuario TEXT,
  respuesta_bot TEXT,
  detalles JSONB, -- Para data adicional
  fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_chatbot_logs_telefono ON chatbot_logs(telefono);
CREATE INDEX idx_chatbot_logs_fecha ON chatbot_logs(fecha);
CREATE INDEX idx_chatbot_logs_tipo ON chatbot_logs(tipo);
```

**Uso:**
- Rastrear cada interacción
- Analytics: "Cuántas promos se enviaron hoy"
- Dashboard: "Últimas 10 conversaciones"

---

### Tabla 4: `cliente_historial` (NEW - Contexto)

```sql
CREATE TABLE cliente_historial (
  id SERIAL PRIMARY KEY,
  telefono VARCHAR(50),
  ultima_compra TIMESTAMP,
  productos_favoritos TEXT, -- JSON: ["Migas", "Costillas"]
  notas_admin TEXT, -- "Alérgico al picante", "Vegano"
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_cliente_historial_telefono ON cliente_historial(telefono);
```

**Uso:**
- Si pregunta por recomendación: "Te recomendamos Migas, que te encantan"
- Si tiene alergias: "Sin picante, verdad?"

---

## 🔌 APIs DEL BACKEND

### Rutas: `backend/routes/chatbots.js`

#### 📌 CLIENTES FRECUENTES

```javascript
// GET /api/chatbots/clientes-frecuentes
// Retorna: Lista de clientes (nombre, teléfono, última visita)
GET /api/chatbots/clientes-frecuentes

// POST /api/chatbots/clientes-frecuentes
// Body: { telefono: "573142146407", nombre: "María" }
// Retorna: Cliente creado/actualizado
POST /api/chatbots/clientes-frecuentes

// DELETE /api/chatbots/clientes-frecuentes/:telefono
// Elimina un cliente frecuente
DELETE /api/chatbots/clientes-frecuentes/573142146407

// GET /api/chatbots/clientes-frecuentes/:telefono
// Retorna: Datos del cliente + historial
GET /api/chatbots/clientes-frecuentes/573142146407
```

---

#### 🎁 PROMOCIONES

```javascript
// GET /api/chatbots/promociones
// Retorna: Todas las promociones (activas e inactivas)
GET /api/chatbots/promociones

// GET /api/chatbots/promociones/activas
// Retorna: Solo las promociones activas y vigentes
GET /api/chatbots/promociones/activas

// POST /api/chatbots/promociones
// Body: FormData { titulo, descripcion, imagen (archivo) }
// Retorna: Promoción creada con ID
POST /api/chatbots/promociones

// POST /api/chatbots/promociones/:id/toggle
// Activa/desactiva una promoción
// Retorna: { activa: 1 } o { activa: 0 }
POST /api/chatbots/promociones/1/toggle

// DELETE /api/chatbots/promociones/:id
// Elimina promoción y su imagen del disco
DELETE /api/chatbots/promociones/1
```

---

#### 📊 ANALYTICS

```javascript
// GET /api/chatbots/logs?dias=7&tipo=promo_enviada
// Retorna: Logs filtrados
GET /api/chatbots/logs

// GET /api/chatbots/estadisticas
// Retorna: { 
//   total_mensajes: 150,
//   clientes_frecuentes: 24,
//   promos_enviadas: 42,
//   handoffs: 8
// }
GET /api/chatbots/estadisticas

// GET /api/chatbots/cliente-perfil/:telefono
// Retorna: { nombre, visitas, ultima_compra, favoritos, notas }
GET /api/chatbots/cliente-perfil/573142146407
```

---

## 🤖 LÓGICA DEL CHATBOT

### Archivo: `backend/services/whatsappAgent.js`

#### 1️⃣ DETECCIÓN DE CLIENTE FRECUENTE

```javascript
async detectarClienteFrecuente(senderNumber) {
  try {
    // Buscar cliente por número exacto O parcial
    const query = `
      SELECT nombre, visitas_count, ultima_visita, productos_favoritos, notas_admin
      FROM clientes_frecuentes cf
      LEFT JOIN cliente_historial ch ON cf.telefono = ch.telefono
      WHERE cf.telefono = $1 
         OR cf.telefono LIKE '%' || $1
         OR $1 LIKE '%' || cf.telefono
      LIMIT 1
    `;
    
    const result = await pgPool.query(query, [senderNumber]);
    
    if (result.rows.length > 0) {
      const cliente = result.rows[0];
      
      // Actualizar última visita y contador
      await pgPool.query(
        `UPDATE clientes_frecuentes 
         SET visitas_count = visitas_count + 1, 
             ultima_visita = NOW() 
         WHERE telefono = $1`,
        [senderNumber]
      );
      
      return {
        existe: true,
        nombre: cliente.nombre,
        esCliente: true,
        visitas: cliente.visitas_count,
        favoritos: cliente.productos_favoritos ? JSON.parse(cliente.productos_favoritos) : [],
        notas: cliente.notas_admin
      };
    }
    
    return { existe: false, esCliente: false };
  } catch (err) {
    console.error('Error detectando cliente:', err.message);
    return { existe: false, esCliente: false };
  }
}
```

---

#### 2️⃣ CARGAR PROMOCIONES ACTIVAS

```javascript
async cargarPromocionesActivas() {
  try {
    const query = `
      SELECT id, titulo, descripcion, imagen_url, imagen_tipo, fecha_inicio, fecha_fin
      FROM promociones
      WHERE activa = 1
        AND (fecha_inicio IS NULL OR fecha_inicio <= NOW())
        AND (fecha_fin IS NULL OR fecha_fin >= NOW())
      ORDER BY orden ASC
    `;
    
    const result = await pgPool.query(query);
    return result.rows || [];
  } catch (err) {
    console.error('Error cargando promociones:', err.message);
    return [];
  }
}
```

---

#### 3️⃣ CONSTRUIR SYSTEM INSTRUCTION DINÁMICO

```javascript
async construirSystemInstruction(senderNumber, botType) {
  if (botType !== 'client') return 'Eres asistente de Puro Sabor';
  
  // Cargar datos del cliente
  const cliente = await this.detectarClienteFrecuente(senderNumber);
  const promociones = await this.cargarPromocionesActivas();
  
  let instruction = 'Eres el recepcionista oficial de Puro Sabor.\n\n';
  
  // ✅ REGLA 1: SALUDO PERSONALIZADO
  if (cliente.existe && cliente.nombre) {
    instruction += `REGLA 1 (CLIENTE FRECUENTE): El cliente es un CLIENTE FRECUENTE llamado "${cliente.nombre}" (${cliente.visitas} visitas). Salúdalo afectuosamente por su nombre al inicio. Sé cálido y familiar.\n`;
    
    // Si tiene notas
    if (cliente.notas) {
      instruction += `Contexto importante: ${cliente.notas}\n`;
    }
    
    // Si tiene favoritos
    if (cliente.favoritos.length > 0) {
      instruction += `Sus platos favoritos son: ${cliente.favoritos.join(', ')}. Puedes recomendarle estos.\n`;
    }
  } else {
    instruction += `REGLA 1 (CLIENTE NUEVO): No conocemos al cliente. Salúdalo amablemente de forma general sin asumir su nombre.\n`;
  }
  
  // ✅ REGLA 2: PROMOCIONES
  if (promociones.length > 0) {
    instruction += `\nREGLA 2 (PROMOCIONES): Hay ${promociones.length} promoción(es) activa(s):\n`;
    
    for (const promo of promociones) {
      instruction += `- [PROMO_ID:${promo.id}] ${promo.titulo}: ${promo.descripcion}\n`;
      if (promo.imagen_url) {
        instruction += `  (Tiene imagen/video adjunto)\n`;
      }
    }
    
    instruction += `Si el cliente pregunta por promociones, descríbelas. Si la promoción tiene imagen (indicada por [PROMO_ID:x]), DEBES añadir al final exactamente: [SEND_PROMO:x]\n`;
  }
  
  // ✅ REGLA 3: MENÚ
  const menuUrl = await getConfig('bot_menu_url') || 'https://purosabor.com/menu';
  instruction += `\nREGLA 3 (PEDIDOS): Si pide menú, precios o quiere hacer pedido, envía este link: 👉 ${menuUrl}\n`;
  
  // ✅ REGLA 4: HANDOFF
  instruction += `\nREGLA 4 (HUMAN HANDOFF): Si pide hablar con un humano o no sabes responder, RESPONDE SOLO CON: [HUMAN_HANDOFF]\n`;
  
  return instruction;
}
```

---

#### 4️⃣ PROCESAR RESPUESTA CON PROMOCIÓN

```javascript
async procesarRespuestaConPromo(finalText, remoteJid, senderNumber) {
  // Buscar [SEND_PROMO:X]
  const promoMatch = finalText.match(/\[SEND_PROMO:(\d+)\]/);
  
  if (!promoMatch) {
    // Sin promoción, solo enviar texto
    await this.client.sendMessage(remoteJid, { text: finalText });
    return;
  }
  
  const promoId = parseInt(promoMatch[1], 10);
  
  // Validar ID
  if (isNaN(promoId) || promoId < 1) {
    console.error('Invalid promo ID');
    return;
  }
  
  // Obtener promo de BD
  const result = await pgPool.query(
    'SELECT imagen_url, imagen_tipo FROM promociones WHERE id = $1 AND activa = 1',
    [promoId]
  );
  
  if (result.rows.length === 0) {
    console.error('Promo not found or inactive');
    return;
  }
  
  const promo = result.rows[0];
  const cleanText = finalText.replace(/\[SEND_PROMO:\d+\]/g, '').trim();
  
  // ✅ OPCIÓN A: Archivo Local (Recomendado para tu caso)
  if (promo.imagen_url && promo.imagen_url.startsWith('/')) {
    const path = require('path');
    const uploadsDir = path.resolve(__dirname, '..', 'uploads', 'media');
    const mediaPath = path.resolve(uploadsDir, path.basename(promo.imagen_url));
    
    // Verificar que no hay path traversal
    if (!mediaPath.startsWith(uploadsDir)) {
      console.error('Path traversal attempt detected');
      return;
    }
    
    const fs = require('fs');
    if (!fs.existsSync(mediaPath)) {
      console.error('File not found:', mediaPath);
      return;
    }
    
    // Enviar según tipo
    let mediaPayload = {};
    if (promo.imagen_tipo === 'video') {
      mediaPayload = { video: { url: mediaPath }, caption: cleanText };
    } else if (promo.imagen_tipo === 'pdf') {
      mediaPayload = { document: { url: mediaPath }, caption: cleanText };
    } else {
      mediaPayload = { image: { url: mediaPath }, caption: cleanText };
    }
    
    await this.client.sendMessage(remoteJid, mediaPayload);
  }
  
  // Registrar en logs
  await pgPool.query(
    `INSERT INTO chatbot_logs (telefono, tipo, respuesta_bot) 
     VALUES ($1, 'promo_enviada', $2)`,
    [senderNumber, `Promoción #${promoId} enviada`]
  );
}
```

---

#### 5️⃣ REGISTRAR INTERACCIÓN

```javascript
async registrarInteraccion(senderNumber, tipo, mensajeUsuario, respuestaBot, cliente) {
  try {
    const detalles = {
      es_cliente_frecuente: cliente.existe,
      nombre_cliente: cliente.nombre || 'Desconocido',
      visitas: cliente.visitas || 0
    };
    
    await pgPool.query(
      `INSERT INTO chatbot_logs (telefono, nombre_cliente, tipo, mensaje_usuario, respuesta_bot, detalles)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [senderNumber, cliente.nombre || 'Anónimo', tipo, mensajeUsuario.substring(0, 200), respuestaBot.substring(0, 500), JSON.stringify(detalles)]
    );
  } catch (err) {
    console.error('Error registrando interacción:', err.message);
  }
}
```

---

## 🎨 INTERFAZ DE ADMINISTRACIÓN

### Archivo: `public/admin/chatbots.html` (NUEVO PANEL)

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gestor ChatBot - Puro Sabor</title>
  <link rel="stylesheet" href="/css/styles.css">
  <link rel="stylesheet" href="/css/dark-mode.css">
  <style>
    .chatbot-panel {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2rem;
      padding: 2rem;
    }
    
    .card-section {
      background: var(--surface-color);
      border-radius: 12px;
      padding: 2rem;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    }
    
    .form-group {
      margin-bottom: 1.5rem;
    }
    
    .form-group label {
      display: block;
      margin-bottom: 0.5rem;
      font-weight: 600;
      color: var(--text-primary);
    }
    
    .form-group input,
    .form-group textarea,
    .form-group select {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      font-size: 1rem;
      background: var(--bg-primary);
      color: var(--text-primary);
    }
    
    .btn-primary {
      background: #d4531f;
      color: white;
      padding: 0.75rem 1.5rem;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      transition: all 0.3s;
    }
    
    .btn-primary:hover {
      background: #b83f18;
      transform: translateY(-2px);
    }
    
    .btn-secondary {
      background: var(--secondary-color);
      color: white;
      padding: 0.5rem 1rem;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9rem;
      margin-right: 0.5rem;
    }
    
    .table-section {
      margin-top: 2rem;
      max-height: 400px;
      overflow-y: auto;
    }
    
    .table-section table {
      width: 100%;
      border-collapse: collapse;
    }
    
    .table-section th,
    .table-section td {
      padding: 0.75rem;
      text-align: left;
      border-bottom: 1px solid var(--border-color);
    }
    
    .table-section th {
      background: var(--bg-secondary);
      font-weight: 600;
    }
    
    .promo-item {
      display: flex;
      gap: 1rem;
      padding: 1rem;
      background: var(--bg-secondary);
      border-radius: 8px;
      margin-bottom: 1rem;
      align-items: center;
    }
    
    .promo-item img {
      width: 80px;
      height: 80px;
      object-fit: cover;
      border-radius: 6px;
    }
    
    .promo-info {
      flex: 1;
    }
    
    .promo-title {
      font-weight: 600;
      margin-bottom: 0.25rem;
    }
    
    .promo-desc {
      font-size: 0.9rem;
      color: var(--text-secondary);
      margin-bottom: 0.5rem;
    }
    
    .promo-actions {
      display: flex;
      gap: 0.5rem;
    }
    
    .toggle-btn {
      padding: 0.5rem 1rem;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.85rem;
    }
    
    .toggle-btn.active {
      background: #10b981;
      color: white;
    }
    
    .toggle-btn.inactive {
      background: #ef4444;
      color: white;
    }
  </style>
</head>
<body>
  <div class="chatbot-panel">
    
    <!-- SECCIÓN 1: PROMOCIONES -->
    <div class="card-section">
      <h2>🎁 Gestor de Promociones</h2>
      
      <div class="form-group">
        <label>Título de Promoción</label>
        <input type="text" id="promo-titulo" placeholder="Ej: 2x1 en Costillas">
      </div>
      
      <div class="form-group">
        <label>Descripción</label>
        <textarea id="promo-desc" rows="3" placeholder="Describe la promoción"></textarea>
      </div>
      
      <div class="form-group">
        <label>Imagen/Video</label>
        <input type="file" id="promo-imagen" accept="image/*,video/*">
      </div>
      
      <div class="form-group">
        <label>Tipo</label>
        <select id="promo-tipo">
          <option value="image">Imagen</option>
          <option value="video">Video</option>
          <option value="pdf">PDF</option>
        </select>
      </div>
      
      <div class="form-group">
        <label>Válida desde</label>
        <input type="datetime-local" id="promo-inicio">
      </div>
      
      <div class="form-group">
        <label>Válida hasta</label>
        <input type="datetime-local" id="promo-fin">
      </div>
      
      <button class="btn-primary" onclick="agregarPromocion()">➕ Agregar Promoción</button>
      
      <!-- Lista de promociones -->
      <div class="table-section">
        <h3>Promociones Activas</h3>
        <div id="promos-list"></div>
      </div>
    </div>
    
    <!-- SECCIÓN 2: CLIENTES FRECUENTES -->
    <div class="card-section">
      <h2>👥 Clientes Frecuentes</h2>
      
      <div class="form-group">
        <label>Número de WhatsApp</label>
        <input type="tel" id="cliente-tel" placeholder="573142146407">
      </div>
      
      <div class="form-group">
        <label>Nombre</label>
        <input type="text" id="cliente-nombre" placeholder="Ej: María García">
      </div>
      
      <div class="form-group">
        <label>Productos Favoritos (separados por coma)</label>
        <input type="text" id="cliente-favoritos" placeholder="Migas, Costillas, Limonada">
      </div>
      
      <div class="form-group">
        <label>Notas (Alergias, Preferencias)</label>
        <textarea id="cliente-notas" rows="2" placeholder="Ej: Sin picante, vegano..."></textarea>
      </div>
      
      <button class="btn-primary" onclick="agregarCliente()">➕ Agregar Cliente</button>
      
      <!-- Lista de clientes -->
      <div class="table-section">
        <h3>Clientes Registrados</h3>
        <table id="clientes-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Teléfono</th>
              <th>Visitas</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody id="clientes-body"></tbody>
        </table>
      </div>
    </div>
  </div>

  <script src="/admin/js/chatbots.js"></script>
</body>
</html>
```

---

### Archivo: `public/admin/js/chatbots.js`

```javascript
// Token de autenticación
const token = localStorage.getItem('token') || sessionStorage.getItem('token');

// ============ PROMOCIONES ============

async function agregarPromocion() {
  const formData = new FormData();
  formData.append('titulo', document.getElementById('promo-titulo').value);
  formData.append('descripcion', document.getElementById('promo-desc').value);
  formData.append('imagen_tipo', document.getElementById('promo-tipo').value);
  formData.append('fecha_inicio', document.getElementById('promo-inicio').value);
  formData.append('fecha_fin', document.getElementById('promo-fin').value);
  
  // Agregar archivo si existe
  const file = document.getElementById('promo-imagen').files[0];
  if (file) {
    formData.append('imagen', file);
  }
  
  try {
    const response = await fetch('/api/chatbots/promociones', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });
    
    if (response.ok) {
      alert('✅ Promoción agregada');
      document.getElementById('promo-titulo').value = '';
      document.getElementById('promo-desc').value = '';
      document.getElementById('promo-imagen').value = '';
      cargarPromociones();
    } else {
      alert('❌ Error al agregar promoción');
    }
  } catch (err) {
    console.error('Error:', err);
    alert('Error de conexión');
  }
}

async function cargarPromociones() {
  try {
    const response = await fetch('/api/chatbots/promociones', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const promos = await response.json();
    
    const list = document.getElementById('promos-list');
    list.innerHTML = '';
    
    promos.forEach(promo => {
      const div = document.createElement('div');
      div.className = 'promo-item';
      div.innerHTML = `
        <img src="${promo.imagen_url || '/placeholder.jpg'}" alt="${promo.titulo}">
        <div class="promo-info">
          <div class="promo-title">${promo.titulo}</div>
          <div class="promo-desc">${promo.descripcion.substring(0, 60)}...</div>
        </div>
        <div class="promo-actions">
          <button class="toggle-btn ${promo.activa ? 'active' : 'inactive'}" 
                  onclick="togglePromo(${promo.id})">
            ${promo.activa ? '✓ Activo' : '✗ Inactivo'}
          </button>
          <button class="btn-secondary" onclick="eliminarPromo(${promo.id})">🗑️ Eliminar</button>
        </div>
      `;
      list.appendChild(div);
    });
  } catch (err) {
    console.error('Error cargando promociones:', err);
  }
}

async function togglePromo(id) {
  try {
    const response = await fetch(`/api/chatbots/promociones/${id}/toggle`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
      cargarPromociones();
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

async function eliminarPromo(id) {
  if (confirm('¿Eliminar esta promoción?')) {
    try {
      const response = await fetch(`/api/chatbots/promociones/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        alert('✅ Promoción eliminada');
        cargarPromociones();
      }
    } catch (err) {
      console.error('Error:', err);
    }
  }
}

// ============ CLIENTES FRECUENTES ============

async function agregarCliente() {
  const telefono = document.getElementById('cliente-tel').value;
  const nombre = document.getElementById('cliente-nombre').value;
  const favoritos = document.getElementById('cliente-favoritos').value.split(',').map(f => f.trim());
  const notas = document.getElementById('cliente-notas').value;
  
  if (!telefono || !nombre) {
    alert('Rellena teléfono y nombre');
    return;
  }
  
  try {
    const response = await fetch('/api/chatbots/clientes-frecuentes', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        telefono,
        nombre,
        productos_favoritos: favoritos,
        notas_admin: notas
      })
    });
    
    if (response.ok) {
      alert('✅ Cliente agregado');
      document.getElementById('cliente-tel').value = '';
      document.getElementById('cliente-nombre').value = '';
      document.getElementById('cliente-favoritos').value = '';
      document.getElementById('cliente-notas').value = '';
      cargarClientes();
    } else {
      alert('❌ Error al agregar cliente');
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

async function cargarClientes() {
  try {
    const response = await fetch('/api/chatbots/clientes-frecuentes', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const clientes = await response.json();
    
    const tbody = document.getElementById('clientes-body');
    tbody.innerHTML = '';
    
    clientes.forEach(cliente => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${cliente.nombre}</td>
        <td>${cliente.telefono}</td>
        <td>${cliente.visitas_count || 0}</td>
        <td>
          <button class="btn-secondary" onclick="editarCliente('${cliente.telefono}')">✏️</button>
          <button class="btn-secondary" onclick="eliminarCliente('${cliente.telefono}')">🗑️</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error:', err);
  }
}

async function eliminarCliente(telefono) {
  if (confirm('¿Eliminar este cliente?')) {
    try {
      const response = await fetch(`/api/chatbots/clientes-frecuentes/${telefono}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        alert('✅ Cliente eliminado');
        cargarClientes();
      }
    } catch (err) {
      console.error('Error:', err);
    }
  }
}

// Cargar al iniciar
window.addEventListener('load', () => {
  cargarPromociones();
  cargarClientes();
});
```

---

## 🧪 PLAN DE TESTING

### ✅ Testing Manual

**Paso 1: Agregar Cliente Frecuente**
```
1. Ir a admin panel
2. Ingresar tu número WhatsApp real
3. Nombre: Tu nombre
4. Guardar
```

**Paso 2: Enviar Mensaje desde WhatsApp**
```
Escribir al bot desde tu número
Esperado: "¡Hola [TuNombre]! 👋"
```

**Paso 3: Agregar Promoción**
```
1. Título: "2x1 en Costillas"
2. Descripción: "Válido los martes"
3. Subir imagen
4. Guardar
```

**Paso 4: Preguntar por Promoción**
```
Escribir: "¿Qué promociones tienen?"
Esperado: Bot responde + envía imagen
```

**Paso 5: Pedir un Pedido**
```
Escribir: "Quiero pedir"
Esperado: Bot envía link del menú web
```

**Paso 6: Handoff**
```
Escribir: "Quiero hablar con un humano"
Esperado: Chat se pausa, admin recibe alerta
```

---

## 📊 RESUMEN DE CAMBIOS

| Archivo | Cambio | Complejidad |
|---------|--------|-------------|
| `backend/config/database.js` | +4 tablas | ⭐⭐ |
| `backend/routes/chatbots.js` | +8 APIs | ⭐⭐⭐ |
| `backend/services/whatsappAgent.js` | Lógica nueva | ⭐⭐⭐⭐ |
| `public/admin/chatbots.html` | UI nueva | ⭐⭐⭐ |
| `public/admin/js/chatbots.js` | JS nuevo | ⭐⭐⭐ |

---

## ⏱️ ESTIMACIÓN

```
Día 1 (8h):
├─ Database setup          : 1h
├─ Backend APIs            : 3h
├─ Bot logic               : 3h
└─ Testing básico          : 1h

Día 2 (8h):
├─ Admin UI                : 3h
├─ Integration testing     : 3h
├─ Fix bugs                : 1h
└─ Documentation           : 1h

Día 3 (4h):
├─ Final testing           : 2h
├─ Staging deployment      : 1h
└─ Production ready        : 1h

TOTAL: 20 horas
```

---

## ✨ ESTADO

**Listo para:** Implementación  
**Aprobación:** ¿Sí?  
**Siguiente paso:** ¿Comenzamos?

