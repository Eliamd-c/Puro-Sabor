/**
 * Error Handler Module
 *
 * Define custom error classes and error handling utilities:
 * - DatabaseError (recoverable) - retry with backoff
 * - NetworkError (recoverable) - retry or fallback to cache
 * - TimeoutError (recoverable) - retry
 * - RateLimitError (recoverable) - wait and retry
 * - ValidationError (non-recoverable) - return 400
 * - AuthenticationError (non-recoverable) - return 401
 * - AuthorizationError (non-recoverable) - return 403
 * - NotFoundError (non-recoverable) - return 404
 * - InternalServerError (non-recoverable) - return 500
 */

const logger = require('../config/logger');

/**
 * Base Error Class
 */
class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();
    this.context = {};

    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Add context to error for debugging
   */
  addContext(key, value) {
    this.context[key] = value;
    return this;
  }

  /**
   * Convert to JSON for logging
   */
  toJSON() {
    return {
      name: this.constructor.name,
      message: this.message,
      statusCode: this.statusCode,
      isOperational: this.isOperational,
      timestamp: this.timestamp,
      context: this.context,
      stack: process.env.NODE_ENV === 'development' ? this.stack : undefined
    };
  }
}

/**
 * Recoverable Errors (should retry)
 */

class DatabaseError extends AppError {
  constructor(message, originalError = null) {
    super(message, 503, true); // Service Unavailable
    this.recoverable = true;
    this.originalError = originalError;
    this.retryAfter = 1000; // Start with 1s backoff
  }
}

class NetworkError extends AppError {
  constructor(message, originalError = null) {
    super(message, 503, true);
    this.recoverable = true;
    this.originalError = originalError;
    this.retryAfter = 1000;
    this.canUseFallback = true; // Can fallback to cache
  }
}

class TimeoutError extends AppError {
  constructor(message, duration = 30000) {
    super(`Request timeout after ${duration}ms: ${message}`, 504, true);
    this.recoverable = true;
    this.duration = duration;
    this.retryAfter = 2000; // Start with 2s backoff
  }
}

class RateLimitError extends AppError {
  constructor(limit, window, retryAfter = 60000) {
    super(`Rate limit exceeded: ${limit} requests per ${window}ms`, 429, true);
    this.recoverable = true;
    this.limit = limit;
    this.window = window;
    this.retryAfter = retryAfter;
    this.canUseFallback = true;
  }
}

/**
 * Non-Recoverable Errors (should not retry)
 */

class ValidationError extends AppError {
  constructor(message, field = null) {
    super(message, 400, true);
    this.recoverable = false;
    this.field = field;
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, true);
    this.recoverable = false;
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, true);
    this.recoverable = false;
  }
}

class NotFoundError extends AppError {
  constructor(resource, id = null) {
    const msg = id ? `${resource} with id ${id} not found` : `${resource} not found`;
    super(msg, 404, true);
    this.recoverable = false;
    this.resource = resource;
    this.id = id;
  }
}

class ConflictError extends AppError {
  constructor(message) {
    super(message, 409, true);
    this.recoverable = false;
  }
}

class InternalServerError extends AppError {
  constructor(message, originalError = null) {
    super(message, 500, false); // Not operational - should alert
    this.recoverable = false;
    this.originalError = originalError;
  }
}

/**
 * Structured Logger for errors
 */
class ErrorLogger {
  /**
   * Log error with context
   */
  static log(error, context = {}) {
    const errorObj = {
      name: error.constructor.name,
      message: error.message,
      statusCode: error.statusCode || 500,
      recoverable: error.recoverable ?? false,
      timestamp: new Date().toISOString(),
      context: {
        ...error.context,
        ...context
      }
    };

    if (error.statusCode >= 500) {
      logger.error(JSON.stringify(errorObj));
    } else {
      logger.warn(JSON.stringify(errorObj));
    }

    return errorObj;
  }

  /**
   * Check if error is recoverable and can retry
   */
  static isRecoverable(error) {
    return error.recoverable === true || error.retryAfter !== undefined;
  }

