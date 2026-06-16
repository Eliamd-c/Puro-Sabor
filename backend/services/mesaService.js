const dbAsync = require('../config/database-promise');
const AppError = require('../errors/AppError');

class MesaService {
  async getAll() {
    return await dbAsync.all("SELECT * FROM sesiones_mesa WHERE estado = 'activa'");
  }

  async getSession(mesaNumero) {
    return await dbAsync.get(
      "SELECT * FROM sesiones_mesa WHERE mesa_numero = ? AND estado = 'activa'",
      [mesaNumero]
    );
  }

  async getSessionById(sessionId) {
    return await dbAsync.get(
      "SELECT * FROM sesiones_mesa WHERE id = ?",
      [sessionId]
    );
  }

  async startSession(mesaNumero, solicitadaPor = 'cliente') {
    const sesionActiva = await this.getSession(mesaNumero);
    if (sesionActiva) {
      throw new AppError('La mesa ya tiene una sesión activa.', 400);
    }
    
    await dbAsync.run(
      "INSERT INTO sesiones_mesa (mesa_numero, estado) VALUES (?, 'activa')",
      [mesaNumero]
    );
    
    return await this.getSession(mesaNumero);
  }

  async closeSession(sessionId, cerradaPor = 'admin') {
    const sesion = await this.getSessionById(sessionId);
    if (!sesion || sesion.estado !== 'activa') {
      throw new AppError('Sesión no encontrada o ya está cerrada.', 404);
    }

    await dbAsync.run(
      "UPDATE sesiones_mesa SET estado = 'cerrada', cerrada_en = CURRENT_TIMESTAMP, cerrada_por = ? WHERE id = ?",
      [cerradaPor, sessionId]
    );
    
    return true;
  }

  async createOrder(mesaNumero, items, total) {
    const sesion = await this.getSession(mesaNumero);
    
    const result = await dbAsync.run(
      `INSERT INTO pedidos (mesa_numero, sesion_id, items_json, total, estado)
       VALUES (?, ?, ?, ?, 'pendiente')`,
      [mesaNumero, sesion ? sesion.id : null, JSON.stringify(items), total]
    );
    
    return result.lastID;
  }
}

module.exports = new MesaService();
