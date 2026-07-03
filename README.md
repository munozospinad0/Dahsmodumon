# 🔥 Dashboard de Leads · modu.mon

Dashboard web (Vercel) donde modu.mon ve sus leads **en tiempo real**, separados en **🏠 Hogar (B2C)** y **🏢 Proyectos (B2B)**, y **cambia el estado** de cada uno. Al marcar **Calificado** o **Ganado**, el sistema **avisa a Meta** (Conversions API) para que optimice las campañas hacia leads de calidad.

```
Meta Lead Ads → (integración nativa Google Sheets) → Hoja "Leads Modumon"
                                   ▲                          │
        Dashboard (Vercel) ───────┘   Apps Script (API + CAPI)◄┘
        lee/actualiza vía JSONP        lee hoja · escribe estado · manda CAPI
```

## Arquitectura
| Pieza | Rol |
|---|---|
| **Google Sheet "Leads Modumon"** | Base de datos (la llena Meta automático) |
| **Apps Script** (`apps-script/Codigo.gs`) | API: entrega leads, guarda estado, dispara CAPI |
| **Dashboard** (`index.html`) | La interfaz en Vercel (leer + actualizar estado) |

---

## Parte A · Backend (Apps Script) — 5 min
1. Abre la Google Sheet **"Leads Modumon"** → **Extensiones → Apps Script**.
2. Pega el contenido de **`apps-script/Codigo.gs`** en `Código.gs`. Guarda.
3. ⚙️ **Project Settings → Script properties → Add**: `META_TOKEN` = *(el token de Meta, el mismo de `.meta/modumon.env`)*.
4. Corre la función **`setup`** una vez (Run → autoriza) → agrega columnas `estado`, `capi`, `actualizado`.
5. **Deploy → New deployment → Web app**:
   - Execute as: **Me** · Who has access: **Anyone**
   - **Deploy** → copia la **URL /exec**.

## Parte B · Frontend (Vercel) — 3 min
1. En **`config.js`** pega la URL del paso A.5 en `API` (y deja `KEY` igual a la del `Codigo.gs`).
2. Sube este repo a GitHub *(ya está)* y en **vercel.com** → **Add New → Project → Import** este repo → **Deploy**.
   - No necesita build: es estático (index.html). Vercel lo detecta solo.
3. Abre la URL de Vercel → ¡ahí está el dashboard! Compártela con modu.mon.

## Cómo lo usan
Abren la URL → pestaña **Hogar** o **Proyectos** → por cada lead cambian el **Estado**
(Nuevo → Contactado → **Calificado** → **Ganado**/Perdido). Al poner *Calificado/Ganado* se guarda
en la hoja **y** se manda a Meta (lo ves en `📡` de la tarjeta).

## Mapeo estado → evento a Meta
| Estado | ¿Va a Meta? | event_name |
|---|---|---|
| Nuevo / Contactado / Perdido | No (interno) | — |
| **Calificado** | Sí | `QualifiedLead` |
| **Ganado** | Sí | `WonLead` |

Luego en **Events Manager** (dataset `1472599984909735`) activas la optimización **"Conversion Leads"** y mapeas esos eventos como etapas del embudo. 🎯

## Seguridad
- El `KEY` en la URL evita accesos casuales. Cámbialo en `Codigo.gs` **y** `config.js` (que sean iguales).
- El token de Meta vive en **Script Properties** (no en el código ni en el repo).