  /**
   * Get retry delay in milliseconds
   */
  static getRetryDelay(error, attemptNumber = 0) {
    if (error instanceof RateLimitError) {
      return error.retryAfter;
    }

    if (error.retryAfter) {
      // Exponential backoff: retryAfter * 2^attempt
      return Math.min(
        error.retryAfter * Math.pow(2, attemptNumber),
        30000 // Cap at 30 seconds
      );
    }

    return null;
  }

  /**
   * Check if error can fallback to cache
   */
  static canUseFallback(error) {
    return error.canUseFallback === true;
  }
}

/**
 * Try-Catch Wrapper for async functions
 *
 * Usage:
 *   const result = await asyncWrapper(
 *     () => someAsyncFunction(),
 *     { context: { operation: 'fetchUser' } }
 *   );
 */
async function asyncWrapper(asyncFn, options = {}) {
  try {
    return await asyncFn();
  } catch (err) {
    const error = normalizeError(err);
    ErrorLogger.log(error, options.context);

    if (options.fallback && ErrorLogger.canUseFallback(error)) {
      return options.fallback();
    }

    throw error;
  }
}

/**
 * Normalize various error types to AppError
 */
function normalizeError(err) {
  if (err instanceof AppError) {
    return err;
  }

  // PostgreSQL/Database errors
  if (err.code === 'ECONNREFUSED') {
    return new DatabaseError('Database connection refused', err);
  }

  if (err.code === 'ETIMEDOUT') {
    return new TimeoutError('Connection timeout', err);
  }

  if (err.name === 'PostgresError' || err.severity) {
    return new DatabaseError(`Database error: ${err.message}`, err);
  }

  // Network errors
  if (err.code === 'ENOTFOUND' || err.code === 'ECONNRESET') {
    return new NetworkError(`Network error: ${err.message}`, err);
  }

  // Timeout errors
  if (err.name === 'TimeoutError' || err.code === 'ETIMEDOUT') {
    return new TimeoutError(err.message, err);
  }

  // Default to internal server error
  return new InternalServerError(err.message || 'Unknown error', err);
}

/**
 * Express error middleware
 * Place at the end of all other middlewares
 */
function errorMiddleware(err, req, res, next) {
  const error = normalizeError(err);

  ErrorLogger.log(error, {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('user-agent')
  });

  res.status(error.statusCode).json({
    success: false,
    error: {
      name: error.constructor.name,
      message: error.message,
      statusCode: error.statusCode,
      ...(process.env.NODE_ENV === 'development' && { context: error.context })
    }
  });
}

/**
 * Cache wrapper for queries with fallback
 *
 * Usage:
 *   const result = await cachedQuery(
 *     () => db.query('SELECT ...'),
 *     'users:all',
 *     300000 // 5 minutes cache
 *   );
 */
const queryCache = new Map();

async function cachedQuery(queryFn, cacheKey, cacheTTL = 300000) {
  // Check cache
  if (queryCache.has(cacheKey)) {
    const cached = queryCache.get(cacheKey);
    if (Date.now() - cached.timestamp < cacheTTL) {
      return cached.data;
    }
    queryCache.delete(cacheKey);
  }

  try {
    const result = await queryFn();

    // Cache result
    queryCache.set(cacheKey, {
      data: result,
      timestamp: Date.now()
    });

    return result;
  } catch (err) {
    const error = normalizeError(err);

    // Try fallback to stale cache
    if (ErrorLogger.canUseFallback(error) && queryCache.has(cacheKey)) {
      const cached = queryCache.get(cacheKey);
      logger.warn(`Using stale cache for ${cacheKey}: ${error.message}`);
      return cached.data;
    }

    throw error;
  }
}

/**
 * Clear cache
 */
function clearCache(pattern = null) {
  if (!pattern) {
    queryCache.clear();
    return;
  }

  for (const key of queryCache.keys()) {
    if (key.includes(pattern)) {
      queryCache.delete(key);
    }
  }
}

module.exports = {
  // Error classes
  AppError,
  DatabaseError,
  NetworkError,
  TimeoutError,
  RateLimitError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  InternalServerError,

  // Utilities
  ErrorLogger,
  asyncWrapper,
  normalizeError,
  errorMiddleware,
  cachedQuery,
  clearCache
};
