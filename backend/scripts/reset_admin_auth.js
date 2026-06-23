const { Pool } = require('pg');
require('dotenv').config({ path: '../../.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function resetAuth() {
  try {
    const result = await pool.query("DELETE FROM wa_auth WHERE key LIKE 'admin_%' AND key NOT LIKE '%lock_pid%'");
    console.log(`Borradas ${result.rowCount} filas de auth de admin`);
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
resetAuth();
