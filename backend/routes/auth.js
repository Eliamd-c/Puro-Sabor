const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { verificarJWT } = require('../middleware/auth');

// POST /api/admin/login
router.post('/login', (req, res) => {
  const { usuario, password } = req.body;

  if (!usuario || !password) {
    return res.status(400).json({ 
      success: false, 
      message: 'Usuario y contraseña son requeridos.' 
    });
  }

  db.get('SELECT * FROM admins WHERE usuario = ? AND activo = 1', [usuario], (err, admin) => {
    if (err) {
      return res.status(500).json({ 
        success: false, 
        message: 'Error en el servidor al buscar administrador.' 
      });
    }

    if (!admin) {
      return res.status(401).json({ 
        success: false, 
        message: 'Credenciales incorrectas.' 
      });
    }

    bcrypt.compare(password, admin.password_hash, (err, isMatch) => {
      if (err) {
        return res.status(500).json({ 
          success: false, 
          message: 'Error en el servidor al verificar contraseña.' 
        });
      }

      if (!isMatch) {
        return res.status(401).json({ 
          success: false, 
          message: 'Credenciales incorrectas.' 
        });
      }

      // Actualizar último login
      db.run('UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [admin.id]);

      // Generar JWT
      const secret = process.env.JWT_SECRET || 'puro_sabor_secreto_super_seguro_2026';
      const token = jwt.sign(
        { id: admin.id, usuario: admin.usuario, email: admin.email },
        secret,
        { expiresIn: '24h' }
      );

      // También podemos configurar una cookie para comodidad
      res.cookie('authToken', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 horas
      });

      res.json({
        success: true,
        message: 'Inicio de sesión exitoso.',
        token,
        admin: {
          id: admin.id,
          usuario: admin.usuario,
          email: admin.email
        }
      });
    });
  });
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
