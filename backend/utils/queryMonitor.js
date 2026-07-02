/**
 * Query Performance Monitor
 * FASE 3.5: Track query execution times and identify slow queries
 *
 * Features:
 * - Capture query execution time
 * - Detect slow queries (>100ms, >1000ms)
 * - Track N+1 query patterns
 * - Percentile analysis (p50, p95, p99)
 * - Real-time performance metrics
 */

class QueryMonitor {
  constructor() {
    this.queries = [];
    this.maxQueries = 1000;           // Keep last 1000 queries
    this.slowQueryThreshold = 100;    // 100ms is "slow"
    this.verySlowThreshold = 1000;    // 1000ms is "very slow"
    this.alertThreshold = 5000;       // 5000ms requires alert

    // Statistics
    this.stats = {
      totalQueries: 0,
      totalTime: 0,
      slowQueries: 0,
      verySlowQueries: 0,
      byType: {}  // e.g., {SELECT: 100, INSERT: 50, UPDATE: 25}
    };
  }

  /**
   * Record a query execution
   *
   * @param {string} query - SQL query (sanitized)
   * @param {number} duration - Execution time in ms
   * @param {boolean} success - Whether query succeeded
   * @param {string} error - Error message if failed
   */
  recordQuery(query, duration, success = true, error = null) {
    // Extract query type
    const type = this.extractQueryType(query);

    // Create record
    const record = {
      query: this.sanitizeQuery(query),
      type,
      duration,
      success,
      error,
      timestamp: new Date(),
      isSlow: duration > this.slowQueryThreshold,
      isVerySlow: duration > this.verySlowThreshold,
      requiresAlert: duration > this.alertThreshold
    };

    // Add to history (keep last N)
    this.queries.push(record);
    if (this.queries.length > this.maxQueries) {
      this.queries.shift();
    }

    // Update statistics
    this.stats.totalQueries++;
    this.stats.totalTime += duration;

    if (duration > this.verySlowThreshold) {
      this.stats.verySlowQueries++;
    } else if (duration > this.slowQueryThreshold) {
      this.stats.slowQueries++;
    }

    // Count by type
    if (!this.stats.byType[type]) {
      this.stats.byType[type] = { count: 0, totalTime: 0, slowCount: 0 };
    }
    this.stats.byType[type].count++;
    this.stats.byType[type].totalTime += duration;
    if (record.isSlow) {
      this.stats.byType[type].slowCount++;
    }

    // Log if very slow
    if (record.requiresAlert) {
      console.warn(`[QueryMonitor] ⚠️ SLOW QUERY (${duration}ms):`, record.query);
    }

    return record;
  }

