const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Puro Sabor - API Documentation',
      version: '1.0.0',
      description: 'API para Menú Interactivo y Panel Administrativo del Restaurante Puro Sabor',
      contact: {
        name: 'Puro Sabor',
        url: 'https://restaurantepurosabor.com'
      }
    },
    servers: [
      {
        url: 'http://localhost:3005',
        description: 'Development server'
      },
      {
        url: 'https://restaurantepurosabor.com',
        description: 'Production server'
      }
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      },
      schemas: {
        Categoria: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            nombre: { type: 'string' },
            descripcion: { type: 'string' },
            orden: { type: 'integer' },
            activa: { type: 'integer' },
            created_at: { type: 'string', format: 'date-time' }
          }
        },
        Producto: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            nombre: { type: 'string' },
            descripcion: { type: 'string' },
            precio: { type: 'number' },
            categoria_id: { type: 'integer' },
            stock: { type: 'integer' },
            disponible: { type: 'integer' },
            imagen_url: { type: 'string' },
            created_at: { type: 'string', format: 'date-time' },
            updated_at: { type: 'string', format: 'date-time' }
          }
        },
        Mesa: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            numero: { type: 'integer' },
            nombre: { type: 'string' },
            activa: { type: 'integer' },
            created_at: { type: 'string', format: 'date-time' }
          }
        },
        PaginatedResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array' },
            pagination: {
              type: 'object',
              properties: {
                page: { type: 'integer' },
                limit: { type: 'integer' },
                total: { type: 'integer' },
                pages: { type: 'integer' },
                hasMore: { type: 'boolean' }
              }
            }
          }
        },
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' }
          }
        }
      }
    }
  },
  apis: [
    './backend/routes/categorias.js',
    './backend/routes/productos.js',
    './backend/routes/mesas.js',
    './backend/routes/auth.js',
    './backend/routes/config.js',
    './backend/routes/inventario.js'
  ]
};

const specs = swaggerJsdoc(options);

module.exports = specs;
