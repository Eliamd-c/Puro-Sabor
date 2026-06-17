# 💬 PLAN: INTERFAZ WEB PARA CHATBOT

**Objetivo:** Panel web donde TÚ interactúes directamente con el chatbot  
**Tipo:** Chat en tiempo real (como WhatsApp Web)  
**Estimación:** 12 horas  

---

## 🎯 ¿QUÉ ES?

Una página web donde:
- ✅ Escribes un mensaje
- ✅ El bot responde en VIVO
- ✅ Ves el historial de conversación
- ✅ Ves promociones con imágenes
- ✅ Todo bonito y fácil

**Como esto, pero para TU bot:**

```
┌─────────────────────────────────┐
│  Puro Sabor - Chatbot           │
├─────────────────────────────────┤
│                                 │
│  Bot: ¡Hola! ¿Cómo estás?       │
│  [10:30am]                      │
│                                 │
│  Tú: Hola, ¿qué promociones... │
│  [10:31am]                      │
│                                 │
│  Bot: Tenemos 2x1 en Costillas  │
│  [Imagen de promoción]          │
│  [10:32am]                      │
│                                 │
├─────────────────────────────────┤
│ [Escribe aquí...]               │
│               [Enviar →]        │
└─────────────────────────────────┘
```

---

## 📁 ARCHIVOS A CREAR

### 1. **Frontend - Chat Interface**

```
public/
├── chatbot/
│   ├── index.html          (UI Principal)
│   ├── css/
│   │   └── chat.css        (Estilos)
│   └── js/
│       └── chat.js         (Lógica del chat)
```

---

## 🏗️ ESTRUCTURA

### **Archivo: `public/chatbot/index.html`**

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chatbot Puro Sabor</title>
  <link rel="stylesheet" href="css/chat.css">
  <link rel="stylesheet" href="/css/dark-mode.css">
</head>
<body>

  <div class="chat-container">
    
    <!-- HEADER -->
    <div class="chat-header">
      <div class="header-left">
        <img src="/Logo.png" alt="Puro Sabor" class="logo">
        <div class="header-info">
          <h1>Puro Sabor</h1>
          <p class="status" id="status">Conectando...</p>
        </div>
      </div>
      <div class="header-right">
        <button id="btn-info" class="btn-icon">ℹ️</button>
        <button id="btn-limpiar" class="btn-icon">🗑️</button>
      </div>
    </div>

    <!-- CHAT MESSAGES -->
    <div class="chat-messages" id="chat-messages">
      <div class="message bot-message">
        <div class="message-content">
          Hola 👋 Soy el asistente de Puro Sabor. ¿Cómo puedo ayudarte?
        </div>
        <span class="message-time">10:00am</span>
      </div>
    </div>

    <!-- INPUT AREA -->
    <div class="chat-input-area">
      <input 
        type="text" 
        id="input-message" 
        class="chat-input" 
        placeholder="Escribe tu pregunta..."
        autocomplete="off"
      >
      <button id="btn-enviar" class="btn-enviar">
        ➤ Enviar
      </button>
    </div>

  </div>

  <!-- MODAL INFO -->
  <div class="modal" id="modal-info" style="display: none;">
    <div class="modal-content">
      <h2>Sobre este Chatbot</h2>
      <p>
        Este es el asistente de información de <strong>Puro Sabor</strong>.
      </p>
      <p>
        Puedo ayudarte con:
        <ul>
          <li>📍 Información del restaurante</li>
          <li>🎁 Promociones activas</li>
          <li>📋 Menú y precios</li>
          <li>🕐 Horarios de atención</li>
          <li>👥 Conectarte con un asesor</li>
        </ul>
      </p>
      <button onclick="cerrarModal()" class="btn-primary">Cerrar</button>
    </div>
  </div>

  <script src="js/chat.js"></script>
