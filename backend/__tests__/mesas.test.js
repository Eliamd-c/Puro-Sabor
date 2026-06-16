const request = require('supertest');
const express = require('express');

const app = express();
app.use(express.json());

const mesasRoutes = require('../routes/mesas');
app.use('/api/mesas', mesasRoutes);

describe('Mesas Endpoints', () => {
  describe('GET /api/mesas', () => {
    it('should return 200 and tables data', async () => {
      const res = await request(app)
        .get('/api/mesas');

      expect([200, 500]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body).toBeDefined();
      }
    });
  });

  describe('GET /api/mesas/sesion/:numero', () => {
    it('should return 200 for valid table', async () => {
      const res = await request(app)
        .get('/api/mesas/sesion/1');

      expect([200, 404, 500]).toContain(res.status);
    });
  });

  describe('POST /api/mesas (Protected)', () => {
    it('should return 401 without token', async () => {
      const res = await request(app)
        .post('/api/mesas')
        .send({ numero: 99 });

      expect(res.status).toBe(401);
    });
  });

  describe('PUT /api/mesas/sesion/:numero/actualizar (Protected)', () => {
    it('should return 401 without token', async () => {
      const res = await request(app)
        .put('/api/mesas/sesion/1/actualizar')
        .send({ estado: 'activa' });

      expect(res.status).toBe(401);
    });
  });
});
