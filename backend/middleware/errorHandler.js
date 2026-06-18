const logger = require('../config/logger');

const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  
  // Log estructurado
  logger.error({
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    statusCode: err.statusCode,
    message: err.message,
    stack: err.stack,
    userId: req.admin?.id
  });
  
  const response = {
    success: false,
    message: err.statusCode === 500 ? 'Error interno del servidor' : err.message
  };

  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
    response.message = err.message; // always show actual error message in dev
  }

  // DEBUG TEMPORAL: exponer error real con header secreto (?debug=puro2026)
  if (req.query.debug === 'puro2026' || req.headers['x-debug'] === 'puro2026') {
    response.realMessage = err.message;
    response.stack = err.stack;
  }
  
  res.status(err.statusCode).json(response);
};

module.exports = errorHandler;
