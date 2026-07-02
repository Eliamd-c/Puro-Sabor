/**
 * Multi-Level Cache Manager
 * FASE 3.3: L1 Redis + L2 Memory cache with smart invalidation
 *
 * Cache hierarchy:
 * 1. L2 Memory cache (fastest, local)
 * 2. L1 Redis cache (fast, distributed)
 * 3. Database (source of truth)
 *
 * All layers have TTL-based expiration
 */

const NodeCache = require('node-cache');
const cacheConfig = require('../config/cache-config');
const redisClient = require('../config/redis-client');

class CacheManager {
  constructor() {
    // L2: Node.js memory cache (fast local access)
    this.memoryCache = new NodeCache({
      stdTTL: 60,              // 60s default TTL
      checkperiod: 120,        // Check every 2min
      maxKeys: cacheConfig.MEMORY_CACHE.MAX_SIZE,
      useClones: true          // Deep clone to prevent mutations
    });

    // Statistics tracking
    this.stats = {
      l1Hits: 0,               // Redis cache hits
      l2Hits: 0,               // Memory cache hits
      l3Hits: 0,               // Database hits (misses)
      totalRequests: 0,
      l1HitTime: [],
      l2HitTime: [],
      l3HitTime: []
    };

    // Event subscriptions for cache invalidation
    this.subscribers = new Map();
    this.setupInvalidationListeners();
  }

  /**
   * Get value from cache hierarchy
   * Returns: { value, source, time }
   */
  async get(key, ttl = null) {
    const startTime = Date.now();
    this.stats.totalRequests++;

    // L2: Check memory cache first (fastest)
    const l2Value = this.memoryCache.get(key);
    if (l2Value !== undefined) {
      this.stats.l2Hits++;
      const hitTime = Date.now() - startTime;
      this.stats.l2HitTime.push(hitTime);
      return { value: l2Value, source: 'L2-memory', time: hitTime };
    }

    // L1: Check Redis cache (distributed)
    try {
      const l1Value = await redisClient.get(key);
      if (l1Value !== null) {
        this.stats.l1Hits++;
        const hitTime = Date.now() - startTime;
        this.stats.l1HitTime.push(hitTime);

        // Populate L2 with L1 value (promote to memory)
        if (ttl) {
          this.memoryCache.set(key, l1Value, ttl);
        }

        return { value: l1Value, source: 'L1-redis', time: hitTime };
      }
    } catch (err) {
      console.warn('[Cache] Redis get error (falling through):', err.message);
    }

    // L3: Miss - return null, caller should query DB
    this.stats.l3Hits++;
    return { value: null, source: 'L3-miss', time: Date.now() - startTime };
  }

  /**
   * Set value in cache hierarchy
   * Populates both L1 (Redis) and L2 (Memory)
   */
  async set(key, value, ttl) {
    if (!ttl) {
      console.warn('[Cache] No TTL provided for key:', key);
      return;
    }

    try {
      // L2: Set in memory cache
      this.memoryCache.set(key, value, ttl);

      // L1: Set in Redis (with TTL)
      await redisClient.set(key, value, ttl);
    } catch (err) {
      console.error('[Cache] Error setting cache:', err.message);
      // Silently fail - memory cache is still populated
    }
  }

  /**
   * Delete from all cache levels
   */
  async delete(key) {
    try {
      // L2: Remove from memory
      this.memoryCache.del(key);

      // L1: Remove from Redis
      await redisClient.del(key);
    } catch (err) {
      console.warn('[Cache] Error deleting from cache:', err.message);
    }
  }

  /**
   * Clear entire cache for a prefix
   * Example: clearPrefix('cache:products') clears all product caches
   */
  async clearPrefix(prefix) {
    try {
      // L2: Clear from memory cache
      const keys = this.memoryCache.keys();
      const matchingKeys = keys.filter(k => k.startsWith(prefix));
      matchingKeys.forEach(k => this.memoryCache.del(k));

      // L1: Clear from Redis (scan for matching keys)
      // Note: This is inefficient in large Redis instances
      // but necessary for cache invalidation
      const redisKeys = keys.filter(k => k.startsWith(prefix));
      for (const key of redisKeys) {
        await redisClient.del(key);
      }

      console.log(`[Cache] Cleared ${matchingKeys.length} keys with prefix: ${prefix}`);
    } catch (err) {
      console.error('[Cache] Error clearing prefix:', err.message);
    }
  }

  /**
   * Clear all caches
   */
  async clearAll() {
    try {
      this.memoryCache.flushAll();
      console.log('[Cache] Cleared all memory cache');

      // Publish event for cluster-wide cache clear
      await this.publishInvalidation(cacheConfig.EVENTS.FULL_CACHE_CLEAR);
    } catch (err) {
      console.error('[Cache] Error clearing all caches:', err.message);
    }
  }

  /**
   * Publish cache invalidation event to other cluster nodes
   */
  async publishInvalidation(event, data = {}) {
    try {
      await redisClient.publish(event, JSON.stringify(data));
    } catch (err) {
      console.warn('[Cache] Error publishing invalidation:', err.message);
    }
  }

