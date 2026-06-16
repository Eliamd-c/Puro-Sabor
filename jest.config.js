module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/backend/__tests__/setup.js'],
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'backend/**/*.js',
    '!backend/server.js',
    '!backend/config/**',
    '!backend/services/whatsappAgent.js',
    '!**/__tests__/**'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    'whatsappAgent'
  ],
  transformIgnorePatterns: [
    'node_modules/(?!(@whiskeysockets|@google)/)'
  ],
  moduleNameMapper: {
    '@whiskeysockets/baileys': '<rootDir>/backend/__mocks__/baileys.js',
    '@google/generative-ai': '<rootDir>/backend/__mocks__/generativeAI.js'
  },
  coverageThreshold: {
    global: {
      branches: 20,
      functions: 20,
      lines: 20,
      statements: 20
    }
  },
  testTimeout: 15000,
  maxWorkers: 1,
  forceExit: true
};
