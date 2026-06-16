const request = require('supertest');
const express = require('express');

// Simple mock app for testing
const app = express();
app.use(express.json());

const authRoutes = require('../routes/auth');
app.use('/api/admin', authRoutes);

describe('Auth Endpoints', () => {
  describe('POST /api/admin/login', () => {
    it('should return 200 or 400 or 401', async () => {
      const res = await request(app)
        .post('/api/admin/login')
        .send({
          usuario: 'test',
          password: 'test1234'
        });

      expect([200, 400, 401, 409]).toContain(res.status);
    });

    it('should handle empty request', async () => {
      const res = await request(app)
        .post('/api/admin/login')
        .send({});

      expect([400, 401, 422]).toContain(res.status);
    });
  });

  describe('POST /api/admin/register', () => {
    it('should handle register request', async () => {
      const res = await request(app)
        .post('/api/admin/register')
        .send({
          usuario: 'newuser',
          password: 'ValidPass123!'
        });

      // Should either succeed (201) or fail with validation
      expect([200, 201, 400, 409]).toContain(res.status);
    });
  });
});
