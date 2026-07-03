/*** modu.mon · Dashboard API + Conversions API (lead status)  ·  Apps Script sobre "Leads Modumon" ***/
/*** Token de Meta: Project Settings > Script properties > META_TOKEN                                  ***/

const DATASET_ID = '1472599984909735';   // pixel/dataset de modu.mon
const API_VER    = 'v21.0';
const KEY        = 'modumon2026';         // misma clave que config.js
const TAB        = '';                    // pestaña; vacío = la primera hoja

// Estados del embudo que Meta reconoce como event_name (mismos en Events Manager > Conversion Leads):
const STATUSES = ['created','contacted','qualified','disqualified','converted'];
// Estados que disparan evento a Meta (created NO: el lead ya existe por el formulario):
const CAPI_STAGES = ['contacted','qualified','disqualified','converted'];
// Nombres posibles de la columna de estado que YA está en el doc (usa el primero que exista; si ninguno, crea 'lead_status'):
const STATUS_ALIASES = ['lead_status','status','estado','lead status','lead_estado','lead status meta'];
const STATUS_DEFAULT = 'lead_status';

function META_TOKEN(){ return PropertiesService.getScriptProperties().getProperty('META_TOKEN') || ''; }
function sheet_(){ const ss=SpreadsheetApp.getActiveSpreadsheet(); return TAB?ss.getSheetByName(TAB):ss.getSheets()[0]; }
function colMap_(sh){ const h=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(x=>String(x).trim()); const m={}; h.forEach((x,i)=>m[x]=i+1); return {h,m}; }
function statusKey_(m){ const keys=Object.keys(m); for(const a of STATUS_ALIASES){ const k=keys.find(x=>String(x).toLowerCase().trim()===a); if(k) return k; } return null; }

// Corre esto UNA vez: si NO existe columna de estado la crea; y pone el dropdown. No toca las columnas de Meta.
function setup(){
  const sh=sheet_(); let key=statusKey_(colMap_(sh).m);
  if(!key){ sh.getRange(1,sh.getLastColumn()+1).setValue(STATUS_DEFAULT); key=STATUS_DEFAULT; }
  const ci=colMap_(sh).m[key];
  const rule=SpreadsheetApp.newDataValidation().requireValueInList(STATUSES,true).build();
  sh.getRange(2,ci,Math.max(1,sh.getMaxRows()-1),1).setDataValidation(rule);
  return 'Listo: usando la columna "'+key+'" con estados '+STATUSES.join(' / ');
}

function tipoFrom_(row,m){ const s=((m['campaign_name']?row[m['campaign_name']-1]:'')+''+(m['adset_name']?row[m['adset_name']-1]:'')+''+(m['form_name']?row[m['form_name']-1]:'')).toUpperCase(); return s.indexOf('B2B')>=0?'b2b':'b2c'; }

function doGet(e){
  const p=(e&&e.parameter)||{};
  if(p.key!==KEY) return out_(p.callback,{error:'unauthorized'});
  try{
    if(p.action==='update') return out_(p.callback, updateLead_(p.id,p.status));
    return out_(p.callback, getLeads_());
  }catch(err){ return out_(p.callback,{error:String(err)}); }
}

function getLeads_(){
  const sh=sheet_(); if(sh.getLastRow()<2) return {rows:[],statuses:STATUSES};
  const {m}=colMap_(sh); const sck=statusKey_(m);
  const data=sh.getDataRange().getValues();
  const g=(row,n)=> m[n]?row[m[n]-1]:'';
  const rows=[];
  for(let r=1;r<data.length;r++){
    const row=data[r];
    if(!g(row,'id') && !g(row,'email') && !g(row,'phone_number')) continue;
    const st=String(sck?row[m[sck]-1]:'').toLowerCase().trim();
    rows.push({
      _row:r+1, id:g(row,'id'),
      fecha:String(g(row,'created_time')||'').slice(0,16).replace('T',' '),
      nombre:g(row,'first_name'), apellido:g(row,'last_name'), correo:g(row,'email'), celular:g(row,'phone_number'),
      empresa:g(row,'company_name'), extra:g(row,'tipo_proyecto')||g(row,'espacio')||'',
      campana:g(row,'campaign_name'), anuncio:g(row,'ad_name'),
      status: STATUSES.indexOf(st)>=0?st:'created', tipo:tipoFrom_(row,m)
    });
  }
  return {rows:rows,statuses:STATUSES,ts:new Date().toLocaleString('es-PA')};
}

function updateLead_(id,status){
  status=String(status||'').toLowerCase().trim();
  if(STATUSES.indexOf(status)<0) return {ok:false,error:'status invalido'};
  const sh=sheet_(); const {m}=colMap_(sh);
  if(!m['id']) return {ok:false,error:'falta columna id'};
  let key=statusKey_(m); if(!key){ setup(); key=STATUS_DEFAULT; }
  const sc=colMap_(sh).m[key];
  const ids=sh.getRange(2,m['id'],Math.max(1,sh.getLastRow()-1),1).getValues();
  let row=-1; for(let i=0;i<ids.length;i++){ if(String(ids[i][0])===String(id)){ row=i+2; break; } }
  if(row<0) return {ok:false,error:'lead no encontrado'};
  sh.getRange(row,sc).setValue(status);
  let capi='';
  if(CAPI_STAGES.indexOf(status)>=0){
    const full=sh.getRange(row,1,1,sh.getLastColumn()).getValues()[0];
    const gg=n=>m[n]?full[m[n]-1]:'';
    const res=sendCapi_(status,{lead_id:gg('id'),email:gg('email'),phone:gg('phone_number')});
    capi=status+(res.ok?' ✓ enviado a Meta':' ✗ '+res.code);
  }
  return {ok:true,status:status,capi:capi};
}

// event_name = el estado del embudo (Meta espera que el estado mapee a event_name)
function sendCapi_(eventName,lead){
  const token=META_TOKEN(); if(!token) return {ok:false,code:'sin_token'};
  const ud={};
  const lid=String(lead.lead_id||'').replace(/[^0-9]/g,''); if(lid) ud.lead_id=Number(lid);
  if(lead.email) ud.em=[sha256_(String(lead.email).trim().toLowerCase())];
  if(lead.phone){ const p=String(lead.phone).replace(/[^0-9]/g,''); if(p) ud.ph=[sha256_(p)]; }
  const evt={event_name:eventName,event_time:Math.floor(Date.now()/1000),action_source:'system_generated',event_id:'modumon-'+lid+'-'+eventName+'-'+Date.now(),user_data:ud,custom_data:{event_source:'crm',lead_event_source:'modu.mon dashboard'}};
  const url='https://graph.facebook.com/'+API_VER+'/'+DATASET_ID+'/events?access_token='+encodeURIComponent(token);
  const resp=UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',payload:JSON.stringify({data:[evt]}),muteHttpExceptions:true});
  const code=resp.getResponseCode(); return {ok:code>=200&&code<300,code:code};
}

function sha256_(s){ const b=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s,Utilities.Charset.UTF_8); return b.map(x=>('0'+(x&0xFF).toString(16)).slice(-2)).join(''); }
function out_(cb,obj){ const j=JSON.stringify(obj); return cb?ContentService.createTextOutput(cb+'('+j+')').setMimeType(ContentService.MimeType.JAVASCRIPT):ContentService.createTextOutput(j).setMimeType(ContentService.MimeType.JSON); }
