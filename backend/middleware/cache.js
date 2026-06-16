/**
 * Middleware de caché para respuestas HTTP
 * Almacena respuestas en memoria para servir más rápido
 *
 * Uso:
 * router.get('/', cacheMiddleware('categorias', 600), async (req, res) => { ... })
 */

const cacheService = require('../services/cacheService');
const logger = require('../config/logger');

/**
 * Middleware que cachea respuestas JSON
 * @param {string} cacheKey - Clave del caché (ej: 'categorias_public')
 * @param {number} ttl - Tiempo de vida en segundos (default: 600 = 10 min)
 * @returns {function} Middleware express
 */
const cacheMiddleware = (cacheKey, ttl = 600) => {
  return (req, res, next) => {
    // Solo cachear GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Intentar obtener del caché
    const cachedData = cacheService.get(cacheKey);
    if (cachedData) {
      logger.debug(`Cache HIT: ${cacheKey}`);
      return res.json(cachedData);
    }

    logger.debug(`Cache MISS: ${cacheKey}`);

    // Guardar el método original de res.json
    const originalJson = res.json.bind(res);

    // Reemplazar res.json para interceptar la respuesta
    res.json = function(data) {
      // Solo cachear respuestas exitosas
      if (data.success !== false && !data.error) {
        cacheService.set(cacheKey, data, ttl);
        logger.debug(`Cache SET: ${cacheKey} (TTL: ${ttl}s)`);
      }
      return originalJson(data);
    };

    next();
  };
};

/**
 * Invalida una clave de caché específica
 * Útil para actualizar caché después de INSERT/UPDATE/DELETE
 *
 * @param {string} key - Clave a invalidar
 */
const invalidateCache = (key) => {
  cacheService.del(key);
  logger.debug(`Cache INVALIDATE: ${key}`);
};

/**
 * Invalida múltiples claves que coincidan con un patrón
 * @param {string} pattern - Patrón a buscar en las claves (ej: 'categorias')
 */
const invalidateCachePattern = (pattern) => {
  // Obtener todas las claves
  const cache = require('../services/cacheService');

  // Iterar sobre las claves y eliminar las que coincidan
  try {
    // Nota: node-cache no expone directamente las claves, pero el servicio podría mejorarse
    // Por ahora, invalidamos manualmente las claves principales
    const keysToInvalidate = [
      `${pattern}_public`,
      `${pattern}_admin`,
      `${pattern}_list`,
      pattern
    ];

    keysToInvalidate.forEach(key => {
      cacheService.del(key);
    });

    logger.debug(`Cache INVALIDATE PATTERN: ${pattern}`);
  } catch (error) {
    logger.error(`Error invalidating cache pattern ${pattern}:`, error.message);
  }
};

module.exports = {
  cacheMiddleware,
  invalidateCache,
  invalidateCachePattern
};
