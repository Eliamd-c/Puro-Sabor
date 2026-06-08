const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { verificarJWT } = require('../middleware/auth');

// GET /api/config — Obtener configuración pública (número WA, dominio, nombre)
router.get('/', (req, res) => {
  db.all('SELECT key, value FROM config', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Error al obtener configuración.', error: err.message });
    }
    const config = {};
    rows.forEach(r => { config[r.key] = r.value; });
    res.json({ success: true, data: config });
  });
});

// PUT /api/config — Actualizar uno o varios valores de configuración (admin)
router.put('/', verificarJWT, (req, res) => {
  const updates = req.body; // { key: value, key2: value2, ... }

  if (!updates || Object.keys(updates).length === 0) {
    return res.status(400).json({ success: false, message: 'No se recibieron datos de configuración.' });
  }

  // Claves permitidas para actualizar
  const CLAVES_PERMITIDAS = ['whatsapp_numero', 'dominio_base', 'restaurante_nombre', 'mesas_timeout_horas'];

  const stmt = db.prepare(`
    INSERT INTO config (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `);

  let errores = [];
  Object.entries(updates).forEach(([key, value]) => {
    if (!CLAVES_PERMITIDAS.includes(key)) {
      errores.push(`Clave no permitida: ${key}`);
      return;
    }
    stmt.run([key, String(value)], (err) => {
      if (err) errores.push(`Error al actualizar ${key}: ${err.message}`);
    });
  });

  stmt.finalize((err) => {
    if (err || errores.length > 0) {
      return res.status(500).json({ success: false, message: 'Error al guardar configuración.', errores });
    }
    res.json({ success: true, message: 'Configuración actualizada con éxito.' });
  });
});

module.exports = router;
