const dbAsync = require('../config/database-promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const AppError = require('../errors/AppError');
const env = require('../config/env');

class AuthService {
  async login(usuario, password) {
    const admin = await dbAsync.get(
      'SELECT * FROM admins WHERE usuario = ? AND activo = 1',
      [usuario]
    );

    if (!admin) {
      throw new AppError('Credenciales incorrectas.', 401);
    }

    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) {
      throw new AppError('Credenciales incorrectas.', 401);
    }

    await dbAsync.run(
      'UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
      [admin.id]
    );

    const token = jwt.sign(
      { id: admin.id, usuario: admin.usuario, email: admin.email },
      env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    return {
      token,
      admin: { id: admin.id, usuario: admin.usuario, email: admin.email }
    };
  }
}

module.exports = new AuthService();
