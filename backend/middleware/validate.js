const AppError = require('../errors/AppError');

const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true // Removes fields not defined in schema
    });
    
    if (error) {
      const messages = error.details.map(d => d.message).join(', ');
      return next(new AppError(`Error de validación: ${messages}`, 400));
    }
    
    req.validatedBody = value;
    next();
  };
};

module.exports = validate;
