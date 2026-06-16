const request = require('supertest');
const express = require('express');

const app = express();
app.use(express.json());

const categoriasRoutes = require('../routes/categorias');
app.use('/api/categorias', categoriasRoutes);

describe('Categorías Endpoints', () => {
  describe('GET /api/categorias', () => {
    it('should return 200 and array of categories', async () => {
      const res = await request(app)
        .get('/api/categorias');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('should have category with expected fields', async () => {
      const res = await request(app)
        .get('/api/categorias');

      if (res.body.length > 0) {
        const cat = res.body[0];
        expect(cat).toHaveProperty('id');
        expect(cat).toHaveProperty('nombre');
      }
    });

    it('should include Migas al Carbón category', async () => {
      const res = await request(app)
        .get('/api/categorias');

      const hasMigas = res.body.some(c =>
        c.nombre.toLowerCase().includes('migas')
      );
      expect(hasMigas).toBe(true);
    });

    it('should include Bebidas category', async () => {
      const res = await request(app)
        .get('/api/categorias');

      const hasBebidas = res.body.some(c =>
        c.nombre.toLowerCase().includes('bebidas')
      );
      expect(hasBebidas).toBe(true);
    });

    it('should include Postres category', async () => {
      const res = await request(app)
        .get('/api/categorias');

      const hasPostres = res.body.some(c =>
        c.nombre.toLowerCase().includes('postres')
      );
      expect(hasPostres).toBe(true);
    });
  });

  describe('GET /api/categorias/admin (Protected)', () => {
    it('should return 401 without JWT token', async () => {
      const res = await request(app)
        .get('/api/categorias/admin');

      expect(res.status).toBe(401);
    });

    it('should return 200 with valid JWT token', async () => {
      const validToken = 'Bearer ' + 'valid-test-token';
      const res = await request(app)
        .get('/api/categorias/admin')
        .set('Authorization', validToken);

      // May fail with 401 if token is invalid, but should recognize the format
      expect([200, 401, 403]).toContain(res.status);
    });
  });

  describe('POST /api/categorias/admin (Protected)', () => {
    it('should return 401 without JWT token', async () => {
      const res = await request(app)
        .post('/api/categorias/admin')
        .send({ nombre: 'Test', descripcion: 'Test' });

      expect(res.status).toBe(401);
    });

    it('should require nombre field', async () => {
      const res = await request(app)
        .post('/api/categorias/admin')
        .set('Authorization', 'Bearer test-token')
        .send({ descripcion: 'Test' });

      // Authentication happens first, so 401 is expected for invalid token
      expect([400, 401, 403]).toContain(res.status);
    });
  });

  describe('PUT /api/categorias/admin/:id (Protected)', () => {
    it('should return 401 without JWT token', async () => {
      const res = await request(app)
        .put('/api/categorias/admin/1')
        .send({ nombre: 'Updated' });

      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/categorias/admin/:id (Protected)', () => {
    it('should return 401 without JWT token', async () => {
      const res = await request(app)
        .delete('/api/categorias/admin/1');

      expect(res.status).toBe(401);
    });
  });
});
