// 🔌 INTERFAZ DE API - CLIENTE PURO SABOR (SOPORTE HÍBRIDO: EXPRESS / ESTÁTICO)

const API_BASE_URL = ''; // Rutas relativas

// 💾 BASE DE DATOS LOCAL PARA FALLBACK ESTÁTICO (Para subir directamente a Hosting Compartido sin Node.js)
const STATIC_CATEGORIES = [
  { id: 1, nombre: 'Migas al Carbón', descripcion: 'Nuestra especialidad al carbón, elige el tamaño y la proteína que desees', orden: 1 },
  { id: 2, nombre: 'Bebidas', descripcion: 'Acompañamientos refrescantes', orden: 2 },
  { id: 3, nombre: 'Postres', descripcion: 'El toque dulce final', orden: 3 }
];

const STATIC_PRODUCTS = [
  // Especialidades: Migas al Carbón
  { id: 101, nombre: 'Migas con Res (Pequeña)', descripcion: 'Nuestra especialidad: abundante porción de migas de plátano con 125 gr de jugoso lomo de res premium al carbón.', precio: 15000.00, categoria_id: 1, categoria_nombre: 'Migas al Carbón', stock: 100, disponible: 1, imagen_url: '/assets/images/miga_res.png' },
  { id: 102, nombre: 'Migas con Res (Grande)', descripcion: 'Nuestra especialidad: abundante porción de migas de plátano con 250 gr de jugoso lomo de res premium al carbón.', precio: 25000.00, categoria_id: 1, categoria_nombre: 'Migas al Carbón', stock: 100, disponible: 1, imagen_url: '/assets/images/miga_res.png' },
  
  { id: 103, nombre: 'Migas con Cerdo (Pequeña)', descripcion: 'Exquisitas migas de plátano tradicional acompañadas de 125 gr de jugoso lomo de cerdo asado al carbón.', precio: 15000.00, categoria_id: 1, categoria_nombre: 'Migas al Carbón', stock: 100, disponible: 1, imagen_url: '/assets/images/miga_cerdo.png' },
  { id: 104, nombre: 'Migas con Cerdo (Grande)', descripcion: 'Exquisitas migas de plátano tradicional acompañadas de 250 gr de jugoso lomo de cerdo asado al carbón.', precio: 22000.00, categoria_id: 1, categoria_nombre: 'Migas al Carbón', stock: 100, disponible: 1, imagen_url: '/assets/images/miga_cerdo.png' },
  
  { id: 105, nombre: 'Migas con Costillas BBQ (Pequeña)', descripcion: 'Migas de plátano de la casa servidas con tiernas costillas de cerdo (125 gr) bañadas en salsa BBQ artesanal.', precio: 15000.00, categoria_id: 1, categoria_nombre: 'Migas al Carbón', stock: 100, disponible: 1, imagen_url: '/assets/images/miga_costillas.png' },
  { id: 106, nombre: 'Migas con Costillas BBQ (Grande)', descripcion: 'Migas de plátano de la casa servidas con tiernas costillas de cerdo (250 gr) bañadas en salsa BBQ artesanal.', precio: 22000.00, categoria_id: 1, categoria_nombre: 'Migas al Carbón', stock: 100, disponible: 1, imagen_url: '/assets/images/miga_costillas.png' },
  
  { id: 107, nombre: 'Migas con Pollo (Pequeña)', descripcion: 'Nuestras migas de plátano acompañadas con filete de pollo al carbón super jugoso de 125 gr macerado en finas hierbas.', precio: 15000.00, categoria_id: 1, categoria_nombre: 'Migas al Carbón', stock: 100, disponible: 1, imagen_url: '/assets/images/miga_pollo.png' },
  { id: 108, nombre: 'Migas con Pollo (Grande)', descripcion: 'Nuestras migas de plátano acompañadas con filete de pollo al carbón super jugoso de 250 gr macerado en finas hierbas.', precio: 20000.00, categoria_id: 1, categoria_nombre: 'Migas al Carbón', stock: 100, disponible: 1, imagen_url: '/assets/images/miga_pollo.png' },
  
  { id: 109, nombre: 'Migas con Ubre (Pequeña)', descripcion: 'Migas tradicionales de plátano verde servidas con 125 gr de tierna y jugosa ubre asada a la parrilla.', precio: 15000.00, categoria_id: 1, categoria_nombre: 'Migas al Carbón', stock: 100, disponible: 1, imagen_url: '/assets/images/miga_ubre.png' },
  { id: 110, nombre: 'Migas con Ubre (Grande)', descripcion: 'Migas tradicionales de plátano verde servidas con 250 gr de tierna y jugosa ubre asada a la parrilla.', precio: 22000.00, categoria_id: 1, categoria_nombre: 'Migas al Carbón', stock: 100, disponible: 1, imagen_url: '/assets/images/miga_ubre.png' },

  // Bebidas
  { id: 201, nombre: 'Limonada Natural', descripcion: 'Refrescante limonada natural preparada al instante con limones frescos seleccionados.', precio: 6000.00, categoria_id: 2, categoria_nombre: 'Bebidas', stock: 100, disponible: 1, imagen_url: '/assets/images/limonada_natural.png' },
  { id: 202, nombre: 'Limonada Cerezada', descripcion: 'Una deliciosa y vistosa combinación de limonada natural con el dulce sabor de las cerezas selectas.', precio: 8700.00, categoria_id: 2, categoria_nombre: 'Bebidas', stock: 100, disponible: 1, imagen_url: '/assets/images/limonada_cerezada.png' },
  { id: 203, nombre: 'Limonada de Hierbabuena', descripcion: 'La frescura absoluta: limonada frapeada con aromáticas hojas de hierbabuena fresca.', precio: 7700.00, categoria_id: 2, categoria_nombre: 'Bebidas', stock: 100, disponible: 1, imagen_url: '/assets/images/limonada_hierbabuena.png' },
  { id: 204, nombre: 'Limonada de Coco', descripcion: 'Exquisitamente cremosa y refrescante, nuestra especialidad de la casa preparada con coco natural.', precio: 8900.00, categoria_id: 2, categoria_nombre: 'Bebidas', stock: 100, disponible: 1, imagen_url: '/assets/images/limonada_coco.png' },
  { id: 205, nombre: 'Limonada de Mango Biche', descripcion: 'Refrescante y ácida combinación de limonada con tiras de mango biche verde y una pizca de sal.', precio: 8900.00, categoria_id: 2, categoria_nombre: 'Bebidas', stock: 100, disponible: 1, imagen_url: '/assets/images/limonada_mango_biche.png' },
  
  { id: 206, nombre: 'Jugo Natural en Agua', descripcion: 'Lulo, maracuyá o mango 100% natural, sumamente refrescante.', precio: 4000.00, categoria_id: 2, categoria_nombre: 'Bebidas', stock: 100, disponible: 1, imagen_url: '/assets/images/jugo_natural.png' },
  { id: 207, nombre: 'Agua Mineral con Gas', descripcion: 'Agua mineral con gas refrescante con una rodaja de limón fresquecito.', precio: 3000.00, categoria_id: 2, categoria_nombre: 'Bebidas', stock: 100, disponible: 1, imagen_url: '/assets/images/agua_gas.png' },
  
  // Gaseosas
  { id: 208, nombre: 'Gaseosa (Mini 250 ml)', descripcion: 'Gaseosa helada en presentación mini de 250 ml (Coca-Cola, Postobón o Pepsi).', precio: 3500.00, categoria_id: 2, categoria_nombre: 'Bebidas', stock: 100, disponible: 1, imagen_url: '/assets/images/gaseosa_fria.png' },
  { id: 209, nombre: 'Gaseosa (Personal)', descripcion: 'Gaseosa helada en presentación personal (Coca-Cola, Postobón o Pepsi).', precio: 6000.00, categoria_id: 2, categoria_nombre: 'Bebidas', stock: 100, disponible: 1, imagen_url: '/assets/images/gaseosa_fria.png' },
  { id: 210, nombre: 'Gaseosa (Litro 1.5)', descripcion: 'Gaseosa helada familiar de 1.5 Litros ideal para compartir con tus migas.', precio: 10000.00, categoria_id: 2, categoria_nombre: 'Bebidas', stock: 100, disponible: 1, imagen_url: '/assets/images/gaseosa_fria.png' },

  // Postres
  { id: 301, nombre: 'Flan de Caramelo', descripcion: 'Flan casero suave y ultra-cremoso bañado en un exquisito almíbar de caramelo tradicional.', precio: 5000.00, categoria_id: 3, categoria_nombre: 'Postres', stock: 100, disponible: 1, imagen_url: '/assets/images/flan_caramelo.png' },
  { id: 302, nombre: 'Tres Leches Artesanal', descripcion: 'Exquisito bizcocho tradicional humedecido en nuestra receta secreta de tres leches, con crema batida.', precio: 5000.00, categoria_id: 3, categoria_nombre: 'Postres', stock: 100, disponible: 1, imagen_url: '/assets/images/tres_leches.png' },
  { id: 303, nombre: 'Torta de Chocolate', descripcion: 'Esponjosa torta húmeda de chocolate premium cubierta con fudge espeso de la casa.', precio: 6000.00, categoria_id: 3, categoria_nombre: 'Postres', stock: 100, disponible: 1, imagen_url: '/assets/images/torta_chocolate.png' }
];

