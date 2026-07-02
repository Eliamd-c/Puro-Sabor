/**
 * Metrics Collector
 *
 * Collects and tracks system metrics:
 * - Uptime
 * - Memory usage
 * - Error rates
 * - Request counts
 * - Database connection health
 * - WhatsApp bot status
 */

const os = require('os');

class MetricsCollector {
  constructor() {
    this.startTime = Date.now();
    this.metrics = {
      uptime: 0,
      memory: {},
      requests: {
        total: 0,
        success: 0,
        errors: 0,
        avgResponseTime: 0
      },
      errors: {
        database: 0,
        network: 0,
        validation: 0,
        authentication: 0,
        rateLimit: 0,
        internal: 0
      },
      database: {
        poolConnections: 0,
        poolIdle: 0,
        poolActive: 0,
        successfulQueries: 0,
        failedQueries: 0,
        avgQueryTime: 0
      },
      whatsapp: {
        adminStatus: 'disconnected',
        clientStatus: 'disconnected',
        messagesProcessed: 0,
        messagesFailedRate: 0
      },
      lastUpdate: new Date()
    };

    this.requestTimings = [];
    this.queryTimings = [];
    this.errorCounts = {};
  }

  /**
   * Record a request
   */
  recordRequest(method, path, statusCode, responseTime) {
    this.metrics.requests.total++;

    if (statusCode < 400) {
      this.metrics.requests.success++;
    } else {
      this.metrics.requests.errors++;
    }

    this.requestTimings.push(responseTime);
    if (this.requestTimings.length > 100) {
      this.requestTimings.shift();
    }

    this.updateAverageResponseTime();
  }

  /**
   * Record an error
   */
  recordError(errorType) {
    const key = errorType.toLowerCase().replace('error', '').trim();

    if (this.metrics.errors[key] !== undefined) {
      this.metrics.errors[key]++;
    } else {
      this.metrics.errors.internal++;
    }

    this.errorCounts[errorType] = (this.errorCounts[errorType] || 0) + 1;
  }

  /**
   * Update database metrics
   */
  updateDatabaseMetrics(poolStats, queryTime = 0) {
    if (poolStats) {
      this.metrics.database.poolConnections = poolStats.poolSize?.total || 0;
      this.metrics.database.poolIdle = poolStats.poolSize?.idle || 0;
      this.metrics.database.poolActive = poolStats.poolSize?.active || 0;
    }

    if (queryTime > 0) {
      this.metrics.database.successfulQueries++;
      this.queryTimings.push(queryTime);
      if (this.queryTimings.length > 100) {
        this.queryTimings.shift();
      }
      this.updateAverageQueryTime();
    }
  }

  /**
   * Record failed query
   */
  recordFailedQuery() {
    this.metrics.database.failedQueries++;
  }

  /**
   * Update WhatsApp bot status
   */
  updateWhatsAppStatus(botType, status, messagesProcessed = 0) {
    if (botType === 'admin') {
      this.metrics.whatsapp.adminStatus = status;
    } else if (botType === 'client') {
      this.metrics.whatsapp.clientStatus = status;
    }

    if (messagesProcessed > 0) {
      this.metrics.whatsapp.messagesProcessed += messagesProcessed;
    }
  }

  /**
   * Calculate average response time
   */
  updateAverageResponseTime() {
    if (this.requestTimings.length === 0) {
      this.metrics.requests.avgResponseTime = 0;
      return;
    }

    const sum = this.requestTimings.reduce((a, b) => a + b, 0);
    this.metrics.requests.avgResponseTime = Math.round(sum / this.requestTimings.length);
  }

  /**
   * Calculate average query time
   */
  updateAverageQueryTime() {
    if (this.queryTimings.length === 0) {
      this.metrics.database.avgQueryTime = 0;
      return;
    }

    const sum = this.queryTimings.reduce((a, b) => a + b, 0);
    this.metrics.database.avgQueryTime = Math.round(sum / this.queryTimings.length);
  }

  /**
   * Get error rate percentage
   */
  getErrorRate() {
    if (this.metrics.requests.total === 0) return 0;
    return Math.round(
      (this.metrics.requests.errors / this.metrics.requests.total) * 100
    );
  }

  /**
   * Get database health
   */
  getDatabaseHealth() {
    const total = this.metrics.database.successfulQueries + this.metrics.database.failedQueries;
    if (total === 0) return 100;

    const healthPercent = Math.round(
      (this.metrics.database.successfulQueries / total) * 100
    );

    return healthPercent;
  }

