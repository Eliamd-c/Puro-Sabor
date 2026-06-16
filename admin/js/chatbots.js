document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('puro_sabor_admin_token') || getCookie('puro_sabor_admin_token');
  if (!token) {
    window.location.href = '/admin/';
    return;
  }

  function getCookie(name) {
    const cookies = document.cookie.split(';');
    for (let c of cookies) {
      const [k, v] = c.trim().split('=');
      if (k === name) return v;
    }
    return null;
  }

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };

  // Bot DOM Elements
  const bots = {
    client: {
      badge: document.getElementById('status-client-badge'),
      image: document.getElementById('qr-client-image'),
      text: document.getElementById('qr-client-text'),
      btnReconnect: document.getElementById('btn-reconnect-client'),
      btnLogout: document.getElementById('btn-logout-client')
    }
  };

  const btnLogoutGlobal = document.getElementById('btn-logout');

  // Socket
  const socket = io('/', { query: { token } });
  socket.emit('unirse_admin');

  // Load Status
  async function loadStatus(type) {
    try {
      const res = await fetch(`/api/chatbots/${type}/status`, { headers: authHeaders });
      const data = await res.json();
      if (data.success) {
        updateUI(type, data.status, data.qr);
      }
    } catch (err) {
      console.error(`Error loading ${type} status:`, err);
    }
  }



  // Action Buttons
  Object.keys(bots).forEach(type => {
    bots[type].btnReconnect.addEventListener('click', async () => {
      bots[type].btnReconnect.disabled = true;
      try {
        await fetch(`/api/chatbots/${type}/reconnect`, { method: 'POST', headers: authHeaders });
      } catch (err) {
        console.error('Error reconnecting', err);
      }
      setTimeout(() => { bots[type].btnReconnect.disabled = false; }, 3000);
    });

    bots[type].btnLogout.addEventListener('click', async () => {
      if (!confirm(`¿Estás seguro de desvincular el Bot ${type.toUpperCase()}?`)) return;
      bots[type].btnLogout.disabled = true;
      try {
        await fetch(`/api/chatbots/${type}/logout`, { method: 'POST', headers: authHeaders });
      } catch (err) {
        console.error('Error logout', err);
      }
      setTimeout(() => { bots[type].btnLogout.disabled = false; }, 3000);
    });
  });

  function updateUI(type, status, qr = null, error = null) {
    const el = bots[type];
    
    el.badge.className = 'status-badge';
    if (status === 'ready') {
      el.badge.classList.add('connected');
      el.badge.innerHTML = '<span>●</span> Conectado';
      el.image.style.display = 'none';
      el.text.innerText = 'Bot funcionando correctamente.';
    } else if (status === 'qr') {
      el.badge.classList.add('loading');
      el.badge.innerHTML = '<span>●</span> Escanea el QR';
      if (qr) {
        el.image.src = qr;
        el.image.style.display = 'block';
        el.text.style.display = 'none';
      }
    } else if (status === 'loading') {
      el.badge.classList.add('loading');
      el.badge.innerHTML = '<span>●</span> Conectando...';
      el.image.style.display = 'none';
      el.text.style.display = 'block';
      el.text.innerText = 'Inicializando cliente...';
    } else {
      el.badge.classList.add('disconnected');
      el.badge.innerHTML = '<span>●</span> Desconectado';
      el.image.style.display = 'none';
      el.text.style.display = 'block';
      el.text.innerText = error || 'El bot no está enlazado a ningún dispositivo.';
    }
  }

  // Socket listeners
  socket.on('whatsapp_client_status', (data) => updateUI('client', data.status, data.qr, data.error));

  socket.on('whatsapp_message', (data) => {
    console.log('[Socket] Mensaje WhatsApp:', data);
    agregarMensajeAlMonitor(data);
  });

  if(btnLogoutGlobal) {
    btnLogoutGlobal.addEventListener('click', () => {
      localStorage.removeItem('puro_sabor_admin_token');
      document.cookie = 'puro_sabor_admin_token=; Max-Age=-99999999;';
      window.location.href = '/admin/';
    });
  }

  // --- CONFIGURACIÓN DE IA ---
  const formConfigAi = document.getElementById('form-config-ai');
  const geminiKeyInput = document.getElementById('gemini-key');
  const btnToggleGeminiKey = document.getElementById('btn-toggle-gemini-key');
  const botHorarioToggle = document.getElementById('bot-horario-toggle');
  const botMensajeAusenciaInput = document.getElementById('bot-mensaje-ausencia');
  const botActiveToggle = document.getElementById('bot-active-toggle');
  const botMenuUrlInput = document.getElementById('bot-menu-url');
  const botSystemPromptInput = document.getElementById('bot-system-prompt');
  const configAiAlert = document.getElementById('config-ai-alert');

  async function cargarConfiguracionIA() {
    try {
      const response = await fetch('/api/chatbots/config-ai', {
        headers: authHeaders
      });
      const result = await response.json();
      if (result.success && result.data) {
        if (geminiKeyInput) geminiKeyInput.value = result.data.gemini_api_key || '';
        if (botActiveToggle) botActiveToggle.checked = result.data.whatsapp_bot_active;
        if (botHorarioToggle) botHorarioToggle.checked = (result.data.bot_horario_activo === '1');
        if (botMensajeAusenciaInput) botMensajeAusenciaInput.value = result.data.bot_mensaje_ausencia || '';
        if (botMenuUrlInput) botMenuUrlInput.value = result.data.bot_menu_url || '';
        if (botSystemPromptInput) botSystemPromptInput.value = result.data.bot_system_prompt || '';
      }
    } catch (error) {
      console.error('Error al cargar config IA:', error);
    }
  }

  if (btnToggleGeminiKey) {
    btnToggleGeminiKey.addEventListener('click', () => {
      if (geminiKeyInput.type === 'password') {
        geminiKeyInput.type = 'text';
        btnToggleGeminiKey.textContent = '🙈';
      } else {
        geminiKeyInput.type = 'password';
        btnToggleGeminiKey.textContent = '👁️';
      }
    });
  }

  if (formConfigAi) {
    formConfigAi.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const gemini_api_key = geminiKeyInput.value.trim();
      const whatsapp_bot_active = botActiveToggle.checked;
      const bot_horario_activo = botHorarioToggle.checked ? '1' : '0';
      const bot_mensaje_ausencia = botMensajeAusenciaInput.value.trim();
      const bot_menu_url = botMenuUrlInput.value.trim();
      const bot_system_prompt = botSystemPromptInput.value.trim();

      const btnSave = document.getElementById('btn-save-ai-config');
      const originalText = btnSave.innerHTML;
      btnSave.disabled = true;
      btnSave.innerHTML = '<span>Guardando y reiniciando bot...</span>';
      if(configAiAlert) configAiAlert.style.display = 'none';

      try {
        const response = await fetch('/api/chatbots/config-ai', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            gemini_api_key,
            whatsapp_bot_active,
            bot_horario_activo,
            bot_mensaje_ausencia,
            bot_menu_url,
            bot_system_prompt
          })
        });
        const result = await response.json();

        if (result.success) {
          mostrarAlertaConfig('success', 'Configuración guardada. El bot de WhatsApp se ha actualizado.');
          setTimeout(cargarConfiguracionIA, 1500);
        } else {
          mostrarAlertaConfig('error', result.message || 'Error al guardar la configuración.');
        }
      } catch (error) {
        console.error('Error al guardar config:', error);
        mostrarAlertaConfig('error', 'Error en la conexión con el servidor.');
      } finally {
        btnSave.disabled = false;
        btnSave.innerHTML = originalText;
      }
    });
  }

  function mostrarAlertaConfig(tipo, mensaje) {
    if(!configAiAlert) return;
    configAiAlert.textContent = mensaje;
    configAiAlert.className = `alert-box ${tipo}`;
    configAiAlert.style.display = 'block';
    if (tipo === 'success') {
      setTimeout(() => {
        configAiAlert.style.display = 'none';
      }, 5000);
    }
  }

  // --- MONITOR DE CHAT ---
  function agregarMensajeAlMonitor(data) {
    const monitor = document.getElementById('ai-chat-monitor');
    const emptyMsg = document.getElementById('ai-chat-empty-msg');
    if (!monitor) return;

    if (emptyMsg) {
      emptyMsg.style.display = 'none';
    }

    const msgDiv = document.createElement('div');
    msgDiv.style.padding = '10px 14px';
    msgDiv.style.borderRadius = '8px';
    msgDiv.style.maxWidth = '90%';
    msgDiv.style.lineHeight = '1.4';
    msgDiv.style.boxShadow = '0 1px 2px rgba(0,0,0,0.1)';

    if (data.type === 'in') {
      msgDiv.style.backgroundColor = 'var(--bg-secondary)';
      msgDiv.style.alignSelf = 'flex-start';
      msgDiv.style.borderLeft = '3px solid #3498db';
      msgDiv.innerHTML = `
        <div style="font-size: 11px; color: #3498db; font-weight: 700; margin-bottom: 4px;">Cliente (${data.sender}) • ${data.time}</div>
        <div style="color: var(--text-primary);">${data.text}</div>
      `;
    } else if (data.type === 'out') {
      msgDiv.style.backgroundColor = 'rgba(46, 204, 113, 0.1)';
      msgDiv.style.alignSelf = 'flex-end';
      msgDiv.style.borderRight = '3px solid var(--success)';
      msgDiv.innerHTML = `
        <div style="font-size: 11px; color: var(--success); font-weight: 700; margin-bottom: 4px; text-align: right;">Bot IA • ${data.time}</div>
        <div style="color: var(--text-primary); text-align: right;">${data.text}</div>
      `;
    } else {
      msgDiv.style.backgroundColor = 'rgba(231, 76, 60, 0.1)';
      msgDiv.style.alignSelf = 'center';
      msgDiv.style.border = '1px solid var(--danger)';
      msgDiv.style.color = 'var(--danger)';
      msgDiv.style.textAlign = 'center';
      msgDiv.innerHTML = `
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 4px;">Sistema • ${data.time}</div>
        <div>${data.text}</div>
      `;
    }

    monitor.appendChild(msgDiv);
    monitor.scrollTop = monitor.scrollHeight;
  }

  // Init
  loadStatus('client');
  cargarConfiguracionIA();
});