</body>
</html>
```

---

### **Archivo: `public/chatbot/css/chat.css`**

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Outfit', sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  height: 100vh;
  overflow: hidden;
}

.chat-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg-primary);
}

/* ========== HEADER ========== */
.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  background: linear-gradient(135deg, var(--surface-color), var(--bg-secondary));
  border-bottom: 1px solid var(--border-color);
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.logo {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
}

.header-info h1 {
  font-size: 1.2rem;
  margin: 0;
}

.status {
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin: 0;
}

.status.online {
  color: #10b981;
  font-weight: 600;
}

.header-right {
  display: flex;
  gap: 0.5rem;
}

.btn-icon {
  background: none;
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
  padding: 0.5rem;
  border-radius: 6px;
  transition: background 0.3s;
}

.btn-icon:hover {
  background: rgba(0,0,0,0.1);
}

/* ========== MESSAGES ========== */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.message {
  display: flex;
  flex-direction: column;
  max-width: 70%;
  animation: slideIn 0.3s ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.bot-message {
  align-self: flex-start;
}

.user-message {
  align-self: flex-end;
}

.message-content {
  padding: 1rem;
  border-radius: 12px;
  word-wrap: break-word;
}

.bot-message .message-content {
  background: var(--surface-color);
  color: var(--text-primary);
  border-bottom-left-radius: 4px;
}

.user-message .message-content {
  background: #d4531f;
  color: white;
  border-bottom-right-radius: 4px;
}

.message-time {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-top: 0.25rem;
  padding: 0 0.5rem;
}

.message-image {
  max-width: 100%;
  border-radius: 8px;
  margin-top: 0.5rem;
}

.message-promo {
  background: linear-gradient(135deg, #fef3c7, #fde68a);
  border-left: 4px solid #d4531f;
  padding: 1rem;
  border-radius: 8px;
  margin-top: 0.5rem;
}

.message-promo img {
  max-width: 100%;
  border-radius: 6px;
  margin-top: 0.5rem;
}

/* ========== INPUT ========== */
.chat-input-area {
  display: flex;
  gap: 0.5rem;
  padding: 1rem 1.5rem;
  background: var(--surface-color);
  border-top: 1px solid var(--border-color);
}

.chat-input {
  flex: 1;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border-color);
  border-radius: 24px;
  font-size: 1rem;
  background: var(--bg-primary);
  color: var(--text-primary);
  outline: none;
  transition: border-color 0.3s;
}

.chat-input:focus {
  border-color: #d4531f;
}

.btn-enviar {
  padding: 0.75rem 1.5rem;
  background: #d4531f;
  color: white;
  border: none;
  border-radius: 24px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.3s;
}

.btn-enviar:hover {
  background: #b83f18;
  transform: translateY(-2px);
}

.btn-enviar:active {
  transform: translateY(0);
}

.btn-enviar:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ========== MODAL ========== */
.modal {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0,0,0,0.5);
  display: flex !important;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--surface-color);
  padding: 2rem;
  border-radius: 12px;
  max-width: 400px;
  box-shadow: 0 10px 40px rgba(0,0,0,0.3);
}

.modal-content h2 {
  margin-bottom: 1rem;
}

.modal-content p {
  margin-bottom: 1rem;
  line-height: 1.6;
}

.modal-content ul {
  margin-left: 1.5rem;
  margin-bottom: 1rem;
}

.modal-content li {
  margin-bottom: 0.5rem;
}

/* ========== RESPONSIVE ========== */
@media (max-width: 768px) {
  .message {
    max-width: 85%;
  }
  
  .chat-header {
    padding: 1rem;
  }
  
  .header-info h1 {
    font-size: 1rem;
  }
}

/* ========== SCROLLBAR ========== */
.chat-messages::-webkit-scrollbar {
  width: 8px;
}

.chat-messages::-webkit-scrollbar-track {
  background: var(--bg-secondary);
}

.chat-messages::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 4px;
}

.chat-messages::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}
```

---

### **Archivo: `public/chatbot/js/chat.js`**

