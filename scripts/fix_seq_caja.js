const db = require('../backend/config/database.js');
db.all("SELECT setval('caja_registros_id_seq', COALESCE((SELECT MAX(id)+1 FROM caja_registros), 1), false);", [], (err) => {
  console.log(err || 'Fixed caja_registros');
  process.exit(0);
});
