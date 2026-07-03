/**
 * Admin Authorization Service
 *
 * Maneja:
 * - Validación E.164 de números de teléfono
 * - Auditoría de intentos de acceso
 * - 2FA via SMS (simulado/real)
 * - Whitelist de números administrativos
 */

// IMPORTANTE: usar la versión con promesas. El módulo '../config/database'
// es de estilo callback: llamarlo con `await` devuelve undefined siempre,
// lo que hacía que isAdminNumberAuthorized() jamás autorizara a nadie.
const db = require('../config/database-promise');
const crypto = require('crypto');

// Cache temporal de OTP codes {number: {code, expires, attempts}}
const otpCache = {};

// Cleanup cache cada 5 minutos
setInterval(() => {
  const now = Date.now();
  for (const number in otpCache) {
    if (otpCache[number].expires < now) {
      delete otpCache[number];
    }
  }
}, 5 * 60 * 1000);

/**
 * Valida número telefónico en formato E.164
 * E.164: +[país][número]
 * Ejemplo: +573142146407 (Colombia)
 *
 * @param {string} number - Número a validar
 * @returns {object} { valid: boolean, normalized: string, error?: string }
 */
function validateE164Format(number) {
  if (!number || typeof number !== 'string') {
    return { valid: false, error: 'Número debe ser string' };
  }

  // Remover espacios y guiones
  let cleaned = number.trim().replace(/[\s\-\(\)]/g, '');

  // Si empieza con 0, agregar + (asume país local)
  if (cleaned.startsWith('0')) {
    cleaned = '+57' + cleaned.substring(1);
  }

  // Si no empieza con +, decidir según el contenido:
  // WhatsApp entrega los números YA con código de país (ej: 573133288298).
  // Anteponer +57 a ciegas duplicaba el código: +57573133288298.
  if (!cleaned.startsWith('+')) {
    if (cleaned.startsWith('57') && cleaned.length === 12) {
      // Ya trae el código de Colombia (57 + 10 dígitos): solo falta el +
      cleaned = '+' + cleaned;
    } else if (cleaned.length === 10) {
      // Número local de 10 dígitos: anteponer código de Colombia
      cleaned = '+57' + cleaned;
    } else {
      // Cualquier otro caso: asumir que ya trae código de país
      cleaned = '+' + cleaned;
    }
  }

  // E.164 regex: +1-999 dígitos (máximo 15 dígitos después del +)
  const e164Regex = /^\+[1-9]\d{1,14}$/;

  if (!e164Regex.test(cleaned)) {
    return {
      valid: false,
      error: `Formato inválido. Debe ser E.164: +573142146407`
    };
  }

  // Validar que tenga al menos 10 dígitos (excluyen­do +)
  const digitsOnly = cleaned.replace(/\D/g, '');
  if (digitsOnly.length < 10) {
    return {
      valid: false,
      error: `Número muy corto. Mínimo 10 dígitos`
    };
  }

  return {
    valid: true,
    normalized: cleaned  // +573142146407
  };
}

/**
 * Registra intento de acceso admin en auditoría
 *
 * @param {string} number - Número que intentó acceder
 * @param {string} status - 'authorized' | 'denied' | '2fa_required' | 'invalid_format'
 * @param {string} reason - Razón del resultado
 * @param {string} metadata - JSON string de datos adicionales
 */
async function logAccessAttempt(number, status, reason, metadata = null) {
  try {
    const result = await db.run(
      `INSERT INTO admin_whitelist_logs (numero, status, reason, metadata, creado_en)
       VALUES (?, ?, ?, ?, NOW())`,
      [number, status, reason, metadata]
    );

    console.log(`[Admin Auth] Log: ${number} - ${status} (${reason})`);
    return result;
  } catch (err) {
    console.error('[Admin Auth] Error logging access:', err.message);
  }
}

/**
 * Compara dos números por sus últimos 10 dígitos (línea local en Colombia),
 * ignorando +, código de país y formato. Evita falsos negativos por
 * diferencias de normalización ("+573133288298" vs "573133288298").
 */
