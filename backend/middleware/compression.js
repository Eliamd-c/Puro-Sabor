/**
 * Response Compression Middleware
 * FASE 3.2: Optimize data transfer with HTTP compression
 *
 * Strategies:
 * 1. Gzip compression (all clients)
 * 2. Brotli compression (modern browsers, better ratio)
 * 3. Response optimization (remove unnecessary fields)
 * 4. Smart filtering (don't compress already-compressed)
 */

const compression = require('compression');
const zlib = require('zlib');

// ─────────────────────────────────────────────────────────────────────────────
// Compression Levels
// ─────────────────────────────────────────────────────────────────────────────
const GZIP_LEVEL = 6;      // Balance: speed vs ratio (6 is default)
const BROTLI_LEVEL = 11;   // Max compression (11 = slowest but best ratio)
const MIN_SIZE = 1024;     // Don't compress <1KB (overhead not worth it)

// ─────────────────────────────────────────────────────────────────────────────
// MIME types to compress (all text-based content)
// ─────────────────────────────────────────────────────────────────────────────
const COMPRESSIBLE_TYPES = [
  'application/json',
  'application/javascript',
  'application/xml',
  'application/x-www-form-urlencoded',
  'text/html',
  'text/plain',
  'text/xml',
  'text/css',
  'text/csv',
  'application/ld+json',
  'application/hal+json'
];

// ─────────────────────────────────────────────────────────────────────────────
// MIME types that are already compressed (skip)
// ─────────────────────────────────────────────────────────────────────────────
const SKIP_COMPRESSION = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'video/mp4',
  'video/webm',
  'audio/mp3',
  'application/zip',
  'application/gzip',
  'application/pdf',
  'font/woff',
  'font/woff2'
];

/**
 * Determine if response should be compressed
 *
 * Skip if:
 * - Client disabled compression (x-no-compression header)
 * - Content already compressed
 * - Content too small
 * - Streaming response (res.headersSent)
 */
function shouldCompress(req, res) {
  // Client requested no compression
  if (req.headers['x-no-compression']) {
    return false;
  }

  // Headers already sent (streaming)
  if (res.headersSent) {
    return false;
  }

  // Get content type
  const type = res.getHeader('content-type');
  if (!type) {
    return false;
  }

  // Extract MIME type (remove charset, etc)
  const mime = type.split(';')[0].trim();

  // Already compressed format
  if (SKIP_COMPRESSION.includes(mime)) {
    return false;
  }

  // Not a compressible type
  if (!COMPRESSIBLE_TYPES.includes(mime)) {
    return false;
  }

  // Check content length
  const length = res.getHeader('content-length');
  if (length && parseInt(length) < MIN_SIZE) {
    return false;
  }

  return true;
}

/**
 * Gzip compression middleware
 * Most compatible, supported by all browsers
 */
function gzipMiddleware() {
  return compression({
    filter: shouldCompress,
    level: GZIP_LEVEL,
    threshold: MIN_SIZE
  });
}

/**
 * Brotli compression middleware
 * Better compression ratio, but slower
 * Only use for modern browsers (detect via header)
 */
function brotliMiddleware() {
  return (req, res, next) => {
    // Check if client supports Brotli
    const accept = req.headers['accept-encoding'] || '';
    if (!accept.includes('br')) {
      return next();
    }

    // Skip if we shouldn't compress
    if (!shouldCompress(req, res)) {
      return next();
    }

    // Wrap res.end() to compress before sending
    const originalEnd = res.end;
    const originalWrite = res.write;
    let chunks = [];
    let isCompressed = false;

    // Intercept write calls
    res.write = function(chunk, encoding) {
      if (!isCompressed && chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
        return true;
      }
      return originalWrite.call(this, chunk, encoding);
    };

    // Intercept end call
    res.end = function(chunk, encoding) {
      if (chunk && !isCompressed) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
      }

      if (chunks.length === 0 || isCompressed) {
        return originalEnd.call(this, chunk, encoding);
      }

      const buffer = Buffer.concat(chunks);

      // Check if compression is worth it
      if (buffer.length < MIN_SIZE) {
        isCompressed = true;
        return originalEnd.call(this, buffer);
      }

      // Compress with Brotli
      zlib.brotliCompress(buffer, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_LEVEL
        }
      }, (err, compressed) => {
        isCompressed = true;

        if (err) {
          // Fall back to uncompressed on error
          console.warn('[Compression] Brotli error, sending uncompressed:', err.message);
          return originalEnd.call(this, buffer);
        }

        // Only use compression if it's actually smaller
        if (compressed.length >= buffer.length) {
          return originalEnd.call(this, buffer);
        }

        // Set compression headers
        res.setHeader('content-encoding', 'br');
        res.setHeader('content-length', compressed.length);
        return originalEnd.call(this, compressed);
      });
    };

    next();
  };
}

