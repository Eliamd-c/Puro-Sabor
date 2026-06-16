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

  // Load Config (Authorized numbers)
  async function loadConfig() {
    try {
      const res = await fetch('/api/config', { headers: authHeaders });
      const data = await res.json();
      if (data.success) {
        inputAdminNumbers.value = data.data.admin_whatsapp_numbers || '';
      }
    } catch (err) {
      console.error('Error loading config:', err);
    }
  }

  // Save Config
  btnSaveNumbers.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ admin_whatsapp_numbers: inputAdminNumbers.value })
      });
      const data = await res.json();
      if (data.success) {
        alert('Números autorizados guardados correctamente.');
      } else {
        alert('Error al guardar: ' + data.message);
      }
    } catch (err) {
      alert('Error de conexión al guardar.');
    }
  });

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

  if(btnLogoutGlobal) {
    btnLogoutGlobal.addEventListener('click', () => {
      localStorage.removeItem('puro_sabor_admin_token');
      document.cookie = 'puro_sabor_admin_token=; Max-Age=-99999999;';
      window.location.href = '/admin/';
    });
  }

  // Init
  loadStatus('client');
});
