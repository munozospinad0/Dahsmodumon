// Proxy seguro al Apps Script de leads — la URL y la KEY viven en env vars (no en el cliente)
// /api/leads?password=...&action=leads   ·   /api/leads?password=...&action=update&id=...&status=...

const PASSWORD = process.env.DASHBOARD_PASSWORD;
const GAS_URL = process.env.APPS_SCRIPT_URL;
const GAS_KEY = process.env.APPS_SCRIPT_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const provided = req.headers['x-dashboard-password'] || req.query.password;
  if (PASSWORD && provided !== PASSWORD) return res.status(401).json({ error: 'unauthorized' });
  if (!GAS_URL || !GAS_KEY) return res.status(500).json({ error: 'Falta APPS_SCRIPT_URL / APPS_SCRIPT_KEY en Vercel' });

  const { action = 'leads', id = '', status = '' } = req.query;
  const params = new URLSearchParams({ key: GAS_KEY });
  if (action === 'update') { params.set('action', 'update'); params.set('id', id); params.set('status', status); }

  try {
    const r = await fetch(GAS_URL + '?' + params.toString(), { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (dash-modumon)' } });
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch { return res.status(502).json({ error: 'Respuesta inválida del Apps Script', status: r.status, ct: r.headers.get('content-type'), snippet: text.slice(0, 160) }); }
    if (action === 'leads') res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate');
    return res.status(200).json(j);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
