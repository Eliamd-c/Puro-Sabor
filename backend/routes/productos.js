const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../config/database');
const { verificarJWT } = require('../middleware/auth');

// Configuración de Multer para subida de imágenes
const uploadsDir = path.join(__dirname, '..', '..', 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'producto-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const filetypes = /jpeg|jpg|png|gif|webp/;
  const mimetype = filetypes.test(file.mimetype);
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

  if (mimetype && extname) {
    return cb(null, true);
  }
  cb(new Error('Solo se permiten archivos de imagen (JPEG, JPG, PNG, GIF, WEBP)'));
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Límite de 5MB
  fileFilter: fileFilter
});

// === RUTAS PÚBLICAS ===

// GET /api/productos (Listar todos los productos activos y disponibles, opcionalmente filtrados por categoría y búsqueda)
router.get('/', (req, res) => {
  const { categoria, buscar } = req.query;
  let query = `
    SELECT p.*, c.nombre as categoria_nombre 
    FROM productos p 
    JOIN categorias c ON p.categoria_id = c.id 
    WHERE p.activo = 1 AND c.activa = 1
  `;
  const params = [];

  if (categoria) {
    query += ' AND (p.categoria_id = ? OR c.nombre = ?)';
    params.push(categoria, categoria);
  }

  if (buscar) {
    query += ' AND (p.nombre LIKE ? OR p.descripcion LIKE ?)';
    params.push(`%${buscar}%`, `%${buscar}%`);
  }

  // Ordenar primero por disponibilidad (los disponibles primero) y luego por categoría/nombre
  query += ' ORDER BY p.disponible DESC, c.orden ASC, p.nombre ASC';

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ 
        success: false, 
        message: 'Error al obtener productos.', 
        error: err.message 
      });
    }
    
    // Normalizar URLs de imágenes
    const data = rows.map(prod => ({
      ...prod,
      disponible: prod.disponible === 1,
      activo: prod.activo === 1
    }));

    res.json({
      success: true,
      data
    });
  });
});

// GET /api/productos/:id (Ver un producto específico por ID)
router.get('/:id', (req, res) => {
  const { id } = req.params;
  const query = `
    SELECT p.*, c.nombre as categoria_nombre 
    FROM productos p 
    JOIN categorias c ON p.categoria_id = c.id 
    WHERE p.id = ? AND p.activo = 1
  `;

  db.get(query, [id], (err, row) => {
    if (err) {
      return res.status(500).json({ 
        success: false, 
        message: 'Error al obtener el producto.', 
        error: err.message 
      });
    }

    if (!row) {
      return res.status(404).json({ 
        success: false, 
        message: 'Producto no encontrado.' 
      });
    }

    res.json({
      success: true,
      data: {
        ...row,
        disponible: row.disponible === 1,
        activo: row.activo === 1
      }
    });
  });
});


// === RUTAS PRIVADAS (ADMIN) ===

// GET /api/admin/productos (Listar todos los productos, activos o inactivos, con paginación opcional)
router.get('/admin/list', verificarJWT, (req, res) => {
  const { buscar, categoria_id } = req.query;
  let query = `
    SELECT p.*, c.nombre as categoria_nombre 
    FROM productos p 
    JOIN categorias c ON p.categoria_id = c.id 
    WHERE p.activo = 1
  `;
  const params = [];

  if (categoria_id) {
    query += ' AND p.categoria_id = ?';
    params.push(categoria_id);
  }

  if (buscar) {
    query += ' AND (p.nombre LIKE ? OR p.descripcion LIKE ?)';
    params.push(`%${buscar}%`, `%${buscar}%`);
  }

  query += ' ORDER BY p.id DESC';

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ 
        success: false, 
        message: 'Error al obtener listado de administración.', 
        error: err.message 
      });
    }

    const data = rows.map(prod => ({
      ...prod,
      disponible: prod.disponible === 1,
      activo: prod.activo === 1
    }));

    res.json({
      success: true,
      data
    });
  });
});