  /**
   * Extract query type (SELECT, INSERT, UPDATE, DELETE, etc)
   */
  extractQueryType(query) {
    if (!query) return 'UNKNOWN';
    const match = query.trim().toUpperCase().match(/^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)/);
    return match ? match[1] : 'UNKNOWN';
  }

  /**
   * Sanitize query for logging (remove sensitive data)
   */
  sanitizeQuery(query) {
    if (!query) return '';
    let sanitized = query;

    // Limit length for logging
    if (sanitized.length > 200) {
      sanitized = sanitized.substring(0, 200) + '...';
    }

    return sanitized;
  }

  /**
   * Get performance statistics
   */
  getStats() {
    const avgTime = this.stats.totalQueries > 0
      ? (this.stats.totalTime / this.stats.totalQueries).toFixed(2)
      : 0;

    return {
      totalQueries: this.stats.totalQueries,
      totalTimeMs: this.stats.totalTime,
      averageTimeMs: parseFloat(avgTime),
      slowQueries: this.stats.slowQueries,
      verySlowQueries: this.stats.verySlowQueries,
      slowQueryRate: this.stats.totalQueries > 0
        ? (this.stats.slowQueries / this.stats.totalQueries * 100).toFixed(2) + '%'
        : '0%',
      byType: this.stats.byType
    };
  }

  /**
   * Get percentile latencies
   */
  getPercentiles() {
    if (this.queries.length === 0) {
      return { p50: 0, p95: 0, p99: 0 };
    }

    // Sort by duration
    const sorted = [...this.queries].sort((a, b) => a.duration - b.duration);

    return {
      p50: sorted[Math.floor(sorted.length * 0.5)].duration,
      p95: sorted[Math.floor(sorted.length * 0.95)].duration,
      p99: sorted[Math.floor(sorted.length * 0.99)].duration,
      max: sorted[sorted.length - 1].duration,
      min: sorted[0].duration
    };
  }

  /**
   * Get slowest queries
   */
  getSlowestQueries(limit = 10) {
    return this.queries
      .filter(q => q.isSlow)
      .sort((a, b) => b.duration - a.duration)
      .slice(0, limit)
      .map(q => ({
        query: q.query,
        type: q.type,
        duration: q.duration,
        timestamp: q.timestamp
      }));
  }

  /**
   * Detect N+1 query patterns
   * E.g.: SELECT from users, then SELECT from posts WHERE user_id = X for each user
   */
  detectN1Patterns() {
    const patterns = {};

    // Group queries by type and base table
    this.queries.forEach(q => {
      const key = `${q.type}:${this.extractTable(q.query)}`;
      if (!patterns[key]) {
        patterns[key] = { count: 0, totalTime: 0, instances: [] };
      }
      patterns[key].count++;
      patterns[key].totalTime += q.duration;
      patterns[key].instances.push(q);
    });

    // Find potential N+1 patterns
    const n1Patterns = [];
    for (const [key, data] of Object.entries(patterns)) {
      // If SELECT appears many times in short timeframe
      if (key.startsWith('SELECT') && data.count > 10) {
        n1Patterns.push({
          pattern: key,
          count: data.count,
          totalTimeMs: data.totalTime,
          avgTimePerQuery: (data.totalTime / data.count).toFixed(2),
          severity: data.count > 100 ? 'high' : data.count > 50 ? 'medium' : 'low'
        });
      }
    }

    return n1Patterns;
  }

  /**
   * Extract table name from query (basic)
   */
  extractTable(query) {
    if (!query) return 'unknown';

    // Try to extract table name (basic pattern matching)
    let match = query.match(/FROM\s+(\w+)/i);
    if (match) return match[1].toLowerCase();

    match = query.match(/INTO\s+(\w+)/i);
    if (match) return match[1].toLowerCase();

    match = query.match(/UPDATE\s+(\w+)/i);
    if (match) return match[1].toLowerCase();

    return 'unknown';
  }

  /**
   * Get query health score (0-100)
   * Based on slow query rate, average time, and percentiles
   */
  getHealthScore() {
    if (this.stats.totalQueries === 0) return 100;

    let score = 100;

    // Penalize slow query rate
    const slowRate = this.stats.slowQueries / this.stats.totalQueries;
    score -= slowRate * 30; // Max -30 for high slow rate

    // Penalize average time
    const avgTime = this.stats.totalTime / this.stats.totalQueries;
    if (avgTime > 100) score -= (avgTime - 100) / 100; // Penalize >100ms

    // Penalize very slow queries
    score -= this.stats.verySlowQueries * 2; // -2 per very slow query

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Get detailed performance report
   */
  getPerformanceReport() {
    return {
      timestamp: new Date(),
      summary: this.getStats(),
      percentiles: this.getPercentiles(),
      healthScore: this.getHealthScore(),
      slowestQueries: this.getSlowestQueries(10),
      n1Patterns: this.detectN1Patterns(),
      recommendations: this.getRecommendations()
    };
  }

  /**
   * Get performance recommendations
   */
  getRecommendations() {
    const recommendations = [];
    const slowRate = this.stats.totalQueries > 0
      ? this.stats.slowQueries / this.stats.totalQueries
      : 0;

    if (slowRate > 0.1) {
      recommendations.push({
        severity: 'high',
        message: `High slow query rate: ${(slowRate * 100).toFixed(1)}% of queries exceed 100ms`,
        action: 'Review slow query list and consider adding indexes or optimizing queries'
      });
    }

    if (this.stats.verySlowQueries > 5) {
      recommendations.push({
        severity: 'high',
        message: `${this.stats.verySlowQueries} queries exceed 1000ms`,
        action: 'These queries require immediate optimization. Check if indexes are missing.'
      });
    }

    const n1Patterns = this.detectN1Patterns();
    if (n1Patterns.length > 0) {
      recommendations.push({
        severity: 'medium',
        message: `Potential N+1 query pattern detected: ${n1Patterns[0].pattern}`,
        action: 'Use JOINs instead of separate queries or implement query batching'
      });
    }

    const avgTime = this.stats.totalQueries > 0
      ? this.stats.totalTime / this.stats.totalQueries
      : 0;
    if (avgTime > 100) {
      recommendations.push({
        severity: 'medium',
        message: `Average query time is high: ${avgTime.toFixed(0)}ms`,
        action: 'Consider implementing caching (FASE 3.3) or query optimization'
      });
    }

    return recommendations;
  }

  /**
   * Reset statistics
   */
  reset() {
    this.queries = [];
    this.stats = {
      totalQueries: 0,
      totalTime: 0,
      slowQueries: 0,
      verySlowQueries: 0,
      byType: {}
    };
  }

  /**
   * Get last N queries
   */
  getRecentQueries(limit = 50) {
    return this.queries.slice(-limit);
  }
}

// Singleton instance
let instance = null;

function getInstance() {
  if (!instance) {
    instance = new QueryMonitor();
  }
  return instance;
}

module.exports = {
  getInstance,
  QueryMonitor
};
