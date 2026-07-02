/**
 * Cluster Synchronization Manager
 *
 * Synchronizes state between cluster nodes:
 * - Admin whitelist (shared across all bots)
 * - Media whitelist cache
 * - Session state
 * - Rate limit state
 * - Event broadcasting
 */

const redisClient = require('../config/redis-client');
const logger = require('../config/logger');

class ClusterSync {
  constructor() {
    this.nodeId = `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.subscribers = [];
    this.channels = {
      AUTH_CHANGE: 'cluster:auth:change',
      MEDIA_UPDATE: 'cluster:media:update',
      STATE_SYNC: 'cluster:state:sync',
      ALERT: 'cluster:alert'
    };
  }

  /**
   * Initialize cluster sync
   */
  async initialize() {
    try {
      logger.info(`[ClusterSync] Initializing on node ${this.nodeId}`);

      // Register node
      await this.registerNode();

      // Subscribe to cluster events
      await this.subscribeToChannels();

      logger.info('[ClusterSync] Cluster sync initialized');
    } catch (err) {
      logger.error('[ClusterSync] Failed to initialize:', err.message);
      throw err;
    }
  }

  /**
   * Register this node in cluster
   */
  async registerNode() {
    try {
      const nodeInfo = {
        nodeId: this.nodeId,
        startTime: Date.now(),
        processId: process.pid,
        environment: process.env.NODE_ENV
      };

      await redisClient.set(
        `cluster:node:${this.nodeId}`,
        nodeInfo,
        300 // 5 minute TTL
      );

      logger.info('[ClusterSync] Node registered:', this.nodeId);
    } catch (err) {
      logger.error('[ClusterSync] Node registration failed:', err.message);
    }
  }

  /**
   * Subscribe to cluster channels
   */
  async subscribeToChannels() {
    try {
      for (const [name, channel] of Object.entries(this.channels)) {
        const subscriber = await redisClient.subscribe(channel, (message) => {
          this.handleChannelMessage(name, message);
        });
        this.subscribers.push(subscriber);
      }
    } catch (err) {
      logger.error('[ClusterSync] Channel subscription failed:', err.message);
    }
  }

  /**
   * Handle incoming channel message
   */
  handleChannelMessage(channelName, message) {
    logger.debug(`[ClusterSync] Received on ${channelName}:`, message);

    switch (channelName) {
      case 'AUTH_CHANGE':
        this.onAuthChange(message);
        break;
      case 'MEDIA_UPDATE':
        this.onMediaUpdate(message);
        break;
      case 'STATE_SYNC':
        this.onStateSync(message);
        break;
      case 'ALERT':
        this.onAlert(message);
        break;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // ADMIN WHITELIST SYNCHRONIZATION
  // ─────────────────────────────────────────────────────────────────

  /**
   * Sync admin whitelist to Redis
   */
  async syncAdminWhitelist(numbers) {
    try {
      const key = 'cluster:admin:whitelist';
      await redisClient.set(key, numbers);

      // Broadcast to other nodes
      await redisClient.publish(this.channels.AUTH_CHANGE, {
        type: 'whitelist_updated',
        numbers,
        nodeId: this.nodeId,
        timestamp: Date.now()
      });

      logger.info('[ClusterSync] Admin whitelist synced:', numbers.length);
    } catch (err) {
      logger.error('[ClusterSync] Whitelist sync failed:', err.message);
    }
  }

  /**
   * Get admin whitelist from Redis
   */
  async getAdminWhitelist() {
    try {
      const key = 'cluster:admin:whitelist';
      const numbers = await redisClient.get(key);
      return numbers || [];
    } catch (err) {
      logger.error('[ClusterSync] Get whitelist failed:', err.message);
      return [];
    }
  }

  /**
   * Handle auth whitelist changes from other nodes
   */
  onAuthChange(message) {
    if (message.nodeId === this.nodeId) return; // Ignore own messages

    logger.info('[ClusterSync] Auth change detected from', message.nodeId);

    // Emit event for whatsappAgent to handle
    if (global.eventEmitter) {
      global.eventEmitter.emit('auth_whitelist_updated', message);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // MEDIA WHITELIST SYNCHRONIZATION
  // ─────────────────────────────────────────────────────────────────

  /**
   * Cache media file hash
   */
  async cacheMediaHash(fileHash, filename, metadata = {}) {
    try {
      const key = `cluster:media:${fileHash}`;
      const data = {
        hash: fileHash,
        filename,
        metadata,
        cachedAt: Date.now()
      };

      await redisClient.set(key, data, 86400); // 24 hour TTL

      // Broadcast to other nodes
      await redisClient.publish(this.channels.MEDIA_UPDATE, {
        type: 'media_cached',
        hash: fileHash,
        filename,
        nodeId: this.nodeId
      });

      logger.info('[ClusterSync] Media hash cached:', fileHash);
    } catch (err) {
      logger.error('[ClusterSync] Media cache failed:', err.message);
    }
  }

  /**
   * Get cached media info
   */
  async getCachedMedia(fileHash) {
    try {
      const key = `cluster:media:${fileHash}`;
      return await redisClient.get(key);
    } catch (err) {
      logger.error('[ClusterSync] Get cached media failed:', err.message);
      return null;
    }
  }

  /**
   * Handle media updates from other nodes
   */
  onMediaUpdate(message) {
    if (message.nodeId === this.nodeId) return; // Ignore own messages

    logger.info('[ClusterSync] Media update from', message.nodeId, ':', message.hash);

    if (global.eventEmitter) {
      global.eventEmitter.emit('media_cached', message);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // LOCK MANAGEMENT
  // ─────────────────────────────────────────────────────────────────

  /**
   * Acquire distributed lock
   */
  async acquireLock(lockName, timeoutSeconds = 30) {
    try {
      const lockKey = `cluster:lock:${lockName}`;
      const lockValue = this.nodeId;

      const acquired = await redisClient.acquireLock(
        lockKey,
        lockValue,
        timeoutSeconds
      );

      if (acquired) {
        logger.debug(`[ClusterSync] Lock acquired: ${lockName}`);
        return lockValue;
      }

      return null;
    } catch (err) {
      logger.error('[ClusterSync] Lock acquisition failed:', err.message);
      return null;
    }
  }

  /**
   * Release distributed lock
   */
  async releaseLock(lockName, lockValue) {
    try {
      const lockKey = `cluster:lock:${lockName}`;
      const released = await redisClient.releaseLock(lockKey, lockValue);

      if (released) {
        logger.debug(`[ClusterSync] Lock released: ${lockName}`);
      }

      return released;
    } catch (err) {
      logger.error('[ClusterSync] Lock release failed:', err.message);
      return false;
    }
  }

  /**
   * Execute function with distributed lock
   */
  async withLock(lockName, fn, timeoutSeconds = 30) {
    const lockValue = await this.acquireLock(lockName, timeoutSeconds);

    if (!lockValue) {
      throw new Error(`Failed to acquire lock: ${lockName}`);
    }

    try {
      return await fn();
    } finally {
      await this.releaseLock(lockName, lockValue);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // RATE LIMIT STATE SYNCHRONIZATION
  // ─────────────────────────────────────────────────────────────────

  /**
   * Store rate limit state in Redis
   */
  async syncRateLimit(number, category, state) {
    try {
      const key = `cluster:ratelimit:${number}:${category}`;
      await redisClient.set(key, state, 60); // 1 minute TTL
    } catch (err) {
      logger.error('[ClusterSync] Rate limit sync failed:', err.message);
    }
  }

  /**
   * Get rate limit state from Redis
   */
  async getRateLimitState(number, category) {
    try {
      const key = `cluster:ratelimit:${number}:${category}`;
      return await redisClient.get(key);
    } catch (err) {
      logger.error('[ClusterSync] Get rate limit failed:', err.message);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // SESSION STATE SYNCHRONIZATION
  // ─────────────────────────────────────────────────────────────────

  /**
   * Store active session
   */
  async storeSession(sessionId, data, ttlSeconds = 3600) {
    try {
      const key = `cluster:session:${sessionId}`;
      await redisClient.set(key, data, ttlSeconds);
    } catch (err) {
      logger.error('[ClusterSync] Session store failed:', err.message);
    }
  }

  /**
   * Get session
   */
  async getSession(sessionId) {
    try {
      const key = `cluster:session:${sessionId}`;
      return await redisClient.get(key);
    } catch (err) {
      logger.error('[ClusterSync] Get session failed:', err.message);
      return null;
    }
  }

  /**
   * Delete session
   */
  async deleteSession(sessionId) {
    try {
      const key = `cluster:session:${sessionId}`;
      await redisClient.del(key);
    } catch (err) {
      logger.error('[ClusterSync] Delete session failed:', err.message);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // BROADCAST ALERTS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Broadcast alert to all nodes
   */
  async broadcastAlert(severity, message, details = {}) {
    try {
      await redisClient.publish(this.channels.ALERT, {
        severity,
        message,
        details,
        nodeId: this.nodeId,
        timestamp: Date.now()
      });

      logger.info(`[ClusterSync] Alert broadcast: ${severity}`, message);
    } catch (err) {
      logger.error('[ClusterSync] Alert broadcast failed:', err.message);
    }
  }

  /**
   * Handle alert from other nodes
   */
  onAlert(message) {
    if (message.nodeId === this.nodeId) return; // Ignore own messages

    logger.warn(
      `[ClusterSync] Alert from ${message.nodeId}: [${message.severity}]`,
      message.message
    );

    if (global.eventEmitter) {
      global.eventEmitter.emit('cluster_alert', message);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // CLUSTER STATUS
  // ─────────────────────────────────────────────────────────────────

  /**
   * Get cluster status
   */
  async getClusterStatus() {
    try {
      const nodesPattern = 'cluster:node:*';
      // Note: In real implementation, use SCAN or KEYS command
      // For now, return basic info

      return {
        nodeId: this.nodeId,
        connected: true,
        redisHealth: await redisClient.getHealth()
      };
    } catch (err) {
      logger.error('[ClusterSync] Get cluster status failed:', err.message);
      return {
        nodeId: this.nodeId,
        connected: false,
        error: err.message
      };
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    try {
      // Unsubscribe from all channels
      for (const subscriber of this.subscribers) {
        await subscriber.unsubscribe();
        await subscriber.quit();
      }

      // Remove node registration
      const key = `cluster:node:${this.nodeId}`;
      await redisClient.del(key);

      logger.info('[ClusterSync] Cluster sync shutdown complete');
    } catch (err) {
      logger.error('[ClusterSync] Shutdown error:', err.message);
    }
  }
}

// Singleton instance
const clusterSync = new ClusterSync();

module.exports = clusterSync;
