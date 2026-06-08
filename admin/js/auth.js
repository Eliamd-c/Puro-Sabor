// 🔐 GESTIÓN DE SESIÓN DE ADMINISTRACIÓN - PURO SABOR

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('login-form');
  const loginAlert = document.getElementById('login-alert');
  const btnSubmit = document.getElementById('btn-submit-login');

  // Verificar si el token ya existe en localStorage y es válido
  async function verificarSesionExistente() {
    const token = localStorage.getItem('puro_sabor_admin_token');
    
    if (token) {
      try {
        const response = await fetch('/api/admin/verify', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        const result = await response.json();
        
        if (result.success) {
          // Ya está autenticado, redirigir a dashboard
          window.location.href = '/admin/dashboard.html';
        } else {
          // Token inválido/expirado, limpiar
          localStorage.removeItem('puro_sabor_admin_token');
          localStorage.removeItem('puro_sabor_admin_user');
        }
      } catch (error) {
        console.error('Error al verificar sesión existente:', error);
      }
    }
  }

  // Ejecutar verificación inicial
  verificarSesionExistente();

  // Controlar envío del formulario de login
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const usuario = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;

      if (!usuario || !password) {
        mostrarError('Por favor completa todos los campos.');
        return;
      }

      // Estilo de carga en botón
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = '<span>Verificando...</span>';
      loginAlert.style.display = 'none';

      try {
        const response = await fetch('/api/admin/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ usuario, password })
        });

        const result = await response.json();

        if (result.success) {
          // Guardar token en localStorage
          localStorage.setItem('puro_sabor_admin_token', result.token);
          localStorage.setItem('puro_sabor_admin_user', JSON.stringify(result.admin));
          
          // Redirigir al dashboard
          window.location.href = '/admin/dashboard.html';
        } else {
          mostrarError(result.message || 'Error al iniciar sesión.');
          restaurarBoton();
        }
      } catch (error) {
        mostrarError('Error en la conexión con el servidor.');
        restaurarBoton();
      }
    });
  }

  function mostrarError(mensaje) {
    loginAlert.textContent = mensaje;
    loginAlert.style.display = 'block';
    
    // Animación sacudida (shake)
    loginAlert.classList.remove('animate-fade-in-up');
    void loginAlert.offsetWidth; // Reflow
    loginAlert.style.animation = 'fadeInUp 0.3s ease-out';
  }

  function restaurarBoton() {
    btnSubmit.disabled = false;
    btnSubmit.innerHTML = '<span>Ingresar al Panel</span>';
  }
});
