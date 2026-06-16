const NodeCache = require('node-cache');

// TTL por defecto: 1 hora (3600 segundos)
// Chequeo de expiración cada 10 minutos (600 segundos)
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

class CacheService {
  get(key) {
    return cache.get(key);
  }

  set(key, value, ttl = 3600) {
    return cache.set(key, value, ttl);
  }

  del(key) {
    return cache.del(key);
  }

  flush() {
    return cache.flushAll();
  }
}

module.exports = new CacheService();