```javascript
// ========== CONFIG ==========
const API_BASE = '/api/chatbot';
const socket = io();

// ========== STATE ==========
let messages = [];
let isLoading = false;

// ========== ELEMENTS ==========
const chatMessages = document.getElementById('chat-messages');
const inputMessage = document.getElementById('input-message');
const btnEnviar = document.getElementById('btn-enviar');
const statusEl = document.getElementById('status');
const btnLimpiar = document.getElementById('btn-limpiar');
const btnInfo = document.getElementById('btn-info');
const modalInfo = document.getElementById('modal-info');

// ========== INIT ==========
document.addEventListener('DOMContentLoaded', () => {
  inputMessage.focus();
  btnEnviar.addEventListener('click', enviarMensaje);
  inputMessage.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') enviarMensaje();
  });
  btnLimpiar.addEventListener('click', limpiarChat);
  btnInfo.addEventListener('click', abrirModal);
  
  // Socket listeners
  socket.on('connect', () => {
    actualizarStatus('En línea', true);
  });
  socket.on('disconnect', () => {
    actualizarStatus('Fuera de línea', false);
  });
});

// ========== FUNCTIONS ==========

function actualizarStatus(texto, online) {
  statusEl.textContent = texto;
  statusEl.classList.toggle('online', online);
}

async function enviarMensaje() {
  const texto = inputMessage.value.trim();
  
  if (!texto) return;
  
  // Deshabilitar input mientras se procesa
  inputMessage.disabled = true;
  btnEnviar.disabled = true;
  isLoading = true;
  
  // Mostrar mensaje del usuario
  agregarMensaje(texto, 'user');
  inputMessage.value = '';
  
  try {
    // Enviar al servidor
    const response = await fetch(`${API_BASE}/mensaje`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        mensaje: texto,
        timestamp: new Date().toISOString()
      })
    });
    
    if (!response.ok) throw new Error('Error en la respuesta');
    
    const data = await response.json();
    
    // Mostrar respuesta del bot
    if (data.respuesta) {
      agregarMensaje(data.respuesta, 'bot');
    }
    
    // Si hay promoción
    if (data.promo_imagen) {
      agregarPromo(data.promo_titulo, data.promo_desc, data.promo_imagen);
    }
    
  } catch (error) {
    console.error('Error:', error);
    agregarMensaje('❌ Error procesando tu mensaje. Intenta de nuevo.', 'bot');
  } finally {
    inputMessage.disabled = false;
    btnEnviar.disabled = false;
    isLoading = false;
    inputMessage.focus();
  }
}

function agregarMensaje(texto, tipo) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${tipo === 'user' ? 'user-message' : 'bot-message'}`;
  
  const hora = new Date().toLocaleTimeString('es-ES', { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  contentDiv.textContent = texto;
  
  const timeSpan = document.createElement('span');
  timeSpan.className = 'message-time';
  timeSpan.textContent = hora;
  
  messageDiv.appendChild(contentDiv);
  messageDiv.appendChild(timeSpan);
  
  chatMessages.appendChild(messageDiv);
  
  // Scroll al final
  chatMessages.scrollTop = chatMessages.scrollHeight;
  
  messages.push({ tipo, texto, hora });
}

function agregarPromo(titulo, descripcion, imagenUrl) {
  const promoDiv = document.createElement('div');
  promoDiv.className = 'message bot-message';
  
  const hora = new Date().toLocaleTimeString('es-ES', { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
  
  const promoContent = document.createElement('div');
  promoContent.className = 'message-promo';
  
  let html = `<strong>${titulo}</strong><br>${descripcion}`;
  
  if (imagenUrl) {
    html += `<br><img src="${imagenUrl}" alt="Promoción" class="message-image">`;
  }
  
  promoContent.innerHTML = html;
  
  const timeSpan = document.createElement('span');
  timeSpan.className = 'message-time';
  timeSpan.textContent = hora;
  
  promoDiv.appendChild(promoContent);
  promoDiv.appendChild(timeSpan);
  
  chatMessages.appendChild(promoDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function limpiarChat() {
  if (confirm('¿Limpiar todo el historial?')) {
    chatMessages.innerHTML = `
      <div class="message bot-message">
        <div class="message-content">
          Hola 👋 Soy el asistente de Puro Sabor. ¿Cómo puedo ayudarte?
        </div>
        <span class="message-time">ahora</span>
      </div>
    `;
    messages = [];
    inputMessage.focus();
  }
}

function abrirModal() {
  modalInfo.style.display = 'flex';
}

function cerrarModal() {
  modalInfo.style.display = 'none';
}

// Cerrar modal al hacer click afuera
modalInfo.addEventListener('click', (e) => {
  if (e.target === modalInfo) {
    cerrarModal();
  }
});
```

---

## 🔌 BACKEND - Nuevas Rutas

### **Archivo: `backend/routes/chatbot.js` (NUEVO)**

```javascript
const express = require('express');
const router = express.Router();
const { getBot } = require('../services/whatsappAgent');

// POST /api/chatbot/mensaje
router.post('/mensaje', async (req, res) => {
  try {
    const { mensaje, timestamp } = req.body;
    
    if (!mensaje || mensaje.trim().length === 0) {
      return res.status(400).json({ error: 'Mensaje vacío' });
    }
    
    // Obtener el bot del cliente
    const clientBot = getBot('client', req.app.get('io'));
    
    // Crear mensaje simulado (como si viniera de WhatsApp)
    const fakeMessage = {
      key: {
        remoteJid: 'web-interface@s.whatsapp.net',
        fromMe: false
      },
      pushName: 'Usuario Web',
      message: {
        conversation: mensaje
      }
    };
    
    // Procesar mensaje (sin enviar por WhatsApp)
    const respuesta = await procesarMensajeWeb(clientBot, mensaje);
    
    res.json({
      exito: true,
      respuesta: respuesta.texto,
      promo_imagen: respuesta.promo_imagen || null,
      promo_titulo: respuesta.promo_titulo || null,
      promo_desc: respuesta.promo_desc || null
    });
    
  } catch (err) {
    console.error('Error en /api/chatbot/mensaje:', err.message);
    res.status(500).json({ 
      error: 'Error procesando el mensaje',
      message: err.message 
    });
  }
});

// Función para procesar sin enviar por WhatsApp
async function procesarMensajeWeb(bot, mensaje) {
  try {
    const genAI = new (require('@google/generative-ai').GoogleGenerativeAI)(
      process.env.GEMINI_API_KEY
    );
    
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction: 'Eres el asistente de Puro Sabor. Ayuda al cliente de forma amable y breve.'
    });
    
    const result = await model.generateContent(mensaje);
    const respuesta = result.response.text();
    
    return {
      texto: respuesta,
      promo_imagen: null
    };
  } catch (err) {
    return {
      texto: '❌ Error procesando tu mensaje. Intenta de nuevo.',
      promo_imagen: null
    };
  }
}

module.exports = router;
```

---

### **Agregar ruta en `backend/server.js`:**

```javascript
const chatbotRoutes = require('./routes/chatbot');
app.use('/api/chatbot', chatbotRoutes);
```

---

## 📊 RESULTADO FINAL

```
ANTES (Solo WhatsApp):
├─ Cliente escribe por WhatsApp
├─ Bot responde por WhatsApp
└─ Admin solo ve en WhatsApp

DESPUÉS (Web + WhatsApp):
├─ Cliente escribe por WEB o WhatsApp
├─ Bot responde en ambos lados
├─ Admin ve todo en panel
├─ Cliente ve histórico bonito
└─ Interfaz súper intuitiva
```

---

## ✨ CARACTERÍSTICAS

✅ Chat en tiempo real  
✅ Mensaje usuario vs bot (colores diferentes)  
✅ Hora de cada mensaje  
✅ Botón para limpiar chat  
✅ Info sobre el bot  
✅ Soporte para promociones con imágenes  
✅ Responsive (funciona en móvil)  
✅ Dark mode automático  
✅ Conexión con el bot real (Gemini)  
✅ Bonito y profesional  

---

## ⏱️ ESTIMACIÓN

```
Frontend (HTML/CSS/JS):  4 horas
Backend (API):           2 horas
Testing:                 1 hora
Integración:             2 horas
─────────────────────────────────
TOTAL:                  9 horas
```

---

## 🎯 ¿QUIERES QUE EMPECEMOS?

**SI → Dime y comenzamos en 1 hora**

**NO → ¿Qué cambiarías?**

