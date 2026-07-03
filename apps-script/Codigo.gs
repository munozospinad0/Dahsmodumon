/*** modu.mon · Dashboard API + CAPI  ·  Apps Script ligado a la hoja "Leads Modumon" ***/
/*** Token de Meta: Project Settings > Script properties > META_TOKEN                   ***/

const DATASET_ID = '1472599984909735';   // pixel/dataset de modu.mon
const API_VER    = 'v21.0';
const KEY        = 'modumon2026';         // clave que usa el dashboard (cámbiala y ponla igual en config.js)
const TAB        = '';                    // nombre de la pestaña; vacío = la primera hoja
const ESTADOS    = ['Nuevo','Contactado','Calificado','Ganado','Perdido'];
const CAPI_MAP   = { 'Calificado':'QualifiedLead', 'Ganado':'WonLead' }; // qué estado dispara evento a Meta
const EXTRA_COLS = ['estado','capi','actualizado'];

function META_TOKEN(){ return PropertiesService.getScriptProperties().getProperty('META_TOKEN') || ''; }
function sheet_(){ const ss=SpreadsheetApp.getActiveSpreadsheet(); return TAB?ss.getSheetByName(TAB):ss.getSheets()[0]; }
function colMap_(sh){ const h=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(x=>String(x).trim()); const m={}; h.forEach((x,i)=>m[x]=i+1); return {h,m}; }

// Corre esto UNA vez desde el editor: agrega columnas estado/capi/actualizado + dropdown
function setup(){
  const sh=sheet_(); let {h}=colMap_(sh);
  EXTRA_COLS.forEach(c=>{ if(h.indexOf(c)<0){ sh.getRange(1,sh.getLastColumn()+1).setValue(c); h.push(c); } });
  const ci=colMap_(sh).m['estado'];
  if(ci){ const rule=SpreadsheetApp.newDataValidation().requireValueInList(ESTADOS,true).build(); sh.getRange(2,ci,Math.max(1,sh.getMaxRows()-1),1).setDataValidation(rule); }
  return 'Listo: columnas estado/capi/actualizado creadas.';
}

function tipoFrom_(row,m){ const s=((m['campaign_name']?row[m['campaign_name']-1]:'')+''+(m['adset_name']?row[m['adset_name']-1]:'')+''+(m['form_name']?row[m['form_name']-1]:'')).toUpperCase(); return s.indexOf('B2B')>=0?'b2b':'b2c'; }

function doGet(e){
  const p=(e&&e.parameter)||{};
  if(p.key!==KEY) return out_(p.callback,{error:'unauthorized'});
  try{
    if(p.action==='update') return out_(p.callback, updateLead_(p.id,p.estado));
    return out_(p.callback, getLeads_());
  }catch(err){ return out_(p.callback,{error:String(err)}); }
}

function getLeads_(){
  const sh=sheet_(); if(sh.getLastRow()<2) return {rows:[],estados:ESTADOS};
  const {m}=colMap_(sh);
  const data=sh.getDataRange().getValues();
  const g=(row,n)=> m[n]?row[m[n]-1]:'';
  const rows=[];
  for(let r=1;r<data.length;r++){
    const row=data[r];
    if(!g(row,'id') && !g(row,'email') && !g(row,'phone_number')) continue;
    rows.push({
      _row:r+1, id:g(row,'id'),
      fecha:String(g(row,'created_time')||'').slice(0,16).replace('T',' '),
      nombre:g(row,'first_name'), apellido:g(row,'last_name'), correo:g(row,'email'), celular:g(row,'phone_number'),
      empresa:g(row,'company_name'), extra:g(row,'tipo_proyecto')||g(row,'espacio')||'',
      campana:g(row,'campaign_name'), anuncio:g(row,'ad_name'),
      estado:g(row,'estado')||'Nuevo', capi:g(row,'capi'), tipo:tipoFrom_(row,m)
    });
  }
  return {rows:rows,estados:ESTADOS,ts:new Date().toLocaleString('es-PA')};
}

function updateLead_(id,estado){
  const sh=sheet_(); const {m}=colMap_(sh);
  if(!m['id']) return {ok:false,error:'falta columna id'};
  if(ESTADOS.indexOf(estado)<0) return {ok:false,error:'estado invalido'};
  const ids=sh.getRange(2,m['id'],Math.max(1,sh.getLastRow()-1),1).getValues();
  let row=-1; for(let i=0;i<ids.length;i++){ if(String(ids[i][0])===String(id)){ row=i+2; break; } }
  if(row<0) return {ok:false,error:'lead no encontrado'};
  if(m['estado']) sh.getRange(row,m['estado']).setValue(estado);
  if(m['actualizado']) sh.getRange(row,m['actualizado']).setValue(new Date());
  let capi='';
  const ev=CAPI_MAP[estado];
  if(ev){
    const full=sh.getRange(row,1,1,sh.getLastColumn()).getValues()[0];
    const gg=n=>m[n]?full[m[n]-1]:'';
    const res=sendCapi_(ev,{lead_id:gg('id'),email:gg('email'),phone:gg('phone_number')});
    capi=ev+(res.ok?' ✓':' ✗ '+res.code);
    if(m['capi']) sh.getRange(row,m['capi']).setValue(capi+' · '+new Date().toLocaleString('es-PA'));
  }
  return {ok:true,estado:estado,capi:capi};
}

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