function sameNumber(a, b) {
  const da = String(a).replace(/\D/g, '');
  const db_ = String(b).replace(/\D/g, '');
  if (da.length < 10 || db_.length < 10) return da === db_;
  return da.slice(-10) === db_.slice(-10);
}

/**
 * Verifica si número está autorizado como admin.
 *
 * Fuentes de autorización (cualquiera de las dos vale):
 * 1. config.admin_whatsapp_numbers — la lista que el admin gestiona desde el
 *    panel de Inventario ("Números Autorizados"). Es la fuente principal.
 * 2. admin_whitelist — tabla del flujo 2FA (FASE 1.2).
 *
 * @param {string} number - Número a verificar (debe estar normalizado)
 * @returns {Promise<boolean>}
 */
async function isAdminNumberAuthorized(number) {
  try {
    // 1) Lista del panel (config.admin_whatsapp_numbers)
    const cfg = await db.get(
      `SELECT value FROM config WHERE key = 'admin_whatsapp_numbers'`,
      []
    );
    if (cfg && cfg.value) {
      const allowed = cfg.value.split(',').map(n => n.trim()).filter(Boolean);
      if (allowed.some(n => sameNumber(n, number))) {
        return true;
      }
    }

    // 2) Whitelist 2FA (comparación flexible por últimos 10 dígitos)
    const rows = await db.all(
      `SELECT numero FROM admin_whitelist WHERE activo = 1`,
      []
    );
    if (rows && rows.some(r => sameNumber(r.numero, number))) {
      return true;
    }

    return false;
  } catch (err) {
    console.error('[Admin Auth] Error checking authorization:', err.message);
    return false;
  }
}

/**
 * Genera código OTP de 6 dígitos
 * @returns {string}
 */
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Envía OTP via "SMS" (simulado en desarrollo, real en producción)
 *
 * @param {string} number - Número E.164
 * @param {string} code - Código OTP
 * @returns {Promise<boolean>}
 */
async function sendOTP(number, code) {
  const isDevelopment = process.env.NODE_ENV !== 'production';

  if (isDevelopment) {
    // En desarrollo, imprimir código en logs (para testing)
    console.log(`[Admin Auth] 🔐 OTP para ${number}: ${code}`);
    return true;
  }

  // En producción, usar servicio SMS real (Twilio, AWS SNS, etc)
  try {
    // TODO: Implementar Twilio o similar
    // const result = await twilioClient.messages.create({
    //   from: process.env.TWILIO_PHONE,
    //   to: number,
    //   body: `[Puro Sabor] Tu código de autorización: ${code}`
    // });

    console.log(`[Admin Auth] SMS enviado a ${number}`);
    return true;
  } catch (err) {
    console.error('[Admin Auth] Error enviando SMS:', err.message);
    return false;
  }
}

/**
 * Inicia proceso 2FA: genera OTP y lo envía
 *
 * @param {string} number - Número E.164
 * @returns {Promise<object>} { success: boolean, message?: string, error?: string }
 */
async function initiate2FA(number) {
  try {
    const code = generateOTP();
    const expiresIn = 10 * 60 * 1000; // 10 minutos

    // Guardar en cache
    otpCache[number] = {
      code,
      expires: Date.now() + expiresIn,
      attempts: 0
    };

    // Enviar OTP
    const sent = await sendOTP(number, code);
    if (!sent) {
      return {
        success: false,
        error: 'No se pudo enviar SMS. Intenta más tarde.'
      };
    }

    await logAccessAttempt(number, '2fa_required', 'OTP enviado');

    return {
      success: true,
      message: `Código enviado a ${number}. Válido por 10 minutos.`
    };
  } catch (err) {
    console.error('[Admin Auth] Error iniciando 2FA:', err.message);
    return {
      success: false,
      error: 'Error interno al enviar código'
    };
  }
}

/**
 * Verifica código OTP y autoriza número si es válido
 *
 * @param {string} number - Número E.164
 * @param {string} code - Código OTP ingresado
 * @returns {Promise<object>} { success: boolean, message?: string, error?: string }
 */
