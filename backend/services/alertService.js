/**
 * Alert Service
 *
 * Sends alerts to administrators via WhatsApp when:
 * - Database connection fails
 * - Error rate exceeds threshold
 * - WhatsApp bot disconnects
 * - Memory usage is high
 * - System is degraded or down
 */

const logger = require('../config/logger');

class AlertService {
  constructor() {
    this.alertHistory = [];
    this.alertThresholds = {
      errorRatePercent: 20, // Alert if >20% errors
      memoryUsagePercent: 85, // Alert if >85% memory
      responseTimeMs: 5000, // Alert if avg response >5s
      databaseHealthPercent: 70 // Alert if <70% health
    };

    this.alertCooldown = {}; // Prevent spam - one alert per type per 5 minutes
    this.cooldownMs = 300000; // 5 minutes

    this.waBot = null; // Will be set from whatsappAgent
  }

  /**
   * Set WhatsApp bot reference
   */
  setWhatsAppBot(adminBot, clientBot) {
    this.adminBot = adminBot;
    this.clientBot = clientBot;
  }

  /**
   * Check if alert should be sent (cooldown check)
   */
  shouldSendAlert(alertType) {
    const now = Date.now();
    const lastAlert = this.alertCooldown[alertType];

    if (!lastAlert || now - lastAlert > this.cooldownMs) {
      this.alertCooldown[alertType] = now;
      return true;
    }

    return false;
  }

  /**
   * Send alert via WhatsApp to admin numbers
   */
  async sendAlert(severity, title, message, details = {}) {
    if (!this.adminBot || !this.adminBot.client) {
      logger.warn('[Alert] WhatsApp bot not available for sending alerts');
      return;
    }

    try {
      const alertMsg = this.formatAlertMessage(severity, title, message, details);

      // Get admin numbers from config
      const adminNumbers = await this.getAdminNumbers();

      for (const adminNum of adminNumbers) {
        try {
          const jid = adminNum.includes('@') ? adminNum : `${adminNum}@s.whatsapp.net`;
          await this.adminBot.client.sendMessage(jid, { text: alertMsg });
          logger.info(`[Alert] Sent ${severity} alert to ${adminNum}`);
        } catch (err) {
          logger.error(`[Alert] Failed to send to ${adminNum}:`, err.message);
        }
      }

      // Store in history
      this.alertHistory.push({
        severity,
        title,
        message,
        details,
        timestamp: new Date(),
        sent: true
      });

      if (this.alertHistory.length > 100) {
        this.alertHistory.shift();
      }
    } catch (err) {
      logger.error('[Alert] Error sending alert:', err.message);
    }
  }

  /**
   * Get admin numbers from config
   */
  async getAdminNumbers() {
    try {
      const db = require('../config/database');
      const adminNumbers = await new Promise((resolve) => {
        db.get(
          `SELECT value FROM config WHERE key = ?`,
          ['admin_whatsapp_numbers'],
          (err, row) => {
            if (err || !row) {
              resolve([]);
              return;
            }
            const numbers = row.value
              .split(',')
              .map(n => n.trim().replace(/^\+/, ''))
              .filter(Boolean);
            resolve(numbers);
          }
        );
      });

      return adminNumbers;
    } catch (err) {
      logger.error('[Alert] Error getting admin numbers:', err.message);
      return [];
    }
  }

  /**
   * Format alert message for WhatsApp
   */
  formatAlertMessage(severity, title, message, details) {
    const emoji = {
      CRITICAL: '🚨',
      ERROR: '❌',
      WARNING: '⚠️',
      INFO: 'ℹ️'
    }[severity] || '📢';

    let msg = `${emoji} *${severity}: ${title}*\n\n`;
    msg += `${message}\n`;

    if (Object.keys(details).length > 0) {
      msg += '\n*Detalles:*\n';
      for (const [key, value] of Object.entries(details)) {
        const displayKey = key.replace(/_/g, ' ');
        msg += `• ${displayKey}: ${value}\n`;
      }
    }

    msg += `\n_${new Date().toLocaleString('es-CO')}_`;

    return msg;
  }

