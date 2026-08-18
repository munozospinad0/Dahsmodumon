// Modumon — Saludo automático DESDE VERCEL (no desde el Apps Script).
//
// Por qué acá: el saludo vivía en un trigger del Apps Script que nunca se instaló, y la
// columna `saludo` estaba vacía en los 551 leads — nunca se intentó ni una vez. Moverlo
// a Vercel evita depender de que alguien entre al editor de Google.
//
// Cómo sabe a quién ya saludó, sin agregar columnas ni tocar el Sheet:
// usa el propio estado del lead. Los que están en `created` son los que nadie tocó.
// Al saludar, se pasan a `contacted` con la acción que el Apps Script YA expone. Ese
// cambio de estado ES el registro, y encima es lo que semánticamente corresponde.
//
//   GET /api/saludar?password=...          → saluda y marca
//   GET /api/saludar?password=...&dry=1    → dice a quién saludaría, sin mandar nada
//   GET /api/saludar (con header x-cron-secret) → para disparadores automáticos
//
// Salvaguardas, porque esto manda mensajes de verdad:
//   · TOPE por corrida (MAX), para que un error no dispare cientos
//   · solo leads de los últimos DIAS_MAX días — saludar leads viejos con plantilla de
//     marketing es lo que tumba el quality rating (ya pasó el 7 y el 10 de agosto)
//   · si el envío falla, NO se marca: así el siguiente intento lo vuelve a tomar

const GAS_URL = process.env.APPS_SCRIPT_URL;
const GAS_KEY = process.env.APPS_SCRIPT_KEY;
const PASSWORD = process.env.DASHBOARD_PASSWORD;
const CRON_SECRET = process.env.CRON_SECRET;

const WA_TOKEN = process.env.WA_TOKEN;
const WA_PHONE_ID = process.env.WA_PHONE_NUMBER_ID;
const WA_TPL = process.env.WA_TEMPLATE_NAME || 'modumon_primer_contacto';
const WA_LANG = process.env.WA_TEMPLATE_LANG || 'es';
const WA_VER = process.env.WA_API_VERSION || 'v23.0';

const MAX = Number(process.env.SALUDO_MAX || 8);
const DIAS_MAX = Number(process.env.SALUDO_DIAS || 3);

/** Teléfono → E.164 sin '+'. Panamá son 8 dígitos. */
function normTel(v) {
  let d = String(v == null ? '' : v).replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 8) d = '507' + d;
  return d.length >= 10 ? d : '';
}

function diasDesde(fecha) {
  const t = Date.parse(String(fecha || '').replace(' ', 'T'));
  if (!isFinite(t)) return 9999;
  return (Date.now() - t) / 86400000;
}

async function gas(params) {
  const qs = new URLSearchParams({ key: GAS_KEY, ...params });
  // El Web App devuelve HTML transitorio en arranque en frío: se reintenta.
  for (let i = 0; i < 3; i++) {
    if (i) await new Promise(r => setTimeout(r, 600 * i));
    try {
      const r = await fetch(GAS_URL + '?' + qs.toString(), { redirect: 'follow' });
      const t = await r.text();
      try { return JSON.parse(t); } catch { /* reintentar */ }
    } catch { /* reintentar */ }
  }
  return null;
}

async function mandarPlantilla(tel, nombre) {
  const cuerpo = {
    messaging_product: 'whatsapp',
    to: tel,
    type: 'template',
    template: {
      name: WA_TPL,
      language: { code: WA_LANG },
      // La plantilla tiene header y botón FIJOS: solo el body lleva parámetro.
      components: [{ type: 'body', parameters: [{ type: 'text', text: nombre || 'amig@' }] }],
    },
  };
  const r = await fetch(`https://graph.facebook.com/${WA_VER}/${WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + WA_TOKEN },
    body: JSON.stringify(cuerpo),
  });
  const j = await r.json().catch(() => ({}));
  if (j.error) return { ok: false, error: j.error.message, code: j.error.code, sub: j.error.error_subcode };
  return { ok: true, id: j.messages?.[0]?.id };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const autorizado =
    (CRON_SECRET && req.headers['x-cron-secret'] === CRON_SECRET) ||
    // Vercel firma sus propios cron jobs con este header
    (CRON_SECRET && req.headers.authorization === 'Bearer ' + CRON_SECRET) ||
    (PASSWORD && (req.query.password === PASSWORD || req.headers['x-dashboard-password'] === PASSWORD));
  if (!autorizado) return res.status(401).json({ error: 'unauthorized' });

  if (!GAS_URL || !GAS_KEY) return res.status(500).json({ error: 'Falta APPS_SCRIPT_URL / APPS_SCRIPT_KEY' });
  if (!WA_TOKEN || !WA_PHONE_ID) return res.status(500).json({ error: 'Falta WA_TOKEN / WA_PHONE_NUMBER_ID' });

  const dry = req.query.dry === '1';
  const tope = Math.min(Number(req.query.max) || MAX, 25);   // techo duro, pase lo que pase

  const datos = await gas({});
  if (!datos) return res.status(502).json({ error: 'el Apps Script no respondió' });
  const filas = datos.rows || datos.data || [];

  // A quién le toca: nadie lo tocó todavía, tiene teléfono y es reciente.
  const candidatos = [];
  const motivos = { sin_telefono: 0, viejo: 0, ya_tocado: 0 };
  for (const f of filas) {
    if (String(f.status || '').toLowerCase() !== 'created') { motivos.ya_tocado++; continue; }
    const tel = normTel(f.celular || f.telefono || f.phone);
    if (!tel) { motivos.sin_telefono++; continue; }
    const d = diasDesde(f.fecha);
    if (d > DIAS_MAX) { motivos.viejo++; continue; }
    candidatos.push({ id: f.id, fila: f._row, nombre: String(f.nombre || '').trim().split(' ')[0], tel, dias: Math.round(d * 10) / 10 });
  }
  // Los más nuevos primero: si hay tope, que se lleve el saludo el que acaba de entrar.
  candidatos.sort((a, b) => a.dias - b.dias);
  const lote = candidatos.slice(0, tope);

  if (dry) {
    return res.status(200).json({
      modo: 'simulacion', total_leads: filas.length,
      candidatos: candidatos.length, se_saludaria: lote.length,
      descartados: motivos, plantilla: WA_TPL,
      lote: lote.map(c => ({ nombre: c.nombre, tel: c.tel.slice(0, 6) + '****', dias: c.dias })),
    });
  }

  const hechos = [];
  for (const c of lote) {
    const env = await mandarPlantilla(c.tel, c.nombre);
    if (env.ok) {
      // Solo se marca si de verdad salió: si falla, el próximo intento lo retoma.
      const upd = await gas({ action: 'update', id: c.id, status: 'contacted' });
      hechos.push({ nombre: c.nombre, enviado: true, marcado: !!(upd && upd.ok) });
    } else {
      hechos.push({ nombre: c.nombre, enviado: false, error: env.error, code: env.code });
    }
    // Un respiro entre envíos: ráfagas seguidas es lo que Meta lee como spam.
    await new Promise(r => setTimeout(r, 400));
  }

  const ok = hechos.filter(h => h.enviado).length;
  return res.status(200).json({
    ok: true, total_leads: filas.length, candidatos: candidatos.length,
    enviados: ok, fallidos: hechos.length - ok, descartados: motivos,
    plantilla: WA_TPL, detalle: hechos,
  });
};
