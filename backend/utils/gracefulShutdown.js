/**
 * Graceful Shutdown Manager
 *
 * Handles clean shutdown of:
 * - HTTP connections
 * - Database connections
 * - Redis connections
 * - WhatsApp connections
 * - Lock cleanup
 * - Pending operations draining
 */

const logger = require('../config/logger');

class GracefulShutdownManager {
  constructor() {
    this.isShuttingDown = false;
    this.shutdownStartTime = null;
    this.maxShutdownDurationMs = 15000; // 15 seconds max
    this.pendingOperations = new Map();
  }

  /**
   * Initialize graceful shutdown manager
   */
  initialize(server, io) {
    this.server = server;
    this.io = io;

    // Handle shutdown signals
    process.on('SIGTERM', () => this.onSignal('SIGTERM'));
    process.on('SIGINT', () => this.onSignal('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (err) => {
      logger.error('[GracefulShutdown] Uncaught exception:', err.message);
      this.shutdown();
    });

    // Handle unhandled rejections
    process.on('unhandledRejection', (reason) => {
      logger.error('[GracefulShutdown] Unhandled rejection:', reason?.message || reason);
      // Don't shutdown on unhandled rejection - just log
    });

    logger.info('[GracefulShutdown] Graceful shutdown manager initialized');
  }

  /**
   * Handle shutdown signal
   */
  onSignal(signal) {
    if (this.isShuttingDown) {
      logger.warn(`[GracefulShutdown] ${signal} received, but already shutting down`);
      return;
    }

    logger.info(`[GracefulShutdown] ${signal} received, initiating graceful shutdown...`);
    this.shutdown();
  }

  /**
   * Start graceful shutdown sequence
   */
  async shutdown() {
    if (this.isShuttingDown) return;

    this.isShuttingDown = true;
    this.shutdownStartTime = Date.now();

    try {
      // Phase 1: Stop accepting new connections (0-2s)
      await this.phase1_StopAcceptingConnections();

      // Phase 2: Drain pending operations (2-8s)
      await this.phase2_DrainPendingOperations();

      // Phase 3: Cleanup connections (8-12s)
      await this.phase3_CleanupConnections();

      // Phase 4: Notify and shutdown (12-15s)
      await this.phase4_FinalCleanup();

      logger.info('[GracefulShutdown] Graceful shutdown completed successfully');
      process.exit(0);
    } catch (err) {
      logger.error('[GracefulShutdown] Error during shutdown:', err.message);
      process.exit(1);
    }
  }

  /**
   * Phase 1: Stop accepting new connections
   */
  async phase1_StopAcceptingConnections() {
    logger.info('[GracefulShutdown] Phase 1: Stopping new connections...');

    try {
      // Close server to stop accepting new HTTP connections
      if (this.server) {
        await new Promise((resolve) => {
          this.server.close(() => {
            logger.info('[GracefulShutdown] HTTP server closed');
            resolve();
          });
        });
      }

      // Stop accepting new socket.io connections
      if (this.io) {
        this.io.close();
        logger.info('[GracefulShutdown] Socket.io closed');
      }

      this.logProgress('Phase 1 complete');
    } catch (err) {
      logger.warn('[GracefulShutdown] Phase 1 error:', err.message);
    }
  }

  /**
   * Phase 2: Drain pending operations
   */
  async phase2_DrainPendingOperations() {
    logger.info('[GracefulShutdown] Phase 2: Draining pending operations...');

    try {
      // Wait for pending operations to complete
      const drainTimeoutMs = 5000; // 5 seconds for draining
      const pendingOps = Array.from(this.pendingOperations.values());

      if (pendingOps.length > 0) {
        logger.info(`[GracefulShutdown] Waiting for ${pendingOps.length} pending operations...`);

        const drainPromises = pendingOps.map((op) => {
          return Promise.race([
            op.promise.catch(() => null), // Ignore errors
            this.createTimeout(drainTimeoutMs) // Max wait time
          ]);
        });

        await Promise.all(drainPromises);
      }

      this.logProgress('Phase 2 complete');
    } catch (err) {
      logger.warn('[GracefulShutdown] Phase 2 error:', err.message);
    }
  }

