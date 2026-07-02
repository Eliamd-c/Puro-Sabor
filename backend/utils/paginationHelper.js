/**
 * Pagination Helper
 * FASE 3.4: Offset-based and cursor-based pagination
 *
 * Two strategies:
 * 1. Offset pagination: Simple but slow on large datasets
 * 2. Cursor pagination: Fast, no offset calculation needed
 */

/**
 * Validate and normalize pagination params
 *
 * @param {number} page - Current page (1-based)
 * @param {number} limit - Items per page
 * @returns {object} Normalized {page, limit, offset}
 */
function normalizePagination(page = 1, limit = 20) {
  // Validate page
  const normalizedPage = Math.max(1, parseInt(page) || 1);

  // Validate limit (min 1, max 500 to prevent abuse)
  const MIN_LIMIT = 1;
  const MAX_LIMIT = 500;
  const normalizedLimit = Math.max(
    MIN_LIMIT,
    Math.min(MAX_LIMIT, parseInt(limit) || 20)
  );

  // Calculate offset for SQL LIMIT/OFFSET
  const offset = (normalizedPage - 1) * normalizedLimit;

  return {
    page: normalizedPage,
    limit: normalizedLimit,
    offset
  };
}

/**
 * Build pagination response metadata
 *
 * @param {number} page - Current page
 * @param {number} limit - Items per page
 * @param {number} total - Total items in collection
 * @returns {object} Pagination metadata
 */
function buildPaginationMeta(page, limit, total) {
  const totalPages = Math.ceil(total / limit);
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;

  return {
    page,
    limit,
    total,
    pages: totalPages,
    hasNext: hasNextPage,
    hasPrev: hasPrevPage,
    startIndex: (page - 1) * limit + 1,
    endIndex: Math.min(page * limit, total)
  };
}

/**
 * Cursor-based pagination (keyset pagination)
 * Better for large datasets and real-time data
 *
 * Usage:
 * - First request: GET /api/items?cursor=null&limit=50
 * - Next request: GET /api/items?cursor=<nextCursor>&limit=50
 *
 * @param {string} cursor - Encoded cursor (JSON base64)
 * @param {number} limit - Items per page
 * @returns {object} {decodedCursor, limit, whereClause}
 */
function parseCursor(cursor, limit = 50) {
  // Validate limit
  const MAX_LIMIT = 500;
  const normalizedLimit = Math.max(1, Math.min(MAX_LIMIT, parseInt(limit) || 50));

  // First request (no cursor)
  if (!cursor) {
    return {
      decodedCursor: null,
      limit: normalizedLimit,
      whereClause: null
    };
  }

  try {
    // Decode cursor (base64 encoded JSON)
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);

    return {
      decodedCursor: parsed,
      limit: normalizedLimit,
      whereClause: buildCursorWhereClause(parsed)
    };
  } catch (err) {
    console.warn('[Pagination] Invalid cursor:', err.message);
    // Return null cursor on error (restart from beginning)
    return {
      decodedCursor: null,
      limit: normalizedLimit,
      whereClause: null
    };
  }
}

/**
 * Build WHERE clause from cursor
 * Cursor contains: {id, timestamp, ...}
 * Returns: WHERE id < 123 AND created_at < '2026-07-02...' ORDER BY id DESC
 *
 * @param {object} cursor - Parsed cursor object
 * @returns {string} SQL WHERE clause
 */
function buildCursorWhereClause(cursor) {
  if (!cursor) return null;

  const conditions = [];

  // Handle different cursor types
  if (cursor.id !== undefined) {
    conditions.push(`id < ${cursor.id}`);
  }

  if (cursor.timestamp !== undefined) {
    conditions.push(`created_at < '${cursor.timestamp}'`);
  }

  if (cursor.field && cursor.value !== undefined) {
    conditions.push(`${cursor.field} < ${cursor.value}`);
  }

  return conditions.length > 0 ? conditions.join(' AND ') : null;
}

