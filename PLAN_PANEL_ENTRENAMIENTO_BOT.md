# 🎛️ PLAN: PANEL DE ENTRENAMIENTO Y CONFIGURACIÓN DEL BOT

**Objetivo:** Panel donde TÚ configures y entrenes el bot  
**Tipo:** Panel de Administración Avanzado  
**Estimación:** 25 horas  

---

## 🎯 ¿QUÉ ES?

Un panel donde TÚ:
- ✅ Agregas información que el bot debe conocer
- ✅ Configuras horarios de atención
- ✅ Defines respuestas a preguntas frecuentes
- ✅ Establece el "contexto" del bot (quién es, qué hace)
- ✅ Ves analytics de conversaciones
- ✅ Entrenas el bot con ejemplos

**NO es para hablar con el bot. Es para que el bot sea INTELIGENTE.**

---

## 📊 ESTRUCTURA DEL PANEL

```
┌─────────────────────────────────────────────┐
│         PANEL DE CONTROL - CHATBOT          │
├─────────────────────────────────────────────┤
│                                             │
│  📋 Configuración Base                      │
│  ├─ Nombre del bot                          │
│  ├─ Descripción                             │
│  ├─ Foto de perfil                          │
│  └─ Tono de voz (formal/amable/divertido)  │
│                                             │
│  🕐 Horarios de Atención                    │
│  ├─ Lunes-Viernes: 6pm - 11:30pm           │
│  ├─ Sábado: 6pm - 11:30pm                  │
│  ├─ Domingo: 12pm - 9pm                    │
│  └─ Días festivos: CERRADO                 │
│                                             │
│  📚 Base de Conocimiento                    │
│  ├─ Preguntas frecuentes                    │
│  ├─ Respuestas automáticas                  │
│  ├─ Información del restaurante             │
│  └─ Instrucciones especiales                │
│                                             │
│  💬 Contexto del Bot                        │
│  ├─ Quién eres (misión)                     │
│  ├─ Qué puedes hacer                        │
│  ├─ Cuándo debes pasar a humano             │
│  └─ Tono de respuesta                       │
│                                             │
│  📊 Analytics                               │
│  ├─ Conversaciones totales                  │
│  ├─ Preguntas más frecuentes                │
│  ├─ % de satisfacción                       │
│  └─ Handoff a humanos                       │
│                                             │
│  🧪 Tester                                  │
│  ├─ Simular preguntas                       │
│  ├─ Ver respuesta del bot                   │
│  └─ Editar si no es buena                   │
│                                             │
└─────────────────────────────────────────────┘
```

---

## 📁 BASE DE DATOS

### Tabla 1: `bot_config`

```sql
CREATE TABLE bot_config (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(255) DEFAULT 'Puro Sabor Bot',
  descripcion TEXT,
  foto_url VARCHAR(500),
  tono VARCHAR(50), -- 'formal', 'amable', 'divertido'
  
  -- Instrucciones del sistema
  system_prompt TEXT,
  mirada_principal TEXT, -- "Eres recepcionista de..."
  
  -- Configuración de respuestas
  respuesta_cuando_cierra TEXT,
  respuesta_cuando_no_sabe TEXT,
  respuesta_handoff TEXT,
  
  -- Otros
  activo INTEGER DEFAULT 1,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

### Tabla 2: `bot_horarios`

```sql
CREATE TABLE bot_horarios (
  id SERIAL PRIMARY KEY,
  dia_semana VARCHAR(20), -- 'lunes', 'martes', ..., 'domingo'
  hora_apertura VARCHAR(5), -- '18:00'
  hora_cierre VARCHAR(5),   -- '23:30'
  abierto INTEGER DEFAULT 1, -- 1=abierto, 0=cerrado
  
  UNIQUE(dia_semana)
);

