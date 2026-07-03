// API Serverless — Proxy a Meta Marketing API (modu.mon)
// /api/insights?level=campaign&preset=maximum  ·  /api/insights?level=ad&preset=last_7d
// /api/insights?level=account&preset=last_30d&daily=1  (serie diaria)

const API_VERSION = process.env.META_API_VERSION || 'v21.0';
const TOKEN = process.env.META_TOKEN;
const ACCOUNT = process.env.META_ACCOUNT_ID || 'act_1032839425787482';

const FIELDS = {
  account: 'spend,impressions,reach,frequency,cpm,cpc,ctr,clicks,actions,cost_per_action_type',
  campaign: 'campaign_name,campaign_id,spend,impressions,reach,frequency,cpm,cpc,ctr,clicks,actions,cost_per_action_type',
  adset: 'adset_name,adset_id,campaign_name,spend,impressions,reach,cpm,cpc,clicks,actions',
  ad: 'ad_name,ad_id,adset_name,campaign_name,spend,impressions,reach,cpm,cpc,ctr,clicks,actions',
};

const PASSWORD = process.env.DASHBOARD_PASSWORD;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Dashboard-Password');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const provided = req.headers['x-dashboard-password'] || req.query.password;
  if (PASSWORD && provided !== PASSWORD) return res.status(401).json({ error: 'unauthorized' });
  if (!TOKEN) return res.status(500).json({ error: 'Falta META_TOKEN en las variables de entorno de Vercel' });

  const { level = 'campaign', preset = 'maximum', from, to, daily, preview, format, breakdowns } = req.query;

  // Preview oficial de un anuncio: /api/insights?preview=AD_ID&format=MOBILE_FEED_STANDARD
  if (preview) {
    if (!/^[0-9]+$/.test(preview)) return res.status(400).json({ error: 'ad id inválido' });
    const fmt = /^[A-Z_]+$/.test(format || '') ? format : 'MOBILE_FEED_STANDARD';
    try {
      const r = await fetch(`https://graph.facebook.com/${API_VERSION}/${preview}/previews?ad_format=${fmt}&access_token=${TOKEN}`);
      const j = await r.json();
      if (j.error) return res.status(400).json({ error: j.error.message });
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
      return res.status(200).json({ success: true, body: (j.data && j.data[0] && j.data[0].body) || '' });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  if (!FIELDS[level]) return res.status(400).json({ error: 'Nivel inválido' });

  let dateParam = (from && to)
    ? `&time_range=${encodeURIComponent(JSON.stringify({ since: from, until: to }))}`
    : `&date_preset=${encodeURIComponent(preset)}`;
  if (daily) dateParam += '&time_increment=1';

  const bd = (breakdowns && /^[a-z_,]+$/.test(breakdowns)) ? `&breakdowns=${breakdowns}` : '';
  const url = `https://graph.facebook.com/${API_VERSION}/${ACCOUNT}/insights?level=${level}` +
    `&fields=${FIELDS[level]}${dateParam}${bd}&limit=500&access_token=${TOKEN}`;

  try {
    const r = await fetch(url);
    const data = await r.json();
    if (data.error) {
      return res.status(400).json({
        error: data.error.message, code: data.error.code,
        hint: data.error.code === 190 ? 'El token de Meta expiró: renueva META_TOKEN en Vercel.' : null,
      });
    }
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    return res.status(200).json({ success: true, level, count: (data.data || []).length, data: data.data || [] });
  } catch (err) {
    return res.status(500).json({ error: 'Error consultando Meta API', message: err.message });
  }
};
