const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
require('dotenv').config({ path: '../.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function createAdmin() {
  try {
    const password = 'Admin2026';
    const passwordHash = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO admins (usuario, password_hash, email, activo)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (usuario) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      ['admin', passwordHash, 'admin@puro-sabor.com']
    );

    console.log('✅ Admin creado');
    console.log('Usuario: admin');
    console.log('Contraseña: Admin2026');
    console.log('\nAcceso: http://localhost:3005/admin');
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

createAdmin();
