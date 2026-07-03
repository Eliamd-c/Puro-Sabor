/**
 * Adaptador OpenAI (ChatGPT) con la misma interfaz que el chat de Gemini.
 *
 * El bot de WhatsApp fue escrito contra el SDK de Gemini:
 *   chat.sendMessage(parts) → result.response.functionCalls() / .text()
 * Este adaptador imita exactamente esa interfaz sobre la API de OpenAI
 * (Chat Completions con tool calling), para que whatsappAgent.js pueda
 * alternar de proveedor sin cambiar su lógica.
 *
 * Se usa fetch nativo (Node 18+) — sin dependencias nuevas.
 *
 * Soporta: texto, imágenes (visión) y function calling.
 * No soporta: audio (se le indica a la IA que avise amablemente).
 */

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini'; // barato, con visión y tool calling

/** Convierte tipos de schema Gemini (OBJECT/STRING/…) a JSON Schema (object/string/…) */
function lowerTypes(schema) {
  if (schema === null || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(lowerTypes);
  const out = {};
  for (const k in schema) {
    if (k === 'type' && typeof schema[k] === 'string') {
      out[k] = schema[k].toLowerCase();
    } else {
      out[k] = lowerTypes(schema[k]);
    }
  }
  return out;
}

/** Convierte las functionDeclarations estilo Gemini al formato tools de OpenAI */
function convertTools(geminiTools) {
  const out = [];
  for (const t of geminiTools || []) {
    for (const fd of t.functionDeclarations || []) {
      out.push({
        type: 'function',
        function: {
          name: fd.name,
          description: fd.description || '',
          parameters: lowerTypes(fd.parameters || { type: 'object', properties: {} })
        }
      });
    }
  }
  return out;
}

function safeParse(s) {
  try { return JSON.parse(s || '{}'); } catch (_) { return {}; }
}

class OpenAIChat {
  /**
   * @param {string} apiKey - API key de OpenAI (sk-...)
   * @param {object} opts - { systemInstruction, tools (formato Gemini), history (formato Gemini), model }
   */
  constructor(apiKey, { systemInstruction = '', tools = [], history = [], model = DEFAULT_MODEL } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.tools = convertTools(tools);
    this.messages = [];
    this.lastToolCalls = [];

    if (systemInstruction) {
      this.messages.push({ role: 'system', content: systemInstruction });
    }
    // Historial Gemini: [{role: 'user'|'model', parts: [{text}]}]
    for (const h of history || []) {
      const text = (h.parts || []).map(p => p.text || '').join('\n').trim() || ' ';
      this.messages.push({ role: h.role === 'model' ? 'assistant' : 'user', content: text });
    }
  }

  /**
   * Acepta lo mismo que el chat de Gemini:
   *  - array de strings y/o {inlineData: {data, mimeType}}  → mensaje del usuario
   *  - array de {functionResponse: {name, response}}        → respuestas de funciones
   * Devuelve { response: { functionCalls(), text() } }
   */
  async sendMessage(parts) {
    const arr = Array.isArray(parts) ? parts : [parts];
    const isToolResponse = arr.length > 0 && arr[0] && arr[0].functionResponse;

    if (isToolResponse) {
      // Emparejar cada functionResponse con el tool_call pendiente
      const pending = [...this.lastToolCalls];
      for (const part of arr) {
        const fr = part.functionResponse;
        const idx = pending.findIndex(c => c.function.name === fr.name);
        const call = idx >= 0 ? pending.splice(idx, 1)[0] : pending.shift();
        this.messages.push({
          role: 'tool',
          tool_call_id: call ? call.id : 'call_desconocido',
          content: JSON.stringify(fr.response?.output ?? fr.response ?? {})
        });
      }
    } else {
      const content = [];
      for (const p of arr) {
        if (typeof p === 'string') {
          content.push({ type: 'text', text: p });
        } else if (p && p.inlineData) {
          const mime = p.inlineData.mimeType || '';
          if (mime.startsWith('image/')) {
            content.push({
              type: 'image_url',
              image_url: { url: `data:${mime};base64,${p.inlineData.data}` }
            });
          } else {
            // Audio u otro media no soportado por Chat Completions
            content.push({
              type: 'text',
              text: '[Nota del sistema: el usuario envió una nota de voz/audio. Indícale amablemente que por ahora solo puedes procesar texto e imágenes, y pídele que escriba su consulta.]'
            });
          }
        }
      }
      if (content.length === 0) content.push({ type: 'text', text: ' ' });
      this.messages.push({ role: 'user', content });
    }

    const body = { model: this.model, messages: this.messages };
    if (this.tools.length > 0) body.tools = this.tools;

    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    const msg = data.choices?.[0]?.message || { content: '' };
    this.messages.push(msg);
    this.lastToolCalls = msg.tool_calls || [];

    return {
      response: {
        functionCalls: () =>
          (msg.tool_calls || []).map(tc => ({
            name: tc.function.name,
            args: safeParse(tc.function.arguments)
          })),
        text: () => msg.content || ''
      }
    };
  }
}

module.exports = { OpenAIChat, convertTools, lowerTypes };
