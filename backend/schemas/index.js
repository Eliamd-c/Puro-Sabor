const Joi = require('joi');

module.exports = {
  loginSchema: Joi.object({
    usuario: Joi.string().pattern(/^[a-zA-Z0-9_.-]+$/).min(3).max(30).required()
      .messages({
        'string.pattern.base': 'El usuario solo puede contener letras, números, guiones, puntos y guiones bajos'
      }),
    password: Joi.string().min(8).required()
      .messages({
        'string.min': 'La contraseña debe tener al menos 8 caracteres'
      })
  }),

  registerSchema: Joi.object({
    usuario: Joi.string().alphanum().min(3).max(30).required()
      .messages({
        'string.alphanum': 'El usuario solo puede contener letras y números',
        'string.min': 'El usuario debe tener al menos 3 caracteres',
        'string.max': 'El usuario no debe exceder 30 caracteres'
      }),
    email: Joi.string().email().required()
      .messages({
        'string.email': 'Debes proporcionar un email válido'
      }),
    password: Joi.string().min(12)
      .pattern(/[A-Z]/).pattern(/[0-9]/).pattern(/[!@#$%^&*]/)
      .required()
      .messages({
        'string.min': 'La contraseña debe tener al menos 12 caracteres',
        'string.pattern.base': 'La contraseña debe contener mayúscula, número y carácter especial (!@#$%^&*)'
      })
  }),

  productoSchema: Joi.object({
    nombre: Joi.string().max(255).required(),
    descripcion: Joi.string().allow('').optional(),
    precio: Joi.number().positive().required(),
    categoria_id: Joi.number().integer().positive().required(),
    stock: Joi.number().integer().min(0).optional(),
    disponible: Joi.number().valid(0, 1).optional(),
    activo: Joi.number().valid(0, 1).optional(),
    imagen_url: Joi.string().allow('').optional() // Sometimes images aren't URIs, they are local paths like /uploads/img.png
  }),

  categoriaSchema: Joi.object({
    nombre: Joi.string().max(255).required(),
    descripcion: Joi.string().allow('').optional(),
    orden: Joi.number().integer().min(0).optional(),
    activa: Joi.number().valid(0, 1).optional()
  })
};
