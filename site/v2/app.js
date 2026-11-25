(() => {
'use strict';
const $=id=>document.getElementById(id);
const cfg=window.PEUGEOT_CONFIG;
const fmt=v=>v?new Date(v).toLocaleString('it-IT',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
const safe=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fresh=(time,minutes=5)=>!!time&&Date.now()-new Date(time).getTime()>=0&&Date.now()-new Date(time).getTime()<=minutes*60000;
if(!cfg||!cfg.supabaseUrl||!cfg.supabasePublishableKey||cfg.supabaseUrl.includes('YOUR-')||!window.supabase){
  $('message').textContent='Configurazione Supabase mancante o libreria non disponibile.';return;
}
const client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey);
let mapMode="standard";
let map,marker,position=null,lastGpsTime=null,animation=null,refreshTimer=null,loading=false,signedIn=false,driving=false,latestData=null;
let authEpoch=0;
let lastBearing=0,lastDisplayedState=null;
let consecutiveDataFailures=0, retryDelayMs=0, lastGoodDataAt=0;
let lastKnownStatus=null,lastKnownOdometer=null;
let geocodeKey='',geocodePending=null,lastGeocodeAt=0;
const addressCache=new Map();
const gpsCoordinates=s=>{const lat=Number(s?.latitude),lon=Number(s?.longitude);return s&&s.latitude!=null&&s.longitude!=null&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180?{lat,lon}:null};
function rememberGps(status){
 if(!gpsCoordinates(status))return lastKnownStatus;
 const incoming=Date.parse(status.dateTime),previous=Date.parse(lastKnownStatus?.dateTime);
 if(!lastKnownStatus||(Number.isFinite(incoming)&&(!Number.isFinite(previous)||incoming>=previous)))lastKnownStatus=status;
 return lastKnownStatus;
}
function setAddress(value){text('map-address',value);text('address',value)}
async function geocodePosition(status,force=false){
 const coords=gpsCoordinates(status);if(!coords)return;
 const requestEpoch=authEpoch;
 const key=coords.lat.toFixed(5)+','+coords.lon.toFixed(5);
 if(addressCache.has(key)){geocodeKey=key;setAddress(addressCache.get(key));return}
 if(!force&&geocodeKey===key)return;
 if(geocodePending)return;
 geocodeKey=key;
 const elapsed=Date.now()-lastGeocodeAt;
 if(elapsed<1100){geocodeKey='';return}
 lastGeocodeAt=Date.now();
 setAddress('Ricerca indirizzo…');
 geocodePending=(async()=>{
  try{
   const u=new URL('https://nominatim.openstreetmap.org/reverse');
   u.search=new URLSearchParams({lat:String(coords.lat),lon:String(coords.lon),format:'jsonv2',zoom:'18','accept-language':'it'});
   const r=await fetch(u,{headers:{Accept:'application/json'}});
   if(!r.ok)throw Error('Geocodifica non disponibile');
   const d=await r.json();const value=d.display_name||'Indirizzo non disponibile';
   if(requestEpoch!==authEpoch||!signedIn)return;
   addressCache.set(key,value);
   if(geocodeKey===key)setAddress(value);
  }catch{if(requestEpoch===authEpoch&&signedIn&&geocodeKey===key)setAddress('Indirizzo non disponibile')}
  finally{geocodePending=null}
 })();
 await geocodePending;
}
// Scheda sempre aperta su PC; sul telefono si apre toccando il marker.
const mobileCardQuery=window.matchMedia('(max-width: 767px)');
let mobileCardOpen=false;
function syncVehicleCard(){
 const card=$('vehicle-card');
 if(!card)return;
 card.hidden=mobileCardQuery.matches&&!mobileCardOpen;
}
function toggleVehicleCard(){if(mobileCardQuery.matches){mobileCardOpen=!mobileCardOpen;syncVehicleCard();}}
function closeVehicleCard(){if(mobileCardQuery.matches){mobileCardOpen=false;syncVehicleCard();}}
mobileCardQuery.addEventListener?.('change',syncVehicleCard);
$('close-vehicle-card').addEventListener('click',closeVehicleCard);
$('open-vehicle-card').addEventListener('click',()=>{mobileCardOpen=true;syncVehicleCard()});
syncVehicleCard();
const MAP_ID='11f4b4da482f19786959ddf7';
const MAP_TYPES={standard:'roadmap',terrain:'terrain',satellite:'satellite',hybrid:'hybrid'};
let googleMapsPromise=null;
function loadGoogleMaps(){
 if(window.google?.maps?.Map&&window.google?.maps?.marker?.AdvancedMarkerElement)return Promise.resolve();
 if(googleMapsPromise)return googleMapsPromise;
 googleMapsPromise=new Promise((resolve,reject)=>{
  const key=cfg.googleMapsApiKey;
  if(!key||key.includes('INSERISCI')){reject(Error('Inserisci googleMapsApiKey in config.js'));return}
  const cb='__peugeotGoogleMapsReady';
  const script=document.createElement('script');
  const timeout=setTimeout(()=>{cleanup();reject(Error('Timeout caricamento Google Maps'))},15000);
  function cleanup(){clearTimeout(timeout);delete window[cb]}
  window[cb]=()=>{cleanup();resolve()};
  script.onerror=()=>{cleanup();reject(Error('Impossibile caricare Google Maps. Controlla chiave API e dominio autorizzato.'))};
  script.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(key)+'&v=weekly&libraries=marker&loading=async&callback='+cb;
  script.async=true;document.head.appendChild(script);
 }).catch(e=>{googleMapsPromise=null;throw e});
 return googleMapsPromise;
}
function vehicleMarkerElement(){
 // SUV posteriore con anello di stato: il marker resta un AdvancedMarkerElement.
 const outer=document.createElement('div');
 outer.className='pc-google-marker';
 outer.style.cssText='width:84px;height:90px;position:relative;display:block;overflow:visible;pointer-events:auto;cursor:pointer;transform:translateY(-12px);filter:drop-shadow(0 3px 4px #0005)';
 outer.innerHTML=`<div class="pc-status-ring" style="position:absolute;left:7px;bottom:5px;width:70px;height:28px;border-radius:50%;background:#808995;box-shadow:0 2px 6px #0006,inset 0 0 0 5px #ffffffb8;transition:background-color .25s ease"></div>
 <div class="pc-suv-rotate" style="position:absolute;left:10px;top:1px;width:64px;height:77px;transform-origin:50% 65%;will-change:transform;transition:transform .3s ease">
 <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 84 100" width="64" height="77" role="img" aria-label="Peugeot 2008 vista posteriore">
 <defs><linearGradient id="pc-body" x1="0" x2="1"><stop offset="0" stop-color="#b9c2ca"/><stop offset=".25" stop-color="#fff"/><stop offset=".75" stop-color="#e8edf1"/><stop offset="1" stop-color="#8b99a5"/></linearGradient><linearGradient id="pc-glass" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#14212e"/><stop offset="1" stop-color="#3c5668"/></linearGradient></defs>
 <ellipse cx="42" cy="90" rx="32" ry="7" fill="#000" opacity=".2"/>
 <path d="M14 67h10v23H12c-2 0-3-2-3-5V71c0-3 2-4 5-4Zm46 0h10c3 0 5 1 5 4v14c0 3-1 5-3 5H60Z" fill="#20262b"/>
 <path d="M11 33 18 14C22 6 30 5 42 5s20 1 24 9l7 19 4 35-4 14c-1 5-6 8-12 8H23c-6 0-11-3-12-8L7 68Z" fill="url(#pc-body)" stroke="#4e5962" stroke-width="2"/>
 <path d="M19 18Q22 10 32 10h20q10 0 13 8l5 24H14Z" fill="url(#pc-glass)" stroke="#53616d" stroke-width="2"/>
 <path d="M14 43h56l3 24H11Z" fill="#e4e9ed"/><path d="M13 46h58" stroke="#88949e" stroke-width="2"/>
 <path d="M12 53h15l-3 8H10Zm60 0H57l3 8h14Z" fill="#b71522" stroke="#fff" stroke-width="1.4"/>
 <path d="M15 54h10m34 0h10" stroke="#fce3e3" stroke-width="2"/>
 <path d="M26 65h32" stroke="#75818b" stroke-width="1.4"/><path d="M18 75h48" stroke="#a7b0b8" stroke-width="2"/>
 <rect x="28" y="78" width="28" height="8" rx="2" fill="#e8edf0" stroke="#65717c" stroke-width="1"/>
 <path d="M13 86h58l-3 5H16Z" fill="#37424c"/><path d="M20 89h11m22 0h11" stroke="#c3ccd2" stroke-width="2"/>
 </svg></div>`;
 return outer;
}
function setState(state,bearing){
 $('state-dot').className='dot '+state;
 if(!marker)return;
 const colors={moving:'#06c93c',idling:'#ffbf00',stopped:'#f33535',unknown:'#808995'};
 const el=marker.content;
 const ring=el?.querySelector('.pc-status-ring');
 if(ring)ring.style.backgroundColor=colors[state]||colors.unknown;
 const n=Number(bearing);
 if(Number.isFinite(n)&&bearing!==null&&bearing!==undefined&&state==='moving')lastBearing=((n%360)+360)%360;
 // Il disegno del SUV e' visto da dietro: il dato bearing viene applicato al veicolo.
 const rot=el?.querySelector('.pc-suv-rotate');
 if(rot)rot.style.transform='rotate('+lastBearing+'deg)';
}
function cancelAnimation(){if(animation!==null)cancelAnimationFrame(animation);animation=null}
function moveMarker(lat,lon){
 cancelAnimation();
 const start=marker.position;
 if(!start){marker.position={lat,lng:lon};return}
 const a=typeof start.lat==='function'?start.lat():Number(start.lat);
 const b=typeof start.lng==='function'?start.lng():Number(start.lng);
 if(!Number.isFinite(a)||!Number.isFinite(b)){marker.position={lat,lng:lon};return}
 const begin=performance.now(),duration=1600;
 const tick=now=>{
  const t=Math.min(1,(now-begin)/duration),e=t*t*(3-2*t);
  marker.position={lat:a+(lat-a)*e,lng:b+(lon-b)*e};
  if(t<1)animation=requestAnimationFrame(tick);else animation=null;
 };
 animation=requestAnimationFrame(tick);
}
function resizeMap(){
 // Google Maps gestisce automaticamente il ridimensionamento del contenitore.
}
function selectMapMode(mode){
 if(!MAP_TYPES[mode])return;
 mapMode=mode;if(map)map.setMapTypeId(MAP_TYPES[mode]);
 document.querySelectorAll('input[name="map-style"]').forEach(el=>el.checked=el.value===mode);
 $('map-layer-info').textContent='';
}
async function drawMap(status,state){
 const lat=Number(status.latitude),lon=Number(status.longitude);
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return;
 const e=authEpoch;await loadGoogleMaps();if(!signedIn||e!==authEpoch)return;
 if(!map){
  map=new google.maps.Map($('map'),{
   center:{lat,lng:lon},zoom:16,mapId:MAP_ID,mapTypeId:MAP_TYPES[mapMode],
   disableDefaultUI:true,zoomControl:true,zoomControlOptions:{position:google.maps.ControlPosition.RIGHT_BOTTOM},
   gestureHandling:'greedy',tilt:0,heading:0
  });
  marker=new google.maps.marker.AdvancedMarkerElement({
   map,position:{lat,lng:lon},content:vehicleMarkerElement(),title:'Ultima posizione Geotab Peugeot 2008'
  });
  marker.addListener('click',toggleVehicleCard);
 }else{
  const changed=!position||position.lat!==lat||position.lon!==lon;
  const newer=status.dateTime&&(!lastGpsTime||new Date(status.dateTime)>new Date(lastGpsTime));
  if(changed&&newer&&state==='moving')moveMarker(lat,lon);
  else if(changed){cancelAnimation();marker.position={lat,lng:lon}}
  if(changed)map.panTo({lat,lng:lon});
 }
 position={lat,lon};
 if(status.dateTime&&(!lastGpsTime||new Date(status.dateTime)>new Date(lastGpsTime)))lastGpsTime=status.dateTime;
 setState(state,status.bearing);
}
function showPanel(panel){
 const open=panel!=='map';$('drawer').hidden=!open;
 $('asset-panel').hidden=panel!=='asset';$('trips-panel').hidden=panel!=='trips';
 $('service-panel').hidden=panel!=='service';$('drawer-title').textContent=panel==='trips'?'Percorsi':panel==='service'?'Manutenzione':'Asset';
 document.querySelectorAll('.nav-button').forEach(b=>{
  const active=b.dataset.panel===panel;b.classList.toggle('active',active);
  if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
 });
 if(map)setTimeout(resizeMap,80);
}
function toggle(logged){
 authEpoch++;signedIn=logged;$('login-panel').hidden=logged;$('dashboard').hidden=!logged;
 $('logout').hidden=!logged;$('refresh').hidden=!logged;
 if(!logged){cancelAnimation();mobileCardOpen=false;syncVehicleCard();setAddress('Indirizzo non richiesto');text('gps-time','—');text('summary-odometer','—');text('pc-fuel-liters','—');text('pc-fuel-percent','—');text('fuel-freshness','');text('pc-fuel-warning-label','—');text('driving','Stato non disponibile');text('speed','— km/h');Array.from($('pc-fuel-bars').children).forEach(el=>el.classList.remove('active'));position=null;lastGpsTime=null;lastKnownStatus=null;lastKnownOdometer=null;addressCache.clear();geocodeKey='';if(marker)marker.map=null;marker=null;map=null;$('map').replaceChildren();$('dual-metrics').replaceChildren();$('service-metrics').replaceChildren();$('trips').replaceChildren();clearTimeout(refreshTimer);cancelAnimation();latestData=null;lastDisplayedState=null;consecutiveDataFailures=0;retryDelayMs=0;lastGoodDataAt=0;showPanel('map');}
 $('connection').textContent=logged?'Collegato':'Non collegato';
}
function text(id,value){$(id).textContent=value}
function showMeasurement(id,timeId,reading,format){
 text(id,reading&&reading.value!=null&&Number.isFinite(Number(reading.value))?format(Number(reading.value)):'—');
 text(timeId,reading?.dateTime?'Rilevato: '+fmt(reading.dateTime)+(fresh(reading.dateTime,60)?'':' · Storico'):'Nessun dato');
}
function colored(id,label,level){
 $(id).className='signal-'+level;$(id).textContent=label;
}
// Lo stato deriva sempre dall'ora del campione Geotab, non dall'ora della richiesta HTTP.
function vehicleState(data){
 const d=data?.status||{},t=Date.parse(d.dateTime),age=Number.isFinite(t)?Date.now()-t:Infinity;
 const gpsFresh=!d.stale&&age>=0&&age<=120000;
 const m=data?.metrics||{},recent=r=>r&&!r.stale&&fresh(r.dateTime,2);
 const current=recent(m.ignition)&&recent(m.speed)?data?.vehicleState?.current:'unknown';
 const state=({moving:'moving',parked:'stopped',stationary_engine_on:'idling'})[current]||'unknown';
 return {state,label:({moving:'In movimento',stopped:'Parcheggiata',idling:'Accensione attiva'})[state]||'Stato non disponibile',age,gpsFresh,speed:recent(m.speed)?m.speed.value:NaN};
}
function elapsedLabel(ms){
 if(!Number.isFinite(ms))return 'ora sconosciuta';
 const seconds=Math.floor(ms/1000);
 if(seconds<60)return 'meno di 1 minuto fa';
 const minutes=Math.floor(seconds/60);
 if(minutes<60)return `${minutes} min fa`;
 const hours=Math.floor(minutes/60);
 if(hours<24)return `${hours} h ${minutes%60} min fa`;
 return `${Math.floor(hours/24)} giorni fa`;
}
function updateVehicleStatus(data){
 if(!data)return;
 const d=data.status||{},v=vehicleState(data);
 driving=v.state==='moving';
 text('driving',v.label);
  $('driving').className='pc-status-text '+v.state;
 const stateIcon=$('status-icon');if(stateIcon)stateIcon.setAttribute('class','pc-status-icon '+v.state);
 text('speed',Number.isFinite(v.speed)?Math.round(v.speed)+' km/h':'— km/h');
 text('gps-time', (d.source||'—')+' · '+fmt(d.dateTime)+(v.gpsFresh?'':' · Storica'));
  $('gps-time').dateTime=d.dateTime||'';
  $('gps-time').title=v.gpsFresh?'Posizione recente':'Ultima posizione registrata (dato non recente)';
 $('gps-time').classList.toggle('gps-stale',!v.gpsFresh);
 $('state-dot').className='dot '+v.state;
 if(marker){setState(v.state,d.bearing);}if(data.metrics?.fuel)text('fuel-freshness',meta(data.metrics.fuel));
 lastDisplayedState=v.state;
}
// Aggiorna l'eta del dato anche tra due interrogazioni Geotab.
setInterval(()=>{if(signedIn&&latestData)updateVehicleStatus(latestData)},15000);
// Visualizzazione del carburante gia recuperato per il pannello Asset.
function meta(r){return r?.dateTime?[r.source||'—',fmt(r.dateTime),r.stale?'Storico':fresh(r.dateTime,2)?'Recente':'Ultimo noto'].join(' · '):'Nessun dato'}
function tile(parent,label,r,unit='',scale=1){const a=document.createElement('div'),l=document.createElement('span'),v=document.createElement('strong'),s=document.createElement('small');a.className='asset-tile';l.textContent=label;v.textContent=typeof r?.value==='number'&&Number.isFinite(r.value)?(r.value/scale).toLocaleString('it-IT',{maximumFractionDigits:2})+' '+unit:'—';s.textContent=meta(r);a.append(l,v,s);$(parent).append(a)}
function render(data){
 latestData=data;const d=data.status||{},m=data.metrics||{},f=m.fuel;
 text('vehicle-name','Peugeot 2008 · Dual Source');text('updated','Richiesta: '+fmt(data.fetchedAt));updateVehicleStatus(data);
 const odo=m.odometer?.value;text('summary-odometer',Number.isFinite(odo)?(odo/1000).toLocaleString('it-IT',{maximumFractionDigits:1})+' km':'— km');
 const p=f?.value,valid=Number.isFinite(p)&&p>=0&&p<=100;
 text('pc-fuel-liters',valid?p.toLocaleString('it-IT',{maximumFractionDigits:2})+' %':'—');
 text('pc-fuel-percent',f?.source||'—');text('fuel-freshness',meta(f));text('pc-fuel-warning-label',({low:'Basso',reserve:'Riserva',critical:'Critico',normal:'Normale'})[data.reserve?.level]||'—');
 $('pc-fuel-warning').title='Riserva virtuale, non spia ufficiale';$('pc-fuel-strip').title=meta(f);$('pc-fuel-strip').setAttribute('aria-label','Carburante: '+(valid?p+' %':'non disponibile')+' · '+meta(f));$('pc-fuel-strip').classList.toggle('reserve',valid&&p<=20);
 Array.from($('pc-fuel-bars').children).forEach((el,i)=>el.classList.toggle('active',valid&&i<Math.ceil(p/20)));
 $('dual-metrics').replaceChildren();$('service-metrics').replaceChildren();
 for(const [k,label,u,s] of [['odometer','Chilometraggio','km',1000],['fuel','Carburante','%',1],['speed','Velocità rilevata','km/h',1],['engineSpeed','Giri motore','rpm',1],['ignition','Accensione (0/1)','',1],['coolant','Refrigerante','°C',1],['oil','Olio','°C',1],['outsideTemperature','Temperatura esterna','°C',1],['voltage','Alimentazione GO9B','V',1],['crankingVoltage','Campione avviamento','V',1],['gpsSignal','Segnale GPS','%',1],['fuelUsed','Contatore carburante','L',1]])tile('dual-metrics',label,m[k],u,s);
 tile('service-metrics','Distanza residua',m.serviceDistance,'km');tile('service-metrics','Tempo residuo',m.serviceDays,'giorni');
 $('trips').replaceChildren();for(const t of Array.isArray(data.trips)?data.trips:[]){const a=document.createElement('article');a.className='trip-item';a.textContent=fmt(t.dateTime)+' → '+fmt(t.stop)+' · OEM';$('trips').append(a)}if(!$('trips').children.length)text('trips','Nessun viaggio disponibile');
 if(gpsCoordinates(d)&&!(d.source==='GO9B'&&d.stale)){setAddress('Indirizzo su richiesta');return drawMap(d,vehicleState(data).state)}
 cancelAnimation();if(marker)marker.map=null;marker=null;map=null;position=null;$('map').replaceChildren();setAddress('Posizione verificabile non disponibile');return Promise.resolve();
}
function schedule(){clearTimeout(refreshTimer)}
function apiFailureInfo(error){
 const status=Number(error?.context?.status)||0;
 const message=String(error?.message||'Errore di connessione');
 const lower=message.toLowerCase();
 const auth=status===401||status===403||/utente non autorizzato|invalid.*token|jwt.*expired|sessione.*scaduta/i.test(message);
 const config=/configurazione server incompleta|configurazione supabase mancante/i.test(message);
 const permanent=auth||config;
 const rate=status===429||/limite.*api|rate.limit|quota|temporaneamente in attesa/i.test(message);
 return {status,message,permanent,rate};
}
async function load(){
 if(loading||!signedIn)return;const requestEpoch=authEpoch;loading=true;clearTimeout(refreshTimer);
 $('refresh').disabled=true;
 try{
  const {data,error}=await client.functions.invoke('peugeot-api-v2',{body:{action:'dashboard'}});
  if(requestEpoch!==authEpoch||!signedIn)return;
  if(error){
   let msg=error.message;
   try{const payload=await error.context?.json();msg=payload?.error||msg}catch{}
   const ex=Error(msg||'Errore di connessione');ex.context=error.context;throw ex;
  }
  if(data?.error)throw Error(data.error);if(data?.version!=='2.1-staging')throw Error('Versione API inattesa');
  // A valid response resets the transient failure counter.
  consecutiveDataFailures=0;retryDelayMs=0;lastGoodDataAt=Date.now();
  text('message','');
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  try{if(requestEpoch!==authEpoch||!signedIn)return;await render(data);if(requestEpoch!==authEpoch||!signedIn)return;text('connection',data?.stale?'Dati disponibili · aggiornamento in attesa':'Dati aggiornati');}
  catch(mapError){if(requestEpoch!==authEpoch||!signedIn)return;text('message','Dati caricati, ma mappa non disponibile: '+(mapError.message||String(mapError)));text('connection','Dati aggiornati');}
 }catch(e){
  if(requestEpoch!==authEpoch||!signedIn)return;
  const f=apiFailureInfo(e);
  consecutiveDataFailures++;
  retryDelayMs=f.permanent?60000:Math.min(60000,5000*Math.pow(2,Math.min(4,consecutiveDataFailures-1)));
  if(f.rate)retryDelayMs=Math.max(retryDelayMs,30000);
  if(f.permanent){
   text('message',f.message);
   text('connection','Verifica accesso');
  }else if(latestData){
   // Keep the last valid dashboard visible; do not misrepresent it as live.
   text('connection','Dati precedenti · aggiornare manualmente');
   text('message','Connessione Geotab non disponibile. Ultimi dati mantenuti; premi Aggiorna.');
  }else{
   text('connection','Connessione in attesa');
   text('message','Dati Geotab non disponibili. Premi Aggiorna.');
  }
  console.warn('Peugeot Connect: richiesta dati non riuscita', {status:f.status,attempts:consecutiveDataFailures,waitSeconds:Math.ceil(retryDelayMs/1000),reason:f.message});
 }finally{loading=false;$('refresh').disabled=false;schedule()}
}
$('login-form').addEventListener('submit',async e=>{
 e.preventDefault();text('message','');
 const {error}=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});
 $('password').value='';if(error){text('message',error.message);return}
 toggle(true);await load();
});
$('logout').addEventListener('click',async()=>{toggle(false);const {error}=await client.auth.signOut();if(error)text('message','Disconnessione server non confermata')});
$('refresh').addEventListener('click',load);
$('layers-toggle').addEventListener('click',()=>{
 const panel=$('layers-panel');panel.hidden=!panel.hidden;
 $('layers-toggle').setAttribute('aria-expanded',String(!panel.hidden));
});
document.querySelectorAll('input[name="map-style"]').forEach(input=>input.addEventListener('change',()=>{
 if(input.checked){selectMapMode(input.value);$('layers-panel').hidden=true;$('layers-toggle').setAttribute('aria-expanded','false');}
}));
$('center-map').addEventListener('click',()=>{if(map&&position)map.panTo({lat:position.lat,lng:position.lon})});
document.querySelectorAll('.nav-button').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.panel==='trips'){location.assign('./percorsi/');return}showPanel(b.dataset.panel)}));
$('close-drawer').addEventListener('click',()=>showPanel('map'));
$('lookup-address').addEventListener('click',async()=>{
 if(!position){setAddress('Posizione non disponibile');return}
 $('lookup-address').disabled=true;
 try{geocodeKey='';await geocodePosition({latitude:position.lat,longitude:position.lon},true)}
 finally{$('lookup-address').disabled=false}
});

window.addEventListener('resize',resizeMap);
document.addEventListener('visibilitychange',()=>{if(signedIn&&document.visibilityState==='visible'){resizeMap()}});
client.auth.onAuthStateChange((event)=>{if(event==='SIGNED_OUT')toggle(false)});
client.auth.getSession().then(async({data})=>{toggle(!!data.session);if(data.session)await load()}).catch(e=>text('message',e.message));
})();
