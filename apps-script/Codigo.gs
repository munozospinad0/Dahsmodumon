/*** modu.mon · Dashboard API + Conversions API + Métricas  ·  Apps Script sobre "Leads Modumon" ***/
/*** Token de Meta: Project Settings > Script properties > META_TOKEN                              ***/

const DATASET_ID = '1472599984909735';
const AD_ACCOUNT = 'act_1032839425787482';
const API_VER    = 'v21.0';
const KEY        = 'modumon2026';
const STATUSES   = ['created','contacted','qualified','disqualified','converted'];
const CAPI_STAGES= ['contacted','qualified','disqualified','converted'];
const STATUS_ALIASES = ['lead_status','status','estado','lead status','lead_estado','lead status meta'];
const STATUS_DEFAULT = 'lead_status';

function META_TOKEN(){ return PropertiesService.getScriptProperties().getProperty('META_TOKEN') || ''; }
function colMap_(sh){ const h=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(x=>String(x).trim()); const m={}; h.forEach((x,i)=>m[x]=i+1); return {h,m}; }
function statusKey_(m){ const keys=Object.keys(m); for(const a of STATUS_ALIASES){ const k=keys.find(x=>String(x).toLowerCase().trim()===a); if(k) return k; } return null; }
function isLeadSheet_(m){ return !!(m['id']||m['email']||m['first_name']); }
function clean_(v){ return String(v==null?'':v).replace(/^[a-zA-Z]+:\s*/,'').trim(); }
function isTest_(fn,ln,email){ return /test lead|dummy data/i.test(String(fn)+String(ln)+String(email)) || String(email).toLowerCase()==='test@meta.com'; }

// Corre 1 vez: pone la columna de estado + dropdown en TODAS las hojas de leads
function setup(){
  const ss=SpreadsheetApp.getActiveSpreadsheet(); let n=0;
  ss.getSheets().forEach(sh=>{
    if(sh.getLastRow()<1) return; const {m}=colMap_(sh); if(!isLeadSheet_(m)) return;
    let key=statusKey_(colMap_(sh).m);
    if(!key){ sh.getRange(1,sh.getLastColumn()+1).setValue(STATUS_DEFAULT); key=STATUS_DEFAULT; }
    const ci=colMap_(sh).m[key];
    const rule=SpreadsheetApp.newDataValidation().requireValueInList(STATUSES,true).build();
    sh.getRange(2,ci,Math.max(1,sh.getMaxRows()-1),1).setDataValidation(rule); n++;
  });
  return 'Listo en '+n+' hoja(s), estados: '+STATUSES.join(' / ');
}

function tipoFrom_(row,m,sheetName){
  const s=((m['campaign_name']?row[m['campaign_name']-1]:'')+''+(m['adset_name']?row[m['adset_name']-1]:'')+''+(m['form_name']?row[m['form_name']-1]:'')+''+(sheetName||'')).toUpperCase();
  if(s.indexOf('B2B')>=0||s.indexOf('PROYECT')>=0) return 'b2b';
  return 'b2c';
}

function doGet(e){
  const p=(e&&e.parameter)||{};
  if(p.key!==KEY) return out_(p.callback,{error:'unauthorized'});
  try{
    if(p.action==='update')  return out_(p.callback, updateLead_(p.id,p.status));
    return out_(p.callback, getLeads_());
  }catch(err){ return out_(p.callback,{error:String(err)}); }
}

function getLeads_(){
  const ss=SpreadsheetApp.getActiveSpreadsheet(); const rows=[];
  ss.getSheets().forEach(sh=>{
    if(sh.getLastRow()<2) return; const {m}=colMap_(sh); if(!isLeadSheet_(m)) return;
    const sck=statusKey_(m); const data=sh.getDataRange().getValues();
    const g=(row,n)=> m[n]?row[m[n]-1]:'';
    for(let r=1;r<data.length;r++){
      const row=data[r]; const id=g(row,'id'), email=g(row,'email'), fn=g(row,'first_name'), ln=g(row,'last_name');
      if(!id && !email && !g(row,'phone_number')) continue;
      if(isTest_(fn,ln,email)) continue;
      const st=String(sck?row[m[sck]-1]:'').toLowerCase().trim();
      rows.push({ _row:r+1, id:id,
        fecha:String(g(row,'created_time')||'').slice(0,16).replace('T',' '),
        nombre:fn, apellido:ln, correo:email, celular:clean_(g(row,'phone_number')),
        empresa:g(row,'company_name'), extra:g(row,'tipo_proyecto')||g(row,'espacio')||'',
        campana:g(row,'campaign_name'), anuncio:g(row,'ad_name'),
        status: STATUSES.indexOf(st)>=0?st:'created', tipo:tipoFrom_(row,m,sh.getName()) });
    }
  });
  return {rows:rows,statuses:STATUSES,ts:new Date().toLocaleString('es-PA')};
}

