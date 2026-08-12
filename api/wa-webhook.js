// Webhook de WhatsApp — recibe las RESPUESTAS de los clientes y las guarda en la hoja.
//
// Sin esto las respuestas viven solo dentro del teléfono: nadie puede saber si un lead
// contestó, y el dashboard no puede mostrar la única señal de calidad que importa de
// verdad ("¿este lead respondió o no?").
//
// Configuración en Meta (App -> WhatsApp -> Configuración -> Webhook):
//   URL de devolución:  https://dash-modumon.vercel.app/api/wa-webhook
//   Token de verificación: el valor de WA_VERIFY_TOKEN en Vercel
//   Campos suscritos: messages
//
// Variables en Vercel: WA_VERIFY_TOKEN · APPS_SCRIPT_URL · APPS_SCRIPT_KEY

const VERIFY  = process.env.WA_VERIFY_TOKEN;
const GAS_URL = process.env.APPS_SCRIPT_URL;
const GAS_KEY = process.env.APPS_SCRIPT_KEY;

// Guarda una respuesta en la hoja vía el Apps Script.
async function guardar(phone, text, ts) {
  if (!GAS_URL || !GAS_KEY) return;
  const p = new URLSearchParams({
    key: GAS_KEY, action: 'inbound',
    phone: String(phone || ''),
    text: String(text || '').slice(0, 300),   // no guardamos conversaciones enteras
    ts: String(ts || ''),
  });
  // 8 s de techo: Meta espera respuesta rápida y reintenta si tardamos.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    await fetch(GAS_URL + '?' + p.toString(), { redirect: 'follow', signal: ctrl.signal });
  } finally { clearTimeout(t); }
}

module.exports = async function handler(req, res) {
  // 1) Verificación: Meta llama una sola vez al configurar el webhook.
  if (req.method === 'GET') {
    const modo  = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const reto  = req.query['hub.challenge'];
    if (modo === 'subscribe' && VERIFY && token === VERIFY) {
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(String(reto));
    }
    return res.status(403).send('forbidden');
  }

  if (req.method !== 'POST') return res.status(405).end();

  // 2) A Meta SIEMPRE se le contesta 200. Si devolvemos error reintenta, y tras
  //    varios fallos desactiva el webhook — perderíamos todas las respuestas.
  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const tareas = [];
    for (const entry of (body && body.entry) || []) {
      for (const ch of entry.changes || []) {
        const v = ch.value || {};
        for (const msg of v.messages || []) {
          // solo mensajes ENTRANTES (los que manda el cliente)
          const from = String(msg.from || '').replace(/[^0-9]/g, '');
          if (!from) continue;
          const texto = (msg.text && msg.text.body) ? msg.text.body : ('[' + (msg.type || 'mensaje') + ']');
          tareas.push(guardar(from, texto, msg.timestamp));
        }
      }
    }
    await Promise.allSettled(tareas);
  } catch (e) {
    // se traga el error a propósito: nunca romper el webhook
  }
  return res.status(200).json({ ok: true });
};
