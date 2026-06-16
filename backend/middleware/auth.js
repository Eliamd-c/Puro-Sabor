const jwt = require('jsonwebtoken');
const env = require('../config/env');

function verificarJWT(req, res, next) {
  // Intentar obtener el token de las cabeceras o de las cookies
  let token = req.headers['authorization'];

  if (token && token.startsWith('Bearer ')) {
    token = token.slice(7, token.length);
  } else if (req.cookies && req.cookies.authToken) {
    token = req.cookies.authToken;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Acceso denegado. No se proporcionó un token de autenticación.'
    });
  }

  try {
    // JWT_SECRET ya está validado en env.js
    const decoded = jwt.verify(token, env.JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Token inválido o expirado.'
    });
  }
}

module.exports = {
  verificarJWT
};
