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

/**
 * SEGURIDAD: Función auxiliar para convertir consultas SQLite → PostgreSQL
 *
 * ⚠️  IMPORTANTE:
 * - Los parámetros SIEMPRE deben ser pasados en el array `params`, NUNCA como strings interpolados
 * - Ejemplo CORRECTO:   db.get('SELECT * FROM admins WHERE usuario = ?', [usuario], ...)
 * - Ejemplo INCORRECTO: db.get(`SELECT * FROM admins WHERE usuario = '${usuario}'`, [], ...)
 *
 * PostgreSQL usa prepared statements nativamente. Los placeholders ($1, $2, etc.)
 * separados de los parámetros previenen SQL injection.
 *
 * Convierte:  SELECT * FROM users WHERE id = ? AND status = ?
 * A:          SELECT * FROM users WHERE id = $1 AND status = $2
 *
 * Parámetros: [5, 'active']
 *
 * @param {string} sql - Consulta SQL con placeholders "?"
 * @returns {string} - Consulta SQL con placeholders PostgreSQL "$1", "$2", etc.
 */
function convertQueryToPg(sql) {
  let i = 1;
  // Regex: mantiene strings entre comillas simples sin cambios, reemplaza "?" fuera de strings
  return sql.replace(/'[^']*'|\?/g, (match) => {
    return match === '?' ? `$${i++}` : match;
  });
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
    
    // Si es un INSERT, PostgreSQL necesita "RETURNING *" para emular el "this.lastID" de SQLite.
    // Usamos * en lugar de id porque hay tablas (como config) que no tienen columna id.
    const isInsert = pgSql.trim().toUpperCase().startsWith('INSERT');
    const finalSql = isInsert ? `${pgSql} RETURNING *` : pgSql;

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
async function inicializarTablas() {
  try {
    // 1. Tabla Categorías
    await pool.query(`
      CREATE TABLE IF NOT EXISTS categorias (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL UNIQUE,
        descripcion TEXT,
        orden INTEGER DEFAULT 0,
        activa INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Tabla Productos
    await pool.query(`
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
    `);

    // 3. Tabla Admins
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        usuario VARCHAR(255) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        email TEXT,
        activo INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP
      )
    `);

    // 4. Tabla Config
    await pool.query(`
      CREATE TABLE IF NOT EXISTS config (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 5. Tabla Mesas
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mesas (
        id SERIAL PRIMARY KEY,
        numero INTEGER UNIQUE NOT NULL,
        nombre VARCHAR(255),
        activa INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 6. Tabla Sesiones de Mesa
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sesiones_mesa (
        id SERIAL PRIMARY KEY,
        mesa_numero INTEGER NOT NULL,
        estado VARCHAR(50) DEFAULT 'activa',
        ultima_actividad TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        creada_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        cerrada_en TIMESTAMP,
        cerrada_por VARCHAR(255)
      )
    `);

    // 7. Tabla Pedidos
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pedidos (
        id SERIAL PRIMARY KEY,
        sesion_id INTEGER,
        mesa_numero INTEGER NOT NULL DEFAULT 0,
        numero_ronda INTEGER DEFAULT 1,
        items_json TEXT NOT NULL,
        total REAL NOT NULL,
        notas TEXT,
        estado VARCHAR(50) DEFAULT 'pendiente',
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sesion_id) REFERENCES sesiones_mesa(id)
      )
    `);

    // 8. Tabla Historial WA
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wa_conversaciones (
        id SERIAL PRIMARY KEY,
        numero_telefono VARCHAR(50) NOT NULL,
        rol VARCHAR(50) NOT NULL,
        contenido TEXT NOT NULL,
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 9. Tabla Chatbots Paused (Asistencia Humana)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chatbots_paused (
        id SERIAL PRIMARY KEY,
        telefono VARCHAR(50) NOT NULL UNIQUE,
        nombre_cliente VARCHAR(255),
        ultimo_mensaje TEXT,
        fecha_pausa TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 10. Tabla Chatbots Knowledge Base (Entrenamiento)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chatbots_kb (
        id SERIAL PRIMARY KEY,
        pregunta TEXT NOT NULL,
        respuesta TEXT NOT NULL,
        media_url TEXT,
        media_type TEXT,
        categoria VARCHAR(100) DEFAULT 'general',
        ejemplos_sinonimos TEXT,
        activa INTEGER DEFAULT 1,
        prioridad INTEGER DEFAULT 0,
        fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Alteraciones seguras por si la tabla chatbots_kb ya existía sin estas columnas
    await pool.query(`ALTER TABLE chatbots_kb ADD COLUMN IF NOT EXISTS media_url TEXT`);
    await pool.query(`ALTER TABLE chatbots_kb ADD COLUMN IF NOT EXISTS media_type TEXT`);
    await pool.query(`ALTER TABLE chatbots_kb ADD COLUMN IF NOT EXISTS categoria VARCHAR(100) DEFAULT 'general'`);
    await pool.query(`ALTER TABLE chatbots_kb ADD COLUMN IF NOT EXISTS ejemplos_sinonimos TEXT`);
    await pool.query(`ALTER TABLE chatbots_kb ADD COLUMN IF NOT EXISTS activa INTEGER DEFAULT 1`);
    await pool.query(`ALTER TABLE chatbots_kb ADD COLUMN IF NOT EXISTS prioridad INTEGER DEFAULT 0`);

    // 11. Tabla Clientes Frecuentes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clientes_frecuentes (
        telefono VARCHAR(50) PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        visitas_count INTEGER DEFAULT 1,
        ultima_visita TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 12. Tabla Cliente Historial
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cliente_historial (
        id SERIAL PRIMARY KEY,
        telefono VARCHAR(50) UNIQUE NOT NULL,
        ultima_compra TIMESTAMP,
        productos_favoritos TEXT,
        notas_admin TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (telefono) REFERENCES clientes_frecuentes(telefono) ON DELETE CASCADE
      )
    `);

    // 13. Tabla Promociones
    await pool.query(`
      CREATE TABLE IF NOT EXISTS promociones (
        id SERIAL PRIMARY KEY,
        titulo VARCHAR(255) NOT NULL,
        descripcion TEXT NOT NULL,
        imagen_url TEXT,
        imagen_tipo VARCHAR(50) DEFAULT 'image',
        activa INTEGER DEFAULT 1,
        orden INTEGER DEFAULT 0,
        fecha_inicio TIMESTAMP,
        fecha_fin TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 14. Tabla Bot Contexto
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bot_contexto (
        id SERIAL PRIMARY KEY,
        tipo VARCHAR(50),
        contenido TEXT,
        activo INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 15. Tabla Bot Horarios
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bot_horarios (
        id SERIAL PRIMARY KEY,
        dia_semana VARCHAR(20) UNIQUE NOT NULL,
        hora_apertura VARCHAR(5) DEFAULT '18:00',
        hora_cierre VARCHAR(5) DEFAULT '23:30',
        abierto INTEGER DEFAULT 1
      )
    `);

    // 16. Tabla Chatbot Logs (Para Analytics)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chatbot_logs (
        id SERIAL PRIMARY KEY,
        telefono VARCHAR(50),
        nombre_cliente VARCHAR(255),
        tipo VARCHAR(50),
        mensaje_usuario TEXT,
        respuesta_bot TEXT,
        detalles JSONB,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 17. Tabla Insumos Internos
    await pool.query(`
      CREATE TABLE IF NOT EXISTS insumos (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        categoria VARCHAR(50),
        cantidad NUMERIC DEFAULT 0,
        unidad VARCHAR(20) DEFAULT 'unidades',
        stock_minimo NUMERIC DEFAULT 0,
        notas TEXT,
        costo_promedio NUMERIC DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Alter segura para costo_promedio
    await pool.query(`ALTER TABLE insumos ADD COLUMN IF NOT EXISTS costo_promedio NUMERIC DEFAULT 0`);

    // 18. Tabla Compras de Insumos (Historial)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS compras_insumos (
        id SERIAL PRIMARY KEY,
        insumo_id INTEGER REFERENCES insumos(id) ON DELETE CASCADE,
        cantidad NUMERIC NOT NULL,
        costo_total NUMERIC NOT NULL,
        costo_unitario NUMERIC NOT NULL,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 19. Tabla Recetas (Escandallos)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS recetas (
        id SERIAL PRIMARY KEY,
        producto_id INTEGER REFERENCES productos(id) ON DELETE CASCADE,
        insumo_id INTEGER REFERENCES insumos(id) ON DELETE CASCADE,
        cantidad_usada NUMERIC NOT NULL,
        UNIQUE (producto_id, insumo_id)
      )
    `);

    // 20. Tabla Caja (Transacciones Diarias)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS caja_registros (
        id SERIAL PRIMARY KEY,
        tipo VARCHAR(20) NOT NULL, -- 'ingreso' o 'gasto'
        descripcion VARCHAR(255) NOT NULL,
        monto NUMERIC NOT NULL,
        categoria VARCHAR(50),
        creado_por VARCHAR(50) DEFAULT 'sistema',
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 21. Tabla Movimientos de Inventario
    await pool.query(`
      CREATE TABLE IF NOT EXISTS movimientos_inventario (
        id SERIAL PRIMARY KEY,
        producto_id INTEGER NOT NULL,
        variante_id INTEGER,
        cantidad_cambio INTEGER NOT NULL,
        razon VARCHAR(50) NOT NULL,
        pedido_id INTEGER,
        notas TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Columnas nuevas en pedidos para features de mesera
    await pool.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS tipo_pedido VARCHAR(20) DEFAULT 'local'`);
    await pool.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS direccion_domicilio TEXT`);
    await pool.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS prepagado INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS carne_en_parrilla INTEGER DEFAULT 0`);
    await pool.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(30)`);
    await pool.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS nombre_cliente VARCHAR(255)`);
    await pool.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);

    // Agregar columna viendo si no existe (migracion segura)
    await pool.query(`ALTER TABLE mesas ADD COLUMN IF NOT EXISTS viendo INTEGER DEFAULT 0`);

    // Resetear contadores al arrancar (evita zombis por crash o reinicio)
    await pool.query(`UPDATE mesas SET viendo = 0`);

    console.log('✅ Tablas verificadas/creadas en Postgres.');
    await crearIndices();
    sembrarDatosIniciales();
  } catch (e) {
    console.error('Error al inicializar tablas en Postgres:', e);
  }
}

