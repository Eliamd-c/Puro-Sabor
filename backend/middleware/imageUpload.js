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
const supabase = require('../config/supabase');

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
  
        logger.info(`Optimizing image: ${file.originalname}`);
  
        // Usar Sharp para optimizar y obtener buffer
        const buffer = await sharp(inputPath)
          .resize(800, 600, {
            fit: 'cover',
            position: 'center',
            withoutEnlargement: true
          })
          .webp({
            quality: 80, // Balance entre calidad y tamaño
            alphaQuality: 80
          })
          .toBuffer();
  
        // Subir a Supabase Storage
        const { data, error } = await supabase
          .storage
          .from('productos')
          .upload(filename, buffer, {
            contentType: 'image/webp',
            upsert: false
          });
          
        if (error) {
          throw new Error(`Supabase upload error: ${error.message}`);
        }
  
        // Obtener URL pública
        const { data: publicUrlData } = supabase
          .storage
          .from('productos')
          .getPublicUrl(filename);
  
        // Eliminar archivo temporal
        if (fs.existsSync(inputPath)) {
          fs.unlinkSync(inputPath);
        }
  
        req.optimizedImages[file.fieldname] = publicUrlData.publicUrl;
      } catch (error) {
        logger.error(`Error optimizing/uploading image (fallback activated): ${error.message}`);
  
        // Si sharp o subida inicial fallan, fallback a subir archivo original
        try {
          const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
          const fallbackFilename = `${Date.now()}-orig-${Math.floor(Math.random()*1000)}${ext}`;
          
          const fileBuffer = fs.readFileSync(file.path);
          
          const { error: fallbackError } = await supabase
            .storage
            .from('productos')
            .upload(fallbackFilename, fileBuffer, {
              contentType: file.mimetype,
              upsert: false
            });
            
          if (fallbackError) {
            throw new Error(`Supabase fallback upload error: ${fallbackError.message}`);
          }
  
          const { data: publicUrlData } = supabase
            .storage
            .from('productos')
            .getPublicUrl(fallbackFilename);
  
          if (fs.existsSync(file.path)) {
            fs.unlinkSync(file.path);
          }
  
          req.optimizedImages[file.fieldname] = publicUrlData.publicUrl;
          logger.info(`Image uploaded to Supabase without optimization: ${fallbackFilename}`);
        } catch (fatalError) {
          logger.error(`Fatal error in fallback upload: ${fatalError.message}`);
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