  /**
   * Setup cache invalidation listeners (cluster sync)
   */
  setupInvalidationListeners() {
    const invalidationHandler = (event, handler) => {
      try {
        redisClient.subscribe(event, async (message) => {
          const data = JSON.parse(message);
          await handler(data);
        });
        this.subscribers.set(event, handler);
      } catch (err) {
        console.warn('[Cache] Error setting up listener for', event, ':', err.message);
      }
    };

    // Handle menu updates
    invalidationHandler(cacheConfig.EVENTS.MENU_UPDATED, async () => {
      await this.clearPrefix(cacheConfig.PREFIXES.MENU);
    });

    // Handle product updates
    invalidationHandler(cacheConfig.EVENTS.PRODUCTS_UPDATED, async () => {
      await this.clearPrefix(cacheConfig.PREFIXES.PRODUCTS);
    });

    // Handle category updates
    invalidationHandler(cacheConfig.EVENTS.CATEGORIES_UPDATED, async () => {
      await this.clearPrefix(cacheConfig.PREFIXES.CATEGORIES);
    });

    // Handle inventory updates
    invalidationHandler(cacheConfig.EVENTS.INVENTORY_UPDATED, async () => {
      await this.clearPrefix(cacheConfig.PREFIXES.INVENTORY);
    });

    // Handle promotions updates
    invalidationHandler(cacheConfig.EVENTS.PROMOTIONS_UPDATED, async () => {
      await this.clearPrefix(cacheConfig.PREFIXES.PROMOTIONS);
    });

    // Handle full cache clear
    invalidationHandler(cacheConfig.EVENTS.FULL_CACHE_CLEAR, async () => {
      this.memoryCache.flushAll();
      console.log('[Cache] Full cache cleared via cluster event');
    });
  }

  /**
   * Cache warmer - pre-load frequently used data on startup
   */
  async warmCache(queryFunctions) {
    console.log('[Cache] Starting cache warming...');
    const startTime = Date.now();

    for (const [name, queryFn, ttl] of queryFunctions) {
      try {
        const data = await queryFn();
        const cacheKey = `${cacheConfig.PREFIXES.MENU}:${name}`;
        await this.set(cacheKey, data, ttl);
        console.log(`[Cache] ✅ Warmed: ${name}`);
      } catch (err) {
        console.warn(`[Cache] ⚠️ Failed to warm ${name}:`, err.message);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[Cache] Cache warming complete (${duration}ms)`);
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.stats.totalRequests;
    const l2Rate = total > 0 ? (this.stats.l2Hits / total * 100).toFixed(2) : 0;
    const l1Rate = total > 0 ? (this.stats.l1Hits / total * 100).toFixed(2) : 0;
    const hitRate = total > 0 ? ((this.stats.l1Hits + this.stats.l2Hits) / total * 100).toFixed(2) : 0;

    const avgL1Time = this.stats.l1HitTime.length > 0
      ? (this.stats.l1HitTime.reduce((a, b) => a + b, 0) / this.stats.l1HitTime.length).toFixed(2)
      : 0;

    const avgL2Time = this.stats.l2HitTime.length > 0
      ? (this.stats.l2HitTime.reduce((a, b) => a + b, 0) / this.stats.l2HitTime.length).toFixed(2)
      : 0;

    const avgL3Time = this.stats.l3HitTime.length > 0
      ? (this.stats.l3HitTime.reduce((a, b) => a + b, 0) / this.stats.l3HitTime.length).toFixed(2)
      : 0;

    return {
      totalRequests: total,
      hits: this.stats.l1Hits + this.stats.l2Hits,
      misses: this.stats.l3Hits,
      hitRate: `${hitRate}%`,
      distribution: {
        l2Memory: `${l2Rate}%`,
        l1Redis: `${l1Rate}%`,
        l3Database: `${(100 - l2Rate - l1Rate).toFixed(2)}%`
      },
      timing: {
        l2AvgMs: avgL2Time,
        l1AvgMs: avgL1Time,
        l3AvgMs: avgL3Time
      },
      memory: {
        cacheKeys: this.memoryCache.keys().length,
        maxKeys: cacheConfig.MEMORY_CACHE.MAX_SIZE,
        stats: this.memoryCache.getStats()
      }
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      l1Hits: 0,
      l2Hits: 0,
      l3Hits: 0,
      totalRequests: 0,
      l1HitTime: [],
      l2HitTime: [],
      l3HitTime: []
    };
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      // Test L2 (memory)
      const testKey = '__cache_health_check__';
      this.memoryCache.set(testKey, 'ok', 10);
      const l2Health = this.memoryCache.get(testKey) === 'ok' ? 'ok' : 'error';
      this.memoryCache.del(testKey);

      // Test L1 (Redis)
      await redisClient.set(testKey, 'ok', 10);
      const l1Value = await redisClient.get(testKey);
      const l1Health = l1Value === 'ok' ? 'ok' : 'error';
      await redisClient.del(testKey);

      return {
        status: l2Health === 'ok' && l1Health === 'ok' ? 'healthy' : 'degraded',
        l1Redis: l1Health,
        l2Memory: l2Health
      };
    } catch (err) {
      return {
        status: 'unhealthy',
        error: err.message
      };
    }
  }
}

// Singleton instance
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new CacheManager();
  }
  return instance;
}

module.exports = {
  getInstance,
  CacheManager
};
