/**
 * Media Security Service
 *
 * Previene:
 * - Path traversal attacks (../../../etc/passwd)
 * - Acceso a archivos fuera de /uploads
 * - MIME type spoofing
 * - Descargas de archivos no permitidos
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../config/database');

const UPLOADS_DIR = path.resolve(__dirname, '..', 'uploads');
const MEDIA_SUBDIR = path.join(UPLOADS_DIR, 'media');

// Whitelist de MIME types permitidos
const ALLOWED_MIME_TYPES = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
  'audio/mpeg': ['mp3'],
  'audio/ogg': ['ogg', 'm4a'],
  'audio/wav': ['wav'],
  'video/mp4': ['mp4'],
  'video/quicktime': ['mov'],
  'application/pdf': ['pdf']
};

const FORBIDDEN_PATTERNS = [
  /\.\./,                    // .. (directory traversal)
  /^\/etc\//,               // /etc/
  /^\/home\//,              // /home/
  /^\/root\//,              // /root/
  /\.env/,                  // .env files
  /\.aws/,                  // .aws credentials
  /\.ssh/,                  // .ssh keys
  /package\.json/,          // package.json
  /config/i,                // config files
  /private/i,               // private files
];

/**
 * Valida una ruta de archivo contra path traversal
 *
 * @param {string} filename - Nombre de archivo (puede incluir path)
 * @param {string} baseDir - Directorio base (default: MEDIA_SUBDIR)
 * @returns {object} { valid: boolean, cleanPath?: string, error?: string }
 */
function sanitizeMediaPath(filename, baseDir = MEDIA_SUBDIR) {
  if (!filename || typeof filename !== 'string') {
    return { valid: false, error: 'Nombre de archivo inválido' };
  }

  // 1. Remover caracteres peligrosos
  let cleaned = filename
    .replace(/\0/g, '')           // Null bytes
    .replace(/\\/g, '/')          // Backslashes (Windows)
    .trim();

  // 2. Verificar patrones peligrosos
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(cleaned)) {
      return {
        valid: false,
        error: `Archivo contiene patrón prohibido: ${pattern}`
      };
    }
  }

  // 3. Usar solo basename (nombre sin path)
  // Esto previene "../../../" incluso si se cuela alguno
  const basename = path.basename(cleaned);

  if (!basename || basename === '.' || basename === '..') {
    return {
      valid: false,
      error: 'Nombre de archivo inválido'
    };
  }

  // 4. Resolver ruta absoluta segura
  const safePath = path.resolve(baseDir, basename);

  // 5. Verificar que esté dentro del directorio permitido
  // Previene symlinks y otros tricks
  try {
    const realPath = fs.realpathSync(safePath);
    const realBaseDir = fs.realpathSync(baseDir);

    if (!realPath.startsWith(realBaseDir)) {
      return {
        valid: false,
        error: 'Ruta resolvida está fuera del directorio permitido'
      };
    }
  } catch (err) {
    // Si el archivo no existe, al menos validar con la ruta teórica
    if (!safePath.startsWith(baseDir)) {
      return {
        valid: false,
        error: 'Ruta está fuera del directorio permitido'
      };
    }
  }

  // 6. Verificar que el archivo existe (si se proporciona flag)
  if (!fs.existsSync(safePath)) {
    return {
      valid: false,
      error: 'Archivo no encontrado'
    };
  }

  return {
    valid: true,
    cleanPath: safePath,
    basename: basename
  };
}

/**
 * Valida que un archivo tiene un MIME type permitido
 *
 * @param {string} filePath - Ruta completa del archivo
 * @param {string} mimeType - MIME type a validar
 * @returns {object} { valid: boolean, error?: string, mimeType?: string }
 */
function validateMimeType(filePath, mimeType) {
  if (!mimeType || typeof mimeType !== 'string') {
    return {
      valid: false,
      error: 'MIME type no especificado'
    };
  }

  // Remover parámetros (e.g., "image/jpeg; charset=utf-8" → "image/jpeg")
  const cleanMime = mimeType.split(';')[0].trim();

  // Verificar whitelist
  if (!ALLOWED_MIME_TYPES[cleanMime]) {
    return {
      valid: false,
      error: `MIME type no permitido: ${cleanMime}. Permitidos: ${Object.keys(ALLOWED_MIME_TYPES).join(', ')}`
    };
  }

  // Validar extensión del archivo
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, '');
  const allowedExts = ALLOWED_MIME_TYPES[cleanMime];

  if (!allowedExts.includes(ext)) {
    return {
      valid: false,
      error: `Extensión .${ext} no permitida para ${cleanMime}. Permitidas: .${allowedExts.join(', .')}`
    };
  }

  return {
    valid: true,
    mimeType: cleanMime
  };
}

/**
 * Calcula hash SHA256 de un archivo (para whitelist)
 *
 * @param {string} filePath - Ruta del archivo
 * @returns {Promise<string>} Hash SHA256 hex
 */
