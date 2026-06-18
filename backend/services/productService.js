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

    // Obtener productos paginados con sus variantes
    const dataQuery = `
      SELECT p.id, p.nombre, p.descripcion, p.precio, p.categoria_id, p.stock, 
             p.disponible, p.imagen_url, p.created_at, p.tiene_variantes,
             (SELECT json_agg(json_build_object('id', v.id, 'nombre', v.nombre, 'stock', v.stock, 'imagen_url', v.imagen_url))
              FROM producto_variantes v WHERE v.producto_id = p.id) as variantes
      FROM productos p
      WHERE ${whereClause}
      ORDER BY p.created_at DESC
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
    const productos = await dbAsync.all(`
      SELECT p.*,
             (SELECT json_agg(json_build_object('id', v.id, 'nombre', v.nombre, 'stock', v.stock, 'imagen_url', v.imagen_url))
              FROM producto_variantes v WHERE v.producto_id = p.id) as variantes
      FROM productos p 
      WHERE p.activo = 1
    `);

    // 3. Guardar en caché
    cacheService.set(CACHE_KEY, productos);

    return productos;
  }

  async getAllAdmin(page = 1, limit = 1000) {
    const offset = (page - 1) * limit;
    
    const countRow = await dbAsync.get('SELECT COUNT(*) as total FROM productos');
    const total = countRow.total;
    
    const productos = await dbAsync.all(`
      SELECT p.*, c.nombre as categoria_nombre,
             (SELECT json_agg(json_build_object('id', v.id, 'nombre', v.nombre, 'stock', v.stock, 'imagen_url', v.imagen_url))
              FROM producto_variantes v WHERE v.producto_id = p.id) as variantes
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
    const { nombre, descripcion, precio, categoria_id, stock, imagen_url, tiene_variantes, variantes } = data;
    
    const result = await dbAsync.run(
      `INSERT INTO productos (nombre, descripcion, precio, categoria_id, stock, imagen_url, tiene_variantes) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [nombre, descripcion || null, precio, categoria_id, stock || 0, imagen_url || '', tiene_variantes || 0]
    );
    
    const newProductId = result.lastID;

    // Handle variants
    if (tiene_variantes && variantes && Array.isArray(variantes)) {
      for (const v of variantes) {
        await dbAsync.run(
          `INSERT INTO producto_variantes (producto_id, nombre, stock, imagen_url) VALUES (?, ?, ?, ?)`,
          [newProductId, v.nombre, v.stock || 0, v.imagen_url || null]
        );
      }
    }

    cacheService.del(CACHE_KEY); // Invalidar caché
    
    return await dbAsync.get('SELECT * FROM productos WHERE id = ?', [newProductId]);
  }

  async update(id, data) {
    const { nombre, descripcion, precio, categoria_id, stock, disponible, activo, imagen_url, tiene_variantes, variantes } = data;
    
    // PostgreSQL (pg driver) crashes if any parameter is undefined. We must use null or defaults.
    const _desc = descripcion !== undefined ? descripcion : null;
    const _stock = stock !== undefined ? stock : 0;
    const _disp = disponible !== undefined ? disponible : 1;
    const _activo = activo !== undefined ? activo : 1;
    const _tiene_variantes = tiene_variantes !== undefined ? tiene_variantes : 0;

    let query = `UPDATE productos SET 
        nombre = ?, descripcion = ?, precio = ?, 
        categoria_id = ?, stock = ?, disponible = ?, 
        activo = ?, tiene_variantes = ?, updated_at = CURRENT_TIMESTAMP`;
    
    let params = [nombre, _desc, precio, categoria_id, _stock, _disp, _activo, _tiene_variantes];

    if (imagen_url !== undefined) {
      query += `, imagen_url = ?`;
      params.push(imagen_url);
    }
    
    query += ` WHERE id = ?`;
    params.push(id);

    await dbAsync.run(query, params);
    
    // Handle variants if the product has them
    if (_tiene_variantes && variantes && Array.isArray(variantes)) {
      // For simplicity, delete old variants and insert new ones
      await dbAsync.run(`DELETE FROM producto_variantes WHERE producto_id = ?`, [id]);
      
      for (const v of variantes) {
        await dbAsync.run(
          `INSERT INTO producto_variantes (producto_id, nombre, stock, imagen_url) VALUES (?, ?, ?, ?)`,
          [id, v.nombre, v.stock || 0, v.imagen_url || null]
        );
      }
    } else if (!_tiene_variantes) {
      // If it doesn't have variants anymore, delete them just in case
      await dbAsync.run(`DELETE FROM producto_variantes WHERE producto_id = ?`, [id]);
    }

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
    cacheService.del(CACHE_KEY); // Invalidar caché
    return await dbAsync.get('SELECT * FROM productos WHERE id = ?', [id]);
  }

  async updateVariantStock(id, stock) {
    const stockLimpio = Math.max(0, parseInt(stock) || 0);
    await dbAsync.run(
      `UPDATE producto_variantes SET stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [stockLimpio, id]
    );
    cacheService.del(CACHE_KEY); // Invalidar caché
    return true;
  }
}

module.exports = new ProductService();
