const express = require('express');
const router = express.Router();
const productService = require('../services/productService');
const validate = require('../middleware/validate');
const schemas = require('../schemas');
const { verificarJWT } = require('../middleware/auth');
const { upload, optimizeImage, handleImageUpload } = require('../middleware/imageUpload');
const { cacheMiddleware, invalidateCachePattern } = require('../middleware/cache');

// GET /api/productos?page=1&limit=20&categoria_id=5&search=migas
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
  upload.single('imagen'),
  optimizeImage,
  handleImageUpload,
  validate(schemas.productoSchema),
  async (req, res, next) => {
    try {
      const data = {
        ...req.validatedBody,
        imagen_url: req.body.imagen_url // Ya procesada por handleImageUpload
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
  upload.single('imagen'),
  optimizeImage,
  handleImageUpload,
  validate(schemas.productoSchema),
  async (req, res, next) => {
    try {
      const data = { ...req.validatedBody };
      if (req.body.imagen_url) {
        data.imagen_url = req.body.imagen_url; // Ya procesada por handleImageUpload
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

module.exports = router;
