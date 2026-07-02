/**
 * Function Validator for Gemini AI
 *
 * Valida inputs de funciones antes de ejecutarlas:
 * - Tipo de dato correcto
 * - Rango de valores válido
 * - Previene SQL injection
 * - Previene NoSQL injection
 * - Auditoría de llamadas
 */

const db = require('../config/database');

/**
 * Schemas de validación para cada función Gemini
 * Define tipos, rangos, validaciones personalizadas
 */
const FUNCTION_SCHEMAS = {
  'crear_producto': {
    params: {
      nombre: { type: 'string', minLength: 1, maxLength: 255 },
      descripcion: { type: 'string', maxLength: 1000 },
      precio: { type: 'number', min: 0, max: 999999.99 },
      categoria_id: { type: 'number', min: 1, integer: true },
      stock: { type: 'number', min: 0, max: 1000000, integer: true }
    },
    requireAll: ['nombre', 'precio', 'categoria_id']
  },

  'actualizar_precio': {
    params: {
      producto_id: { type: 'number', min: 1, integer: true },
      nuevo_precio: { type: 'number', min: 0, max: 999999.99 }
    },
    requireAll: ['producto_id', 'nuevo_precio']
  },

  'actualizar_stock': {
    params: {
      producto_id: { type: 'number', min: 1, integer: true },
      cantidad: { type: 'number', min: -1000000, max: 1000000, integer: true }
    },
    requireAll: ['producto_id', 'cantidad']
  },

  'crear_pedido': {
    params: {
      mesa_numero: { type: 'number', min: 1, max: 100, integer: true },
      items_json: { type: 'string', maxLength: 5000, json: true },
      total: { type: 'number', min: 0, max: 999999.99 },
      notas: { type: 'string', maxLength: 500 }
    },
    requireAll: ['mesa_numero', 'items_json', 'total']
  },

  'buscar_producto': {
    params: {
      termino: { type: 'string', minLength: 1, maxLength: 100 },
      categoria_id: { type: 'number', integer: true, optional: true }
    },
    requireAll: ['termino']
  },

  'obtener_inventario': {
    params: {
      categoria_id: { type: 'number', integer: true, optional: true }
    },
    requireAll: []
  },

  'crear_promocion': {
    params: {
      titulo: { type: 'string', minLength: 1, maxLength: 255 },
      descripcion: { type: 'string', maxLength: 1000 },
      orden: { type: 'number', min: 0, max: 999, integer: true, optional: true }
    },
    requireAll: ['titulo', 'descripcion']
  },

  'pausar_chat': {
    params: {
      numero_cliente: { type: 'string', pattern: '^\\+?[0-9]{10,15}$' },
      razon: { type: 'string', maxLength: 500 }
    },
    requireAll: ['numero_cliente']
  }
};

/**
 * Validar un valor contra un schema de parámetro
 *
 * @param {*} value - Valor a validar
 * @param {object} schema - Schema de validación
 * @returns {object} { valid: boolean, error?: string }
 */
function validateValue(value, schema) {
  // Verificar tipo
  if (schema.type === 'string' && typeof value !== 'string') {
    return { valid: false, error: `Debe ser texto, recibido: ${typeof value}` };
  }

  if (schema.type === 'number' && typeof value !== 'number') {
    return { valid: false, error: `Debe ser número, recibido: ${typeof value}` };
  }

  if (schema.type === 'boolean' && typeof value !== 'boolean') {
    return { valid: false, error: `Debe ser booleano, recibido: ${typeof value}` };
  }

  // Validaciones específicas por tipo
  if (schema.type === 'string') {
    // minLength
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return { valid: false, error: `Mínimo ${schema.minLength} caracteres` };
    }

    // maxLength
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      return { valid: false, error: `Máximo ${schema.maxLength} caracteres` };
    }

    // Pattern (regex)
    if (schema.pattern !== undefined) {
      const regex = new RegExp(schema.pattern);
      if (!regex.test(value)) {
        return { valid: false, error: `Formato inválido: ${schema.pattern}` };
      }
    }

    // JSON validation
    if (schema.json === true) {
      try {
        JSON.parse(value);
      } catch (err) {
        return { valid: false, error: `JSON inválido: ${err.message}` };
      }
    }

    // SQL Injection prevention
    if (hasSQLInjectionPattern(value)) {
      return { valid: false, error: 'Patrón sospechoso detectado (SQL injection)' };
    }

    // NoSQL Injection prevention
    if (hasNoSQLInjectionPattern(value)) {
      return { valid: false, error: 'Patrón sospechoso detectado (NoSQL injection)' };
    }
  }

  if (schema.type === 'number') {
    // Validar integer
    if (schema.integer === true && !Number.isInteger(value)) {
      return { valid: false, error: 'Debe ser número entero' };
    }

    // min
    if (schema.min !== undefined && value < schema.min) {
      return { valid: false, error: `Mínimo: ${schema.min}` };
    }

    // max
    if (schema.max !== undefined && value > schema.max) {
      return { valid: false, error: `Máximo: ${schema.max}` };
    }

    // NaN check
    if (isNaN(value)) {
      return { valid: false, error: 'No es un número válido' };
    }

    // Infinity check
    if (!isFinite(value)) {
      return { valid: false, error: 'Número fuera de rango' };
    }
  }

  return { valid: true };
}

