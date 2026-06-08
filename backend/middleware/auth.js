const jwt = require('jsonwebtoken');

function verificarJWT(req, res, next) {
  // Intentar obtener el token de las cabeceras o de las cookies
  let token = req.headers['authorization'];
  
  if (token && token.startsWith('Bearer ')) {
    token = token.slice(7, token.length);
  } else if (req.cookies && req.cookies.authToken) {
    token = req.cookies.authToken;
  }

  // También permitir que el token venga en los query params o cuerpo por comodidad (opcional, pero Authorization o cookie es mejor)
  if (!token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'Acceso denegado. No se proporcionó un token de autenticación.' 
    });
  }

  try {
    const secret = process.env.JWT_SECRET || 'puro_sabor_secreto_super_seguro_2026';
    const decoded = jwt.verify(token, secret);
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
