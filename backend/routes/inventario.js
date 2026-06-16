const express = require('express');
const router = express.Router();
const configService = require('../services/configService');
const { verificarJWT } = require('../middleware/auth');
const waAgent = require('../services/whatsappAgent');
const { apiLimiter } = require('../middleware/rateLimiter');

// Helper para enmascarar la clave API
function maskApiKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '********';
  return `${key.slice(0, 6)}...${key.slice(-6)}`;
}



module.exports = router;
