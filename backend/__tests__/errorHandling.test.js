const request = require('supertest');
const express = require('express');

const app = express();
app.use(express.json());

// Test routes
app.get('/test/error', (req, res, next) => {
  const err = new Error('Test error');
  err.statusCode = 400;
  next(err);
});

// Error handler middleware
app.use((err, req, res, next) => {
  const status = err.statusCode || 500;
  const message = err.message || 'Error interno';

  res.status(status).json({
    success: false,
    message: message
  });
});

describe('Error Handling', () => {
  describe('Error Middleware', () => {
    it('should handle custom errors', async () => {
      const res = await request(app)
        .get('/test/error');

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return error message', async () => {
      const res = await request(app)
        .get('/test/error');

      expect(res.body.message).toBeDefined();
    });
  });

  describe('404 Handling', () => {
    it('should handle non-existent routes', async () => {
      const res = await request(app)
        .get('/api/nonexistent');

      expect([404, 500]).toContain(res.status);
    });
  });
});
