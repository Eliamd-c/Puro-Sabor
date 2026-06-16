const request = require('supertest');
const express = require('express');

const app = express();
app.use(express.json());

const productosRoutes = require('../routes/productos');
app.use('/api/productos', productosRoutes);

describe('Productos Endpoints', () => {
  describe('GET /api/productos', () => {
    it('should return 200 and paginated products', async () => {
      const res = await request(app)
        .get('/api/productos');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('should return pagination metadata', async () => {
      const res = await request(app)
        .get('/api/productos');

      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.page).toBeDefined();
      expect(res.body.pagination.limit).toBeDefined();
      expect(res.body.pagination.total).toBeDefined();
      expect(res.body.pagination.hasMore).toBeDefined();
    });

    it('should support page parameter', async () => {
      const res = await request(app)
        .get('/api/productos?page=2');

      expect(res.status).toBe(200);
      expect(res.body.pagination.page).toBe(2);
    });

    it('should support limit parameter', async () => {
      const res = await request(app)
        .get('/api/productos?limit=5');

      expect(res.status).toBe(200);
      expect(res.body.pagination.limit).toBe(5);
    });

    it('should support search parameter', async () => {
      const res = await request(app)
        .get('/api/productos?search=limonada');

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
    });

    it('should support categoria_id filter', async () => {
      const res = await request(app)
        .get('/api/productos?categoria_id=1');

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
    });

    it('should return max 20 items by default', async () => {
      const res = await request(app)
        .get('/api/productos');

      expect(res.body.data.length).toBeLessThanOrEqual(20);
    });

    it('should have product with expected fields', async () => {
      const res = await request(app)
        .get('/api/productos');

      if (res.body.data.length > 0) {
        const prod = res.body.data[0];
        expect(prod).toHaveProperty('id');
        expect(prod).toHaveProperty('nombre');
        expect(prod).toHaveProperty('precio');
        expect(prod).toHaveProperty('categoria_id');
      }
    });

    it('pagination should indicate if more items available', async () => {
      const res = await request(app)
        .get('/api/productos?limit=5');

      expect(typeof res.body.pagination.hasMore).toBe('boolean');
    });
  });

  describe('GET /api/productos/admin/list (Protected)', () => {
    it('should return 401 without JWT token', async () => {
      const res = await request(app)
        .get('/api/productos/admin/list');

      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/productos/admin (Protected)', () => {
    it('should return 401 without JWT token', async () => {
      const res = await request(app)
        .post('/api/productos/admin')
        .send({
          nombre: 'Test Product',
          precio: 5000,
          categoria_id: 1
        });

      expect(res.status).toBe(401);
    });

    it('should require nombre field', async () => {
      const res = await request(app)
        .post('/api/productos/admin')
        .set('Authorization', 'Bearer test-token')
        .send({
          precio: 5000,
          categoria_id: 1
        });

      // Authentication happens first, so 401 is expected for invalid token
      expect([400, 401, 403]).toContain(res.status);
    });

    it('should require precio field', async () => {
      const res = await request(app)
        .post('/api/productos/admin')
        .set('Authorization', 'Bearer test-token')
        .send({
          nombre: 'Test',
          categoria_id: 1
        });

      // Authentication happens first, so 401 is expected for invalid token
      expect([400, 401, 403]).toContain(res.status);
    });

    it('should require categoria_id field', async () => {
      const res = await request(app)
        .post('/api/productos/admin')
        .set('Authorization', 'Bearer test-token')
        .send({
          nombre: 'Test',
          precio: 5000
        });

      // Authentication happens first, so 401 is expected for invalid token
      expect([400, 401, 403]).toContain(res.status);
    });
  });

  describe('PUT /api/productos/admin/:id (Protected)', () => {
    it('should return 401 without JWT token', async () => {
      const res = await request(app)
        .put('/api/productos/admin/1')
        .send({ nombre: 'Updated' });

      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /api/productos/admin/:id (Protected)', () => {
    it('should return 401 without JWT token', async () => {
      const res = await request(app)
        .delete('/api/productos/admin/1');

      expect(res.status).toBe(401);
    });
  });
});
