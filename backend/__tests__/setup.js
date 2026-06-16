// Jest setup file
// Close database connections after all tests

beforeAll(async () => {
  // Increase timeout for setup
  jest.setTimeout(30000);
});

afterAll(async () => {
  // Close database connections
  try {
    const db = require('../config/database');
    if (db.pool) {
      await db.pool.end();
    }
  } catch (e) {
    // Ignore
  }

  // Wait a bit for cleanup
  return new Promise(resolve => setTimeout(resolve, 1000));
});

// Suppress console output during tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
