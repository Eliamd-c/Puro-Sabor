const logger = require('../config/logger');
const fs = require('fs');
const path = require('path');
const { normalizeError, ErrorLogger } = require('../utils/errorHandler');

/**
 * Enhanced Error Handler Middleware
 * Handles all error types with proper logging, retry info, and structured JSON
 */
const errorHandler = (err, req, res, next) => {
  // Normalize error to AppError
  const error = normalizeError(err);

  // Structured logging with context
  const errorContext = {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    userId: req.admin?.id,
    recoverable: error.recoverable
  };

  ErrorLogger.log(error, errorContext);

  // Write 500 errors to dedicated log file
  if (error.statusCode >= 500) {
    try {
      const logDir = path.join(__dirname, '..', '..', 'logs');
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

      const linea = `[${new Date().toISOString()}] ${error.constructor.name}\n` +
        `${req.method} ${req.url}\n` +
        `Message: ${error.message}\n` +
        `${error.stack}\n\n`;

      fs.appendFileSync(path.join(logDir, 'errores500.log'), linea);
    } catch (e) { /* ignore file write errors */ }
  }

  // Prepare response
  const response = {
    success: false,
    error: {
      name: error.constructor.name,
      message: error.statusCode === 500 ? 'Error interno del servidor' : error.message,
      statusCode: error.statusCode,
      recoverable: error.recoverable,
      ...(error.recoverable && { retryAfter: ErrorLogger.getRetryDelay(error) })
    }
  };

  // Include context in development
  if (process.env.NODE_ENV === 'development') {
    response.error.context = error.context;
    response.error.stack = error.stack;
  }

  // Debug mode (with secret header)
  if (req.query.debug === 'puro2026' || req.headers['x-debug'] === 'puro2026') {
    response.debug = {
      message: error.message,
      stack: error.stack,
      context: error.context
    };
  }

  res.status(error.statusCode).json(response);
};

module.exports = errorHandler;
