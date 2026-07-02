/**
 * Categories Service with Caching
 * FASE 3.3: Multi-level cache for frequently-accessed category data
 */

const dbAsync = require('../config/database-promise');
const { getInstance: getCacheManager } = require('../utils/cacheManager');
const cacheConfig = require('../config/cache-config');

class CategoriesService {
  /**
   * Get all categories with caching
   */
  async getAll() {
    const cache = getCacheManager();
    const cacheKey = `${cacheConfig.PREFIXES.CATEGORIES}:all`;
    const ttl = cacheConfig.CATEGORIES_TTL;

    // 1. Try cache first (L1 Redis + L2 Memory)
    const cached = await cache.get(cacheKey, ttl);
    if (cached.value !== null) {
      return cached.value;
    }

    // 2. Query database if cache miss
    const categorias = await dbAsync.all(`
      SELECT id, nombre, descripcion, orden, activa
      FROM categorias
      ORDER BY orden ASC
    `);

    // 3. Populate cache for next requests
    await cache.set(cacheKey, categorias, ttl);

    return categorias;
  }

  /**
   * Get single category by ID
   */
  async getById(id) {
    const cache = getCacheManager();
    const cacheKey = `${cacheConfig.PREFIXES.CATEGORIES}:${id}`;
    const ttl = cacheConfig.CATEGORIES_TTL;

    // Try cache first
    const cached = await cache.get(cacheKey, ttl);
    if (cached.value !== null) {
      return cached.value;
    }

    // Query database
    const categoria = await dbAsync.get(`
      SELECT id, nombre, descripcion, orden, activa
      FROM categorias
      WHERE id = ?
    `, [id]);

    // Populate cache
    if (categoria) {
      await cache.set(cacheKey, categoria, ttl);
    }

    return categoria;
  }

  /**
   * Create new category
   */
  async create(data) {
    const { nombre, descripcion, orden = 0, activa = 1 } = data;

    const result = await dbAsync.run(
      `INSERT INTO categorias (nombre, descripcion, orden, activa)
       VALUES (?, ?, ?, ?)`,
      [nombre, descripcion || null, orden, activa]
    );

    // Invalidate all category caches
    const cache = getCacheManager();
    await cache.clearPrefix(cacheConfig.PREFIXES.CATEGORIES);
    await cache.publishInvalidation(cacheConfig.EVENTS.CATEGORIES_UPDATED);

    return await dbAsync.get('SELECT * FROM categorias WHERE id = ?', [result.lastID]);
  }

  /**
   * Update category
   */
  async update(id, data) {
    const { nombre, descripcion, orden, activa } = data;

    const updates = [];
    const params = [];

    if (nombre !== undefined) {
      updates.push('nombre = ?');
      params.push(nombre);
    }
    if (descripcion !== undefined) {
      updates.push('descripcion = ?');
      params.push(descripcion);
    }
    if (orden !== undefined) {
      updates.push('orden = ?');
      params.push(orden);
    }
    if (activa !== undefined) {
      updates.push('activa = ?');
      params.push(activa);
    }

    if (updates.length > 0) {
      params.push(id);
      await dbAsync.run(
        `UPDATE categorias SET ${updates.join(', ')} WHERE id = ?`,
        params
      );
    }

    // Invalidate all category caches
    const cache = getCacheManager();
    await cache.clearPrefix(cacheConfig.PREFIXES.CATEGORIES);
    await cache.clearPrefix(cacheConfig.PREFIXES.PRODUCTS);
    await cache.publishInvalidation(cacheConfig.EVENTS.CATEGORIES_UPDATED);

    return await dbAsync.get('SELECT * FROM categorias WHERE id = ?', [id]);
  }

  /**
   * Delete category
   */
  async delete(id) {
    await dbAsync.run('DELETE FROM categorias WHERE id = ?', [id]);

    // Invalidate caches
    const cache = getCacheManager();
    await cache.clearPrefix(cacheConfig.PREFIXES.CATEGORIES);
    await cache.clearPrefix(cacheConfig.PREFIXES.PRODUCTS);
    await cache.publishInvalidation(cacheConfig.EVENTS.CATEGORIES_UPDATED);

    return true;
  }
}

module.exports = new CategoriesService();