let isStaticMode = false; // Se activa automáticamente si falla la llamada al backend

const API = {
  // Obtener categorías activas
  async getCategorias() {
    if (isStaticMode) {
      return STATIC_CATEGORIES;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/categorias`);
      if (!response.ok) throw new Error('API no disponible');
      const result = await response.json();
      if (!result.success) throw new Error(result.message);
      return result.data;
    } catch (error) {
      console.warn('⚠️ No se detectó servidor backend. Activando Modo Estático Automático.');
      isStaticMode = true;
      return STATIC_CATEGORIES;
    }
  },

  // Obtener productos activos (con filtros opcionales de búsqueda y categoría)
  async getProductos(categoria = '', buscar = '') {
    if (isStaticMode) {
      return this._filtrarProductosEstaticos(categoria, buscar);
    }

    try {
      const params = new URLSearchParams();
      if (categoria) params.append('categoria', categoria);
      if (buscar) params.append('buscar', buscar);

      const response = await fetch(`${API_BASE_URL}/api/productos?${params.toString()}`);
      if (!response.ok) throw new Error('API no disponible');
      const result = await response.json();
      if (!result.success) throw new Error(result.message);
      return result.data;
    } catch (error) {
      isStaticMode = true;
      return this._filtrarProductosEstaticos(categoria, buscar);
    }
  },

  // Obtener detalles de un producto por ID
  async getProductoById(id) {
    if (isStaticMode) {
      return STATIC_PRODUCTS.find(p => p.id === parseInt(id)) || null;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/productos/${id}`);
      if (!response.ok) throw new Error('API no disponible');
      const result = await response.json();
      if (!result.success) throw new Error(result.message);
      return result.data;
    } catch (error) {
      isStaticMode = true;
      return STATIC_PRODUCTS.find(p => p.id === parseInt(id)) || null;
    }
  },

  // Helper interno para simular base de datos en el cliente
  _filtrarProductosEstaticos(categoria = '', buscar = '') {
    let filtrados = [...STATIC_PRODUCTS];

    if (categoria) {
      filtrados = filtrados.filter(p => p.categoria_id === parseInt(categoria));
    }

    if (buscar) {
      const q = buscar.toLowerCase();
      filtrados = filtrados.filter(p => 
        p.nombre.toLowerCase().includes(q) || 
        (p.descripcion && p.descripcion.toLowerCase().includes(q))
      );
    }

    return filtrados;
  }
};
