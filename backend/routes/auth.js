const express = require('express');
const router = express.Router();
const dbAsync = require('../config/database-promise');
const authService = require('../services/authService');
const validate = require('../middleware/validate');
const schemas = require('../schemas');
const { verificarJWT } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimiter');
const AppError = require('../errors/AppError');

// POST /api/admin/login
router.post('/login', loginLimiter, validate(schemas.loginSchema), async (req, res, next) => {
  try {
    const { usuario, password } = req.validatedBody;

    // Verificar credenciales directamente
    const bcrypt = require('bcryptjs');
    const admin = await dbAsync.get(
      'SELECT id, usuario, email FROM admins WHERE usuario = ? AND activo = 1',
      [usuario]
    );

    if (!admin) {
      return res.status(401).json({ success: false, error: 'Credenciales incorrectas.' });
    }

    // Obtener hash para comparar
    const adminFull = await dbAsync.get(
      'SELECT password_hash FROM admins WHERE id = ?',
      [admin.id]
    );

    const isMatch = await bcrypt.compare(password, adminFull.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Credenciales incorrectas.' });
    }

    // Actualizar last_login
    await dbAsync.run(
      'UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
      [admin.id]
    );

    // Generar token JWT simple
    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      { id: admin.id, usuario: admin.usuario, email: admin.email },
      process.env.JWT_SECRET || 'fallback-secret-key-change-in-env',
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      message: 'Inicio de sesión exitoso.',
      token,
      admin: { id: admin.id, usuario: admin.usuario, email: admin.email }
    });
  } catch (error) {
    console.error('[Login] Error:', error.message);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// GET /api/admin/verify (Verificar si el token actual es válido)
router.get('/verify', verificarJWT, (req, res) => {
  res.json({
    success: true,
    message: 'Token válido.',
    admin: req.admin
  });
});

// POST /api/admin/logout
router.post('/logout', (req, res) => {
  res.clearCookie('authToken');
  res.json({
    success: true,
    message: 'Sesión cerrada con éxito.'
  });
});

// ─── AUXILIAR LOGIN ───────────────────────────────────────────────
router.post('/auxiliar/login', loginLimiter, validate(schemas.loginSchema), async (req, res, next) => {
  try {
    const { usuario, password } = req.validatedBody;
    const bcrypt = require('bcryptjs');
    const jwt = require('jsonwebtoken');

    const auxiliar = await dbAsync.get(
      'SELECT * FROM auxiliares_venta WHERE usuario = ? AND activo = 1',
      [usuario]
    );

    if (!auxiliar) {
      return res.status(401).json({ success: false, error: 'Credenciales incorrectas.' });
    }

    const isMatch = await bcrypt.compare(password, auxiliar.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Credenciales incorrectas.' });
    }

    await dbAsync.run(
      'UPDATE auxiliares_venta SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
      [auxiliar.id]
    );

    const token = jwt.sign(
      { id: auxiliar.id, usuario: auxiliar.usuario, nombre: auxiliar.nombre, role: 'auxiliar' },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      user: { id: auxiliar.id, usuario: auxiliar.usuario, nombre: auxiliar.nombre }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
