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
    const result = await authService.login(usuario, password);
    
    // Cookie configurable para mayor comodidad
    res.cookie('authToken', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000 // 24 horas
    });

    res.json({
      success: true,
      message: 'Inicio de sesión exitoso.',
      ...result
    });
  } catch (error) {
    next(error);
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

// ENDPOINT TEMPORAL: Crear nuevo admin
router.post('/create-admin', async (req, res, next) => {
  try {
    const { usuario, password, email } = req.body;
    if (!usuario || !password) {
      return res.status(400).json({ success: false, message: 'Usuario y contraseña requeridos.' });
    }

    const bcrypt = require('bcryptjs');
    const passwordHash = await bcrypt.hash(password, 10);

    await dbAsync.run(
      `INSERT INTO admins (usuario, password_hash, email, activo)
       VALUES (?, ?, ?, 1)`,
      [usuario, passwordHash, email || '']
    );

    res.json({
      success: true,
      message: `Admin "${usuario}" creado exitosamente.`,
      credentials: { usuario, password }
    });
  } catch (error) {
    if (error.message.includes('duplicate')) {
      return res.status(400).json({ success: false, message: 'El usuario ya existe.' });
    }
    next(error);
  }
});

module.exports = router;
