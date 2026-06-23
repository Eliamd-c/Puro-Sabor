const { Pool } = require('pg');
require('dotenv').config({ path: '../../.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function check() {
  try {
    const resConfig = await pool.query("SELECT * FROM config WHERE key = 'whatsapp_admin_bot_active'");
    console.log('Config admin bot active:', resConfig.rows);
    
    const resAuth = await pool.query("SELECT * FROM wa_auth WHERE key LIKE '%admin%'");
    console.log('Auth keys admin:', resAuth.rows.map(r => r.key));
    
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
check();
