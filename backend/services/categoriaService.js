const dbAsync = require('../config/database-promise');
const AppError = require('../errors/AppError');
const cacheService = require('./cacheService');

const CACHE_KEY = 'categorias_activas';

class CategoriaService {
  async getAll() {
    const cached = cacheService.get(CACHE_KEY);
    if (cached) return cached;

    const categorias = await dbAsync.all('SELECT * FROM categorias WHERE activa = 1 ORDER BY orden');
    cacheService.set(CACHE_KEY, categorias);
    return categorias;
  }

  async getAllAdmin() {
    return await dbAsync.all('SELECT * FROM categorias ORDER BY orden');
  }

  async create(data) {
    const { nombre, descripcion, orden } = data;
    const result = await dbAsync.run(
      'INSERT INTO categorias (nombre, descripcion, orden) VALUES (?, ?, ?)',
      [nombre, descripcion, orden || 0]
    );
    cacheService.del(CACHE_KEY);
    return await dbAsync.get('SELECT * FROM categorias WHERE id = ?', [result.lastID]);
  }

  async update(id, data) {
    const { nombre, descripcion, orden, activa } = data;
    await dbAsync.run(
      'UPDATE categorias SET nombre = ?, descripcion = ?, orden = ?, activa = ? WHERE id = ?',
      [nombre, descripcion, orden, activa, id]
    );
    cacheService.del(CACHE_KEY);
    return await dbAsync.get('SELECT * FROM categorias WHERE id = ?', [id]);
  }

  async delete(id) {
    const count = await dbAsync.get('SELECT COUNT(*) as count FROM productos WHERE categoria_id = ?', [id]);
    if (count.count > 0) {
      throw new AppError('No se puede eliminar la categoría porque tiene productos asociados.', 400);
    }
    await dbAsync.run('DELETE FROM categorias WHERE id = ?', [id]);
    cacheService.del(CACHE_KEY);
    return true;
  }
}

module.exports = new CategoriaService();
