const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, '..', 'database', 'menu.db');

// Asegurar que la carpeta database exista
const fs = require('fs');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error al conectar a la base de datos:', err.message);
  } else {
    console.log('Conectado a la base de datos SQLite.');
    inicializarTablas();
  }
});

function inicializarTablas() {
  db.serialize(() => {
    // 1. Tabla Categorías
    db.run(`
      CREATE TABLE IF NOT EXISTS categorias (
        id INTEGER PRIMARY KEY AUTO_INCREMENT,
        nombre TEXT NOT NULL UNIQUE,
        descripcion TEXT,
        orden INTEGER DEFAULT 0,
        activa INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `.replace('AUTO_INCREMENT', 'AUTOINCREMENT')); // SQLite usa AUTOINCREMENT

    // 2. Tabla Productos
    db.run(`
      CREATE TABLE IF NOT EXISTS productos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        descripcion TEXT,
        precio REAL NOT NULL,
        categoria_id INTEGER NOT NULL,
        stock INTEGER DEFAULT 0,
        imagen_url TEXT,
        disponible INTEGER DEFAULT 1,
        activo INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (categoria_id) REFERENCES categorias(id)
      )
    `);

    // 3. Tabla Admins
    db.run(`
      CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        email TEXT,
        activo INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME
      )
    `);

    // 4. Tabla Config (clave-valor para WhatsApp, dominio, etc.)
    db.run(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 5. Tabla Mesas (mesas físicas del restaurante)
    db.run(`
      CREATE TABLE IF NOT EXISTS mesas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        numero INTEGER UNIQUE NOT NULL,
        nombre TEXT,
        activa INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 6. Tabla Sesiones de Mesa (ciclo de vida por grupo)
    db.run(`
      CREATE TABLE IF NOT EXISTS sesiones_mesa (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mesa_numero INTEGER NOT NULL,
        estado TEXT DEFAULT 'activa',
        ultima_actividad DATETIME DEFAULT CURRENT_TIMESTAMP,
        creada_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        cerrada_en DATETIME,
        cerrada_por TEXT
      )
    `);

    // 7. Tabla Pedidos (rondas de pedido por sesión)
    db.run(`
      CREATE TABLE IF NOT EXISTS pedidos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sesion_id INTEGER NOT NULL,
        mesa_numero INTEGER NOT NULL,
        numero_ronda INTEGER DEFAULT 1,
        items_json TEXT NOT NULL,
        total REAL NOT NULL,
        notas TEXT,
        creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sesion_id) REFERENCES sesiones_mesa(id)
      )
    `);

    // 8. Tabla Historial de conversaciones de WhatsApp IA
    db.run(`
      CREATE TABLE IF NOT EXISTS wa_conversaciones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        numero_telefono TEXT NOT NULL,
        rol TEXT NOT NULL,
        contenido TEXT NOT NULL,
        creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, () => {
      // Una vez creadas todas las tablas, sembrar datos iniciales
      sembrarDatosIniciales();
    });
  });
}

function sembrarDatosIniciales() {
  // Sembrar configuración inicial (WhatsApp, dominio, y API de Gemini)
  const configs = [
    ['whatsapp_numero', '3133288298'],
    ['dominio_base', 'https://restaurantepurosabor.com'],
    ['restaurante_nombre', 'Puro Sabor'],
    ['mesas_timeout_horas', '2'],
    ['gemini_api_key', ''],
    ['whatsapp_whitelist', '573133288298,3133288298'],
    ['whatsapp_bot_active', '1']
  ];
  const stmt = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
  configs.forEach(c => stmt.run(c));
  stmt.finalize(() => console.log('✅ Config inicial/IA sembrada.'));

  // Sembrar 6 mesas iniciales
  db.get("SELECT COUNT(*) as count FROM mesas", (err, row) => {
    if (!err && row && row.count === 0) {
      const stmt = db.prepare('INSERT INTO mesas (numero, nombre) VALUES (?, ?)');
      for (let i = 1; i <= 6; i++) {
        stmt.run([i, `Mesa ${i}`]);
      }
      stmt.finalize(() => console.log('✅ 6 mesas iniciales creadas.'));
    }
  });

  // Verificar si hay categorías
  db.get('SELECT COUNT(*) as count FROM categorias', (err, row) => {
    if (err) return console.error('Error al verificar categorías:', err);

    if (row.count === 0) {
      console.log('Sembrando categorías iniciales...');
      const categorias = [
        ['Migas al Carbón', 'Nuestra especialidad al carbón, elige el tamaño y la proteína que desees', 1],
        ['Bebidas', 'Acompañamientos refrescantes', 2],
        ['Postres', 'El toque dulce final', 3]
      ];

      const stmt = db.prepare('INSERT INTO categorias (nombre, descripcion, orden) VALUES (?, ?, ?)');
      categorias.forEach(cat => stmt.run(cat));
      stmt.finalize(() => {
        // Sembrar productos una vez que las categorías existan
        sembrarProductos();
      });
    } else {
      sembrarProductos();
    }
  });

  // Verificar admin
  db.get('SELECT COUNT(*) as count FROM admins', (err, row) => {
    if (err) return console.error('Error al verificar admins:', err);

    if (row.count === 0) {
      console.log('Sembrando administrador por defecto...');
      const defaultUser = process.env.ADMIN_USER || 'admin';
      const defaultPassword = process.env.ADMIN_PASSWORD || 'purosabor2026';
      
      bcrypt.hash(defaultPassword, 10, (err, hash) => {
        if (err) return console.error('Error hashing password:', err);
        db.run(
          'INSERT INTO admins (usuario, password_hash, email) VALUES (?, ?, ?)',
          [defaultUser, hash, 'admin@purosabor.com'],
          (err) => {
            if (err) console.error('Error al sembrar admin:', err);
            else console.log(`Administrador '${defaultUser}' creado con éxito.`);
          }
        );
      });
    }
  });
}

