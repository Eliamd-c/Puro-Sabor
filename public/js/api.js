// 🔌 INTERFAZ DE API - CLIENTE PURO SABOR

const API_BASE_URL = ''; // Rutas relativas

const API = {
  // Obtener categorías activas
  async getCategorias() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/categorias`);
      if (!response.ok) throw new Error('API no disponible');
      const result = await response.json();
      // Compatibilidad con formato array crudo o envuelto en data
      return Array.isArray(result) ? result : (result.data || []);
    } catch (error) {
      console.error('⚠️ Error obteniendo categorías:', error.message);
      return [];
    }
  },

  // Obtener productos activos (con filtros opcionales de búsqueda, categoría y paginación)
  async getProductos(opciones = {}) {
    let filtros = opciones;
    if (typeof opciones === 'string') {
      const categoria = opciones;
      const buscar = arguments[1] || '';
      filtros = { categoria_id: categoria, search: buscar, page: 1, limit: 20 };
    }

    const { page = 1, limit = 20, categoria_id = '', search = '' } = filtros;

    try {
      const params = new URLSearchParams();
      params.append('page', page);
      params.append('limit', limit);
      if (categoria_id) params.append('categoria_id', categoria_id);
      if (search) params.append('search', search);
      params.append('_t', Date.now()); // Evitar caché agresivo del navegador

      const response = await fetch(`${API_BASE_URL}/api/productos?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('API no disponible');
      const result = await response.json();
      if (!result.success) throw new Error(result.message);
      
      // Compatibilidad con ambos formatos
      return Array.isArray(result.data) ? result.data : (result.data || []);
    } catch (error) {
      console.error('⚠️ Error obteniendo productos:', error.message);
      return [];
    }
  },

  // Guardar pedido
  async crearPedido(datosPedido) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/pedidos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datosPedido)
      });
      if (!response.ok) throw new Error('Error al conectar con el servidor');
      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Error al enviar pedido:', error);
      return { success: false, message: 'No se pudo conectar con el servidor' };
    }
  }
};

window.API = API;
