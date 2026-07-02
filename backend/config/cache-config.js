/**
 * Cache Configuration
 * FASE 3.3: Multi-level caching strategy
 *
 * TTL times for different data types:
 * - Fast-changing: 1-5 min (rate limits, sessions)
 * - Regular-changing: 30 min (promotions, inventory)
 * - Slow-changing: 1 hour (menu, products)
 * - Static: 24 hours (categories)
 */

module.exports = {
  // ─────────────────────────────────────────────────────────────────────────────
  // Cache TTLs (Time To Live)
  // ─────────────────────────────────────────────────────────────────────────────

  // Product & Menu Data
  MENU_TTL: 60 * 60,           // 1 hour - Menu changes rarely
  CATEGORIES_TTL: 24 * 60 * 60, // 24 hours - Categories almost never change
  PRODUCTS_TTL: 60 * 60,        // 1 hour - Product prices/stock can change
  PRODUCT_BY_ID_TTL: 60 * 60,   // 1 hour - Individual product cache

  // Dynamic Content
  PROMOTIONS_TTL: 30 * 60,      // 30 min - Promotions change frequently
  INVENTORY_TTL: 5 * 60,        // 5 min - Inventory updates often
  LOW_STOCK_TTL: 5 * 60,        // 5 min - Stock alerts need to be fresh

  // Auth & Security
  ADMIN_WHITELIST_TTL: 5 * 60,  // 5 min - Synchronized via cluster
  AUTH_TOKEN_TTL: 30 * 60,      // 30 min - Session tokens
  SESSION_TTL: 60 * 60,         // 1 hour - User sessions

  // Rate Limiting & State
  RATE_LIMIT_TTL: 60,           // 1 min - Rate limit state
  RATE_LIMIT_STATE_TTL: 60,     // 1 min - Refreshed constantly

  // Message History
  MESSAGE_HISTORY_TTL: 60 * 60, // 1 hour - Conversation history
  LAST_MESSAGES_TTL: 10 * 60,   // 10 min - Last messages cache

  // Financial Data
  CASH_REGISTRY_TTL: 30 * 60,   // 30 min - Can be refreshed periodically
  DAILY_SUMMARY_TTL: 5 * 60,    // 5 min - Daily summaries refresh often

  // ─────────────────────────────────────────────────────────────────────────────
  // Cache Levels
  // ─────────────────────────────────────────────────────────────────────────────

  LEVELS: {
    L1: 'redis',     // Distributed cache (cluster-wide)
    L2: 'memory',    // Local memory cache (fast)
    L3: 'database'   // Source of truth
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Cache Invalidation Events (Pub/Sub channels)
  // ─────────────────────────────────────────────────────────────────────────────

  EVENTS: {
    MENU_UPDATED: 'cache:menu:updated',
    PRODUCTS_UPDATED: 'cache:products:updated',
    CATEGORIES_UPDATED: 'cache:categories:updated',
    INVENTORY_UPDATED: 'cache:inventory:updated',
    PROMOTIONS_UPDATED: 'cache:promotions:updated',
    ADMIN_WHITELIST_UPDATED: 'cache:admin_whitelist:updated',
    AUTH_CACHE_CLEARED: 'cache:auth:cleared',
    FULL_CACHE_CLEAR: 'cache:clear:all'
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Cache Key Prefixes (for multi-level cache isolation)
  // ─────────────────────────────────────────────────────────────────────────────

  PREFIXES: {
    MENU: 'cache:menu',
    PRODUCTS: 'cache:products',
    CATEGORIES: 'cache:categories',
    PROMOTIONS: 'cache:promotions',
    INVENTORY: 'cache:inventory',
    WHITELIST: 'cache:whitelist',
    SESSIONS: 'cache:sessions',
    RATE_LIMITS: 'cache:ratelimit',
    MESSAGES: 'cache:messages',
    FINANCIAL: 'cache:financial'
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Cache Warming (pre-load on startup)
  // ─────────────────────────────────────────────────────────────────────────────

  WARM_ON_STARTUP: [
    'categories',
    'menu',
    'promotions'
  ],

  // ─────────────────────────────────────────────────────────────────────────────
  // Memory Cache Limits
  // ─────────────────────────────────────────────────────────────────────────────

  MEMORY_CACHE: {
    MAX_SIZE: 500,           // Max items in memory cache
    CHECK_PERIOD: 5 * 60,    // Check every 5 minutes
    MAX_MEMORY_MB: 100       // Max 100MB for local cache
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Cache Performance Thresholds
  // ─────────────────────────────────────────────────────────────────────────────

  THRESHOLDS: {
    HIT_RATE_TARGET: 0.80,   // Target 80% hit rate
    L1_HIT_TIME_MS: 5,       // Redis should respond in <5ms
    L2_HIT_TIME_MS: 1,       // Memory should respond in <1ms
    DB_MAX_TIME_MS: 100      // DB queries should be <100ms
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Cache Statistics Tracking
  // ─────────────────────────────────────────────────────────────────────────────

  TRACK_STATS: true,
  STATS_INTERVAL: 60 * 1000,  // Report stats every minute
};