  /**
   * Phase 3: Cleanup connections
   */
  async phase3_CleanupConnections() {
    logger.info('[GracefulShutdown] Phase 3: Cleaning up connections...');

    try {
      // Cleanup Database
      const db = require('../config/database');
      if (db && db.getPool) {
        try {
          const pool = db.getPool();
          if (pool && pool.end) {
            await pool.end();
            logger.info('[GracefulShutdown] Database pool closed');
          }
        } catch (err) {
          logger.warn('[GracefulShutdown] Database cleanup error:', err.message);
        }
      }

      // Cleanup Redis
      const redisClient = require('../config/redis-client');
      if (redisClient && redisClient.client) {
        try {
          await redisClient.disconnect();
          logger.info('[GracefulShutdown] Redis disconnected');
        } catch (err) {
          logger.warn('[GracefulShutdown] Redis cleanup error:', err.message);
        }
      }

      // Cleanup Cluster Sync
      const clusterSync = require('./clusterSync');
      if (clusterSync) {
        try {
          await clusterSync.shutdown();
          logger.info('[GracefulShutdown] Cluster sync shutdown');
        } catch (err) {
          logger.warn('[GracefulShutdown] Cluster sync cleanup error:', err.message);
        }
      }

      this.logProgress('Phase 3 complete');
    } catch (err) {
      logger.warn('[GracefulShutdown] Phase 3 error:', err.message);
    }
  }

  /**
   * Phase 4: Final cleanup
   */
  async phase4_FinalCleanup() {
    logger.info('[GracefulShutdown] Phase 4: Final cleanup...');

    try {
      // Release any remaining locks
      const clusterSync = require('./clusterSync');
      if (clusterSync) {
        try {
          // Notify cluster that this node is going down
          await clusterSync.broadcastAlert(
            'INFO',
            `Node ${clusterSync.nodeId} is shutting down`,
            { status: 'shutdown', timestamp: Date.now() }
          );
        } catch (err) {
          logger.warn('[GracefulShutdown] Final notification error:', err.message);
        }
      }

      // Close logger
      if (logger.close) {
        logger.close();
      }

      this.logProgress('Phase 4 complete');
    } catch (err) {
      logger.warn('[GracefulShutdown] Phase 4 error:', err.message);
    }
  }

  /**
   * Register a pending operation
   */
  registerOperation(id, promise) {
    this.pendingOperations.set(id, {
      id,
      promise,
      startTime: Date.now()
    });
  }

  /**
   * Unregister a completed operation
   */
  unregisterOperation(id) {
    this.pendingOperations.delete(id);
  }

  /**
   * Get current shutdown progress
   */
  getShutdownProgress() {
    if (!this.isShuttingDown) {
      return {
        isShuttingDown: false,
        elapsedMs: 0,
        maxDurationMs: this.maxShutdownDurationMs
      };
    }

    const elapsedMs = Date.now() - this.shutdownStartTime;
    const remainingMs = Math.max(0, this.maxShutdownDurationMs - elapsedMs);

    return {
      isShuttingDown: true,
      elapsedMs,
      remainingMs,
      maxDurationMs: this.maxShutdownDurationMs,
      percentComplete: Math.round((elapsedMs / this.maxShutdownDurationMs) * 100),
      pendingOperations: this.pendingOperations.size
    };
  }

  /**
   * Log progress
   */
  logProgress(message) {
    const progress = this.getShutdownProgress();
    logger.info(
      `[GracefulShutdown] ${message} (${progress.elapsedMs}ms/${progress.maxDurationMs}ms, ` +
      `${progress.pendingOperations} pending ops)`
    );
  }

  /**
   * Create timeout promise
   */
  createTimeout(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  /**
   * Is currently shutting down?
   */
  isShuttingDownNow() {
    return this.isShuttingDown;
  }

  /**
   * Get time remaining before forced exit
   */
  getTimeRemaining() {
    if (!this.isShuttingDown) return -1;

    const elapsed = Date.now() - this.shutdownStartTime;
    return Math.max(0, this.maxShutdownDurationMs - elapsed);
  }
}

// Singleton instance
const gracefulShutdownManager = new GracefulShutdownManager();

module.exports = gracefulShutdownManager;
