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
    fileSize: 15 * 1024 * 1024 // 15MB máximo (fotos de celular modernas pesan más)
  }
});

/**
 * Manejador de errores de Multer — convierte errores crípticos en mensajes claros
 * con status 400 en lugar de 500. Debe usarse justo después de upload.single().
 */
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    let mensaje = 'Error al subir el archivo.';
    if (err.code === 'LIMIT_FILE_SIZE') {
      mensaje = 'La imagen es demasiado grande. El máximo permitido es 15MB.';
    }
    return res.status(400).json({ success: false, message: mensaje });
  }
  if (err) {
    // Errores del fileFilter (tipo no permitido, etc.)
    return res.status(err.statusCode || 400).json({ success: false, message: err.message });
  }
  next();
};

/**
 * Middleware que optimiza y convierte imágenes a WebP
 * Debe ejecutarse DESPUÉS del middleware de multer
 */
const optimizeImage = async (req, res, next) => {
  // Manejar tanto req.file como req.files
  let files = [];
  if (req.files && req.files.length > 0) files = req.files;
  else if (req.file) files = [req.file];

  if (files.length === 0) {
    return next();
  }

  req.optimizedImages = {};

  for (const file of files) {
    try {
      const inputPath = file.path;
      const filename = `${Date.now()}-${Math.floor(Math.random()*1000)}.webp`;
      const outputPath = path.join(uploadsDir, filename);

      logger.info(`Optimizing image: ${file.originalname}`);

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

      req.optimizedImages[file.fieldname] = `/uploads/${filename}`;
    } catch (error) {
      logger.error(`Error optimizing image (sharp fallback): ${error.message}`);

      // Si sharp falla, fallback
      try {
        const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
        const fallbackFilename = `${Date.now()}-orig-${Math.floor(Math.random()*1000)}${ext}`;
        const fallbackPath = path.join(uploadsDir, fallbackFilename);
        fs.renameSync(file.path, fallbackPath);

        req.optimizedImages[file.fieldname] = `/uploads/${fallbackFilename}`;
        logger.info(`Image uploaded without optimization: ${fallbackFilename}`);
      } catch (fallbackError) {
        if (file && fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
    }
  }
  next();
};

/**
 * Middleware que permite fallback a URL mantenida manualmente
 * (por si el usuario pasa una URL en lugar de subir archivo)
 */
const handleImageUpload = (req, res, next) => {
  if (req.optimizedImages) {
    if (req.optimizedImages['imagen']) {
      req.body.imagen_url = req.optimizedImages['imagen'];
    }
    // Also save the map for routes to extract variant images
    req.body.optimizedImagesMap = req.optimizedImages;
  }
  next();
};

module.exports = {
  upload,
  handleMulterError,
  optimizeImage,
  handleImageUpload
};