async function getFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Obtiene media desde BD y valida seguridad
 *
 * @param {string} mediaUrl - URL de media desde BD (e.g., "/uploads/media/file.jpg")
 * @param {string} mimeType - MIME type desde BD (e.g., "image/jpeg")
 * @param {string} source - Fuente de la request ('menu', 'promo', 'kb')
 * @returns {object} { valid: boolean, cleanPath?: string, error?: string }
 */
function getSecureMediaPath(mediaUrl, mimeType, source = 'unknown') {
  if (!mediaUrl) {
    return { valid: false, error: 'URL de media no especificada' };
  }

  // 1. Sanitizar ruta
  const sanitized = sanitizeMediaPath(mediaUrl, MEDIA_SUBDIR);
  if (!sanitized.valid) {
    console.error(`[Media Security] Path traversal attempt detected from ${source}: ${mediaUrl}`);
    return sanitized;
  }

  // 2. Validar MIME type
  const mimeValidation = validateMimeType(sanitized.cleanPath, mimeType);
  if (!mimeValidation.valid) {
    console.error(`[Media Security] MIME type validation failed for ${sanitized.cleanPath}: ${mimeType}`);
    return mimeValidation;
  }

  // 3. Verificar que existe
  if (!fs.existsSync(sanitized.cleanPath)) {
    return { valid: false, error: 'Archivo no encontrado en servidor' };
  }

  // 4. Verificar tamaño (máximo 50MB)
  const stats = fs.statSync(sanitized.cleanPath);
  const MAX_SIZE = 50 * 1024 * 1024;
  if (stats.size > MAX_SIZE) {
    return {
      valid: false,
      error: `Archivo muy grande (${Math.round(stats.size / 1024 / 1024)}MB). Máximo: 50MB`
    };
  }

  return {
    valid: true,
    cleanPath: sanitized.cleanPath,
    basename: sanitized.basename,
    mimeType: mimeValidation.mimeType,
    size: stats.size
  };
}

/**
 * Registra media en whitelist (para auditoría)
 *
 * @param {string} filePath - Ruta del archivo
 * @param {string} fileName - Nombre para auditoría
 * @param {string} source - Fuente (menu, promo, kb)
 */
async function whitelistMedia(filePath, fileName, source) {
  try {
    const fileHash = await getFileHash(filePath);
    const stats = fs.statSync(filePath);

    await db.run(
      `INSERT INTO media_whitelist (filename, file_hash, file_size, source, whitelisted_at)
       VALUES (?, ?, ?, ?, NOW())
       ON CONFLICT (file_hash) DO NOTHING`,
      [fileName, fileHash, stats.size, source]
    );

    console.log(`[Media Security] Media whitelisted: ${fileName} (hash: ${fileHash.slice(0, 8)}...)`);
  } catch (err) {
    console.error('[Media Security] Error whitelisting media:', err.message);
  }
}

/**
 * Valida que media está en whitelist
 *
 * @param {string} filePath - Ruta del archivo
 * @returns {Promise<boolean>}
 */
async function isMediaWhitelisted(filePath) {
  try {
    const fileHash = await getFileHash(filePath);

    const row = await db.get(
      `SELECT id FROM media_whitelist WHERE file_hash = ?`,
      [fileHash]
    );

    return !!row;
  } catch (err) {
    console.error('[Media Security] Error checking whitelist:', err.message);
    return false;
  }
}

/**
 * Obtiene información segura sobre un archivo
 *
 * @param {string} filePath - Ruta del archivo
 * @returns {object} { name, size, mimeType, hash, exists }
 */
async function getMediaInfo(filePath) {
  const sanitized = sanitizeMediaPath(filePath, MEDIA_SUBDIR);
  if (!sanitized.valid) {
    return { error: sanitized.error };
  }

  try {
    const stats = fs.statSync(sanitized.cleanPath);
    const hash = await getFileHash(sanitized.cleanPath);
    const ext = path.extname(sanitized.cleanPath).toLowerCase().replace(/^\./, '');

    // Inferir MIME type
    let inferredMime = 'application/octet-stream';
    for (const [mime, exts] of Object.entries(ALLOWED_MIME_TYPES)) {
      if (exts.includes(ext)) {
        inferredMime = mime;
        break;
      }
    }

    return {
      name: sanitized.basename,
      size: stats.size,
      mimeType: inferredMime,
      hash: hash.slice(0, 16),
      exists: true,
      createdAt: stats.birthtime,
      modifiedAt: stats.mtime
    };
  } catch (err) {
    return {
      error: err.message
    };
  }
}

module.exports = {
  sanitizeMediaPath,
  validateMimeType,
  getSecureMediaPath,
  whitelistMedia,
  isMediaWhitelisted,
  getMediaInfo,
  getFileHash,
  ALLOWED_MIME_TYPES,
  MEDIA_SUBDIR,
  UPLOADS_DIR
};
