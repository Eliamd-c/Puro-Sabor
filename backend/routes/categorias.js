const express = require('express');
const router = express.Router();
const categoriaService = require('../services/categoriaService');
const validate = require('../middleware/validate');
const schemas = require('../schemas');
const { verificarJWT } = require('../middleware/auth');
const { cacheMiddleware, invalidateCachePattern } = require('../middleware/cache');

// GET /api/categorias (PÚBLICO - CACHEADO 10 minutos)
router.get('/', cacheMiddleware('categorias_public', 600), async (req, res, next) => {
  try {
    const categorias = await categoriaService.getAll();
    res.json(categorias);
  } catch (error) {
    next(error);
  }
});

// GET /api/categorias/admin (ADMIN - CACHEADO 5 minutos)
router.get('/admin', verificarJWT, cacheMiddleware('categorias_admin', 300), async (req, res, next) => {
  try {
    const categorias = await categoriaService.getAllAdmin();
    res.json({ success: true, data: categorias });
  } catch (error) {
    next(error);
  }
});

// POST /api/categorias/admin
router.post('/admin', verificarJWT, validate(schemas.categoriaSchema), async (req, res, next) => {
  try {
    const newCat = await categoriaService.create(req.validatedBody);
    // Invalidar caché después de crear
    invalidateCachePattern('categorias');
    res.status(201).json({ success: true, data: newCat });
  } catch (error) {
    next(error);
  }
});

// PUT /api/categorias/admin/:id
router.put('/admin/:id', verificarJWT, validate(schemas.categoriaSchema), async (req, res, next) => {
  try {
    const updatedCat = await categoriaService.update(req.params.id, req.validatedBody);
    // Invalidar caché después de actualizar
    invalidateCachePattern('categorias');
    res.json({ success: true, data: updatedCat });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/categorias/admin/:id
router.delete('/admin/:id', verificarJWT, async (req, res, next) => {
  try {
    await categoriaService.delete(req.params.id);
    // Invalidar caché después de eliminar
    invalidateCachePattern('categorias');
    res.json({ success: true, message: 'Categoría eliminada' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
