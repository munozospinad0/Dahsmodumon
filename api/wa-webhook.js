// Webhook de WhatsApp — guarda la CONVERSACIÓN COMPLETA en la hoja, en ambos sentidos:
//   entrante  = lo que escribe el cliente (campo `messages`)
//   saliente  = lo que responde Modumon — desde el teléfono (coexistencia) o por API —
//               que llega como "echo" (campos `smb_message_echoes` / `message_echoes`)
//
// Sin esto las respuestas viven solo dentro del teléfono: nadie puede saber si un lead
// contestó ni qué le respondieron, y el dashboard no puede mostrar el avance real.
//
// Configuración en Meta (App -> WhatsApp -> Configuración -> Webhook):
//   URL de devolución:  https://dash-modumon.vercel.app/api/wa-webhook
//   Token de verificación: el valor de WA_VERIFY_TOKEN en Vercel
//   Campos suscritos: messages · smb_message_echoes · message_echoes
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

// Llama al Apps Script con cualquier acción. 8 s de techo: Meta espera respuesta
// rápida y reintenta si tardamos (por eso el Apps Script deduplica por msg_id).
async function gas(params) {
  if (!GAS_URL || !GAS_KEY) return;
  const p = new URLSearchParams(Object.assign({ key: GAS_KEY }, params));
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
        // ENTRANTES: lo que escribe el cliente. Actualiza la ficha del lead Y el hilo.
        for (const msg of v.messages || []) {
          const from = String(msg.from || '').replace(/[^0-9]/g, '');
          if (!from) continue;
          tareas.push(gas({
            action: 'inbound', phone: from,
            text: String(textoDe(msg)).slice(0, 500),
            ts: String(msg.timestamp || ''), msg_id: String(msg.id || ''),
          }));
        }
        // SALIENTES: lo que responde Modumon. En coexistencia, lo que Verónica manda
        // desde el teléfono llega como echo — sin esto el hilo solo tendría un lado.
        const ecos = [].concat(v.message_echoes || [], v.smb_message_echoes || []);
        for (const eco of ecos) {
          const to = String(eco.to || '').replace(/[^0-9]/g, '');
          if (!to) continue;
          tareas.push(gas({
            action: 'wa_log', dir: 'saliente', phone: to,
            text: String(textoDe(eco)).slice(0, 500),
            ts: String(eco.timestamp || ''), msg_id: String(eco.id || ''),
          }));
        }
      }
    }
    await Promise.allSettled(tareas);
  } catch (e) {
    // se traga el error a propósito: nunca romper el webhook
  }
  return res.status(200).json({ ok: true });
};
