const { Pool } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await pool.query("ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS estado VARCHAR(50) DEFAULT 'pendiente'");
    await pool.query('CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON pedidos(estado)');
    console.log('✅ Columna estado e índice añadidos exitosamente a pedidos.');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    pool.end();
  }
}
run();
