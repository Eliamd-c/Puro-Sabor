const express = require('express');
const router = express.Router();
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

module.exports = router;