function sembrarProductos() {
  db.get('SELECT COUNT(*) as count FROM productos', (err, row) => {
    if (err) return console.error('Error al verificar productos:', err);

    if (row.count === 0) {
      console.log('Sembrando productos iniciales...');
      
      // Obtener los IDs de las categorías recién creadas
      db.all('SELECT id, nombre FROM categorias', (err, rows) => {
        if (err) return console.error('Error al obtener categorías:', err);
        
        const catMap = {};
        rows.forEach(r => { catMap[r.nombre] = r.id; });

        const productos = [
          // Migas al Carbón - RES
          [
            'Migas con Res (Pequeña - 125 gr)', 
            'Deliciosas migas tradicionales de plátano acompañadas de 125 gr de jugoso lomo de res premium al carbón.', 
            15000.00, 
            catMap['Migas al Carbón'], 
            50, 
            '/assets/images/miga_res.png'
          ],
          [
            'Migas con Res (Grande - 250 gr)', 
            'Nuestra especialidad: abundante porción de migas de plátano con 250 gr de jugoso lomo de res premium al carbón.', 
            25000.00, 
            catMap['Migas al Carbón'], 
            35, 
            '/assets/images/miga_res.png'
          ],
          
          // Migas al Carbón - CERDO
          [
            'Migas con Cerdo (Pequeña - 125 gr)', 
            'Migas tradicionales de plátano verde con 125 gr de tierna carne de cerdo asada al carbón.', 
            15000.00, 
            catMap['Migas al Carbón'], 
            50, 
            '/assets/images/miga_cerdo.png'
          ],
          [
            'Migas con Cerdo (Grande - 250 gr)', 
            'Generosa porción de migas de plátano verde con 250 gr de filete de cerdo marinado asado al carbón.', 
            22000.00, 
            catMap['Migas al Carbón'], 
            40, 
            '/assets/images/miga_cerdo.png'
          ],

          // Migas al Carbón - UBRE
          [
            'Migas con Ubre (Pequeña - 125 gr)', 
            'Una especialidad tradicional exquisita: migas de plátano con 125 gr de ubre tierna asada al carbón.', 
            15000.00, 
            catMap['Migas al Carbón'], 
            30, 
            '/assets/images/miga_ubre.png'
          ],
          [
            'Migas con Ubre (Grande - 250 gr)', 
            'La máxima expresión de nuestra tradición: migas de plátano con 250 gr de ubre tierna asada al carbón.', 
            22000.00, 
            catMap['Migas al Carbón'], 
            25, 
            '/assets/images/miga_ubre.png'
          ],

          // Migas al Carbón - POLLO
          [
            'Migas con Pollo (Pequeña - 125 gr)', 
            'Suaves migas de plátano tradicionales servidas con 125 gr de jugosa pechuga de pollo marinada al carbón.', 
            15000.00, 
            catMap['Migas al Carbón'], 
            50, 
            '/assets/images/miga_pollo.png'
          ],
          [
            'Migas con Pollo (Grande - 250 gr)', 
            'Exquisito filete de pechuga de pollo al carbón (250 gr) servido sobre una generosa porción de migas de plátano.', 
            20000.00, 
            catMap['Migas al Carbón'], 
            45, 
            '/assets/images/miga_pollo.png'
          ],

          // Migas al Carbón - COSTILLAS BBQ
          [
            'Migas con Costillas BBQ (Pequeña - 125 gr)', 
            'Nuestras famosas costillitas de cerdo tiernas al carbón bañadas en salsa BBQ artesanal, con porción de migas.', 
            15000.00, 
            catMap['Migas al Carbón'], 
            40, 
            '/assets/images/miga_costillas.png'
          ],
          [
            'Migas con Costillas BBQ (Grande - 250 gr)', 
            'Espectaculares costillas de cerdo tiernas al carbón bañadas en salsa BBQ artesanal sobre migas de plátano doradas.', 
            22000.00, 
            catMap['Migas al Carbón'], 
            30, 
            '/assets/images/miga_costillas.png'
          ],
          
          // Bebidas
          [
            'Limonada Natural', 
            'Refrescante limonada natural preparada al instante con limones frescos seleccionados.', 
            6000.00, 
            catMap['Bebidas'], 
            80, 
            '/assets/images/limonada_natural.png'
          ],
          [
            'Limonada Cerezada', 
            'Una deliciosa y vistosa combinación de limonada natural con el dulce sabor de las cerezas selectas.', 
            8700.00, 
            catMap['Bebidas'], 
            60, 
            '/assets/images/limonada_cerezada.png'
          ],
          [
            'Limonada de Hierbabuena', 
            'La frescura absoluta: limonada frapeada con aromáticas hojas de hierbabuena fresca.', 
            7700.00, 
            catMap['Bebidas'], 
            70, 
            '/assets/images/limonada_hierbabuena.png'
          ],
          [
            'Limonada de Coco', 
            'Exquisitamente cremosa y refrescante, nuestra especialidad de la casa preparada con coco natural.', 
            8900.00, 
            catMap['Bebidas'], 
            50, 
            '/assets/images/limonada_coco.png'
          ],
          [
            'Limonada de Mango Biche', 
            'Refrescante y ácida combinación de limonada con tiras de mango biche verde y una pizca de sal.', 
            8900.00, 
            catMap['Bebidas'], 
            50, 
            '/assets/images/limonada_mango_biche.png'
          ],
          [
            'Jugo Natural en Agua', 
            'Lulo, maracuyá o mango 100% natural, sumamente refrescante.', 
            4000.00, 
            catMap['Bebidas'], 
            100, 
            '/assets/images/jugo_natural.png'
          ],
          [
            'Gaseosa (Mini 250 ml)', 
            'Gaseosa helada en presentación mini de 250 ml (Coca-Cola, Postobón o Pepsi).', 
            3500.00, 
            catMap['Bebidas'], 
            100, 
            '/assets/images/gaseosa_fria.png'
          ],
          [
            'Gaseosa (Personal)', 
            'Gaseosa helada en presentación personal (Coca-Cola, Postobón o Pepsi).', 
            6000.00, 
            catMap['Bebidas'], 
            100, 
            '/assets/images/gaseosa_fria.png'
          ],
          [
            'Gaseosa (Litro 1.5)', 
            'Gaseosa helada familiar de 1.5 Litros ideal para compartir con tus migas.', 
            10000.00, 
            catMap['Bebidas'], 
            50, 
            '/assets/images/gaseosa_fria.png'
          ],
          [
            'Agua Mineral con Gas', 
            'Agua mineral con gas refrescante con una rodaja de limón fresquecito.', 
            3000.00, 
            catMap['Bebidas'], 
            80, 
            '/assets/images/agua_gas.png'
          ],
          
          // Postres
          [
            'Flan de Caramelo de la Abuela', 
            'Flan de leche y caramelo sumamente cremoso, preparado diariamente de forma artesanal.', 
            5000.00, 
            catMap['Postres'], 
            15, 
            '/assets/images/flan_caramelo.png'
          ],
          [
            'Tres Leches Artesanal', 
            'Bizcocho esponjoso bañado en salsa de tres leches casera de la casa.', 
            5000.00, 
            catMap['Postres'], 
            20, 
            '/assets/images/tres_leches.png'
          ],
          [
            'Torta de Chocolate', 
            'Torta de chocolate artesanal, húmeda y esponjosa, con fudge de chocolate premium.', 
            6000.00, 
            catMap['Postres'], 
            25, 
            '/assets/images/torta_chocolate.png'
          ]
        ];

        const stmt = db.prepare(`
          INSERT INTO productos (nombre, descripcion, precio, categoria_id, stock, imagen_url) 
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        productos.forEach(prod => stmt.run(prod));
        stmt.finalize(() => {
          console.log('Sembrado de productos completado con éxito.');
        });
      });
    }
  });
}

module.exports = db;
