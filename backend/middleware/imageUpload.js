/**
 * Middleware para optimización de imágenes
 * Convierte imágenes a WebP, redimensiona y comprime automáticamente
 *
 * Requisitos: npm install sharp
 */

const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const logger = require('../config/logger');

// Configuración de directorios
const uploadsDir = path.join(__dirname, '..', '..', 'public', 'uploads');
const tempDir = path.join(uploadsDir, 'temp');

// Crear directorios si no existen
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

/**
 * Configuración de Multer para subida de archivos
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    // Generar nombre único para archivo temporal
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});

const fileFilter = (req, file, cb) => {
  // Solo permitir tipos de imagen comunes
  const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    const error = new Error(
      `Solo se permiten imágenes (JPEG, PNG, GIF, WebP). Recibido: ${file.mimetype}`
    );
    error.statusCode = 400;
    cb(error);
  }
};

/**
 * Multer upload con validación
 */
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB máximo
  }
});

/**
 * Middleware que optimiza y convierte imágenes a WebP
 * Debe ejecutarse DESPUÉS del middleware de multer
 */
const optimizeImage = async (req, res, next) => {
  // Si no hay archivo, continuar
  if (!req.file) {
    return next();
  }

  try {
    const inputPath = req.file.path;
    const filename = `${Date.now()}.webp`;
    const outputPath = path.join(uploadsDir, filename);

    logger.info(`Optimizing image: ${req.file.originalname}`);

    // Usar Sharp para optimizar
    const stats = await sharp(inputPath)
      .resize(800, 600, {
        fit: 'cover',
        position: 'center',
        withoutEnlargement: true
      })
      .webp({
        quality: 80, // Balance entre calidad y tamaño
        alphaQuality: 80
      })
      .toFile(outputPath);

    // Eliminar archivo temporal
    fs.unlinkSync(inputPath);

    // Calcular reducción de tamaño
    const originalSize = req.file.size;
    const newSize = stats.size;
    const reduction = Math.round(((originalSize - newSize) / originalSize) * 100);

    logger.info(
      `Image optimized: ${req.file.originalname} → ${filename} ` +
      `(${originalSize} → ${newSize} bytes, -${reduction}%)`
    );

    // Guardar información en el request para usar en la ruta
    req.optimizedImage = {
      url: `/uploads/${filename}`,
      filename,
      size: newSize,
      originalSize,
      reduction
    };

    next();
  } catch (error) {
    logger.error(`Error optimizing image (sharp fallback): ${error.message}`);

    // Si sharp falla (binarios nativos incompatibles en Hostinger, etc.),
    // mover el archivo original sin optimizar para no bloquear la subida
    try {
      const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
      const fallbackFilename = `${Date.now()}-orig${ext}`;
      const fallbackPath = path.join(uploadsDir, fallbackFilename);
      fs.renameSync(req.file.path, fallbackPath);

      req.optimizedImage = {
        url: `/uploads/${fallbackFilename}`,
        filename: fallbackFilename,
        size: req.file.size,
        originalSize: req.file.size,
        reduction: 0
      };

      logger.info(`Image uploaded without optimization: ${fallbackFilename}`);
      next();
    } catch (fallbackError) {
      // Si incluso mover el archivo falla, limpiar y propagar
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      const customError = new Error(`Error al subir imagen: ${error.message}`);
      customError.statusCode = 500;
      next(customError);
    }
  }
};

/**
 * Middleware que permite fallback a URL mantenida manualmente
 * (por si el usuario pasa una URL en lugar de subir archivo)
 */
const handleImageUpload = (req, res, next) => {
  if (req.optimizedImage) {
    // Imagen subida y optimizada
    req.body.imagen_url = req.optimizedImage.url;
  } else if (req.body.imagen_url) {
    // URL proporcionada manualmente - usar como está
    // (asumiendo que ya está validada)
  }
  next();
};

module.exports = {
  upload,
  optimizeImage,
  handleImageUpload
};
