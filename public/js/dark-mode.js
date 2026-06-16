// Dark Mode Manager para Puro Sabor

class DarkModeManager {
  constructor() {
    this.STORAGE_KEY = 'puro-sabor-theme';
    this.DARK_CLASS = 'dark-mode';
    this.init();
  }

  init() {
    // Aplicar tema guardado o detectar preferencia
    const savedTheme = this.getSavedTheme();
    const prefersDark = this.getSystemPreference();

    if (savedTheme) {
      this.setTheme(savedTheme);
    } else if (prefersDark) {
      this.setTheme('dark');
    }

    // Escuchar cambios de preferencia del sistema
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)')
        .addEventListener('change', (e) => {
          const savedTheme = this.getSavedTheme();
          if (!savedTheme) {
            // Solo aplicar si no hay preferencia guardada
            this.setTheme(e.matches ? 'dark' : 'light');
          }
        });
    }

    console.log('[Dark Mode] Inicializado. Tema actual:', this.getCurrentTheme());
  }

  /**
   * Obtener tema guardado en localStorage
   */
  getSavedTheme() {
    return localStorage.getItem(this.STORAGE_KEY);
  }

  /**
   * Obtener preferencia del sistema (prefers-color-scheme)
   */
  getSystemPreference() {
    if (window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  }

  /**
   * Obtener tema actual
   */
  getCurrentTheme() {
    return document.documentElement.classList.contains(this.DARK_CLASS)
      ? 'dark'
      : 'light';
  }

  /**
   * Establecer tema
   */
  setTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.classList.add(this.DARK_CLASS);
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem(this.STORAGE_KEY, 'dark');
    } else {
      document.documentElement.classList.remove(this.DARK_CLASS);
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem(this.STORAGE_KEY, 'light');
    }

    // Actualizar meta theme-color
    this.updateThemeColor(theme);

    console.log('[Dark Mode] Tema cambiado a:', theme);
  }

  /**
   * Toggle entre dark y light mode
   */
  toggle() {
    const current = this.getCurrentTheme();
    const newTheme = current === 'dark' ? 'light' : 'dark';
    this.setTheme(newTheme);
    return newTheme;
  }

  /**
   * Actualizar meta theme-color para navegadores
   */
  updateThemeColor(theme) {
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
      // En dark mode, un color más suave
      const color = theme === 'dark' ? '#1e293b' : '#d4531f';
      themeColorMeta.setAttribute('content', color);
    }
  }

  /**
   * Crear botón toggle
   */
  createToggleButton() {
    const button = document.createElement('button');
    button.className = 'dark-mode-toggle';
    button.id = 'dark-mode-toggle';
    button.setAttribute('aria-label', 'Toggle dark mode');
    button.title = 'Toggle dark mode';
    button.innerHTML = this.getCurrentTheme() === 'dark' ? '☀️' : '🌙';

    button.addEventListener('click', () => {
      const newTheme = this.toggle();
      button.innerHTML = newTheme === 'dark' ? '☀️' : '🌙';
    });

    return button;
  }

  /**
   * Inyectar botón toggle en el header
   */
  injectToggleButton() {
    const header = document.querySelector('.sticky-header');
    if (!header) return;

    const headerActions = header.querySelector('.header-actions');
    if (headerActions) {
      const toggle = this.createToggleButton();
      headerActions.insertBefore(toggle, headerActions.firstChild);
    }
  }
}

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.darkModeManager = new DarkModeManager();
    window.darkModeManager.injectToggleButton();
  });
} else {
  window.darkModeManager = new DarkModeManager();
  // Inyectar button después de que el header esté listo
  setTimeout(() => {
    window.darkModeManager.injectToggleButton();
  }, 100);
}

// API pública para controlar dark mode
window.toggleDarkMode = () => {
  if (window.darkModeManager) {
    return window.darkModeManager.toggle();
  }
};

window.setDarkMode = (enable) => {
  if (window.darkModeManager) {
    window.darkModeManager.setTheme(enable ? 'dark' : 'light');
  }
};

window.getDarkModeStatus = () => {
  if (window.darkModeManager) {
    return window.darkModeManager.getCurrentTheme() === 'dark';
  }
  return false;
};
