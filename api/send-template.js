// Envía la plantilla de WhatsApp (modumon_primer_contacto) por Cloud API.
// Token y phone_number_id viven en env vars de Vercel (NO en el cliente).
// Uso: /api/send-template?password=...&phone=50764660991&name=María
const PASSWORD = process.env.DASHBOARD_PASSWORD;
const WA_TOKEN = process.env.WA_TOKEN;
const WA_PHONE_ID = process.env.WA_PHONE_NUMBER_ID;
const TEMPLATE = process.env.WA_TEMPLATE_NAME || 'modumon_primer_contacto';
const LANG = process.env.WA_TEMPLATE_LANG || 'es';
const VER = process.env.WA_API_VERSION || 'v23.0';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const provided = req.headers['x-dashboard-password'] || req.query.password;
  if (PASSWORD && provided !== PASSWORD) return res.status(401).json({ ok: false, error: 'unauthorized' });
  if (!WA_TOKEN || !WA_PHONE_ID) return res.status(500).json({ ok: false, error: 'Falta WA_TOKEN / WA_PHONE_NUMBER_ID en Vercel' });

  const phone = String(req.query.phone || '').replace(/[^0-9]/g, '');
  const name = (String(req.query.name || '').trim()) || 'amig@';
  if (phone.length < 8) return res.status(400).json({ ok: false, error: 'Número inválido (usa código de país + número)' });

  const payload = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template: {
      name: TEMPLATE,
      language: { code: LANG },
      components: [{ type: 'body', parameters: [{ type: 'text', text: name }] }]
    }
  };
  try {
    const r = await fetch(`https://graph.facebook.com/${VER}/${WA_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + WA_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const j = await r.json();
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    if (j.error) return res.status(200).json({ ok: false, error: j.error.message, code: j.error.code });
    return res.status(200).json({ ok: true, to: phone, id: (j.messages && j.messages[0] && j.messages[0].id) || null });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
