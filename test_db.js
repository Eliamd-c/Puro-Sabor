require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/puro_sabor' });

pool.query("SELECT id, nombre, imagen_url FROM productos WHERE nombre ILIKE '%coca%' OR nombre ILIKE '%postobon%'")
  .then(res => console.log(res.rows))
  .catch(console.error)
  .finally(() => pool.end());
