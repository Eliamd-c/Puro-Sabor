const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  try {
    console.log('--- Iniciando Migración de Variantes ---');
    
    // 1. Alterar tabla productos
    await pool.query(`ALTER TABLE productos ADD COLUMN IF NOT EXISTS tiene_variantes INTEGER DEFAULT 0;`);
    console.log('✅ Columna tiene_variantes añadida a productos.');

    // 2. Crear tabla producto_variantes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS producto_variantes (
        id SERIAL PRIMARY KEY,
        producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
        nombre VARCHAR(255) NOT NULL,
        stock INTEGER DEFAULT 0,
        imagen_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Tabla producto_variantes creada.');

    // 3. Buscar la categoría "Bebidas" o donde estén las Postobón
    // Asumimos que están buscando por nombre "Postobon" o "Postobón"
    const gaseosasQuery = await pool.query(`SELECT * FROM productos WHERE nombre ILIKE '%postobon%' OR nombre ILIKE '%postobón%'`);
    const gaseosas = gaseosasQuery.rows.filter(g => g.activo === 1);

    if (gaseosas.length > 0) {
      console.log(`Encontradas ${gaseosas.length} gaseosas activas para agrupar.`);
      
      // Tomar la primera como categoría de referencia, o el precio de referencia
      const categoria_id = gaseosas[0].categoria_id;
      const precio = gaseosas[0].precio;

      // Crear el producto agrupado
      const newProduct = await pool.query(`
        INSERT INTO productos (nombre, descripcion, precio, categoria_id, stock, tiene_variantes, activo, disponible)
        VALUES ($1, $2, $3, $4, 0, 1, 1, 1)
        RETURNING id
      `, ['Gaseosas Postobón', 'Gaseosas surtidas', precio, categoria_id]);
      
      const newProductId = newProduct.rows[0].id;
      console.log(`✅ Producto "Gaseosas Postobón" creado con ID: ${newProductId}`);

      // Mover cada gaseosa a producto_variantes
      for (const g of gaseosas) {
        // Extraer nombre del sabor (ej. "Postobon Manzana" -> "Manzana")
        let sabor = g.nombre.replace(/postob[oó]n/i, '').trim();
        if (!sabor) sabor = "Normal";

        await pool.query(`
          INSERT INTO producto_variantes (producto_id, nombre, stock, imagen_url)
          VALUES ($1, $2, $3, $4)
        `, [newProductId, sabor, g.stock, g.imagen_url]);

        // Borrar (o marcar inactivo) el producto antiguo
        await pool.query(`UPDATE productos SET activo = 0 WHERE id = $1`, [g.id]);
      }
      console.log('✅ Variantes creadas y productos antiguos desactivados.');
    } else {
      console.log('No se encontraron gaseosas postobon activas para migrar.');
    }

    console.log('--- Migración Completada ---');
  } catch (error) {
    console.error('Error durante la migración:', error);
  } finally {
    await pool.end();
  }
}

migrate();