/**
 * Response optimization middleware
 * Remove unnecessary fields to reduce payload size
 *
 * Before: {"id": 1, "name": "Product", "password_hash": "xxx", "internal_notes": "xxx"}
 * After: {"id": 1, "name": "Product"}
 */
function optimizeResponse() {
  return (req, res, next) => {
    // Track original send
    const originalSend = res.json;

    // Override json method
    res.json = function(data) {
      // If it's already a response, pass through
      if (!data || typeof data !== 'object') {
        return originalSend.call(this, data);
      }

      // Try to optimize the response
      try {
        const optimized = optimizeObject(data);
        return originalSend.call(this, optimized);
      } catch (err) {
        // If optimization fails, send original
        console.warn('[Compression] Optimization error:', err.message);
        return originalSend.call(this, data);
      }
    };

    next();
  };
}

/**
 * Recursively optimize object by removing unnecessary fields
 */
function optimizeObject(obj) {
  if (Array.isArray(obj)) {
    return obj.map(item => optimizeObject(item));
  }

  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  const optimized = {};

  // Fields to ALWAYS exclude (internal, security)
  const EXCLUDE_FIELDS = [
    'password',
    'password_hash',
    'internal_notes',
    'debug_info',
    'secret',
    'api_key',
    'private_key',
    'token',
    'refresh_token',
    '__v',        // Mongoose version
    '_id'         // Mongo ID if not primary key
  ];

  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      // Skip excluded fields
      if (EXCLUDE_FIELDS.includes(key.toLowerCase())) {
        continue;
      }

      // Recursively optimize nested objects
      const value = obj[key];
      if (value !== null && typeof value === 'object') {
        optimized[key] = optimizeObject(value);
      } else {
        optimized[key] = value;
      }
    }
  }

  return optimized;
}

/**
 * Statistics middleware
 * Track compression metrics
 */
let compressionStats = {
  totalRequests: 0,
  compressedRequests: 0,
  bytesSent: 0,
  bytesCompressed: 0,
  avgRatio: 0
};

function statsMiddleware() {
  return (req, res, next) => {
    compressionStats.totalRequests++;

    const originalEnd = res.end;
    res.end = function(chunk, encoding) {
      if (res.getHeader('content-encoding') === 'gzip' ||
          res.getHeader('content-encoding') === 'br') {
        compressionStats.compressedRequests++;
      }

      const length = res.getHeader('content-length');
      if (length) {
        compressionStats.bytesSent += parseInt(length);
      }

      return originalEnd.call(this, chunk, encoding);
    };

    next();
  };
}

/**
 * Get compression statistics
 */
function getStats() {
  const ratio = compressionStats.totalRequests > 0
    ? (compressionStats.compressedRequests / compressionStats.totalRequests * 100).toFixed(2)
    : 0;

  return {
    totalRequests: compressionStats.totalRequests,
    compressedRequests: compressionStats.compressedRequests,
    compressionRate: `${ratio}%`,
    bytesSent: compressionStats.bytesSent,
    bytesSentMB: (compressionStats.bytesSent / 1024 / 1024).toFixed(2),
    estimatedBytesWithoutCompression: (compressionStats.bytesSent * 3.33).toFixed(0) // Assume 70% compression
  };
}

/**
 * Reset compression statistics
 */
function resetStats() {
  compressionStats = {
    totalRequests: 0,
    compressedRequests: 0,
    bytesSent: 0,
    bytesCompressed: 0,
    avgRatio: 0
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Export middleware stack
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Middleware factories
  gzip: gzipMiddleware,
  brotli: brotliMiddleware,
  optimize: optimizeResponse,
  stats: statsMiddleware,

  // Utilities
  getStats,
  resetStats,
  shouldCompress,
  optimizeObject,

  // Constants
  GZIP_LEVEL,
  BROTLI_LEVEL,
  MIN_SIZE,
  COMPRESSIBLE_TYPES,
  SKIP_COMPRESSION
};