/**
 * Detecta patrones comunes de SQL injection
 *
 * @param {string} value - String a verificar
 * @returns {boolean} true si contiene patrón sospechoso
 */
function hasSQLInjectionPattern(value) {
  const sqlPatterns = [
    /(\bOR\b|\bAND\b)[\s\w='"]+/i,  // OR/AND statements
    /(\bDROP\b|\bDELETE\b|\bUPDATE\b|\bINSERT\b)/i, // DDL/DML
    /(\bUNION\b|\bSELECT\b)/i,       // UNION/SELECT
    /--\s*$/,                         // SQL comment
    /;[\s]*$/,                        // Statement terminator
    /\/\*.*?\*\//,                    // Block comment
    /xp_|sp_/i                        // Stored procedures
  ];

  return sqlPatterns.some(pattern => pattern.test(value));
}

/**
 * Detecta patrones comunes de NoSQL injection
 *
 * @param {string} value - String a verificar
 * @returns {boolean} true si contiene patrón sospechoso
 */
function hasNoSQLInjectionPattern(value) {
  const noSqlPatterns = [
    /\{[\s]*\$[a-z]+/i,              // MongoDB operators: {$where, $regex}
    /db\.[a-z]+\(/i,                 // db.collection()
    /function[\s]*\(/i,              // JavaScript code
    /eval[\s]*\(/i,                  // eval()
    /return[\s]+/i                   // return statements
  ];

  return noSqlPatterns.some(pattern => pattern.test(value));
}

/**
 * Valida todos los parámetros contra un schema de función
 *
 * @param {string} functionName - Nombre de la función
 * @param {object} params - Parámetros a validar
 * @returns {object} { valid: boolean, errors?: {param: error} }
 */
function validateFunctionParams(functionName, params) {
  const schema = FUNCTION_SCHEMAS[functionName];

  if (!schema) {
    return {
      valid: false,
      error: `Función desconocida: ${functionName}`
    };
  }

  const errors = {};

  // Validar parámetros requeridos
  for (const required of schema.requireAll) {
    if (params[required] === undefined || params[required] === null) {
      errors[required] = `Parámetro requerido`;
    }
  }

  // Validar cada parámetro presente
  for (const [paramName, paramValue] of Object.entries(params)) {
    // Ignorar parámetros no en schema
    if (!schema.params[paramName]) {
      errors[paramName] = `Parámetro no reconocido`;
      continue;
    }

    const paramSchema = schema.params[paramName];
    const validation = validateValue(paramValue, paramSchema);

    if (!validation.valid) {
      errors[paramName] = validation.error;
    }
  }

  // Si hay errores, retornar detalle
  if (Object.keys(errors).length > 0) {
    return {
      valid: false,
      errors
    };
  }

  return { valid: true };
}

/**
 * Registra llamada a función en auditoría
 *
 * @param {string} functionName - Nombre de función
 * @param {object} params - Parámetros pasados
 * @param {boolean} valid - Si fue válido
 * @param {string} error - Error si aplicable
 */
async function auditFunctionCall(functionName, params, valid, error = null) {
  try {
    await db.run(
      `INSERT INTO function_call_audit (function_name, params_json, valid, error, called_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [
        functionName,
        JSON.stringify(params),
        valid ? 1 : 0,
        error
      ]
    );

    console.log(`[Function Audit] ${functionName}: ${valid ? '✅ VÁLIDO' : '❌ INVÁLIDO'}`);
  } catch (err) {
    console.error('[Function Audit] Error registrando llamada:', err.message);
  }
}

/**
 * Ejecuta función Gemini con validación de inputs
 *
 * @param {string} functionName - Nombre de función
 * @param {object} params - Parámetros
 * @param {Function} executeCallback - Callback que ejecuta la función
 * @returns {Promise<object>} { success: boolean, result?: any, error?: string }
 */
async function executeWithValidation(functionName, params, executeCallback) {
  // 1. Validar parámetros
  const validation = validateFunctionParams(functionName, params);

  if (!validation.valid) {
    await auditFunctionCall(functionName, params, false, JSON.stringify(validation.errors));

    return {
      success: false,
      error: `Validación fallida: ${JSON.stringify(validation.errors)}`
    };
  }

  // 2. Parámetros válidos - registrar y ejecutar
  try {
    const result = await executeCallback(params);

    await auditFunctionCall(functionName, params, true);

    return {
      success: true,
      result
    };
  } catch (err) {
    await auditFunctionCall(functionName, params, false, err.message);

    return {
      success: false,
      error: `Error ejecutando función: ${err.message}`
    };
  }
}

/**
 * Obtiene lista de funciones y sus schemas
 *
 * @returns {array} Array de funciones disponibles con schemas
 */
function getFunctionSchemas() {
  return Object.entries(FUNCTION_SCHEMAS).map(([name, schema]) => ({
    name,
    params: schema.params,
    required: schema.requireAll
  }));
}

module.exports = {
  validateFunctionParams,
  validateValue,
  executeWithValidation,
  auditFunctionCall,
  getFunctionSchemas,
  FUNCTION_SCHEMAS,
  hasSQLInjectionPattern,
  hasNoSQLInjectionPattern
};
