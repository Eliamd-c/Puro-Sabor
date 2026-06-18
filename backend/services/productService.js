const dbAsync = require('../config/database-promise');
const AppError = require('../errors/AppError');
const cacheService = require('./cacheService');

const CACHE_KEY = 'productos_activos';

class ProductService {
  /**
   * Obtener productos con paginación y filtros (PÚBLICO)
   * @param {number} page - Página (default: 1)
   * @param {number} limit - Items por página (default: 20)
   * @param {object} filters - {categoria_id, search}
   */
  async getPaginated(page = 1, limit = 20, filters = {}) {
    const offset = (page - 1) * limit;

    // Construir query dinámicamente según filtros
    let whereConditions = ['activo = 1'];
    const params = [];

    if (filters.categoria_id) {
      whereConditions.push('categoria_id = ?');
      params.push(filters.categoria_id);
    }

    if (filters.search) {
      whereConditions.push('nombre ILIKE ?');
      params.push(`%${filters.search}%`);
    }

    const whereClause = whereConditions.join(' AND ');

    // Contar total
    const countQuery = `SELECT COUNT(*) as total FROM productos WHERE ${whereClause}`;
    const countResult = await dbAsync.get(countQuery, params);
    const total = countResult.total || 0;

    // Obtener productos paginados
    const dataQuery = `
      SELECT id, nombre, descripcion, precio, categoria_id, stock, disponible, imagen_url, created_at
      FROM productos
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    const dataParams = [...params, limit, offset];
    const productos = await dbAsync.all(dataQuery, dataParams);

    return {
      data: productos,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasMore: page < Math.ceil(total / limit)
      }
    };
  }

  async getAll() {
    // 1. Intentar obtener del caché
    const cached = cacheService.get(CACHE_KEY);
    if (cached) {
      return cached;
    }

    // 2. Si no hay caché, buscar en DB
    const productos = await dbAsync.all('SELECT * FROM productos WHERE activo = 1');

    // 3. Guardar en caché
    cacheService.set(CACHE_KEY, productos);

    return productos;
  }

  async getAllAdmin(page = 1, limit = 1000) {
    const offset = (page - 1) * limit;
    
    const countRow = await dbAsync.get('SELECT COUNT(*) as total FROM productos');
    const total = countRow.total;
    
    const productos = await dbAsync.all(`
      SELECT p.*, c.nombre as categoria_nombre 
      FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      ORDER BY p.categoria_id ASC, p.nombre ASC
      LIMIT ? OFFSET ?
    `, [limit, offset]);
    
    return {
      data: productos,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async create(data) {
    const { nombre, descripcion, precio, categoria_id, stock, imagen_url } = data;
    const result = await dbAsync.run(
      `INSERT INTO productos (nombre, descripcion, precio, categoria_id, stock, imagen_url) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [nombre, descripcion, precio, categoria_id, stock, imagen_url || '']
    );
    
    cacheService.del(CACHE_KEY); // Invalidar caché
    
    return await dbAsync.get('SELECT * FROM productos WHERE id = ?', [result.lastID]);
  }

  async update(id, data) {
    const { nombre, descripcion, precio, categoria_id, stock, disponible, activo, imagen_url } = data;
    
    // PostgreSQL (pg driver) crashes if any parameter is undefined. We must use null or defaults.
    const _desc = descripcion !== undefined ? descripcion : null;
    const _stock = stock !== undefined ? stock : 0;
    const _disp = disponible !== undefined ? disponible : 1;
    const _activo = activo !== undefined ? activo : 1;

    let query = `UPDATE productos SET 
        nombre = ?, descripcion = ?, precio = ?, 
        categoria_id = ?, stock = ?, disponible = ?, 
        activo = ?, updated_at = CURRENT_TIMESTAMP`;
    
    let params = [nombre, _desc, precio, categoria_id, _stock, _disp, _activo];

    if (imagen_url !== undefined) {
      query += `, imagen_url = ?`;
      params.push(imagen_url);
    }
    
    query += ` WHERE id = ?`;
    params.push(id);

    await dbAsync.run(query, params);
    
    cacheService.del(CACHE_KEY); // Invalidar caché
    
    return await dbAsync.get('SELECT * FROM productos WHERE id = ?', [id]);
  }

  async delete(id) {
    await dbAsync.run('DELETE FROM productos WHERE id = ?', [id]);
    cacheService.del(CACHE_KEY); // Invalidar caché
    return true;
  }
  async updateStock(id, stock) {
    const stockLimpio = Math.max(0, parseInt(stock) || 0);
    await dbAsync.run(
      `UPDATE productos SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [stockLimpio, id]
    );
    cacheService.del(CACHE_KEY);
    return await dbAsync.get('SELECT * FROM productos WHERE id = ?', [id]);
  }
}

module.exports = new ProductService();
