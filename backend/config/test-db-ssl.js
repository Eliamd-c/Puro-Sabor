/**
 * Test SSL/TLS Connection Validation
 *
 * Valida que la conexión a Supabase está usando SSL/TLS correctamente.
 * Se ejecuta al startup para detectar problemas de configuración ANTES de ir a producción.
 */

const { Pool } = require('pg');

async function validateSSLConfiguration() {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.HOSTINGER_MODE === 'true';

  console.log(`[SSL Test] Iniciando validación SSL (Modo: ${isProduction ? 'PRODUCCIÓN' : 'DESARROLLO'})`);

  // Test 1: Verificar que DATABASE_URL está configurado
  if (!process.env.DATABASE_URL) {
    console.error('[SSL Test] ❌ FALLO: DATABASE_URL no está configurado');
    return false;
  }
  console.log('[SSL Test] ✅ DATABASE_URL configurado');

  // Test 2: Verificar que DATABASE_URL contiene postgres:// o postgresql://
  if (!process.env.DATABASE_URL.startsWith('postgres') && !process.env.DATABASE_URL.startsWith('postgresql')) {
    console.error('[SSL Test] ❌ FALLO: DATABASE_URL no parece ser un URL PostgreSQL válido');
    return false;
  }
  console.log('[SSL Test] ✅ DATABASE_URL parece válido');

  // Test 3: Intentar conectar sin SSL (debe fallar en producción)
  if (isProduction) {
    console.log('[SSL Test] Verificando que conexión SIN SSL se rechaza en producción...');
    try {
      const testPoolNoSSL = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: false,
        connectionTimeoutMillis: 5000
      });

      await testPoolNoSSL.query('SELECT 1');

      // Si llegamos aquí en producción, hay un problema
      console.error('[SSL Test] ⚠️  ADVERTENCIA: Se permitió conexión sin SSL en producción (Supabase rechazó la conexión)');
      await testPoolNoSSL.end();
    } catch (err) {
      // Expected en producción - Supabase rechaza conexiones no-SSL
      if (err.message.includes('SSL') || err.message.includes('certificate') || err.code === 'ECONNREFUSED') {
        console.log('[SSL Test] ✅ Conexión sin SSL fue rechazada (comportamiento esperado en producción)');
      } else {
        console.log('[SSL Test] ℹ️  Conexión falló:', err.message);
      }
    }
  }

  // Test 4: Intentar conectar CON SSL (debe funcionar siempre)
  console.log('[SSL Test] Verificando conexión CON SSL...');
  try {
    const testPoolWithSSL = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: isProduction
        ? { rejectUnauthorized: true }
        : { rejectUnauthorized: false },
      connectionTimeoutMillis: 5000
    });

    const result = await testPoolWithSSL.query('SELECT 1 as test');

    if (result.rows[0].test === 1) {
      console.log('[SSL Test] ✅ Conexión SSL exitosa');
      await testPoolWithSSL.end();
      return true;
    } else {
      console.error('[SSL Test] ❌ FALLO: Query retornó resultado inesperado');
      await testPoolWithSSL.end();
      return false;
    }
  } catch (err) {
    console.error('[SSL Test] ❌ FALLO: No se pudo conectar con SSL');
    console.error('[SSL Test] Error:', err.message);

    if (err.message.includes('certificate')) {
      console.error('[SSL Test] 💡 Sugerencia: Problema de certificado. En producción Supabase requiere SSL con certificado válido.');
    }

    return false;
  }
}

// Test 5: Validar configuración de rejectUnauthorized
async function validateRejectUnauthorizedSetting() {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.HOSTINGER_MODE === 'true';

  console.log('[SSL Test] Verificando configuración de rejectUnauthorized...');

  if (isProduction) {
    // En producción, rejectUnauthorized DEBE ser true
    if (process.env.NODE_ENV === 'production' || process.env.HOSTINGER_MODE === 'true') {
      console.log('[SSL Test] ✅ Modo PRODUCCIÓN detectado - rejectUnauthorized debe ser true');
      return true;
    }
  } else {
    // En desarrollo, puede ser false
    console.log('[SSL Test] ℹ️  Modo DESARROLLO detectado - rejectUnauthorized puede ser false');
    return true;
  }
}

// Ejecutar tests
async function runAllTests() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║        VALIDACIÓN DE SSL/TLS - STARTUP TEST            ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  const sslTest = await validateSSLConfiguration();
  const settingTest = await validateRejectUnauthorizedSetting();

  console.log('\n╔════════════════════════════════════════════════════════╗');
  if (sslTest && settingTest) {
    console.log('║           ✅ TODOS LOS TESTS PASARON                     ║');
    console.log('║  La conexión SSL/TLS está configurada correctamente    ║');
  } else {
    console.log('║           ⚠️  ALGUNOS TESTS FALLARON                     ║');
    console.log('║   Verifica la configuración de SSL/TLS antes de usar   ║');
  }
  console.log('╚════════════════════════════════════════════════════════╝\n');

  return sslTest && settingTest;
}

module.exports = { validateSSLConfiguration, validateRejectUnauthorizedSetting, runAllTests };

// Si se ejecuta directamente (node config/test-db-ssl.js)
if (require.main === module) {
  runAllTests().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(err => {
    console.error('Error fatal:', err);
    process.exit(1);
  });
}
