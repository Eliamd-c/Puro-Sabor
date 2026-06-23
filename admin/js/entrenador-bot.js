document.addEventListener('DOMContentLoaded', () => {
  function getCookie(name) {
    const cookies = document.cookie.split(';');
    for (let c of cookies) {
      const [k, v] = c.trim().split('=');
      if (k === name) return decodeURIComponent(v);
    }
    return null;
  }

  const token = localStorage.getItem('puro_sabor_admin_token') || getCookie('authToken');
  if (!token) {
    window.location.href = '/admin/';
    return;
  }

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };

  const btnLogoutGlobal = document.getElementById('btn-logout');
  if (btnLogoutGlobal) {
    btnLogoutGlobal.addEventListener('click', () => {
      localStorage.removeItem('puro_sabor_admin_token');
      document.cookie = 'puro_sabor_admin_token=; Max-Age=-99999999;';
      window.location.href = '/admin/';
    });
  }

  // --- TAB NAVIGATION SYSTEM ---
  window.switchTab = function(tabName) {
    // 1. Remove active state from links
    document.querySelectorAll('.entrenador-link').forEach(link => {
      link.classList.remove('active');
    });

    // 2. Add active state to selected link
    const activeLink = Array.from(document.querySelectorAll('.entrenador-link')).find(link => 
      link.getAttribute('onclick').includes(tabName)
    );
    if (activeLink) activeLink.classList.add('active');

    // 3. Hide all sections
    document.querySelectorAll('.entrenador-section').forEach(section => {
      section.classList.remove('active');
    });

    // 4. Show selected section
    const targetSection = document.getElementById(`tab-${tabName}`);
    if (targetSection) targetSection.classList.add('active');

    // 5. Load tab data
    if (tabName === 'config') cargarConfigBase();
    else if (tabName === 'horarios') cargarHorarios();
    else if (tabName === 'conocimiento') cargarConocimiento();
    else if (tabName === 'contexto') cargarContexto();
    else if (tabName === 'analytics') cargarAnalytics();
  };

  // --- TAB 1: CONFIGURACIÓN IA BASE ---
  const formBotBase = document.getElementById('form-bot-base');
  const alertConfigBase = document.getElementById('alert-config-base');

  async function cargarConfigBase() {
    try {
      const response = await fetch('/api/chatbots/config-ai', { headers: authHeaders });
      const result = await response.json();
      if (result.success && result.data) {
        // En config-ai, recuperamos las llaves del bot del cliente
        document.getElementById('bot-config-nombre').value = 'Puro Sabor Bot'; // Valor por defecto
        document.getElementById('bot-config-prompt').value = result.data.bot_system_prompt || '';
        document.getElementById('bot-config-ausencia').value = result.data.bot_mensaje_ausencia || '';

        // Imagen del menú
        const menuImg = result.data.bot_menu_imagen_url;
        const previewWrap = document.getElementById('menu-img-preview-wrap');
        const previewImg = document.getElementById('menu-img-preview');
        if (menuImg && previewWrap && previewImg) {
          previewImg.src = menuImg;
          previewWrap.style.display = 'block';
        } else if (previewWrap) {
          previewWrap.style.display = 'none';
        }
        
        const configActivo = document.getElementById('bot-config-activo');
        const configHorario = document.getElementById('bot-config-horario');
        if (configActivo) configActivo.checked = result.data.whatsapp_bot_active;
        if (configHorario) configHorario.checked = (result.data.bot_horario_activo === '1');
        
        // Cargar variables generales como el tono (o un valor fijo si no está en config)
        try {
          const tonoRes = await fetch('/api/config', { headers: authHeaders });
          const tonoData = await tonoRes.json();
          if (tonoData.success) {
            const tonoObj = tonoData.data.find(c => c.key === 'bot_tono');
            if (tonoObj) document.getElementById('bot-config-tono').value = tonoObj.value;
          }
        } catch (e) {}
      }
    } catch (err) {
      console.error('Error al cargar config base:', err);
    }
  }

  if (formBotBase) {
    formBotBase.addEventListener('submit', async (e) => {
      e.preventDefault();
      const prompt = document.getElementById('bot-config-prompt').value.trim();
      const ausencia = document.getElementById('bot-config-ausencia').value.trim();
      const tono = document.getElementById('bot-config-tono').value;
      const activo = document.getElementById('bot-config-activo').checked;
      const horario = document.getElementById('bot-config-horario').checked ? '1' : '0';

      const btnSave = document.getElementById('btn-save-bot-base');
      btnSave.disabled = true;
      btnSave.innerHTML = '<span>Guardando...</span>';
      alertConfigBase.style.display = 'none';

      try {
        // 1. Guardar prompt, mensaje de ausencia, y toggles en config-ai
        const resAi = await fetch('/api/chatbots/config-ai', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            bot_system_prompt: prompt,
            bot_mensaje_ausencia: ausencia,
            whatsapp_bot_active: activo,
            bot_horario_activo: horario
          })
        });
        const rAi = await resAi.json();

        // 2. Guardar tono en config general
        const resTono = await fetch('/api/config', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            configs: [{ key: 'bot_tono', value: tono }]
          })
        });

        if (rAi.success) {
          alertConfigBase.textContent = 'Configuración guardada exitosamente.';
          alertConfigBase.className = 'alert-box success';
          alertConfigBase.style.display = 'block';
          setTimeout(() => { alertConfigBase.style.display = 'none'; }, 4000);
        } else {
          alertConfigBase.textContent = 'Error al guardar la configuración.';
          alertConfigBase.className = 'alert-box error';
          alertConfigBase.style.display = 'block';
        }
      } catch (err) {
        console.error(err);
        alertConfigBase.textContent = 'Error de conexión con el servidor.';
        alertConfigBase.className = 'alert-box error';
        alertConfigBase.style.display = 'block';
      } finally {
        btnSave.disabled = false;
        btnSave.innerHTML = '<span>💾 Guardar Configuración Base</span>';
      }
    });
  }

  // --- IMAGEN DEL MENÚ (subir / quitar) ---
  const btnUploadMenuImg = document.getElementById('btn-upload-menu-img');
  const btnDeleteMenuImg = document.getElementById('btn-delete-menu-img');
  const alertMenuImg = document.getElementById('alert-menu-img');

  function showMenuImgAlert(msg, ok) {
    if (!alertMenuImg) return;
    alertMenuImg.textContent = msg;
    alertMenuImg.className = 'alert-box ' + (ok ? 'success' : 'error');
    alertMenuImg.style.display = 'block';
    setTimeout(() => { alertMenuImg.style.display = 'none'; }, 4000);
  }

  if (btnUploadMenuImg) {
    btnUploadMenuImg.addEventListener('click', async () => {
      const fileInput = document.getElementById('menu-img-file');
      const file = fileInput?.files?.[0];
      if (!file) { showMenuImgAlert('Selecciona una imagen primero.', false); return; }

      const fd = new FormData();
      fd.append('imagen', file);
      btnUploadMenuImg.disabled = true;
      btnUploadMenuImg.textContent = 'Subiendo...';
      try {
        const res = await fetch('/api/chatbots/menu-imagen', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: fd
        });
        const r = await res.json();
        if (r.success) {
          const previewWrap = document.getElementById('menu-img-preview-wrap');
          const previewImg = document.getElementById('menu-img-preview');
          if (previewImg) previewImg.src = r.url + '?v=' + Date.now();
          if (previewWrap) previewWrap.style.display = 'block';
          if (fileInput) fileInput.value = '';
          showMenuImgAlert('Imagen del menú guardada.', true);
        } else {
          showMenuImgAlert(r.message || 'Error al subir.', false);
        }
      } catch (err) {
        showMenuImgAlert('Error de conexión.', false);
      } finally {
        btnUploadMenuImg.disabled = false;
        btnUploadMenuImg.textContent = '⬆️ Subir Imagen';
      }
    });
  }

  if (btnDeleteMenuImg) {
    btnDeleteMenuImg.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/chatbots/menu-imagen', {
          method: 'DELETE',
          headers: authHeaders
        });
        const r = await res.json();
        if (r.success) {
          const previewWrap = document.getElementById('menu-img-preview-wrap');
          if (previewWrap) previewWrap.style.display = 'none';
          showMenuImgAlert('Imagen del menú eliminada.', true);
        } else {
          showMenuImgAlert(r.message || 'Error al eliminar.', false);
        }
      } catch (err) {
        showMenuImgAlert('Error de conexión.', false);
      }
    });
  }

  // --- TAB 2: HORARIOS ---
  const horariosTableBody = document.getElementById('horarios-table-body');

  async function cargarHorarios() {
    if (!horariosTableBody) return;
    try {
      const response = await fetch('/api/chatbots/horarios', { headers: authHeaders });
      const result = await response.json();
      if (result.success && result.data) {
        horariosTableBody.innerHTML = '';
        result.data.forEach(h => {
          const tr = document.createElement('tr');
          const isAbierto = h.abierto === 1;
          tr.innerHTML = `
            <td style="font-weight: 700;">${h.dia_semana.toUpperCase()}</td>
            <td>
              <label class="switch">
                <input type="checkbox" id="horario-toggle-${h.dia_semana}" ${isAbierto ? 'checked' : ''} onchange="toggleHorarioState('${h.dia_semana}')">
                <span class="slider-toggle"></span>
              </label>
            </td>
            <td>
              <input type="time" id="horario-apertura-${h.dia_semana}" value="${h.hora_apertura}" ${!isAbierto ? 'disabled' : ''}>
            </td>
            <td>
              <input type="time" id="horario-cierre-${h.dia_semana}" value="${h.hora_cierre}" ${!isAbierto ? 'disabled' : ''}>
            </td>
            <td>
              <button class="btn-primary" onclick="guardarDiaHorario('${h.dia_semana}')" style="padding: 6px 12px; font-size:12px;">Guardar</button>
            </td>
          `;
          horariosTableBody.appendChild(tr);
        });
      }
    } catch (err) {
      console.error(err);
    }
  }

  window.toggleHorarioState = function(dia) {
    const isChecked = document.getElementById(`horario-toggle-${dia}`).checked;
    document.getElementById(`horario-apertura-${dia}`).disabled = !isChecked;
    document.getElementById(`horario-cierre-${dia}`).disabled = !isChecked;
  };

  window.guardarDiaHorario = async function(dia) {
    const abierto = document.getElementById(`horario-toggle-${dia}`).checked;
    const hora_apertura = document.getElementById(`horario-apertura-${dia}`).value;
    const hora_cierre = document.getElementById(`horario-cierre-${dia}`).value;

    try {
      const response = await fetch('/api/chatbots/horarios', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          dia_semana: dia,
          abierto: abierto ? 1 : 0,
          hora_apertura,
          hora_cierre
        })
      });
      const result = await response.json();
      if (result.success) {
        alert(`✅ Horario de ${dia.toUpperCase()} guardado.`);
      } else {
        alert('❌ Error al guardar el horario.');
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión.');
    }
  };

  // --- TAB 3: BASE DE CONOCIMIENTO (KB) ---
  const formAddKb = document.getElementById('form-entrenador-add-kb');
  const kbListContainer = document.getElementById('entrenador-kb-list-container');

  async function cargarConocimiento() {
    if (!kbListContainer) return;
    try {
      const response = await fetch('/api/chatbots/kb', { headers: authHeaders });
      const result = await response.json();
      if (result.success && result.data) {
        if (result.data.length === 0) {
          kbListContainer.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">No hay reglas aprendidas.</div>';
          return;
        }

        kbListContainer.innerHTML = '';
        result.data.forEach(item => {
          const card = document.createElement('div');
          card.className = 'kb-item';
          
          let mediaBadge = '';
          if (item.media_url) {
            let icon = '📁';
            if (item.media_type === 'image') icon = '📸';
            if (item.media_type === 'video') icon = '🎥';
            if (item.media_type === 'audio') icon = '🎙️';
            mediaBadge = `<span class="kb-badge media">${icon} Adjunto</span>`;
          }

          let sinonimosText = '';
          if (item.ejemplos_sinonimos) {
            try {
              const parsed = JSON.parse(item.ejemplos_sinonimos);
              if (parsed.length > 0) {
                sinonimosText = `<div style="font-size: 11px; margin-top: 4px; color: var(--text-muted);">Sinónimos: ${parsed.join(', ')}</div>`;
              }
            } catch (e) {}
          }

          card.innerHTML = `
            <div class="kb-content">
              <div class="kb-q">Q: ${item.pregunta}</div>
              <div class="kb-a">A: ${item.respuesta}</div>
              ${sinonimosText}
              <div class="kb-meta">
                <span class="kb-badge category">${item.categoria.toUpperCase()}</span>
                <span class="kb-badge">Prioridad: ${item.prioridad}</span>
                ${mediaBadge}
              </div>
            </div>
            <button class="btn-eliminar" onclick="eliminarEntrenadorKb(${item.id})">🗑️</button>
          `;
          kbListContainer.appendChild(card);
        });
      }
    } catch (err) {
      console.error(err);
    }
  }

  if (formAddKb) {
    formAddKb.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('btn-save-entrenador-kb');
      btn.disabled = true;
      btn.textContent = 'Guardando...';

      const formData = new FormData();
      formData.append('categoria', document.getElementById('entrenador-kb-categoria').value);
      formData.append('pregunta', document.getElementById('entrenador-kb-pregunta').value.trim());
      formData.append('respuesta', document.getElementById('entrenador-kb-respuesta').value.trim());
      formData.append('prioridad', document.getElementById('entrenador-kb-prioridad').value);
      
      const sinonimos = document.getElementById('entrenador-kb-sinonimos').value.trim();
      const sinonimosArray = sinonimos ? sinonimos.split(',').map(s => s.trim()) : [];
      formData.append('ejemplos_sinonimos', JSON.stringify(sinonimosArray));

      const fileInput = document.getElementById('entrenador-kb-media');
      if (fileInput.files.length > 0) {
        formData.append('media', fileInput.files[0]);
      }

      try {
        const res = await fetch('/api/chatbots/kb', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }, // Form-data requiere boundary que fetch calcula solo
          body: formData
        });
        const result = await res.json();
        if (result.success) {
          formAddKb.reset();
          cargarConocimiento();
        } else {
          alert('Error: ' + result.message);
        }
      } catch (error) {
        console.error(error);
        alert('Error al guardar la regla.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Guardar en el Cerebro 🧠';
      }
    });
  }

  window.eliminarEntrenadorKb = async function(id) {
    if (!confirm('¿Seguro que quieres borrar esta regla?')) return;
    try {
      const res = await fetch('/api/chatbots/kb/' + id, { method: 'DELETE', headers: authHeaders });
      const result = await res.json();
      if (result.success) {
        cargarConocimiento();
      } else {
        alert(result.message);
      }
    } catch (e) {
      console.error(e);
      alert('Error al eliminar.');
    }
  };

  // --- TAB 4: CONTEXTO ---
  const formAddContexto = document.getElementById('form-add-contexto');
  const entrenadorContextListContainer = document.getElementById('entrenador-context-list-container');

  async function cargarContexto() {
    if (!entrenadorContextListContainer) return;
    try {
      const response = await fetch('/api/chatbots/contexto', { headers: authHeaders });
      const result = await response.json();
      if (result.success && result.data) {
        if (result.data.length === 0) {
          entrenadorContextListContainer.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">No hay directrices agregadas.</div>';
          return;
        }

        entrenadorContextListContainer.innerHTML = '';
        result.data.forEach(item => {
          const card = document.createElement('div');
          card.className = 'ctx-item';
          
          let badgeColor = 'rgba(231,76,60,0.15); color:#e74c3c;'; // restricción
          if (item.tipo === 'instruccion') badgeColor = 'rgba(52,152,219,0.15); color:#3498db;';
          if (item.tipo === 'ejemplo') badgeColor = 'rgba(241,196,15,0.15); color:#f1c40f;';

          card.innerHTML = `
            <div class="ctx-content">
              <span class="kb-badge" style="background:${badgeColor} font-weight:700; border-radius:4px; margin-bottom:8px; display:inline-block;">
                ${item.tipo.toUpperCase()}
              </span>
              <div class="ctx-body">${item.contenido}</div>
            </div>
            <button class="btn-eliminar" onclick="eliminarContexto(${item.id})">🗑️</button>
          `;
          entrenadorContextListContainer.appendChild(card);
        });
      }
    } catch (err) {
      console.error(err);
    }
  }

  if (formAddContexto) {
    formAddContexto.addEventListener('submit', async (e) => {
      e.preventDefault();
      const tipo = document.getElementById('contexto-tipo').value;
      const contenido = document.getElementById('contexto-contenido').value.trim();

      try {
        const response = await fetch('/api/chatbots/contexto', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ tipo, contenido })
        });
        const result = await response.json();
        if (result.success) {
          document.getElementById('contexto-contenido').value = '';
          cargarContexto();
        } else {
          alert('Error: ' + result.message);
        }
      } catch (err) {
        console.error(err);
        alert('Error de conexión.');
      }
    });
  }

  window.eliminarContexto = async function(id) {
    if (!confirm('¿Eliminar esta directriz del contexto?')) return;
    try {
      const response = await fetch(`/api/chatbots/contexto/${id}`, { method: 'DELETE', headers: authHeaders });
      const result = await response.json();
      if (result.success) {
        cargarContexto();
      } else {
        alert(result.message);
      }
    } catch (err) {
      console.error(err);
      alert('Error al eliminar.');
    }
  };

  // --- TAB 5: TESTER (SIMULADOR EN VIVO) ---
  const testerChatMessages = document.getElementById('tester-chat-messages');
  const testerUserInput = document.getElementById('tester-user-input');
  const btnTesterSend = document.getElementById('btn-tester-send');

  async function enviarPreguntaTester() {
    const pregunta = testerUserInput.value.trim();
    if (!pregunta) return;

    // Render User Message
    renderMessageTester(pregunta, 'user');
    testerUserInput.value = '';
    testerUserInput.disabled = true;
    btnTesterSend.disabled = true;

    // Render Typing bubble
    const typingBubble = renderMessageTester('🤖 Pensando...', 'bot typing');

    try {
      const response = await fetch('/api/chatbots/test', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ pregunta })
      });
      const result = await response.json();
      
      // Remove typing bubble
      if (typingBubble) typingBubble.remove();

      if (result.success && result.respuesta) {
        renderMessageTester(result.respuesta, 'bot');
      } else {
        renderMessageTester('❌ Ocurrió un error al procesar el mensaje.', 'bot');
      }
    } catch (err) {
      console.error(err);
      if (typingBubble) typingBubble.remove();
      renderMessageTester('❌ Error de conexión con el servidor.', 'bot');
    } finally {
      testerUserInput.disabled = false;
      btnTesterSend.disabled = false;
      testerUserInput.focus();
    }
  }

  function renderMessageTester(text, sender) {
    const div = document.createElement('div');
    div.className = `tester-msg ${sender}`;
    div.textContent = text;
    testerChatMessages.appendChild(div);
    testerChatMessages.scrollTop = testerChatMessages.scrollHeight;
    return div;
  }

  if (btnTesterSend) {
    btnTesterSend.addEventListener('click', enviarPreguntaTester);
  }
  if (testerUserInput) {
    testerUserInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') enviarPreguntaTester();
    });
  }

  // --- TAB 6: ANALYTICS ---
  async function cargarAnalytics() {
    try {
      const response = await fetch('/api/chatbots/analytics', { headers: authHeaders });
      const result = await response.json();
      if (result.success && result.data) {
        document.getElementById('stat-conv-total').textContent = result.data.total_conversaciones;
        document.getElementById('stat-msg-total').textContent = result.data.total_mensajes;
        document.getElementById('stat-handoff-total').textContent = result.data.handoffs;
        document.getElementById('stat-promos-total').textContent = result.data.total_promociones_enviadas;
        
        const preguntasList = document.getElementById('analytics-preguntas-comunes');
        if (preguntasList) {
          preguntasList.innerHTML = '';
          if (result.data.preguntas_frecuentes.length === 0) {
            preguntasList.innerHTML = '<div style="color:var(--text-muted); font-size:12px;">Aún no hay mensajes logueados.</div>';
            return;
          }
          result.data.preguntas_frecuentes.forEach(item => {
            const row = document.createElement('div');
            row.className = 'pregunta-item';
            row.innerHTML = `
              <div class="pregunta-texto">"${item.pregunta}"</div>
              <div class="pregunta-contador">${item.veces} veces</div>
            `;
            preguntasList.appendChild(row);
          });
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  // Init default tab
  switchTab('config');
});