-- Ejemplo de datos:
INSERT INTO bot_horarios (dia_semana, hora_apertura, hora_cierre, abierto) VALUES
('lunes', '18:00', '23:30', 1),
('martes', '18:00', '23:30', 1),
('miercoles', '18:00', '23:30', 1),
('jueves', '18:00', '23:30', 1),
('viernes', '18:00', '23:30', 1),
('sabado', '18:00', '23:30', 1),
('domingo', '12:00', '21:00', 1);
```

---

### Tabla 3: `bot_base_conocimiento`

```sql
CREATE TABLE bot_base_conocimiento (
  id SERIAL PRIMARY KEY,
  categoria VARCHAR(100), -- 'ubicacion', 'horarios', 'menu', 'politicas', 'general'
  pregunta TEXT NOT NULL, -- "¿Dónde están ubicados?"
  respuesta TEXT NOT NULL, -- "Estamos en Cra 50 #..."
  ejemplos_sinonimos TEXT, -- JSON: ["¿Dónde queda?", "ubicación", "dirección"]
  
  activa INTEGER DEFAULT 1,
  prioridad INTEGER DEFAULT 0, -- Mayor = más importante
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_bot_kb_categoria ON bot_base_conocimiento(categoria);
CREATE INDEX idx_bot_kb_activa ON bot_base_conocimiento(activa);
```

---

### Tabla 4: `bot_contexto`

```sql
CREATE TABLE bot_contexto (
  id SERIAL PRIMARY KEY,
  tipo VARCHAR(50), -- 'instruccion', 'ejemplo', 'restriccion'
  contenido TEXT,
  
  -- Ejemplos:
  -- tipo='instruccion', contenido='Siempre sé amable y profesional'
  -- tipo='ejemplo', contenido='Si piden pizza, dile: "No tenemos pizza"'
  -- tipo='restriccion', contenido='NUNCA tomes pedidos directamente'
  
  activo INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

### Tabla 5: `bot_conversaciones_analiticas`

```sql
CREATE TABLE bot_conversaciones_analiticas (
  id SERIAL PRIMARY KEY,
  pregunta_usuario TEXT,
  respuesta_bot TEXT,
  fue_efectiva INTEGER, -- 1=sí, 0=no, NULL=no evaluada
  necesito_humano INTEGER, -- 1=sí, 0=no
  categoria VARCHAR(100),
  fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 🎨 INTERFAZ DEL PANEL

### **Archivo: `public/admin/entrenador-bot.html`**

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Entrenador de Bot - Puro Sabor</title>
  <link rel="stylesheet" href="/css/styles.css">
  <link rel="stylesheet" href="/css/dark-mode.css">
  <link rel="stylesheet" href="/admin/css/entrenador.css">
</head>
<body>
  <div class="admin-layout">
    
    <!-- SIDEBAR NAVEGACIÓN -->
    <nav class="sidebar">
      <div class="sidebar-header">
        <h2>🤖 Bot</h2>
      </div>
      
      <ul class="nav-menu">
        <li><a href="#config" class="nav-link active" onclick="cambiarSeccion('config')">⚙️ Configuración</a></li>
        <li><a href="#horarios" class="nav-link" onclick="cambiarSeccion('horarios')">🕐 Horarios</a></li>
        <li><a href="#conocimiento" class="nav-link" onclick="cambiarSeccion('conocimiento')">📚 Base de Conocimiento</a></li>
        <li><a href="#contexto" class="nav-link" onclick="cambiarSeccion('contexto')">💬 Contexto</a></li>
        <li><a href="#tester" class="nav-link" onclick="cambiarSeccion('tester')">🧪 Tester</a></li>
        <li><a href="#analytics" class="nav-link" onclick="cambiarSeccion('analytics')">📊 Analytics</a></li>
      </ul>
    </nav>

    <!-- CONTENIDO PRINCIPAL -->
    <main class="content">
      
      <!-- 1. CONFIGURACIÓN BASE -->
      <section id="config-section" class="section active">
        <h1>⚙️ Configuración Base del Bot</h1>
        
        <div class="form-card">
          <div class="form-group">
            <label>Nombre del Bot</label>
            <input type="text" id="bot-nombre" value="Puro Sabor Bot" placeholder="Ej: Asistente Puro Sabor">
          </div>
          
          <div class="form-group">
            <label>Descripción Corta</label>
            <input type="text" id="bot-desc" placeholder="Ej: Asistente de información del restaurante">
          </div>
          
          <div class="form-group">
            <label>Foto de Perfil</label>
            <input type="file" id="bot-foto" accept="image/*">
          </div>
          
          <div class="form-group">
            <label>Tono de Voz</label>
            <select id="bot-tono">
              <option value="amable">😊 Amable y cálido</option>
              <option value="formal">🎩 Formal y profesional</option>
              <option value="divertido">😄 Divertido y casual</option>
            </select>
          </div>
          
          <div class="form-group">
            <label>Instrucción Principal (System Prompt)</label>
            <textarea id="bot-instruccion" rows="6" placeholder="Ej: Eres el asistente de Puro Sabor..."></textarea>
            <small>Esta es la instrucción base que el bot SIEMPRE debe seguir</small>
          </div>
          
          <div class="form-group">
            <label>Respuesta cuando CIERRA</label>
            <input type="text" id="bot-cierra" placeholder="Ej: Abrimos mañana a las 6pm">
          </div>
          
          <div class="form-group">
            <label>Respuesta cuando NO SABE</label>
            <input type="text" id="bot-no-sabe" placeholder="Ej: No tengo esa información. ¿Hablo con un asesor?">
          </div>
          
          <div class="form-group">
            <label>Respuesta para HANDOFF (pasar a humano)</label>
            <input type="text" id="bot-handoff" placeholder="Ej: Un momento, te conecto con un asesor">
          </div>
          
          <button class="btn-guardar" onclick="guardarConfig()">💾 Guardar Configuración</button>
        </div>
      </section>

      <!-- 2. HORARIOS -->
      <section id="horarios-section" class="section">
        <h1>🕐 Horarios de Atención</h1>
        
        <div class="form-card">
          <table class="horarios-table">
            <thead>
              <tr>
                <th>Día</th>
                <th>Abierto</th>
                <th>Apertura</th>
                <th>Cierre</th>
                <th>Guardar</th>
              </tr>
            </thead>
            <tbody id="horarios-tbody"></tbody>
          </table>
        </div>
      </section>

      <!-- 3. BASE DE CONOCIMIENTO -->
      <section id="conocimiento-section" class="section">
        <h1>📚 Base de Conocimiento</h1>
        
        <div class="form-card">
          <h3>Agregar Nueva Entrada</h3>
          
          <div class="form-group">
            <label>Categoría</label>
            <select id="kb-categoria">
              <option value="ubicacion">📍 Ubicación</option>
              <option value="horarios">🕐 Horarios</option>
              <option value="menu">🍖 Menú</option>
              <option value="politicas">📋 Políticas</option>
              <option value="general">❓ General</option>
            </select>
          </div>
          
          <div class="form-group">
            <label>Pregunta (ej: "¿Dónde están ubicados?")</label>
            <input type="text" id="kb-pregunta" placeholder="">
          </div>
          
          <div class="form-group">
            <label>Respuesta</label>
            <textarea id="kb-respuesta" rows="4" placeholder="Respuesta completa y útil"></textarea>
          </div>
          
          <div class="form-group">
            <label>Sinónimos (ej: "¿Dónde queda?", "ubicación", "dirección")</label>
            <input type="text" id="kb-sinonimos" placeholder="Separa con comas">
          </div>
          
          <button class="btn-agregar" onclick="agregarKB()">➕ Agregar a Base</button>
        </div>
        
        <div class="form-card">
          <h3>Entradas Actuales</h3>
          <div id="kb-lista" class="kb-lista"></div>
        </div>
      </section>

      <!-- 4. CONTEXTO -->
      <section id="contexto-section" class="section">
        <h1>💬 Contexto del Bot</h1>
        
        <div class="form-card">
          <p>El contexto son instrucciones especiales que el bot debe seguir siempre.</p>
          
          <div class="form-group">
            <label>Tipo de Instrucción</label>
            <select id="ctx-tipo">
              <option value="instruccion">📌 Instrucción General</option>
              <option value="ejemplo">📝 Ejemplo de Comportamiento</option>
              <option value="restriccion">🚫 Restricción/Límite</option>
            </select>
          </div>
          
          <div class="form-group">
            <label>Contenido</label>
            <textarea id="ctx-contenido" rows="4" placeholder="Ej: 'Siempre sé amable', 'NUNCA tomes pedidos directamente', etc"></textarea>
          </div>
          
          <button class="btn-agregar" onclick="agregarContexto()">➕ Agregar Instrucción</button>
        </div>
        
        <div class="form-card">
          <h3>Instrucciones Activas</h3>
          <div id="contexto-lista" class="contexto-lista"></div>
        </div>
      </section>

      <!-- 5. TESTER -->
      <section id="tester-section" class="section">
        <h1>🧪 Tester del Bot</h1>
        
        <div class="form-card">
          <p>Simula una pregunta y ve cómo responde el bot con la config actual.</p>
          
          <div class="form-group">
            <label>Escribe una pregunta de prueba</label>
            <textarea id="test-pregunta" rows="2" placeholder="Ej: ¿Dónde están ubicados?"></textarea>
          </div>
          
          <button class="btn-test" onclick="testearBot()">▶️ Probar Bot</button>
          
          <div id="test-resultado" class="test-resultado" style="display:none;">
            <h3>Respuesta del Bot:</h3>
            <div id="test-respuesta-texto"></div>
          </div>
        </div>
      </section>

      <!-- 6. ANALYTICS -->
      <section id="analytics-section" class="section">
        <h1>📊 Analytics</h1>
        
        <div class="stats-grid">
          <div class="stat-card">
            <h3>Total Conversaciones</h3>
            <p class="stat-numero" id="stat-total">0</p>
          </div>
          
          <div class="stat-card">
            <h3>Preguntas Únicas</h3>
            <p class="stat-numero" id="stat-unicas">0</p>
          </div>
          
          <div class="stat-card">
            <h3>Handoffs (a humano)</h3>
            <p class="stat-numero" id="stat-handoff">0</p>
          </div>
          
          <div class="stat-card">
            <h3>Satisfacción</h3>
            <p class="stat-numero" id="stat-satisfaccion">-</p>
          </div>
        </div>
        
        <div class="form-card">
          <h3>Preguntas Más Frecuentes</h3>
          <div id="preguntas-frecuentes" class="lista-preguntas"></div>
        </div>
      </section>
      
    </main>
  </div>

  <script src="/admin/js/entrenador-bot.js"></script>
</body>
</html>
```

---

### **Archivo: `public/admin/css/entrenador.css`**

```css
.admin-layout {
  display: flex;
  height: 100vh;
}

.sidebar {
  width: 250px;
  background: var(--surface-color);
  border-right: 1px solid var(--border-color);
  padding: 1.5rem 0;
  overflow-y: auto;
}

.sidebar-header {
  padding: 0 1.5rem;
  margin-bottom: 2rem;
}

.sidebar-header h2 {
  margin: 0;
  color: #d4531f;
}

.nav-menu {
  list-style: none;
  margin: 0;
  padding: 0;
}

.nav-link {
  display: block;
  padding: 0.75rem 1.5rem;
  color: var(--text-primary);
  text-decoration: none;
  transition: all 0.3s;
  border-left: 3px solid transparent;
}

.nav-link:hover {
  background: rgba(212, 83, 31, 0.1);
  border-left-color: #d4531f;
}

.nav-link.active {
  background: rgba(212, 83, 31, 0.15);
  border-left-color: #d4531f;
  color: #d4531f;
  font-weight: 600;
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 2rem;
}

.section {
  display: none;
}

.section.active {
  display: block;
  animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.form-card {
  background: var(--surface-color);
  border-radius: 12px;
  padding: 2rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
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
  font-family: inherit;
}

.form-group input:focus,
.form-group textarea:focus,
.form-group select:focus {
  outline: none;
  border-color: #d4531f;
  box-shadow: 0 0 0 3px rgba(212, 83, 31, 0.1);
}

.form-group small {
  display: block;
  margin-top: 0.25rem;
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.btn-guardar,
.btn-agregar,
.btn-test {
  background: #d4531f;
  color: white;
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.3s;
  font-size: 1rem;
}

.btn-guardar:hover,
.btn-agregar:hover,
.btn-test:hover {
  background: #b83f18;
  transform: translateY(-2px);
}

/* TABLAS */
.horarios-table {
  width: 100%;
  border-collapse: collapse;
}

.horarios-table th,
.horarios-table td {
  padding: 1rem;
  text-align: left;
  border-bottom: 1px solid var(--border-color);
}

.horarios-table th {
  background: var(--bg-secondary);
  font-weight: 600;
}

.horarios-table input {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--border-color);
  border-radius: 4px;
}

/* LISTAS */
.kb-lista,
.contexto-lista {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.kb-item,
.contexto-item {
  background: var(--bg-secondary);
  padding: 1rem;
  border-radius: 8px;
  border-left: 3px solid #d4531f;
}

.kb-item h4,
.contexto-item h4 {
  margin: 0 0 0.5rem 0;
  color: #d4531f;
}

.kb-item p,
.contexto-item p {
  margin: 0 0 0.5rem 0;
  color: var(--text-secondary);
}

.item-acciones {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.btn-eliminar {
  background: #ef4444;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.3s;
}

.btn-eliminar:hover {
  background: #dc2626;
}

/* TESTER */
.test-resultado {
  margin-top: 1.5rem;
  padding: 1rem;
  background: var(--bg-secondary);
  border-radius: 8px;
  border-left: 3px solid #10b981;
}

.test-resultado h3 {
  margin-top: 0;
  color: #10b981;
}

#test-respuesta-texto {
  background: var(--bg-primary);
  padding: 1rem;
  border-radius: 6px;
  line-height: 1.6;
}

/* STATS */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1.5rem;
  margin-bottom: 2rem;
}

.stat-card {
  background: linear-gradient(135deg, var(--surface-color), var(--bg-secondary));
  padding: 1.5rem;
  border-radius: 12px;
  text-align: center;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}

.stat-card h3 {
  margin: 0 0 0.5rem 0;
  font-size: 0.95rem;
  color: var(--text-secondary);
}

.stat-numero {
  margin: 0;
  font-size: 2.5rem;
  font-weight: bold;
  color: #d4531f;
}

.lista-preguntas {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.pregunta-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem;
  background: var(--bg-secondary);
  border-radius: 6px;
}

.pregunta-texto {
  flex: 1;
}

.pregunta-contador {
  background: #d4531f;
  color: white;
  padding: 0.25rem 0.75rem;
  border-radius: 20px;
  font-size: 0.85rem;
  font-weight: 600;
}

/* RESPONSIVE */
@media (max-width: 768px) {
  .admin-layout {
    flex-direction: column;
  }
  
  .sidebar {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--border-color);
    height: auto;
    padding: 1rem;
  }
  
  .nav-menu {
    display: flex;
    gap: 0.5rem;
    overflow-x: auto;
  }
  
  .nav-link {
    white-space: nowrap;
  }
  
  .content {
    padding: 1rem;
  }
  
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
```

---

### **Archivo: `public/admin/js/entrenador-bot.js`**

```javascript
// ========== STATE ==========
let configActual = {};
let horariosActuales = [];
let baseConocimiento = [];
let contextoActual = [];

// ========== INIT ==========
document.addEventListener('DOMContentLoaded', async () => {
  cargarTodasLasConfiguraciones();
});

// ========== CAMBIAR SECCIÓN ==========
function cambiarSeccion(nombre) {
  // Ocultar todas las secciones
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  
  // Mostrar la seleccionada
  document.getElementById(nombre + '-section').classList.add('active');
  
  // Actualizar sidebar
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  event.target.classList.add('active');
  
  // Cargar datos si es necesario
  if (nombre === 'horarios') {
    cargarHorarios();
  } else if (nombre === 'conocimiento') {
    cargarBaseConocimiento();
  } else if (nombre === 'contexto') {
    cargarContexto();
  } else if (nombre === 'analytics') {
    cargarAnalytics();
  }
}

// ========== CONFIGURACIÓN BASE ==========
async function cargarTodasLasConfiguraciones() {
  try {
    const response = await fetch('/api/admin/bot-config', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    
    if (!response.ok) throw new Error('Error cargando config');
    
    const data = await response.json();
    configActual = data;
    
    // Llenar formulario
    document.getElementById('bot-nombre').value = data.nombre || '';
    document.getElementById('bot-desc').value = data.descripcion || '';
    document.getElementById('bot-tono').value = data.tono || 'amable';
    document.getElementById('bot-instruccion').value = data.system_prompt || '';
    document.getElementById('bot-cierra').value = data.respuesta_cuando_cierra || '';
    document.getElementById('bot-no-sabe').value = data.respuesta_cuando_no_sabe || '';
    document.getElementById('bot-handoff').value = data.respuesta_handoff || '';
    
  } catch (err) {
    console.error('Error:', err);
  }
}

async function guardarConfig() {
  try {
    const config = {
      nombre: document.getElementById('bot-nombre').value,
      descripcion: document.getElementById('bot-desc').value,
      tono: document.getElementById('bot-tono').value,
      system_prompt: document.getElementById('bot-instruccion').value,
      respuesta_cuando_cierra: document.getElementById('bot-cierra').value,
      respuesta_cuando_no_sabe: document.getElementById('bot-no-sabe').value,
      respuesta_handoff: document.getElementById('bot-handoff').value
    };
    
    const response = await fetch('/api/admin/bot-config', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(config)
    });
    
    if (response.ok) {
      alert('✅ Configuración guardada');
    } else {
      alert('❌ Error al guardar');
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

// ========== HORARIOS ==========
async function cargarHorarios() {
  try {
    const response = await fetch('/api/admin/bot-horarios', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    
    const horarios = await response.json();
    const dias = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
    
    const tbody = document.getElementById('horarios-tbody');
    tbody.innerHTML = '';
    
    dias.forEach(dia => {
      const horario = horarios.find(h => h.dia_semana === dia);
      const tr = document.createElement('tr');
      
      tr.innerHTML = `
        <td>${dia.charAt(0).toUpperCase() + dia.slice(1)}</td>
        <td>
          <input type="checkbox" 
            ${horario?.abierto === 1 ? 'checked' : ''} 
            onchange="guardarHorario('${dia}', this)">
        </td>
        <td>
          <input type="time" 
            value="${horario?.hora_apertura || '18:00'}"
            id="hora-apertura-${dia}">
        </td>
        <td>
          <input type="time" 
            value="${horario?.hora_cierre || '23:30'}"
            id="hora-cierre-${dia}">
        </td>
        <td>
          <button class="btn-guardar" style="padding: 0.5rem 1rem;" onclick="guardarHorario('${dia}')">✓</button>
        </td>
      `;
      
      tbody.appendChild(tr);
    });
    
  } catch (err) {
    console.error('Error:', err);
  }
}

async function guardarHorario(dia) {
  try {
    const abierto = document.querySelector(`input[onchange*="${dia}"]`).checked ? 1 : 0;
    const horario_apertura = document.getElementById(`hora-apertura-${dia}`).value;
    const horario_cierre = document.getElementById(`hora-cierre-${dia}`).value;
    
    const response = await fetch('/api/admin/bot-horarios', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        dia_semana: dia,
        abierto,
        hora_apertura: horario_apertura,
        hora_cierre: horario_cierre
      })
    });
    
    if (response.ok) {
      alert(`✅ Horario de ${dia} actualizado`);
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

// ========== BASE DE CONOCIMIENTO ==========
async function cargarBaseConocimiento() {
  try {
    const response = await fetch('/api/admin/bot-kb', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    
    baseConocimiento = await response.json();
    renderizarKB();
    
  } catch (err) {
    console.error('Error:', err);
  }
}

function renderizarKB() {
  const lista = document.getElementById('kb-lista');
  lista.innerHTML = '';
  
  baseConocimiento.forEach(item => {
    const div = document.createElement('div');
    div.className = 'kb-item';
    div.innerHTML = `
      <h4>${item.pregunta}</h4>
      <p><strong>Respuesta:</strong> ${item.respuesta.substring(0, 100)}...</p>
      <p><strong>Categoría:</strong> ${item.categoria}</p>
      <div class="item-acciones">
        <button class="btn-eliminar" onclick="eliminarKB(${item.id})">🗑️ Eliminar</button>
      </div>
    `;
    lista.appendChild(div);
  });
}

async function agregarKB() {
  const categoria = document.getElementById('kb-categoria').value;
  const pregunta = document.getElementById('kb-pregunta').value;
  const respuesta = document.getElementById('kb-respuesta').value;
  const sinonimos = document.getElementById('kb-sinonimos').value;
  
  if (!pregunta || !respuesta) {
    alert('Completa pregunta y respuesta');
    return;
  }
  
  try {
    const response = await fetch('/api/admin/bot-kb', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        categoria,
        pregunta,
        respuesta,
        ejemplos_sinonimos: sinonimos.split(',').map(s => s.trim())
      })
    });
    
    if (response.ok) {
      alert('✅ Entrada agregada a la base');
      document.getElementById('kb-pregunta').value = '';
      document.getElementById('kb-respuesta').value = '';
      document.getElementById('kb-sinonimos').value = '';
      cargarBaseConocimiento();
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

async function eliminarKB(id) {
  if (!confirm('¿Eliminar esta entrada?')) return;
  
  try {
    const response = await fetch(`/api/admin/bot-kb/${id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    
    if (response.ok) {
      alert('✅ Entrada eliminada');
      cargarBaseConocimiento();
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

// ========== CONTEXTO ==========
async function cargarContexto() {
  try {
    const response = await fetch('/api/admin/bot-contexto', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    
    contextoActual = await response.json();
    renderizarContexto();
    
  } catch (err) {
    console.error('Error:', err);
  }
}

function renderizarContexto() {
  const lista = document.getElementById('contexto-lista');
  lista.innerHTML = '';
  
  contextoActual.forEach(item => {
    const div = document.createElement('div');
    div.className = 'contexto-item';
    div.innerHTML = `
      <h4>${item.tipo.toUpperCase()}</h4>
      <p>${item.contenido}</p>
      <div class="item-acciones">
        <button class="btn-eliminar" onclick="eliminarContexto(${item.id})">🗑️ Eliminar</button>
      </div>
    `;
    lista.appendChild(div);
  });
}

async function agregarContexto() {
  const tipo = document.getElementById('ctx-tipo').value;
  const contenido = document.getElementById('ctx-contenido').value;
  
  if (!contenido) {
    alert('Escribe una instrucción');
    return;
  }
  
  try {
    const response = await fetch('/api/admin/bot-contexto', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ tipo, contenido })
    });
    
    if (response.ok) {
      alert('✅ Instrucción agregada');
      document.getElementById('ctx-contenido').value = '';
      cargarContexto();
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

async function eliminarContexto(id) {
  if (!confirm('¿Eliminar esta instrucción?')) return;
  
  try {
    const response = await fetch(`/api/admin/bot-contexto/${id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    
    if (response.ok) {
      cargarContexto();
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

// ========== TESTER ==========
async function testearBot() {
  const pregunta = document.getElementById('test-pregunta').value;
  
  if (!pregunta) {
    alert('Escribe una pregunta');
    return;
  }
  
  try {
    const response = await fetch('/api/admin/bot-test', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ pregunta })
    });
    
    const data = await response.json();
    
    document.getElementById('test-resultado').style.display = 'block';
    document.getElementById('test-respuesta-texto').textContent = data.respuesta;
    
  } catch (err) {
    console.error('Error:', err);
  }
}

// ========== ANALYTICS ==========
async function cargarAnalytics() {
  try {
    const response = await fetch('/api/admin/bot-analytics', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });
    
    const data = await response.json();
    
    // Actualizar stats
    document.getElementById('stat-total').textContent = data.total_conversaciones;
    document.getElementById('stat-unicas').textContent = data.preguntas_unicas;
    document.getElementById('stat-handoff').textContent = data.handoffs;
    document.getElementById('stat-satisfaccion').textContent = data.satisfaccion + '%';
    
    // Preguntas frecuentes
    const lista = document.getElementById('preguntas-frecuentes');
    lista.innerHTML = '';
    
    data.preguntas_frecuentes.forEach(item => {
      const div = document.createElement('div');
      div.className = 'pregunta-item';
      div.innerHTML = `
        <div class="pregunta-texto">${item.pregunta}</div>
        <div class="pregunta-contador">${item.veces}x</div>
      `;
      lista.appendChild(div);
    });
    
  } catch (err) {
    console.error('Error:', err);
  }
}
```

---

## 📝 BACKEND - NUEVAS RUTAS

### **Archivo: `backend/routes/admin-bot.js` (NUEVO)**

```javascript
const express = require('express');
const router = express.Router();
const { verificarJWT } = require('../middleware/auth');
const db = require('../config/database');

// Middleware de verificación
router.use(verificarJWT);

// ========== CONFIG ==========
router.get('/bot-config', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM bot_config LIMIT 1');
    res.json(result.rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/bot-config', async (req, res) => {
  try {
    const { nombre, descripcion, tono, system_prompt, respuesta_cuando_cierra, respuesta_cuando_no_sabe, respuesta_handoff } = req.body;
    
    const result = await db.query(
      `INSERT INTO bot_config (nombre, descripcion, tono, system_prompt, respuesta_cuando_cierra, respuesta_cuando_no_sabe, respuesta_handoff)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
       nombre = $1, descripcion = $2, tono = $3, system_prompt = $4,
       respuesta_cuando_cierra = $5, respuesta_cuando_no_sabe = $6, respuesta_handoff = $7
       RETURNING *`,
      [nombre, descripcion, tono, system_prompt, respuesta_cuando_cierra, respuesta_cuando_no_sabe, respuesta_handoff]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ... (más rutas para horarios, KB, contexto, etc)

module.exports = router;
```

---

## ⏱️ ESTIMACIÓN

```
Diseño de BD:         2h
Frontend HTML/CSS:    6h
Frontend JavaScript:  6h
Backend APIs:         7h
Testing:              3h
Documentación:        1h
─────────────────────────────
TOTAL:               25 horas
```

---

## ✅ RESULTADO FINAL

Panel profesional donde:
- ✅ Configuras qué dirá el bot
- ✅ Estableces horarios automáticos
- ✅ Agregas base de conocimiento
- ✅ Das instrucciones especiales
- ✅ Testeas cambios en vivo
- ✅ Ves analytics de conversaciones

**TODO desde una interfaz bonita y fácil.**

---

## 🎯 ¿EMPEZAMOS?

¿Confirmás que quieres este panel de entrenamiento?

**SÍ → Empiezo ahora**

**CAMBIOS → Dime qué ajustar**

