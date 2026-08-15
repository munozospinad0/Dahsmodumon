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

/* Qué escribió el cliente. No todo llega como texto: si tocó un botón o eligió
   de una lista, el contenido viene en otro sitio del payload. Antes eso caía en
   "[button]" y el vendedor no sabía qué habían respondido. */
function textoDe(msg) {
  if (msg.text && msg.text.body) return msg.text.body;
  if (msg.button && msg.button.text) return msg.button.text;
  if (msg.interactive) {
    const i = msg.interactive;
    if (i.button_reply && i.button_reply.title) return i.button_reply.title;
    if (i.list_reply && i.list_reply.title) return i.list_reply.title;
    if (i.nfm_reply && i.nfm_reply.body) return String(i.nfm_reply.body);
  }
  // adjuntos: se deja el pie de foto si lo hay, que suele decir más que el tipo
  for (const t of ['image', 'video', 'document', 'audio']) {
    if (msg[t]) {
      const cap = msg[t].caption;
      const etiqueta = { image: 'foto', video: 'video', document: 'documento', audio: 'nota de voz' }[t];
      return cap ? (cap + ' (' + etiqueta + ')') : ('envió una ' + etiqueta);
    }
  }
  if (msg.location) return 'compartió su ubicación';
  if (msg.contacts) return 'compartió un contacto';
  if (msg.reaction && msg.reaction.emoji) return 'reaccionó ' + msg.reaction.emoji;
  return 'respondió por WhatsApp';
}

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
          tareas.push(guardar(from, textoDe(msg), msg.timestamp));
        }
      }
    }
    await Promise.allSettled(tareas);
  } catch (e) {
    // se traga el error a propósito: nunca romper el webhook
  }
  return res.status(200).json({ ok: true });
};
