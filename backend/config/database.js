const { Pool } = require('pg');
require('dotenv').config();

// Configuración del Pool de PostgreSQL conectado a Supabase
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.on('error', (err, client) => {
  console.error('Error inesperado en PostgreSQL', err);
  process.exit(-1);
});

console.log('Conectado a la base de datos PostgreSQL (Supabase).');

// Función auxiliar para convertir las consultas de SQLite (con "?") a PostgreSQL (con "$1", "$2")
function convertQueryToPg(sql) {
  let i = 1;
  // Reemplaza los "?" que no estén dentro de comillas simples (de forma básica)
  // Como convención en nuestras rutas no hay "?" literales en las sentencias.
  return sql.replace(/\?/g, () => `$${i++}`);
}

// Wrapper (Adaptador) para que las rutas existentes diseñadas para SQLite (db.run, db.get, db.all) 
// funcionen directamente con el Pool de PostgreSQL sin tener que reescribir cientos de líneas.
const db = {
  run: function(sql, params, callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    const pgSql = convertQueryToPg(sql);
    
    // Si es un INSERT, PostgreSQL necesita "RETURNING id" para emular el "this.lastID" de SQLite
    const isInsert = pgSql.trim().toUpperCase().startsWith('INSERT');
    const finalSql = isInsert ? `${pgSql} RETURNING id` : pgSql;

    pool.query(finalSql, params, (err, result) => {
      if (err) {
        if (callback) callback(err);
        return;
      }
      const context = {
        changes: result.rowCount || 0,
        lastID: isInsert && result.rows.length > 0 ? result.rows[0].id : null
      };
      if (callback) callback.call(context, null);
    });
  },
  
  get: function(sql, params, callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    const pgSql = convertQueryToPg(sql);
    pool.query(pgSql, params, (err, result) => {
      if (err) {
        if (callback) callback(err);
        return;
      }
      if (callback) callback(null, result.rows.length > 0 ? result.rows[0] : undefined);
    });
  },
  
  all: function(sql, params, callback) {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    const pgSql = convertQueryToPg(sql);
    pool.query(pgSql, params, (err, result) => {
      if (err) {
        if (callback) callback(err);
        return;
      }
      if (callback) callback(null, result.rows);
    });
  },

  prepare: function(sql) {
    // Para el comando stmt.run() de sembrarDatosIniciales
    const pgSql = convertQueryToPg(sql);
    return {
      run: function(params, callback) {
        pool.query(pgSql, params, (err) => {
          if (callback) callback(err);
        });
      },
      finalize: function(callback) {
        if (callback) callback();
      }
    };
  },

  serialize: function(callback) {
    // PostgreSQL maneja la concurrencia nativamente, ejecutamos directo
    callback();
  }
};

// --- CREACIÓN DE TABLAS (MIGRACIÓN A POSTGRESQL) ---
function inicializarTablas() {
  db.serialize(() => {
    // 1. Tabla Categorías
    pool.query(`
      CREATE TABLE IF NOT EXISTS categorias (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL UNIQUE,
        descripcion TEXT,
        orden INTEGER DEFAULT 0,
        activa INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `).catch(e => console.error(e));

    // 2. Tabla Productos
    pool.query(`
      CREATE TABLE IF NOT EXISTS productos (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        descripcion TEXT,
        precio REAL NOT NULL,
        categoria_id INTEGER NOT NULL,
        stock INTEGER DEFAULT 0,
        imagen_url TEXT,
        disponible INTEGER DEFAULT 1,
        activo INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (categoria_id) REFERENCES categorias(id)
      )
    `).catch(e => console.error(e));

    // 3. Tabla Admins
    pool.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        usuario VARCHAR(255) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        email TEXT,
        activo INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP
      )
    `).catch(e => console.error(e));

    // 4. Tabla Config
    pool.query(`
      CREATE TABLE IF NOT EXISTS config (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `).catch(e => console.error(e));

    // 5. Tabla Mesas
    pool.query(`
      CREATE TABLE IF NOT EXISTS mesas (
        id SERIAL PRIMARY KEY,
        numero INTEGER UNIQUE NOT NULL,
        nombre VARCHAR(255),
        activa INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `).catch(e => console.error(e));

    // 6. Tabla Sesiones de Mesa
    pool.query(`
      CREATE TABLE IF NOT EXISTS sesiones_mesa (
        id SERIAL PRIMARY KEY,
        mesa_numero INTEGER NOT NULL,
        estado VARCHAR(50) DEFAULT 'activa',
        ultima_actividad TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        creada_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        cerrada_en TIMESTAMP,
        cerrada_por VARCHAR(255)
      )
    `).catch(e => console.error(e));

    // 7. Tabla Pedidos
    pool.query(`
      CREATE TABLE IF NOT EXISTS pedidos (
        id SERIAL PRIMARY KEY,
        sesion_id INTEGER NOT NULL,
        mesa_numero INTEGER NOT NULL,
        numero_ronda INTEGER DEFAULT 1,
        items_json TEXT NOT NULL,
        total REAL NOT NULL,
        notas TEXT,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sesion_id) REFERENCES sesiones_mesa(id)
      )
    `).catch(e => console.error(e));

    // 8. Tabla Historial WA
    pool.query(`
      CREATE TABLE IF NOT EXISTS wa_conversaciones (
        id SERIAL PRIMARY KEY,
        numero_telefono VARCHAR(50) NOT NULL,
        rol VARCHAR(50) NOT NULL,
        contenido TEXT NOT NULL,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `).then(() => {
      sembrarDatosIniciales();
    }).catch(e => console.error(e));
  });
}

function sembrarDatosIniciales() {
  const configs = [
    ['whatsapp_numero', '3142146407'],
    ['dominio_base', 'https://restaurantepurosabor.com'],
    ['restaurante_nombre', 'Puro Sabor'],
    ['mesas_timeout_horas', '2'],
    ['gemini_api_key', ''],
    ['whatsapp_whitelist', '573142146407,3142146407'],
    ['whatsapp_bot_active', '1'],
    ['bot_horario_activo', '0'],
    ['bot_mensaje_ausencia', '¡Hola! Gracias por contactarte con Puro Sabor. 🍖 Te informamos que iniciaremos atención este próximo Sábado a partir de las 6:00 de la tarde. \n\nSin embargo, puedes ir antojándote y revisando nuestros platos en nuestro menú web: 👉 https://restaurantepurosabor.com \n\n¡Te esperamos el sábado!']
  ];
  
  // En PostgreSQL, ON CONFLICT DO NOTHING se usa en lugar de INSERT OR IGNORE
  const stmt = db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING');
  configs.forEach(c => stmt.run(c));
  stmt.finalize(() => console.log('✅ Config inicial/IA sembrada en Postgres.'));

  // Sembrar 6 mesas iniciales
  db.get("SELECT COUNT(*) as count FROM mesas", (err, row) => {
    if (!err && row && parseInt(row.count) === 0) {
      console.log('Sembrando mesas iniciales...');
      for (let i = 1; i <= 6; i++) {
        db.run('INSERT INTO mesas (numero, nombre) VALUES (?, ?) ON CONFLICT (numero) DO NOTHING', [i, `Mesa ${i}`]);
      }
    }
  });
}

// Inicializar la estructura
inicializarTablas();

module.exports = db;
