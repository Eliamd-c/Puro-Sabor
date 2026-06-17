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

  socket.on('whatsapp_client_message', (data) => {
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

  // --- BANDEJA DE ASISTENCIA HUMANA (HANDOFF) ---
  const handoffList = document.getElementById('handoff-list');
  const handoffReplyBox = document.getElementById('handoff-reply-box');
  const handoffReplyTitle = document.getElementById('handoff-reply-title');
  const handoffReplyQuestion = document.getElementById('handoff-reply-question');
  const handoffReplyText = document.getElementById('handoff-reply-text');
  const btnSendReply = document.getElementById('btn-send-reply');
  const btnCancelReply = document.getElementById('btn-cancel-reply');

  let currentHandoffChat = null;

  async function cargarHandoff() {
    if (!handoffList) return;
    try {
      const response = await fetch('/api/chatbots/paused', { headers: authHeaders });
      const result = await response.json();
      
      if (result.success) {
        if (result.data.length === 0) {
          handoffList.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">No hay clientes en espera. 🎉</div>';
          return;
        }

        handoffList.innerHTML = '';
        result.data.forEach(chat => {
          const card = document.createElement('div');
          card.style.padding = '12px';
          card.style.background = 'var(--bg-secondary)';
          card.style.borderRadius = '8px';
          card.style.borderLeft = '4px solid #e74c3c';
          card.style.cursor = 'pointer';
          card.style.display = 'flex';
          card.style.flexDirection = 'column';
          card.style.gap = '6px';
          
          const fecha = new Date(chat.fecha_pausa).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          
          card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <strong style="font-size: 14px;">${chat.nombre_cliente || chat.telefono}</strong>
              <span style="font-size: 11px; color: var(--text-muted);">${fecha}</span>
            </div>
            <div style="font-size: 13px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              "${chat.ultimo_mensaje}"
            </div>
          `;
          
          card.addEventListener('click', () => abrirRespuestaRapida(chat));
          handoffList.appendChild(card);
        });
      }
    } catch (error) {
      console.error('Error cargando bandeja de asistencia:', error);
    }
  }

  function abrirRespuestaRapida(chat) {
    currentHandoffChat = chat;
    handoffReplyTitle.textContent = `Respondiendo a: ${chat.nombre_cliente || chat.telefono}`;
    handoffReplyQuestion.textContent = `"${chat.ultimo_mensaje}"`;
    handoffReplyText.value = '';
    handoffReplyBox.style.display = 'block';
    handoffReplyText.focus();
  }

  if (btnCancelReply) {
    btnCancelReply.addEventListener('click', () => {
      handoffReplyBox.style.display = 'none';
      currentHandoffChat = null;
    });
  }

  if (btnSendReply) {
    btnSendReply.addEventListener('click', async () => {
      if (!currentHandoffChat) return;
      const respuesta = handoffReplyText.value.trim();
      if (!respuesta) {
        alert('Escribe una respuesta primero.');
        return;
      }

      btnSendReply.disabled = true;
      btnSendReply.textContent = 'Enviando...';

      try {
        const res = await fetch('/api/chatbots/reply', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            telefono: currentHandoffChat.telefono,
            pregunta: currentHandoffChat.ultimo_mensaje,
            respuesta: respuesta
          })
        });
        const result = await res.json();
        
        if (result.success) {
          handoffReplyBox.style.display = 'none';
          currentHandoffChat = null;
          cargarHandoff();
        } else {
          alert('Error: ' + result.message);
        }
      } catch (error) {
        console.error(error);
        alert('Error enviando la respuesta.');
      } finally {
        btnSendReply.disabled = false;
        btnSendReply.textContent = '📤 Enviar y Reactivar Bot';
      }
    });
  }

  // Socket listener for new handoff
  if (socket) {
    socket.on('whatsapp_handoff_requested', () => {
      cargarHandoff();
    });
  }

  // Init
  loadStatus('client');
  cargarHandoff();
});