/**
 * Encode cursor for next page
 * Cursor is JSON-encoded and base64-encoded for URL safety
 *
 * @param {object} lastItem - Last item from current page
 * @param {array} cursorFields - Fields to include in cursor (e.g., ['id', 'created_at'])
 * @returns {string} Encoded cursor for next page
 */
function encodeCursor(lastItem, cursorFields = ['id']) {
  const cursor = {};

  for (const field of cursorFields) {
    if (lastItem[field] !== undefined) {
      cursor[field] = lastItem[field];
    }
  }

  // If no fields found, use id as fallback
  if (Object.keys(cursor).length === 0 && lastItem.id !== undefined) {
    cursor.id = lastItem.id;
  }

  // JSON encode and base64
  const json = JSON.stringify(cursor);
  return Buffer.from(json, 'utf-8').toString('base64');
}

/**
 * Build offset-based pagination response
 *
 * @param {array} data - Page data
 * @param {number} page - Current page
 * @param {number} limit - Items per page
 * @param {number} total - Total items
 * @returns {object} Paginated response
 */
function buildOffsetPaginatedResponse(data, page, limit, total) {
  return {
    data,
    pagination: buildPaginationMeta(page, limit, total)
  };
}

/**
 * Build cursor-based pagination response
 *
 * @param {array} data - Page data
 * @param {number} limit - Items per page
 * @param {number} total - Total items (optional)
 * @param {array} cursorFields - Fields for cursor (default: ['id'])
 * @returns {object} Cursor-paginated response
 */
function buildCursorPaginatedResponse(data, limit, total = null, cursorFields = ['id']) {
  const response = {
    data,
    pagination: {
      count: data.length,
      limit,
      hasMore: data.length >= limit
    }
  };

  // Add cursor for next page if there's more data
  if (data.length > 0 && data.length >= limit) {
    response.pagination.nextCursor = encodeCursor(data[data.length - 1], cursorFields);
  }

  // Add total if provided
  if (total !== null) {
    response.pagination.total = total;
  }

  return response;
}

/**
 * Parse request query parameters for pagination
 *
 * @param {object} query - Express request.query
 * @returns {object} {page, limit, offset, useCursor}
 */
function parsePaginationParams(query) {
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 20;
  const cursor = query.cursor || null;

  if (cursor) {
    // Cursor-based pagination
    const { decodedCursor, limit: normalizedLimit, whereClause } = parseCursor(cursor, limit);
    return {
      cursor,
      decodedCursor,
      limit: normalizedLimit,
      whereClause,
      useCursor: true
    };
  } else {
    // Offset-based pagination
    const { page: normalizedPage, limit: normalizedLimit, offset } = normalizePagination(page, limit);
    return {
      page: normalizedPage,
      limit: normalizedLimit,
      offset,
      useCursor: false
    };
  }
}

/**
 * Middleware to inject pagination helpers
 * Usage: app.use(paginationMiddleware)
 */
function paginationMiddleware(req, res, next) {
  // Add helpers to request object
  req.pagination = {
    normalize: (page, limit) => normalizePagination(page, limit),
    buildMeta: (page, limit, total) => buildPaginationMeta(page, limit, total),
    parseParams: () => parsePaginationParams(req.query),
    buildOffsetResponse: (data, page, limit, total) =>
      buildOffsetPaginatedResponse(data, page, limit, total),
    buildCursorResponse: (data, limit, total, fields) =>
      buildCursorPaginatedResponse(data, limit, total, fields),
    encodeCursor: (item, fields) => encodeCursor(item, fields),
    parseCursor: (cursor, limit) => parseCursor(cursor, limit)
  };

  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// Export functions
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Offset-based
  normalizePagination,
  buildPaginationMeta,
  buildOffsetPaginatedResponse,

  // Cursor-based
  parseCursor,
  encodeCursor,
  buildCursorWhereClause,
  buildCursorPaginatedResponse,

  // Utilities
  parsePaginationParams,
  paginationMiddleware
};
