/**
 * Redis Client Configuration
 *
 * Manages Redis connection for:
 * - Shared state between cluster nodes
 * - Admin whitelist synchronization
 * - Media whitelist caching
 * - Session management
 * - Pub/Sub for inter-bot communication
 */

const redis = require('redis');
const logger = require('./logger');

class RedisClient {
  constructor() {
    this.client = null;
    this.connected = false;
    this.retryAttempts = 0;
    this.maxRetries = 5;
  }

  /**
   * Initialize Redis connection
   */
  async initialize(options = {}) {
    try {
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
      const defaultOptions = {
        url: redisUrl,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > this.maxRetries) {
              logger.error('[Redis] Max retries exceeded, giving up');
              return new Error('Redis max retries exceeded');
            }
            const delay = Math.min(retries * 100, 3000);
            logger.warn(`[Redis] Reconnecting (attempt ${retries})...`);
            return delay;
          }
        }
      };

      this.client = redis.createClient({ ...defaultOptions, ...options });

      this.client.on('error', (err) => {
        logger.error('[Redis] Connection error:', err.message);
        this.connected = false;
      });

      this.client.on('connect', () => {
        logger.info('[Redis] Connected successfully');
        this.connected = true;
        this.retryAttempts = 0;
      });

      this.client.on('reconnecting', () => {
        this.retryAttempts++;
        logger.warn(`[Redis] Reconnecting (attempt ${this.retryAttempts})`);
      });

      await this.client.connect();
      logger.info('[Redis] Redis client initialized');
      return this.client;
    } catch (err) {
      logger.error('[Redis] Failed to initialize:', err.message);
      throw err;
    }
  }

  /**
   * Set key-value with optional expiry
   */
  async set(key, value, expirySeconds = null) {
    if (!this.client || !this.connected) {
      throw new Error('Redis not connected');
    }

    try {
      if (typeof value === 'object') {
        value = JSON.stringify(value);
      }

      if (expirySeconds) {
        await this.client.setEx(key, expirySeconds, value);
      } else {
        await this.client.set(key, value);
      }

      return true;
    } catch (err) {
      logger.error(`[Redis] Set failed for key ${key}:`, err.message);
      throw err;
    }
  }

  /**
   * Get value by key
   */
  async get(key) {
    if (!this.client || !this.connected) {
      throw new Error('Redis not connected');
    }

    try {
      const value = await this.client.get(key);

      if (!value) return null;

      try {
        return JSON.parse(value);
      } catch (e) {
        return value;
      }
    } catch (err) {
      logger.error(`[Redis] Get failed for key ${key}:`, err.message);
      throw err;
    }
  }

  /**
   * Delete key
   */
  async del(key) {
    if (!this.client || !this.connected) {
      throw new Error('Redis not connected');
    }

    try {
      return await this.client.del(key);
    } catch (err) {
      logger.error(`[Redis] Delete failed for key ${key}:`, err.message);
      throw err;
    }
  }

  /**
   * Check if key exists
   */
  async exists(key) {
    if (!this.client || !this.connected) {
      throw new Error('Redis not connected');
    }

    try {
      return await this.client.exists(key);
    } catch (err) {
      logger.error(`[Redis] Exists check failed for key ${key}:`, err.message);
      throw err;
    }
  }

  /**
   * Increment counter
   */
  async incr(key) {
    if (!this.client || !this.connected) {
      throw new Error('Redis not connected');
    }

    try {
      return await this.client.incr(key);
    } catch (err) {
      logger.error(`[Redis] Increment failed for key ${key}:`, err.message);
      throw err;
    }
  }

  /**
   * Acquire lock with timeout
   */
  async acquireLock(lockKey, lockValue, timeoutSeconds = 30) {
    if (!this.client || !this.connected) {
      throw new Error('Redis not connected');
    }

    try {
      const result = await this.client.set(
        lockKey,
        lockValue,
        {
          NX: true, // Only set if not exists
          EX: timeoutSeconds // Expire after timeout
        }
      );

      return result !== null; // true if lock acquired
    } catch (err) {
      logger.error(`[Redis] Lock acquisition failed for ${lockKey}:`, err.message);
      throw err;
    }
  }

  /**
   * Release lock (only if owned by this instance)
   */
  async releaseLock(lockKey, lockValue) {
    if (!this.client || !this.connected) {
      throw new Error('Redis not connected');
    }

    try {
      const currentValue = await this.get(lockKey);

      if (currentValue === lockValue) {
        await this.del(lockKey);
        return true;
      }

      return false; // Lock not owned by us
    } catch (err) {
      logger.error(`[Redis] Lock release failed for ${lockKey}:`, err.message);
      throw err;
    }
  }

  /**
   * Publish message to channel
   */
  async publish(channel, message) {
    if (!this.client || !this.connected) {
      logger.warn('[Redis] Cannot publish - not connected');
      return 0;
    }

    try {
      if (typeof message === 'object') {
        message = JSON.stringify(message);
      }

      return await this.client.publish(channel, message);
    } catch (err) {
      logger.error(`[Redis] Publish failed to ${channel}:`, err.message);
      throw err;
    }
  }

  /**
   * Subscribe to channel
   */
  async subscribe(channel, callback) {
    if (!this.client || !this.connected) {
      throw new Error('Redis not connected');
    }

    try {
      const subscriber = this.client.duplicate();
      await subscriber.connect();

      await subscriber.subscribe(channel, (message) => {
        try {
          const parsed = JSON.parse(message);
          callback(parsed);
        } catch (e) {
          callback(message);
        }
      });

      logger.info(`[Redis] Subscribed to channel: ${channel}`);
      return subscriber;
    } catch (err) {
      logger.error(`[Redis] Subscribe failed for ${channel}:`, err.message);
      throw err;
    }
  }

  /**
   * Get health status
   */
  async getHealth() {
    if (!this.client || !this.connected) {
      return { status: 'disconnected', message: 'Redis not connected' };
    }

    try {
      await this.client.ping();
      return { status: 'ok', message: 'Redis is healthy' };
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  }

  /**
   * Disconnect gracefully
   */
  async disconnect() {
    if (this.client) {
      try {
        await this.client.quit();
        this.connected = false;
        logger.info('[Redis] Disconnected gracefully');
      } catch (err) {
        logger.error('[Redis] Error during disconnect:', err.message);
      }
    }
  }

  /**
   * Flush all data (development only)
   */
  async flushAll() {
    if (!this.client || !this.connected) {
      throw new Error('Redis not connected');
    }

    if (process.env.NODE_ENV === 'production') {
      throw new Error('Cannot flush Redis in production');
    }

    try {
      await this.client.flushAll();
      logger.info('[Redis] All data flushed');
    } catch (err) {
      logger.error('[Redis] Flush failed:', err.message);
      throw err;
    }
  }
}

// Singleton instance
const redisClient = new RedisClient();

module.exports = redisClient;
