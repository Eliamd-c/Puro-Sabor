/**
 * WhatsApp Bot Monitor
 *
 * Registro en memoria de TODO lo que pasa con cada mensaje del bot:
 * cada etapa del pipeline (recibido → autorización → rate limit → IA →
 * respuesta) deja una traza con su resultado. Esto existe porque la
 * mayoría de los rechazos del bot son silenciosos (return sin respuesta)
 * y desde afuera parece que "el bot no responde" sin saber por qué.
 *
 * Los eventos se guardan en un ring buffer (últimos 500) y se emiten en
 * vivo por Socket.IO al room 'admin' (evento 'whatsapp_monitor_event').
 */

const MAX_EVENTS = 500;
const events = [];
let io = null;
let seq = 0;

/**
 * Niveles:
 *  info  → flujo normal (mensaje recibido, respuesta enviada)
 *  ok    → paso superado (autorizado, conectado)
 *  warn  → mensaje descartado por regla (denegado, rate limit, horario)
 *  error → fallo técnico (Gemini, envío, DB)
 */
function trace(bot, stage, level, sender, detail) {
  const event = {
    id: ++seq,
    ts: new Date().toISOString(),
    bot,                    // 'admin' | 'client' | 'system'
    stage,                  // etapa del pipeline, ej: 'auth', 'gemini', 'reply'
    level,                  // 'info' | 'ok' | 'warn' | 'error'
    sender: sender || null, // número del remitente si aplica
    detail                  // texto humano explicando qué pasó
  };

  events.push(event);
  if (events.length > MAX_EVENTS) events.shift();

  // Log a consola también (visible en logs de Hostinger)
  const prefix = { info: 'ℹ️', ok: '✅', warn: '⚠️', error: '❌' }[level] || '·';
  console.log(`[WA Monitor][${bot}][${stage}] ${prefix} ${sender ? sender + ' — ' : ''}${detail}`);

  if (io) {
    try {
      io.to('admin').emit('whatsapp_monitor_event', event);
    } catch (_) {}
  }

  return event;
}

function setIO(socketIO) {
  io = socketIO;
}

/**
 * Devuelve eventos recientes, más nuevos primero.
 * Filtros opcionales: bot, level, sender (subcadena), limit.
 */
function getEvents({ bot, level, sender, limit = 200 } = {}) {
  let out = events;
  if (bot) out = out.filter(e => e.bot === bot);
  if (level) out = out.filter(e => e.level === level);
  if (sender) out = out.filter(e => e.sender && e.sender.includes(sender));
  return out.slice(-Math.min(limit, MAX_EVENTS)).reverse();
}

function clear() {
  events.length = 0;
}

module.exports = { trace, setIO, getEvents, clear };
