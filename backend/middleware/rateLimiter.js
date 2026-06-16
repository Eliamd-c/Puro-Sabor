const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // Limitar a 5 intentos de login por IP cada 15 min
  message: {
    success: false,
    message: 'Demasiados intentos de login. Intenta en 15 minutos.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 60, // Limitar cada IP a 60 requests por minuto
  message: {
    success: false,
    message: 'Demasiadas solicitudes a la API. Intenta más tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = { loginLimiter, apiLimiter };
