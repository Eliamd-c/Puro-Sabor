/**
 * Configuración centralizada de variables de entorno
 * Valida que todas las variables requeridas estén presentes en startup
 *
 * Uso: const env = require('./config/env');
 *      console.log(env.JWT_SECRET, env.DATABASE_URL);
 */

require('dotenv').config();

// ── Variables requeridas ───────────────────────────────────────
const REQUIRED_ENVS = [
  'JWT_SECRET',
  'DATABASE_URL'
];

// ── Validación de variables requeridas ─────────────────────────
const missingEnvs = REQUIRED_ENVS.filter(env => !process.env[env]);

if (missingEnvs.length > 0) {
  console.error('❌ FATAL ERROR: Las siguientes variables de entorno son obligatorias:');
  missingEnvs.forEach(env => {
    console.error(`   - ${env}`);
  });
  console.error('\nPor favor, configura estas variables en tu archivo .env');
  process.exit(1);
}

// ── Exportar configuración validada ────────────────────────────
module.exports = {
  // Core
  JWT_SECRET: process.env.JWT_SECRET,
  DATABASE_URL: process.env.DATABASE_URL,
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3005', 10),

  // Frontend
  FRONTEND_URL: process.env.FRONTEND_URL || 'https://restaurantepurosabor.com',

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',

  // APIs externas
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',

  // Configuración de negocio
  RESTAURANT_NAME: process.env.RESTAURANT_NAME || 'Puro Sabor',
  WHATSAPP_NUMBER: process.env.WHATSAPP_NUMBER || '',

  // Funciones de ayuda
  isDevelopment() {
    return this.NODE_ENV === 'development';
  },

  isProduction() {
    return this.NODE_ENV === 'production';
  }
};
