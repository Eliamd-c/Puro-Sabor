/**
 * Rate Limiting & Media Download Queue Service
 *
 * Implementa:
 * - Rate limiting diferenciado (admin vs clientes)
 * - Media download queue con concurrencia controlada
 * - Detección de archivos grandes
 * - Timeout y cancelación automática
 */

const fs = require('fs');
const path = require('path');

// ╔════════════════════════════════════════════════════════════════╗
// ║  RATE LIMITING                                                 ║
// ╚════════════════════════════════════════════════════════════════╝

/**
 * Límites de rate según tipo de usuario
 * Format: { maxRequests, windowMs }
 */
const RATE_LIMITS = {
  admin: {
    messages: { maxRequests: 30, windowMs: 60 * 1000 },        // 30 msg/min
    functions: { maxRequests: 30, windowMs: 60 * 1000 },      // 30 funciones/min
    media: { maxRequests: 10, windowMs: 60 * 1000 }           // 10 descargas/min
  },
  client: {
    messages: { maxRequests: 10, windowMs: 60 * 1000 },       // 10 msg/min
    functions: { maxRequests: 5, windowMs: 60 * 1000 },       // 5 funciones/min
    media: { maxRequests: 3, windowMs: 60 * 1000 }            // 3 descargas/min
  }
};

// Cache en memoria para rate limiting
// Structure: { number: { category: { count, resetAt } } }
const rateLimitCache = new Map();

/**
 * Cleanup cache cada 30 minutos (borrar entradas expiradas)
 */
setInterval(() => {
  const now = Date.now();
  for (const [number, categories] of rateLimitCache.entries()) {
    for (const [category, data] of Object.entries(categories)) {
      if (data.resetAt < now) {
        delete categories[category];
      }
    }
    if (Object.keys(categories).length === 0) {
      rateLimitCache.delete(number);
    }
  }
}, 30 * 60 * 1000);

/**
 * Verifica si un número ha excedido rate limit
 *
 * @param {string} number - Número de teléfono
 * @param {string} category - Categoría (messages, functions, media)
 * @param {string} userType - 'admin' o 'client'
 * @returns {object} { allowed: boolean, remaining: number, resetIn: number }
 */
function checkRateLimit(number, category, userType = 'client') {
  const limits = RATE_LIMITS[userType]?.[category];
  if (!limits) {
    console.warn(`[Rate Limit] Límite no encontrado para ${userType}.${category}`);
    return { allowed: true }; // Permiso por defecto si no hay límite
  }

  const now = Date.now();
  let userLimits = rateLimitCache.get(number);

  if (!userLimits) {
    userLimits = {};
    rateLimitCache.set(number, userLimits);
  }

  let categoryData = userLimits[category];

  // Resetear si la ventana expiró
  if (!categoryData || now > categoryData.resetAt) {
    categoryData = {
      count: 0,
      resetAt: now + limits.windowMs
    };
    userLimits[category] = categoryData;
  }

  const allowed = categoryData.count < limits.maxRequests;
  const resetIn = Math.max(0, categoryData.resetAt - now);
  const remaining = Math.max(0, limits.maxRequests - categoryData.count);

  if (allowed) {
    categoryData.count++;
  }

  return {
    allowed,
    remaining,
    resetIn,
    limit: limits.maxRequests
  };
}

/**
 * Obtiene información de rate limit sin incrementar counter
 *
 * @param {string} number - Número de teléfono
 * @param {string} category - Categoría
 * @param {string} userType - 'admin' o 'client'
 * @returns {object} { limit, remaining, resetIn }
 */
function getRateLimitStatus(number, category, userType = 'client') {
  const limits = RATE_LIMITS[userType]?.[category];
  if (!limits) return null;

  const now = Date.now();
  const userLimits = rateLimitCache.get(number);
  const categoryData = userLimits?.[category];

  if (!categoryData || now > categoryData.resetAt) {
    return {
      limit: limits.maxRequests,
      remaining: limits.maxRequests,
      resetIn: 0
    };
  }

  return {
    limit: limits.maxRequests,
    remaining: Math.max(0, limits.maxRequests - categoryData.count),
    resetIn: Math.max(0, categoryData.resetAt - now)
  };
}

/**
 * Reset manual del rate limit para un número
 * (útil para admin reset o testing)
 *
 * @param {string} number - Número a resetear
 * @param {string} category - Categoría a resetear (opcional)
 */
function resetRateLimit(number, category = null) {
  if (!rateLimitCache.has(number)) return;

  const userLimits = rateLimitCache.get(number);

  if (category) {
    delete userLimits[category];
  } else {
    rateLimitCache.delete(number);
  }

  console.log(`[Rate Limit] Reset para ${number}${category ? ` (${category})` : ''}`);
}

// ╔════════════════════════════════════════════════════════════════╗
// ║  MEDIA DOWNLOAD QUEUE                                          ║
// ╚════════════════════════════════════════════════════════════════╝

// Configuración de descargas
const MEDIA_CONFIG = {
  MAX_CONCURRENT_DOWNLOADS: 2,      // Máximo 2 descargas simultáneas
  MAX_DOWNLOAD_SIZE: 50 * 1024 * 1024, // 50MB máximo
  LARGE_FILE_THRESHOLD: 10 * 1024 * 1024, // 10MB se considera "grande"
  DOWNLOAD_TIMEOUT: 30 * 1000        // 30 segundos de timeout
};

/**
 * Cola de descargas con control de concurrencia
 */
