const { Pool } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function addIndexes() {
  try {
    console.log('Conectando a PostgreSQL para añadir índices...');
    
    // 1. Índice para búsquedas por categoría en productos
    await pool.query('CREATE INDEX IF NOT EXISTS idx_productos_categoria ON productos(categoria_id)');
    console.log('✅ Índice idx_productos_categoria creado.');

    // 2. Índice para filtrar productos activos (el menú público hace mucho esta query)
    await pool.query('CREATE INDEX IF NOT EXISTS idx_productos_activo ON productos(activo)');
    console.log('✅ Índice idx_productos_activo creado.');

    // 3. Índice para pedidos por estado (mesas activas buscando pedidos pendientes)
    await pool.query('CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON pedidos(estado)');
    console.log('✅ Índice idx_pedidos_estado creado.');

    console.log('Todos los índices fueron aplicados con éxito.');
  } catch (err) {
    console.error('Error al aplicar índices:', err);
  } finally {
    pool.end();
  }
}

addIndexes();
