const db = require('./backend/config/database.js');

const tables = ['productos', 'insumos', 'categorias', 'recetas', 'compras_insumos', 'mesas', 'pedidos', 'pedido_items'];

async function fixAll() {
  for (const table of tables) {
    try {
      await new Promise((resolve) => {
        db.all(`SELECT setval('${table}_id_seq', COALESCE((SELECT MAX(id)+1 FROM ${table}), 1), false);`, [], (err) => {
          if (err) console.log(`Error fixing ${table}:`, err.message);
          else console.log(`Fixed sequence for ${table}`);
          resolve();
        });
      });
    } catch (e) {}
  }
  process.exit(0);
}

fixAll();