async function verify2FA(number, code) {
  try {
    const cache = otpCache[number];

    // Verificar que exista OTP
    if (!cache) {
      await logAccessAttempt(number, 'denied', '2FA code no iniciado o expirado');
      return {
        success: false,
        error: 'No hay código OTP activo. Inicia 2FA primero.'
      };
    }

    // Verificar expiration
    if (Date.now() > cache.expires) {
      delete otpCache[number];
      await logAccessAttempt(number, 'denied', '2FA code expirado');
      return {
        success: false,
        error: 'Código expiró. Inicia 2FA nuevamente.'
      };
    }

    // Verificar intentos (máximo 3)
    if (cache.attempts >= 3) {
      delete otpCache[number];
      await logAccessAttempt(number, 'denied', 'Demasiados intentos fallidos');
      return {
        success: false,
        error: 'Demasiados intentos. Inicia 2FA nuevamente.'
      };
    }

    // Verificar código
    if (code !== cache.code) {
      cache.attempts++;
      await logAccessAttempt(
        number,
        'denied',
        `Código incorrecto (intento ${cache.attempts}/3)`
      );
      return {
        success: false,
        error: `Código incorrecto. Intento ${cache.attempts}/3`
      };
    }

    // ✅ Código correcto - Autorizar número
    delete otpCache[number];

    // Agregar a whitelist
    await db.run(
      `INSERT INTO admin_whitelist (numero, activo, autorizado_en)
       VALUES (?, 1, NOW())
       ON CONFLICT (numero) DO UPDATE SET activo = 1, autorizado_en = NOW()`,
      [number]
    );

    await logAccessAttempt(number, 'authorized', '2FA exitoso, número agregado a whitelist');

    return {
      success: true,
      message: `✅ ${number} autorizado correctamente`
    };
  } catch (err) {
    console.error('[Admin Auth] Error verificando 2FA:', err.message);
    return {
      success: false,
      error: 'Error interno verificando código'
    };
  }
}

/**
 * Autoriza un número manualmente (sin 2FA, solo para testing)
 * ⚠️  SOLO EN DESARROLLO
 *
 * @param {string} number - Número E.164
 * @returns {Promise<object>}
 */
async function authorizeNumberManually(number) {
  if (process.env.NODE_ENV === 'production') {
    return {
      success: false,
      error: 'Autorización manual solo disponible en desarrollo'
    };
  }

  try {
    await db.run(
      `INSERT INTO admin_whitelist (numero, activo, autorizado_en)
       VALUES (?, 1, NOW())
       ON CONFLICT (numero) DO UPDATE SET activo = 1`,
      [number]
    );

    await logAccessAttempt(number, 'authorized', 'Autorizado manualmente (desarrollo)');

    return {
      success: true,
      message: `${number} autorizado`
    };
  } catch (err) {
    console.error('[Admin Auth] Error autorizando:', err.message);
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Deshabilita un número de la whitelist
 *
 * @param {string} number - Número E.164
 * @returns {Promise<object>}
 */
async function revokeAdminAccess(number) {
  try {
    await db.run(
      `UPDATE admin_whitelist SET activo = 0 WHERE numero = ?`,
      [number]
    );

    await logAccessAttempt(number, 'revoked', 'Acceso revocado');

    return {
      success: true,
      message: `Acceso revocado para ${number}`
    };
  } catch (err) {
    console.error('[Admin Auth] Error revocando acceso:', err.message);
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Obtiene historial de intentos de acceso
 *
 * @param {string} number - Número opcional para filtrar
 * @param {number} limit - Límite de resultados
 * @returns {Promise<array>}
 */
async function getAccessLog(number = null, limit = 100) {
  try {
    let query = `SELECT * FROM admin_whitelist_logs`;
    const params = [];

    if (number) {
      query += ` WHERE numero = ?`;
      params.push(number);
    }

    query += ` ORDER BY creado_en DESC LIMIT ?`;
    params.push(limit);

    const rows = await db.all(query, params);
    return rows || [];
  } catch (err) {
    console.error('[Admin Auth] Error obteniendo logs:', err.message);
    return [];
  }
}

module.exports = {
  validateE164Format,
  isAdminNumberAuthorized,
  initiate2FA,
  verify2FA,
  authorizeNumberManually,
  revokeAdminAccess,
  logAccessAttempt,
  getAccessLog,
  generateOTP,
  sendOTP
};
