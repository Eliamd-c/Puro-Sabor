const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'menu.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Tabla para usuarios en espera de un humano
  db.run(`
    CREATE TABLE IF NOT EXISTS chatbots_paused (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telefono TEXT UNIQUE,
      nombre_cliente TEXT,
      ultimo_mensaje TEXT,
      fecha_pausa DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Tabla para la base de conocimientos (preguntas y respuestas aprendidas del admin)
  db.run(`
    CREATE TABLE IF NOT EXISTS chatbots_kb (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pregunta TEXT,
      respuesta TEXT,
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("✅ Tablas chatbots_paused y chatbots_kb creadas (si no existían).");
});

db.close();