  /**
   * Get memory usage info
   */
  updateMemoryMetrics() {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const usagePercent = Math.round((usedMemory / totalMemory) * 100);

    this.metrics.memory = {
      total: this.formatBytes(totalMemory),
      free: this.formatBytes(freeMemory),
      used: this.formatBytes(usedMemory),
      usagePercent
    };

    return this.metrics.memory;
  }

  /**
   * Get CPU load
   */
  getCpuLoad() {
    const cpus = os.cpus();
    const avgLoad = os.loadavg();

    return {
      cores: cpus.length,
      avgLoad: avgLoad[0].toFixed(2),
      avgLoad5min: avgLoad[1].toFixed(2),
      avgLoad15min: avgLoad[2].toFixed(2)
    };
  }

  /**
   * Get complete health snapshot
   */
  getHealthSnapshot(poolManager = null) {
    this.updateMemoryMetrics();

    const uptime = Math.round((Date.now() - this.startTime) / 1000);
    const dbHealth = this.getDatabaseHealth();
    const errorRate = this.getErrorRate();

    // Determine overall status
    let status = 'ok';
    if (
      this.metrics.whatsapp.adminStatus === 'disconnected' ||
      this.metrics.whatsapp.clientStatus === 'disconnected' ||
      errorRate > 10 ||
      dbHealth < 90
    ) {
      status = 'degraded';
    }
    if (
      errorRate > 30 ||
      dbHealth < 70 ||
      (this.metrics.whatsapp.adminStatus === 'disconnected' &&
        this.metrics.whatsapp.clientStatus === 'disconnected')
    ) {
      status = 'down';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
      uptimeSeconds: uptime,
      checks: {
        database: dbHealth >= 80 ? 'ok' : dbHealth >= 50 ? 'degraded' : 'error',
        whatsapp_admin: this.metrics.whatsapp.adminStatus,
        whatsapp_client: this.metrics.whatsapp.clientStatus,
        memory: this.metrics.memory.usagePercent < 85 ? 'ok' : 'warning',
        errorRate: errorRate < 10 ? 'ok' : errorRate < 20 ? 'warning' : 'error'
      },
      metrics: {
        requests: this.metrics.requests,
        errors: this.metrics.errors,
        database: {
          ...this.metrics.database,
          health: `${dbHealth}%`
        },
        whatsapp: this.metrics.whatsapp,
        memory: this.metrics.memory,
        cpu: this.getCpuLoad()
      }
    };
  }

  /**
   * Get diagnostic information
   */
  getDiagnostic(poolManager = null) {
    const health = this.getHealthSnapshot(poolManager);

    const diagnostic = {
      version: '2.0',
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
      health: health.status,
      uptime: health.uptimeSeconds,
      uptime_formatted: health.uptime,

      system: {
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        memory: this.metrics.memory,
        cpu: this.getCpuLoad()
      },

      requests: {
        total: this.metrics.requests.total,
        successful: this.metrics.requests.success,
        failed: this.metrics.requests.errors,
        errorRate: `${this.getErrorRate()}%`,
        avgResponseTime: `${this.metrics.requests.avgResponseTime}ms`
      },

      database: {
        poolSize: {
          total: this.metrics.database.poolConnections,
          active: this.metrics.database.poolActive,
          idle: this.metrics.database.poolIdle
        },
        queries: {
          successful: this.metrics.database.successfulQueries,
          failed: this.metrics.database.failedQueries,
          health: `${this.getDatabaseHealth()}%`,
          avgTime: `${this.metrics.database.avgQueryTime}ms`
        }
      },

      whatsapp: {
        adminBot: this.metrics.whatsapp.adminStatus,
        clientBot: this.metrics.whatsapp.clientStatus,
        messagesProcessed: this.metrics.whatsapp.messagesProcessed
      },

      errors: {
        total: Object.values(this.metrics.errors).reduce((a, b) => a + b, 0),
        byType: this.metrics.errors,
        topErrors: this.getTopErrors(5)
      },

      checks: health.checks
    };

    return diagnostic;
  }

  /**
   * Get top N error types
   */
  getTopErrors(limit = 5) {
    return Object.entries(this.errorCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([type, count]) => ({ type, count }));
  }

  /**
   * Reset metrics (for testing)
   */
  reset() {
    this.startTime = Date.now();
    this.metrics.requests = {
      total: 0,
      success: 0,
      errors: 0,
      avgResponseTime: 0
    };
    this.metrics.errors = {
      database: 0,
      network: 0,
      validation: 0,
      authentication: 0,
      rateLimit: 0,
      internal: 0
    };
    this.requestTimings = [];
    this.queryTimings = [];
    this.errorCounts = {};
  }

  /**
   * Format bytes to human readable
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }
}

// Singleton instance
const metricsCollector = new MetricsCollector();

module.exports = metricsCollector;