class MediaDownloadQueue {
  constructor() {
    this.queue = [];
    this.activeDownloads = new Map(); // { id: { status, progress, error } }
    this.downloadId = 0;
  }

  /**
   * Agrega descarga a la cola
   *
   * @param {string} filePath - Ruta del archivo
   * @param {Function} onProgress - Callback de progreso
   * @returns {Promise<Buffer>} Contenido del archivo
   */
  async download(filePath, onProgress = null) {
    return new Promise((resolve, reject) => {
      const downloadId = ++this.downloadId;

      const task = {
        id: downloadId,
        filePath,
        onProgress,
        resolve,
        reject
      };

      this.queue.push(task);
      this.activeDownloads.set(downloadId, {
        status: 'queued',
        progress: 0,
        error: null
      });

      console.log(`[Download Queue] #${downloadId} encolado: ${path.basename(filePath)}`);
      this._processQueue();
    });
  }

  /**
   * Procesa la cola de descargas
   */
  _processQueue() {
    // No iniciar más descargas si ya hay MAX_CONCURRENT
    if (this.activeDownloads.size >= MEDIA_CONFIG.MAX_CONCURRENT_DOWNLOADS) {
      return;
    }

    const task = this.queue.shift();
    if (!task) return;

    this._executeDownload(task);
  }

  /**
   * Ejecuta descarga de un archivo
   */
  async _executeDownload(task) {
    const { id, filePath, onProgress, resolve, reject } = task;

    console.log(`[Download Queue] #${id} iniciando: ${path.basename(filePath)}`);

    this.activeDownloads.set(id, {
      status: 'downloading',
      progress: 0,
      error: null
    });

    try {
      // Verificar tamaño
      const stats = fs.statSync(filePath);
      const fileSize = stats.size;

      if (fileSize > MEDIA_CONFIG.MAX_DOWNLOAD_SIZE) {
        throw new Error(
          `Archivo muy grande (${Math.round(fileSize / 1024 / 1024)}MB). Máximo: 50MB`
        );
      }

      // Descargar con timeout
      const data = await this._readFileWithTimeout(filePath, (progress) => {
        const progressPercent = Math.round((progress / fileSize) * 100);
        this.activeDownloads.set(id, {
          status: 'downloading',
          progress: progressPercent,
          error: null
        });

        if (onProgress) {
          onProgress(progressPercent, fileSize, progress);
        }
      });

      console.log(`[Download Queue] #${id} completado: ${Math.round(fileSize / 1024)}KB`);

      this.activeDownloads.set(id, {
        status: 'completed',
        progress: 100,
        error: null
      });

      resolve(data);
    } catch (err) {
      console.error(`[Download Queue] #${id} error: ${err.message}`);

      this.activeDownloads.set(id, {
        status: 'error',
        progress: 0,
        error: err.message
      });

      reject(err);
    } finally {
      // Limpiar y procesar siguiente
      setTimeout(() => {
        this.activeDownloads.delete(id);
        this._processQueue();
      }, 100);
    }
  }

  /**
   * Lee archivo con timeout
   */
  _readFileWithTimeout(filePath, onProgress) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout descargando archivo (>${MEDIA_CONFIG.DOWNLOAD_TIMEOUT}ms)`));
      }, MEDIA_CONFIG.DOWNLOAD_TIMEOUT);

      const stream = fs.createReadStream(filePath);
      const chunks = [];
      let bytesRead = 0;

      stream.on('data', (chunk) => {
        chunks.push(chunk);
        bytesRead += chunk.length;
        onProgress(bytesRead);
      });

      stream.on('end', () => {
        clearTimeout(timeout);
        resolve(Buffer.concat(chunks));
      });

      stream.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * Obtiene estado de la cola
   */
  getStatus() {
    return {
      queued: this.queue.length,
      active: this.activeDownloads.size,
      maxConcurrent: MEDIA_CONFIG.MAX_CONCURRENT_DOWNLOADS,
      downloads: Array.from(this.activeDownloads.values())
    };
  }

  /**
   * Cancela descarga específica
   */
  cancel(downloadId) {
    if (this.activeDownloads.has(downloadId)) {
      this.activeDownloads.delete(downloadId);
      this.queue = this.queue.filter(t => t.id !== downloadId);
      console.log(`[Download Queue] #${downloadId} cancelado`);
      return true;
    }
    return false;
  }
}

// Instancia global de la cola
const globalDownloadQueue = new MediaDownloadQueue();

/**
 * Detecta si archivo es "grande" (requiere atención especial)
 *
 * @param {string} filePath - Ruta del archivo
 * @returns {object} { isLarge: boolean, size: number, sizeFormatted: string }
 */
function isLargeFile(filePath) {
  try {
    const stats = fs.statSync(filePath);
    const size = stats.size;
    const isLarge = size > MEDIA_CONFIG.LARGE_FILE_THRESHOLD;

    return {
      isLarge,
      size,
      sizeFormatted: formatBytes(size)
    };
  } catch (err) {
    return {
      isLarge: false,
      size: 0,
      sizeFormatted: '0B',
      error: err.message
    };
  }
}

/**
 * Formatea bytes a string legible
 *
 * @param {number} bytes - Cantidad de bytes
 * @returns {string} Ej: "2.5MB"
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

module.exports = {
  // Rate Limiting
  checkRateLimit,
  getRateLimitStatus,
  resetRateLimit,
  RATE_LIMITS,

  // Media Download Queue
  MediaDownloadQueue,
  globalDownloadQueue,
  isLargeFile,
  formatBytes,
  MEDIA_CONFIG
};