/**
 * Crea índices en la base de datos para optimizar queries
 * Los índices mejoran la velocidad de búsqueda en gran medida
 */
async function crearIndices() {
  try {
    // 1. Índice para búsqueda rápida de usuarios por email/username (Login)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_admins_usuario
      ON admins(usuario)
    `);

    // 2. Índice para filtrado de productos por categoría
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_productos_categoria
      ON productos(categoria_id)
    `);

    // 3. Índice para búsqueda de productos activos
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_productos_activo
      ON productos(activo)
      WHERE activo = 1
    `);

    // 4. Índice para búsqueda de sesiones activas
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_sesiones_estado
      ON sesiones_mesa(estado, ultima_actividad DESC)
    `);

    // 5. Índice para historial de pedidos por mesa
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_pedidos_mesa_fecha
      ON pedidos(mesa_numero, creado_en DESC)
    `);

    // 6. Índice para sesiones activas por mesa
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_sesiones_mesa
      ON sesiones_mesa(mesa_numero, estado)
    `);

    // 7. Índice para historial de WhatsApp por número
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_wa_numero_fecha
      ON wa_conversaciones(numero_telefono, creado_en DESC)
    `);

    // 8. Índice para búsqueda por config key (consultas frecuentes)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_config_key
      ON config(key)
    `);

    // 9. Índices para clientes frecuentes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_clientes_frecuentes_telefono
      ON clientes_frecuentes(telefono)
    `);
    
    // 10. Índices para cliente historial
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_cliente_historial_telefono
      ON cliente_historial(telefono)
    `);

    // 11. Índices para promociones
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_promociones_activa
      ON promociones(activa)
      WHERE activa = 1
    `);

    // 12. Índices para chatbot logs
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chatbot_logs_telefono
      ON chatbot_logs(telefono)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chatbot_logs_fecha
      ON chatbot_logs(fecha DESC)
    `);

    console.log('✅ Índices verificados/creados en Postgres.');
  } catch (e) {
    console.error('Error al crear índices en Postgres:', e);
  }
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

  // Sembrar horarios por defecto
  db.get("SELECT COUNT(*) as count FROM bot_horarios", (err, row) => {
    if (!err && row && parseInt(row.count) === 0) {
      console.log('Sembrando horarios por defecto...');
      const dias = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
      dias.forEach(dia => {
        db.run(
          `INSERT INTO bot_horarios (dia_semana, hora_apertura, hora_cierre, abierto)
           VALUES (?, ?, ?, ?) ON CONFLICT (dia_semana) DO NOTHING`,
          [dia, '18:00', '23:30', 1]
        );
      });
    }
  });
}

// Inicializar la estructura
inicializarTablas();

module.exports = db;
