/**
 * Database Connection Pool with Retry Logic
 *
 * Manages PostgreSQL connection pooling with:
 * - Min/max connections (2-10)
 * - Exponential backoff retry (1s, 2s, 4s, 8s, 16s)
 * - Health checks every 30 seconds
 * - Automatic connection cleanup
 * - Metrics tracking
 */

const { Pool } = require('pg');

class PoolManager {
  constructor(connectionString, options = {}) {
    this.connectionString = connectionString;
    this.poolConfig = {
      connectionString,
      max: options.maxConnections || 10,
      min: options.minConnections || 2,
      idleTimeoutMillis: options.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: options.connectionTimeoutMillis || 5000,
      statementTimeoutMillis: options.statementTimeoutMillis || 30000,
      application_name: 'puro-sabor-whatsapp-bot',
      // Supabase requiere TLS. Sin el certificado CA de Supabase, la
      // verificación estricta falla ("self-signed certificate in chain"),
      // así que solo se activa cuando se provee sslCA.
      ssl: options.sslCA
        ? { rejectUnauthorized: true, ca: options.sslCA }
        : { rejectUnauthorized: false }
    };

    this.pool = null;
    this.isHealthy = false;
    this.metrics = {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      waitingRequests: 0,
      failedAttempts: 0,
      successfulConnections: 0,
      lastHealthCheck: null,
      uptime: Date.now()
    };

    // Retry configuration
    this.retryConfig = {
      maxRetries: 5,
      baseDelay: 1000, // 1 second
      maxDelay: 16000, // 16 seconds
      backoffMultiplier: 2
    };

    // Health check interval (30 seconds)
    this.healthCheckInterval = null;
    this.healthCheckFrequency = options.healthCheckFrequency || 30000;
  }

  /**
   * Initialize the connection pool
   */
  async initialize() {
    try {
      this.pool = new Pool(this.poolConfig);

      // Handle pool events
      this.pool.on('error', (err) => {
        console.error('[Pool] Unexpected error on idle client:', err);
        this.metrics.failedAttempts++;
      });

      this.pool.on('connect', () => {
        this.metrics.successfulConnections++;
      });

      // Test initial connection
      const client = await this.pool.connect();
      await client.query('SELECT NOW() as time');
      client.release();

      this.isHealthy = true;
      console.log('[Pool] ✅ Connection pool initialized successfully');
      console.log(`[Pool] Min: ${this.poolConfig.min}, Max: ${this.poolConfig.max}`);

      // Start health checks
      this.startHealthChecks();

      return this.pool;
    } catch (err) {
      console.error('[Pool] ❌ Failed to initialize pool:', err.message);
      this.isHealthy = false;
      throw err;
    }
  }

  /**
   * Start periodic health checks
   */
  startHealthChecks() {
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, this.healthCheckFrequency);

    console.log(`[Pool] Health checks scheduled every ${this.healthCheckFrequency}ms`);
  }

  /**
   * Perform health check query
   */
  async performHealthCheck() {
    try {
      const client = await this.pool.connect();
      const result = await client.query('SELECT NOW() as time, version() as version');
      client.release();

      this.isHealthy = true;
      this.metrics.lastHealthCheck = new Date();

      console.log('[Pool] ✅ Health check passed');
      return { healthy: true, timestamp: new Date() };
    } catch (err) {
      this.isHealthy = false;
      console.error('[Pool] ❌ Health check failed:', err.message);
      this.metrics.failedAttempts++;
      return { healthy: false, error: err.message };
    }
  }

  /**
   * Execute query with automatic retry
   *
   * @param {string} query - SQL query
   * @param {array} params - Query parameters
   * @param {object} options - Retry options
   * @returns {Promise} Query result
   */
  async query(query, params = [], options = {}) {
    const maxRetries = options.maxRetries || this.retryConfig.maxRetries;
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const client = await this.pool.connect();
        try {
          const result = await client.query(query, params);
          this.metrics.activeConnections = this.pool.waitingCount;
          return result;
        } finally {
          client.release();
        }
      } catch (err) {
        lastError = err;

        // Don't retry on non-recoverable errors
        if (this.isNonRecoverable(err)) {
          throw err;
        }

        if (attempt < maxRetries) {
          const delay = this.calculateBackoff(attempt);
          console.warn(
            `[Pool] Query failed (attempt ${attempt + 1}/${maxRetries + 1}), ` +
            `retrying in ${delay}ms: ${err.message}`
          );

          await this.sleep(delay);
        } else {
          this.metrics.failedAttempts++;
        }
      }
    }

    throw lastError;
  }

  /**
   * Get connection with retry
   *
   * @returns {Promise} Database client
   */
  async getConnection() {
    const maxRetries = this.retryConfig.maxRetries;
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const client = await this.pool.connect();
        this.metrics.activeConnections++;
        return client;
      } catch (err) {
        lastError = err;

        if (attempt < maxRetries) {
          const delay = this.calculateBackoff(attempt);
          console.warn(
            `[Pool] Connection failed (attempt ${attempt + 1}/${maxRetries + 1}), ` +
            `retrying in ${delay}ms: ${err.message}`
          );

          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Determine if error is non-recoverable
   *
   * @param {Error} err - Error object
   * @returns {boolean} true if should not retry
   */
  isNonRecoverable(err) {
    const nonRecoverablePatterns = [
      'syntax error',
      'permission denied',
      'invalid input',
      'relation does not exist',
      'column does not exist'
    ];

    const errorMsg = err.message?.toLowerCase() || '';
    return nonRecoverablePatterns.some(pattern => errorMsg.includes(pattern));
  }

  /**
   * Calculate exponential backoff delay
   *
   * @param {number} attempt - Current attempt number (0-indexed)
   * @returns {number} Delay in milliseconds
   */
  calculateBackoff(attempt) {
    const delay = Math.min(
      this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt),
      this.retryConfig.maxDelay
    );

    // Add random jitter (±20%)
    const jitter = delay * 0.2 * (Math.random() * 2 - 1);
    return Math.max(0, delay + jitter);
  }

  /**
   * Sleep helper
   *
   * @param {number} ms - Milliseconds to sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get pool statistics
   *
   * @returns {object} Pool stats
   */
  getStats() {
    if (!this.pool) {
      return { error: 'Pool not initialized' };
    }

    return {
      healthy: this.isHealthy,
      poolSize: {
        total: this.pool.totalCount,
        idle: this.pool.idleCount,
        active: this.pool.totalCount - this.pool.idleCount
      },
      waiting: this.pool.waitingCount,
      metrics: {
        totalConnections: this.metrics.totalConnections,
        successfulConnections: this.metrics.successfulConnections,
        failedAttempts: this.metrics.failedAttempts,
        lastHealthCheck: this.metrics.lastHealthCheck,
        uptime: Date.now() - this.metrics.uptime
      }
    };
  }

  /**
   * Drain all connections
   */
  async drain() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      console.log('[Pool] Health check interval cleared');
    }

    if (this.pool) {
      await this.pool.end();
      console.log('[Pool] All connections closed');
    }
  }

  /**
   * Get current health status
   *
   * @returns {object} Health status
   */
  async getHealth() {
    if (!this.isHealthy) {
      return { status: 'down', message: 'Pool is not healthy' };
    }

    try {
      const result = await this.query('SELECT NOW() as time');
      return {
        status: 'ok',
        timestamp: result.rows[0].time,
        poolStats: this.getStats()
      };
    } catch (err) {
      return { status: 'error', message: err.message };
    }
  }
}

module.exports = PoolManager;
