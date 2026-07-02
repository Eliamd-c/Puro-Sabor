/**
 * Health Check Endpoints
 *
 * GET /health - Quick health status
 * GET /diagnostic - Detailed diagnostic information
 */

const express = require('express');
const router = express.Router();
const metricsCollector = require('../utils/metricsCollector');
const alertService = require('../services/alertService');

/**
 * GET /health
 *
 * Quick health status check (should respond in <1s)
 * Returns current health status and component checks
 */
router.get('/health', async (req, res) => {
  try {
    const db = require('../config/database');
    const poolManager = db.getPoolManager?.();

    // Get health snapshot
    const health = metricsCollector.getHealthSnapshot(poolManager);

    // Check if health check itself timed out (>1s)
    const checkDuration = Date.now() - req.startTime;
    if (checkDuration > 1000) {
      health.slowHealthCheck = true;
      health.checks.performance = 'warning';
    }

    // Return JSON response
    res.status(health.status === 'down' ? 503 : 200).json({
      status: health.status,
      timestamp: health.timestamp,
      uptime: health.uptimeSeconds,
      checks: health.checks,
      ...(process.env.NODE_ENV === 'development' && {
        metrics: {
          requests: health.metrics.requests,
          errors: health.metrics.errors,
          memory: health.metrics.memory
        }
      })
    });
  } catch (err) {
    console.error('[Health] Error in health check:', err.message);
    res.status(500).json({
      status: 'error',
      error: 'Health check failed',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

/**
 * GET /diagnostic
 *
 * Detailed diagnostic information (can be slower)
 * Returns comprehensive system metrics and diagnostics
 */
router.get('/diagnostic', async (req, res) => {
  try {
    const db = require('../config/database');
    const poolManager = db.getPoolManager?.();

    // Get diagnostic info
    const diagnostic = metricsCollector.getDiagnostic(poolManager);

    // Get alert status
    const alertStatus = alertService.getAlertStatus();

    // Get recent alerts
    const recentAlerts = alertService.getAlertHistory(10);

    res.json({
      diagnostic,
      alerts: {
        status: alertStatus,
        recent: recentAlerts
      }
    });
  } catch (err) {
    console.error('[Diagnostic] Error in diagnostic endpoint:', err.message);
    res.status(500).json({
      error: 'Diagnostic failed',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

/**
 * GET /health/db
 *
 * Database-specific health check
 */
router.get('/health/db', async (req, res) => {
  try {
    const db = require('../config/database');

    // Try a simple query
    const startTime = Date.now();
    const result = await new Promise((resolve, reject) => {
      db.get('SELECT NOW() as time', (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
    const queryTime = Date.now() - startTime;

    res.json({
      status: 'ok',
      database: 'PostgreSQL/Supabase',
      queryTime: `${queryTime}ms`,
      timestamp: result?.time || new Date()
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      error: 'Database unavailable',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

/**
 * GET /health/whatsapp
 *
 * WhatsApp bots status
 */
router.get('/health/whatsapp', (req, res) => {
  try {
    const waAgent = require('../services/whatsappAgent');
    const adminBot = waAgent.getBot('admin');
    const clientBot = waAgent.getBot('client');

    res.json({
      status: 'ok',
      whatsapp: {
        admin: {
          status: adminBot?.botStatus || 'unknown',
          connected: adminBot?.client ? true : false,
          qrAvailable: adminBot?.latestQrDataUrl ? true : false
        },
        client: {
          status: clientBot?.botStatus || 'unknown',
          connected: clientBot?.client ? true : false,
          qrAvailable: clientBot?.latestQrDataUrl ? true : false
        }
      }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      error: 'WhatsApp status check failed',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

/**
 * POST /health/record-metric
 *
 * Record metrics from client (optional)
 * Usage: POST with { type, value }
 */
router.post('/health/record-metric', (req, res) => {
  try {
    const { type, value } = req.body;

    if (type === 'request') {
      const { statusCode, responseTime } = value;
      metricsCollector.recordRequest('POST', '/unknown', statusCode, responseTime);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /health/compression
 *
 * Compression statistics and metrics
 * Shows compression performance data
 */
router.get('/health/compression', (req, res) => {
  try {
    const compressionMiddleware = require('../middleware/compression');
    const stats = compressionMiddleware.getStats();

    res.json({
      status: 'ok',
      compression: {
        ...stats,
        configuration: {
          gzipLevel: compressionMiddleware.GZIP_LEVEL,
          brotliLevel: compressionMiddleware.BROTLI_LEVEL,
          minSize: `${compressionMiddleware.MIN_SIZE} bytes`,
          compressibleTypes: compressionMiddleware.COMPRESSIBLE_TYPES.length,
          skippedTypes: compressionMiddleware.SKIP_COMPRESSION.length
        }
      }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      error: 'Compression stats unavailable',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

/**
 * GET /health/cache
 *
 * Cache statistics and health
 * Shows L1/L2 cache hit rates and performance metrics
 */
router.get('/health/cache', async (req, res) => {
  try {
    const { getInstance: getCacheManager } = require('../utils/cacheManager');
    const cache = getCacheManager();

    const stats = cache.getStats();
    const health = await cache.healthCheck();

    res.json({
      status: 'ok',
      cache: {
        health,
        performance: {
          totalRequests: stats.totalRequests,
          cacheHits: stats.hits,
          cacheMisses: stats.misses,
          hitRate: stats.hitRate,
          distribution: stats.distribution,
          timing: {
            l1RedisMsAvg: stats.timing.l1AvgMs,
            l2MemoryMsAvg: stats.timing.l2AvgMs,
            l3DatabaseMsAvg: stats.timing.l3AvgMs
          }
        },
        memory: {
          cachedKeys: stats.memory.cacheKeys,
          maxKeys: stats.memory.maxKeys,
          ...stats.memory.stats
        }
      }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      error: 'Cache stats unavailable',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

/**
 * GET /health/performance
 *
 * FASE 3.5: Query performance monitoring
 * Shows slow queries, percentiles, N+1 patterns, and health score
 */
router.get('/health/performance', (req, res) => {
  try {
    const { getInstance: getQueryMonitor } = require('../utils/queryMonitor');
    const monitor = getQueryMonitor();

    const report = monitor.getPerformanceReport();

    res.json({
      status: 'ok',
      performance: {
        timestamp: report.timestamp,
        healthScore: report.healthScore,
        queries: {
          total: report.summary.totalQueries,
          avgTimeMs: parseFloat(report.summary.averageTimeMs),
          slowCount: report.summary.slowQueries,
          verySlowCount: report.summary.verySlowQueries,
          slowQueryRate: report.summary.slowQueryRate,
          percentiles: report.percentiles,
          byType: report.summary.byType
        },
        slowestQueries: report.slowestQueries.slice(0, 5),
        n1Patterns: report.n1Patterns,
        recommendations: report.recommendations
      }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      error: 'Performance stats unavailable',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

/**
 * GET /health/performance/queries
 *
 * Detailed query history (last 50 queries)
 */
router.get('/health/performance/queries', (req, res) => {
  try {
    const { getInstance: getQueryMonitor } = require('../utils/queryMonitor');
    const monitor = getQueryMonitor();

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const recentQueries = monitor.getRecentQueries(limit);

    res.json({
      status: 'ok',
      queries: {
        count: recentQueries.length,
        data: recentQueries
      }
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      error: 'Query history unavailable',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

/**
 * POST /health/performance/reset
 *
 * Reset performance statistics (admin only)
 */
router.post('/health/performance/reset', (req, res) => {
  try {
    // In production, you'd check authentication here
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        status: 'error',
        error: 'Not allowed in production'
      });
    }

    const { getInstance: getQueryMonitor } = require('../utils/queryMonitor');
    const monitor = getQueryMonitor();

    monitor.reset();

    res.json({
      status: 'ok',
      message: 'Performance statistics reset'
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      error: 'Failed to reset statistics',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

module.exports = router;
