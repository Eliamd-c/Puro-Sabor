const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
require('dotenv').config({ path: '../.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function seed() {
  try {
    const password = 'Admin2026';
    const passwordHash = await bcrypt.hash(password, 10);

    // Crear tabla si no existe
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        usuario VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        activo INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP
      )
    `);

    await pool.query(
      `INSERT INTO admins (usuario, password_hash, email, activo)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (usuario) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      ['admin', passwordHash, 'admin@puro-sabor.com']
    );

    console.log('✅ Admin creado correctamente');
    console.log('Usuario: admin');
    console.log('Contraseña: Admin2026');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

seed();