  /**
   * Check health and send alerts if needed
   */
  async checkAndAlert(health, metrics) {
    try {
      // Check error rate
      if (metrics.requests.total > 0) {
        const errorRate = Math.round(
          (metrics.requests.errors / metrics.requests.total) * 100
        );

        if (
          errorRate > this.alertThresholds.errorRatePercent &&
          this.shouldSendAlert('HIGH_ERROR_RATE')
        ) {
          await this.sendAlert('WARNING', 'Error Rate High',
            `Error rate has reached ${errorRate}%`,
            {
              'error_rate': `${errorRate}%`,
              'total_requests': metrics.requests.total,
              'failed_requests': metrics.requests.errors
            }
          );
        }
      }

      // Check database health
      if (metrics.database) {
        const dbHealth = this.calculateDatabaseHealth(metrics.database);
        if (
          dbHealth < this.alertThresholds.databaseHealthPercent &&
          this.shouldSendAlert('DATABASE_HEALTH')
        ) {
          await this.sendAlert('ERROR', 'Database Health Low',
            `Database health is at ${dbHealth}%`,
            {
              'health_percent': `${dbHealth}%`,
              'successful_queries': metrics.database.successfulQueries,
              'failed_queries': metrics.database.failedQueries,
              'active_connections': metrics.database.poolActive
            }
          );
        }
      }

      // Check memory usage
      if (metrics.memory) {
        if (
          metrics.memory.usagePercent > this.alertThresholds.memoryUsagePercent &&
          this.shouldSendAlert('HIGH_MEMORY')
        ) {
          await this.sendAlert('WARNING', 'High Memory Usage',
            `Memory usage is at ${metrics.memory.usagePercent}%`,
            {
              'memory_usage': `${metrics.memory.usagePercent}%`,
              'used': metrics.memory.used,
              'total': metrics.memory.total
            }
          );
        }
      }

      // Check response time
      if (
        metrics.requests.avgResponseTime > this.alertThresholds.responseTimeMs &&
        this.shouldSendAlert('SLOW_RESPONSES')
      ) {
        await this.sendAlert('WARNING', 'Slow Response Times',
          `Average response time is ${metrics.requests.avgResponseTime}ms`,
          {
            'avg_response_time': `${metrics.requests.avgResponseTime}ms`,
            'total_requests': metrics.requests.total
          }
        );
      }

      // Check WhatsApp bot status
      if (health.checks.whatsapp_admin === 'error' &&
          this.shouldSendAlert('WHATSAPP_ADMIN_DOWN')) {
        await this.sendAlert('CRITICAL', 'Admin WhatsApp Bot Down',
          'The admin WhatsApp bot has disconnected',
          { 'status': health.checks.whatsapp_admin }
        );
      }

      if (health.checks.whatsapp_client === 'error' &&
          this.shouldSendAlert('WHATSAPP_CLIENT_DOWN')) {
        await this.sendAlert('ERROR', 'Client WhatsApp Bot Down',
          'The client WhatsApp bot has disconnected',
          { 'status': health.checks.whatsapp_client }
        );
      }

      // Check overall system status
      if (
        health.status === 'down' &&
        this.shouldSendAlert('SYSTEM_DOWN')
      ) {
        await this.sendAlert('CRITICAL', 'System Down',
          'The system is currently down or severely degraded',
          {
            'status': health.status,
            'error_rate': `${Math.round((metrics.requests.errors / (metrics.requests.total || 1)) * 100)}%`
          }
        );
      }
    } catch (err) {
      logger.error('[Alert] Error in checkAndAlert:', err.message);
    }
  }

  /**
   * Calculate database health percentage
   */
  calculateDatabaseHealth(dbMetrics) {
    const total = dbMetrics.successfulQueries + dbMetrics.failedQueries;
    if (total === 0) return 100;

    return Math.round((dbMetrics.successfulQueries / total) * 100);
  }

  /**
   * Get alert history
   */
  getAlertHistory(limit = 20) {
    return this.alertHistory.slice(-limit).reverse();
  }

  /**
   * Clear alert history
   */
  clearHistory() {
    this.alertHistory = [];
  }

  /**
   * Get alert status (what alerts have been triggered recently)
   */
  getAlertStatus() {
    const now = Date.now();
    const recentAlerts = this.alertHistory.filter(
      a => now - a.timestamp < 3600000 // Last hour
    );

    const severityCounts = {
      CRITICAL: 0,
      ERROR: 0,
      WARNING: 0,
      INFO: 0
    };

    for (const alert of recentAlerts) {
      if (severityCounts[alert.severity] !== undefined) {
        severityCounts[alert.severity]++;
      }
    }

    return {
      recentAlerts: recentAlerts.length,
      ...severityCounts,
      lastAlert: recentAlerts.length > 0 ? recentAlerts[0] : null
    };
  }
}

// Singleton instance
const alertService = new AlertService();

module.exports = alertService;