// POST /api/admin/productos (Crear producto)
router.post('/admin', verificarJWT, upload.single('imagen'), (req, res) => {
  const { nombre, descripcion, precio, categoria_id, stock, disponible } = req.body;

  if (!nombre || !precio || !categoria_id) {
    return res.status(400).json({ 
      success: false, 
      message: 'Nombre, precio y categoría son campos obligatorios.' 
    });
  }

  let imagen_url = '/assets/images/default-food.jpg'; // Imagen por defecto
  if (req.file) {
    imagen_url = `/uploads/${req.file.filename}`;
  } else if (req.body.imagen_url) {
    imagen_url = req.body.imagen_url;
  }

  const query = `
    INSERT INTO productos (nombre, descripcion, precio, categoria_id, stock, imagen_url, disponible, activo) 
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `;

  const dispVal = disponible === undefined ? 1 : (disponible === 'true' || disponible === '1' || disponible === true ? 1 : 0);
  const stockVal = stock ? parseInt(stock) : 0;

  const params = [
    nombre, 
    descripcion || '', 
    parseFloat(precio), 
    parseInt(categoria_id), 
    stockVal, 
    imagen_url,
    dispVal
  ];

  db.run(query, params, function(err) {
    if (err) {
      return res.status(500).json({ 
        success: false, 
        message: 'Error al guardar el producto en base de datos.', 
        error: err.message 
      });
    }

    res.status(201).json({
      success: true,
      message: 'Producto creado con éxito.',
      data: {
        id: this.lastID,
        nombre,
        descripcion,
        precio: parseFloat(precio),
        categoria_id: parseInt(categoria_id),
        stock: stockVal,
        imagen_url,
        disponible: dispVal === 1,
        activo: true
      }
    });
  });
});

// PUT /api/admin/productos/:id (Actualizar producto entero)
router.put('/admin/:id', verificarJWT, upload.single('imagen'), (req, res) => {
  const { id } = req.params;
  const { nombre, descripcion, precio, categoria_id, stock, disponible, imagen_url_existente } = req.body;

  if (!nombre || !precio || !categoria_id) {
    return res.status(400).json({ 
      success: false, 
      message: 'Nombre, precio y categoría son requeridos.' 
    });
  }

  // Determinar la URL de la imagen
  let imagen_url = imagen_url_existente || '/assets/images/default-food.jpg';
  if (req.file) {
    imagen_url = `/uploads/${req.file.filename}`;
  }

  const dispVal = disponible === undefined ? 1 : (disponible === 'true' || disponible === '1' || disponible === true ? 1 : 0);
  const stockVal = stock ? parseInt(stock) : 0;

  const query = `
    UPDATE productos 
    SET nombre = ?, descripcion = ?, precio = ?, categoria_id = ?, stock = ?, imagen_url = ?, disponible = ? 
    WHERE id = ? AND activo = 1
  `;

  const params = [
    nombre, 
    descripcion || '', 
    parseFloat(precio), 
    parseInt(categoria_id), 
    stockVal, 
    imagen_url, 
    dispVal,
    id
  ];

  db.run(query, params, function(err) {
    if (err) {
      return res.status(500).json({ 
        success: false, 
        message: 'Error al actualizar el producto.', 
        error: err.message 
      });
    }

    if (this.changes === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Producto no encontrado.' 
      });
    }

    res.json({
      success: true,
      message: 'Producto actualizado con éxito.',
      data: {
        id: parseInt(id),
        nombre,
        descripcion,
        precio: parseFloat(precio),
        categoria_id: parseInt(categoria_id),
        stock: stockVal,
        imagen_url,
        disponible: dispVal === 1
      }
    });
  });
});

// PATCH /api/admin/productos/:id/stock (Actualizar solo stock)
router.patch('/admin/:id/stock', verificarJWT, (req, res) => {
  const { id } = req.params;
  const { stock } = req.body;

  if (stock === undefined || isNaN(parseInt(stock))) {
    return res.status(400).json({ 
      success: false, 
      message: 'Stock numérico es requerido.' 
    });
  }

  const stockVal = parseInt(stock);
  const dispVal = stockVal > 0 ? 1 : 0;

  // Si actualizamos el stock a 0, también desactivamos la disponibilidad por lógica de negocio amable
  const query = `
    UPDATE productos 
    SET stock = ?, disponible = CASE WHEN ? = 0 THEN 0 ELSE disponible END 
    WHERE id = ? AND activo = 1
  `;

  db.run(query, [stockVal, stockVal, id], function(err) {
    if (err) {
      return res.status(500).json({ 
        success: false, 
        message: 'Error al actualizar stock.', 
        error: err.message 
      });
    }

    if (this.changes === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Producto no encontrado.' 
      });
    }

    res.json({
      success: true,
      message: 'Stock actualizado con éxito.',
      id: parseInt(id),
      stock: stockVal
    });
  });
});

// DELETE /api/admin/productos/:id (Soft-delete: marcar como inactivo)
router.delete('/admin/:id', verificarJWT, (req, res) => {
  const { id } = req.params;

  db.run('UPDATE productos SET activo = 0 WHERE id = ?', [id], function(err) {
    if (err) {
      return res.status(500).json({ 
        success: false, 
        message: 'Error al eliminar el producto.', 
        error: err.message 
      });
    }

    if (this.changes === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Producto no encontrado.' 
      });
    }

    res.json({
      success: true,
      message: 'Producto eliminado con éxito.'
    });
  });
});

module.exports = router;
