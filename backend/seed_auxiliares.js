const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
require('dotenv').config({ path: '../.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const auxiliares = [
  { usuario: 'isabel', nombre: 'Isabel' },
  { usuario: 'linda', nombre: 'Linda' },
  { usuario: 'fernando', nombre: 'Fernando' },
  { usuario: 'eliam', nombre: 'Eliam' },
  { usuario: 'melida', nombre: 'Melida' },
  { usuario: 'naryi', nombre: 'Naryi' },
  { usuario: 'cata', nombre: 'Cata' }
];

const password = 'Purosabor2026';

async function seed() {
  try {
    const passwordHash = await bcrypt.hash(password, 10);

    // Crear tabla si no existe
    await pool.query(`
      CREATE TABLE IF NOT EXISTS auxiliares_venta (
        id SERIAL PRIMARY KEY,
        usuario VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        nombre VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        activo INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP
      )
    `);

    for (const aux of auxiliares) {
      await pool.query(
        `INSERT INTO auxiliares_venta (usuario, password_hash, nombre, email, activo)
         VALUES ($1, $2, $3, $4, 1)
         ON CONFLICT (usuario) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
        [aux.usuario, passwordHash, aux.nombre, `${aux.usuario}@puro-sabor.com`]
      );
      console.log(`✓ ${aux.nombre} (${aux.usuario})`);
    }

    console.log('\n✅ Auxiliares creados correctamente');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

seed();
