const express = require('express');
const router = express.Router();
const productService = require('../services/productService');
const validate = require('../middleware/validate');
const schemas = require('../schemas');
const { verificarJWT } = require('../middleware/auth');
const { upload, handleMulterError, optimizeImage, handleImageUpload } = require('../middleware/imageUpload');
const { cacheMiddleware, invalidateCachePattern } = require('../middleware/cache');

/**
 * @swagger
 * /api/productos:
 *   get:
 *     summary: Obtener productos con paginación
 *     description: Retorna productos paginados con soporte para búsqueda y filtrado por categoría
 *     tags:
 *       - Productos
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Número de página
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Items por página
 *       - in: query
 *         name: categoria_id
 *         schema:
 *           type: integer
 *         description: Filtrar por categoría
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Búsqueda por nombre o descripción
 *     responses:
 *       200:
 *         description: Productos obtenidos exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginatedResponse'
 *       500:
 *         description: Error del servidor
 */
router.get('/', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const categoria_id = req.query.categoria_id ? parseInt(req.query.categoria_id) : null;
    const search = req.query.search || '';

    const result = await productService.getPaginated(page, limit, {
      categoria_id,
      search
    });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/productos/admin/list
router.get('/admin/list', verificarJWT, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 1000;
    
    const result = await productService.getAllAdmin(page, limit);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

// POST /api/productos/admin
router.post(
  '/admin',
  verificarJWT,
  upload.any(), // Soporta múltiples archivos (imagen, variante_img_0, variante_img_1...)
  handleMulterError,
  optimizeImage,
  handleImageUpload,
  // validate(schemas.productoSchema), // Tendremos que validar manualmente o relajar el esquema
  async (req, res, next) => {
    try {
      // Parsear variantes si vienen
      let variantes = [];
      if (req.body.variantes_json) {
        try {
          variantes = JSON.parse(req.body.variantes_json);
        } catch (e) {
          console.error("Error parseando variantes_json", e);
        }
      }

      // Asignar imágenes a las variantes
      const optimizedMap = req.body.optimizedImagesMap || {};
      variantes.forEach((v, index) => {
        const field = `variante_img_${index}`;
        if (optimizedMap[field]) {
          v.imagen_url = optimizedMap[field];
        } else if (req.body[`variante_img_url_${index}`]) {
          v.imagen_url = req.body[`variante_img_url_${index}`];
        }
      });

      const data = {
        ...req.body, 
        imagen_url: req.body.imagen_url || req.body.imagen_url_existente,
        tiene_variantes: variantes.length > 0 ? 1 : 0,
        variantes: variantes
      };

      const newProduct = await productService.create(data);
      // Invalidar caché de productos
      invalidateCachePattern('productos');

      res.status(201).json({ success: true, data: newProduct });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/productos/admin/:id
router.put(
  '/admin/:id',
  verificarJWT,
  upload.any(),
  handleMulterError,
  optimizeImage,
  handleImageUpload,
  // validate(schemas.productoSchema),
  async (req, res, next) => {
    try {
      // Parsear variantes si vienen
      let variantes = [];
      if (req.body.variantes_json) {
        try {
          variantes = JSON.parse(req.body.variantes_json);
        } catch (e) {
          console.error("Error parseando variantes_json", e);
        }
      }

      // Asignar imágenes a las variantes
      const optimizedMap = req.body.optimizedImagesMap || {};
      variantes.forEach((v, index) => {
        const field = `variante_img_${index}`;
        if (optimizedMap[field]) {
          v.imagen_url = optimizedMap[field];
        } else if (req.body[`variante_img_url_${index}`]) {
          v.imagen_url = req.body[`variante_img_url_${index}`];
        }
      });

      const data = { 
        ...req.body,
        tiene_variantes: req.body.tiene_variantes !== undefined ? parseInt(req.body.tiene_variantes) : (variantes.length > 0 ? 1 : 0),
        variantes: variantes
      };
      
      if (req.body.imagen_url) {
        data.imagen_url = req.body.imagen_url;
      } else if (req.body.imagen_url_existente) {
        data.imagen_url = req.body.imagen_url_existente;
      }

      const updatedProduct = await productService.update(req.params.id, data);
      // Invalidar caché de productos
      invalidateCachePattern('productos');

      res.json({ success: true, data: updatedProduct });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/productos/admin/:id
router.delete('/admin/:id', verificarJWT, async (req, res, next) => {
  try {
    await productService.delete(req.params.id);
    res.json({ success: true, message: 'Producto eliminado' });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/productos/admin/:id/stock
router.patch('/admin/:id/stock', verificarJWT, async (req, res, next) => {
  try {
    const { stock } = req.body;
    if (stock === undefined) {
      return res.status(400).json({ success: false, message: 'Se requiere el campo stock' });
    }
    const updatedProduct = await productService.updateStock(req.params.id, stock);
    res.json({ success: true, data: updatedProduct });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/productos/admin/variante/:id/stock
router.patch('/admin/variante/:id/stock', verificarJWT, async (req, res, next) => {
  try {
    const { stock } = req.body;
    if (stock === undefined) {
      return res.status(400).json({ success: false, message: 'Se requiere el campo stock' });
    }
    await productService.updateVariantStock(req.params.id, stock);
    res.json({ success: true, message: 'Stock de variante actualizado' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