function updateLead_(id,status){
  status=String(status||'').toLowerCase().trim();
  if(STATUSES.indexOf(status)<0) return {ok:false,error:'status invalido'};
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  for(const sh of ss.getSheets()){
    if(sh.getLastRow()<2) continue; const {m}=colMap_(sh); if(!m['id']) continue;
    let key=statusKey_(m); if(!key){ sh.getRange(1,sh.getLastColumn()+1).setValue(STATUS_DEFAULT); key=STATUS_DEFAULT; }
    const sc=colMap_(sh).m[key];
    const ids=sh.getRange(2,m['id'],Math.max(1,sh.getLastRow()-1),1).getValues();
    for(let i=0;i<ids.length;i++){
      if(String(ids[i][0])===String(id)){
        const row=i+2; sh.getRange(row,sc).setValue(status);
        let capi='';
        if(CAPI_STAGES.indexOf(status)>=0){
          const full=sh.getRange(row,1,1,sh.getLastColumn()).getValues()[0]; const gg=n=>m[n]?full[m[n]-1]:'';
          const res=sendCapi_(status,{lead_id:gg('id'),email:gg('email'),phone:gg('phone_number')});
          capi=status+(res.ok?' - enviado a Meta':' - error '+res.code);
        }
        return {ok:true,status:status,capi:capi};
      }
    }
  }
  return {ok:false,error:'lead no encontrado'};
}

// Métricas de campañas desde la Marketing API (cacheadas 10 min para no gastar cuota)
function getMetrics_(){
  const cache=CacheService.getScriptCache(); const c=cache.get('metrics'); if(c) return JSON.parse(c);
  const token=META_TOKEN(); if(!token) return {error:'sin_token',campaigns:[],totals:{}};
  const fields='campaign_name,spend,impressions,clicks,ctr,actions';
  const url='https://graph.facebook.com/'+API_VER+'/'+AD_ACCOUNT+'/insights?level=campaign&date_preset=maximum&fields='+encodeURIComponent(fields)+'&limit=50&access_token='+encodeURIComponent(token);
  const resp=UrlFetchApp.fetch(url,{muteHttpExceptions:true}); const j=JSON.parse(resp.getContentText());
  if(j.error) return {error:j.error.message,campaigns:[],totals:{}};
  const camps=(j.data||[]).map(c=>{
    let leads=0; (c.actions||[]).forEach(a=>{ if(String(a.action_type).indexOf('lead')>=0) leads+=Number(a.value)||0; });
    const spend=Number(c.spend)||0, imp=Number(c.impressions)||0;
    return {name:c.campaign_name, spend:spend, impressions:imp, clicks:Number(c.clicks)||0, ctr:Number(c.ctr)||0, leads:leads, cpl:leads?spend/leads:0};
  });
  const totals={ spend:camps.reduce((s,c)=>s+c.spend,0), leads:camps.reduce((s,c)=>s+c.leads,0), impressions:camps.reduce((s,c)=>s+c.impressions,0), clicks:camps.reduce((s,c)=>s+c.clicks,0) };
  totals.cpl=totals.leads?totals.spend/totals.leads:0;
  const out={campaigns:camps,totals:totals,ts:new Date().toLocaleString('es-PA')};
  cache.put('metrics',JSON.stringify(out),600);
  return out;
}

function sendCapi_(eventName,lead){
  const token=META_TOKEN(); if(!token) return {ok:false,code:'sin_token'};
  const ud={}; const lid=String(lead.lead_id||'').replace(/[^0-9]/g,''); if(lid) ud.lead_id=Number(lid);
  if(lead.email) ud.em=[sha256_(String(lead.email).trim().toLowerCase())];
  if(lead.phone){ const p=String(lead.phone).replace(/[^0-9]/g,''); if(p) ud.ph=[sha256_(p)]; }
  const evt={event_name:eventName,event_time:Math.floor(Date.now()/1000),action_source:'system_generated',event_id:'modumon-'+lid+'-'+eventName+'-'+Date.now(),user_data:ud,custom_data:{event_source:'crm',lead_event_source:'modu.mon dashboard'}};
  const url='https://graph.facebook.com/'+API_VER+'/'+DATASET_ID+'/events?access_token='+encodeURIComponent(token);
  const resp=UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',payload:JSON.stringify({data:[evt]}),muteHttpExceptions:true});
  const code=resp.getResponseCode(); return {ok:code>=200&&code<300,code:code};
}

function sha256_(s){ const b=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s,Utilities.Charset.UTF_8); return b.map(x=>('0'+(x&0xFF).toString(16)).slice(-2)).join(''); }
function out_(cb,obj){ const j=JSON.stringify(obj); return cb?ContentService.createTextOutput(cb+'('+j+')').setMimeType(ContentService.MimeType.JAVASCRIPT):ContentService.createTextOutput(j).setMimeType(ContentService.MimeType.JSON); }
