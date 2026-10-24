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
let lastBearing=0,lastDisplayedState=null;
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
   addressCache.set(key,value);
   if(geocodeKey===key)setAddress(value);
  }catch{if(geocodeKey===key)setAddress('Indirizzo non disponibile')}
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
 const outer=document.createElement('div');
 outer.className='pc-google-marker';
 outer.style.cssText='width:60px;height:60px;border-radius:50%;border:3px solid white;box-shadow:0 2px 12px #0007;display:grid;place-items:center;background:#808995;position:relative;transform:translateY(-14px)';
 outer.innerHTML='<div class="pc-suv-rotate" style="width:33px;height:48px;transform-origin:center;will-change:transform"><svg viewBox="0 0 40 64" width="33" height="48" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="12" width="6" height="13" rx="2" fill="#1e293b"/><rect x="33" y="12" width="6" height="13" rx="2" fill="#1e293b"/><rect x="1" y="40" width="6" height="13" rx="2" fill="#1e293b"/><rect x="33" y="40" width="6" height="13" rx="2" fill="#1e293b"/><path d="M13 2Q20 0 27 2L33 12V51Q32 61 20 63Q8 61 7 51V12Z" fill="#f7fafc" stroke="#293748" stroke-width="1.5"/><path d="M10 18H30L28 26H12Z" fill="#6e9ab5" stroke="#334155"/><rect x="12" y="28" width="16" height="16" rx="3" fill="#394b5d"/><path d="M11 46H29L30 54H10Z" fill="#83abc3" stroke="#334155"/><path d="M9 8L13 7M27 7L31 8" stroke="#fff0ad" stroke-width="3"/><path d="M9 56L14 59M26 59L31 56" stroke="#ed5555" stroke-width="3"/></svg></div>';
 return outer;
}
function setState(state,bearing){
 $('state-dot').className='dot '+state;
 if(!marker)return;
 const colors={moving:'#06c93c',idling:'#ffbf00',stopped:'#f33535',unknown:'#808995'};
 const el=marker.content;
 if(el)el.style.background=colors[state]||colors.unknown;
 const n=Number(bearing);
 if(Number.isFinite(n)&&bearing!==null&&bearing!==undefined&&state==='moving')lastBearing=((n%360)+360)%360;
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
 await loadGoogleMaps();
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
 $('drawer-title').textContent=panel==='trips'?'Percorsi':'Asset';
 document.querySelectorAll('.nav-button').forEach(b=>{
  const active=b.dataset.panel===panel;b.classList.toggle('active',active);
  if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
 });
 if(map)setTimeout(resizeMap,80);
}
function toggle(logged){
 signedIn=logged;$('login-panel').hidden=logged;$('dashboard').hidden=!logged;
 $('logout').hidden=!logged;$('refresh').hidden=!logged;
 if(!logged){clearTimeout(refreshTimer);cancelAnimation();latestData=null;lastDisplayedState=null;showPanel('map');}
 $('connection').textContent=logged?'Collegato':'Non collegato';
}
function text(id,value){$(id).textContent=value}
function showMeasurement(id,timeId,reading,format){
 text(id,reading&&Number.isFinite(reading.value)?format(reading.value):'—');
 text(timeId,reading?.dateTime?'Rilevato: '+fmt(reading.dateTime)+(fresh(reading.dateTime,60)?'':' · Storico'):'Nessun dato');
}
function colored(id,label,level){
 $(id).className='signal-'+level;$(id).textContent=label;
}
// Lo stato deriva sempre dall'ora del campione Geotab, non dall'ora della richiesta HTTP.
function vehicleState(data){
 const d=data?.status||{},a=data?.assetDiagnostics||{};
 const t=Date.parse(d.dateTime),age=Number.isFinite(t)?Math.max(0,Date.now()-t):Infinity;
 const gpsFresh=Number.isFinite(t)&&t<=Date.now()+60000&&age<=300000;
 const speed=d.speed===null||d.speed===undefined?NaN:Number(d.speed);
 const moving=gpsFresh&&d.isDriving===true&&Number.isFinite(speed)&&speed>0;
 const valid=r=>r&&r.value!==null&&r.value!==undefined&&fresh(r.dateTime,5)&&Number.isFinite(Number(r.value));
 const rpm=valid(a.engineSpeed)?Number(a.engineSpeed.value):null;
 const ignition=valid(a.ignition)?Number(a.ignition.value):null;
 const active=valid(a.engineActive)?Number(a.engineActive.value):null;
 const engineOn=rpm!==null?rpm>0:ignition!==null?ignition===1:active!==null?active===1:null;
 const stopped=Number.isFinite(speed)&&speed===0&&d.isDriving!==true;
 const state=moving?'moving':stopped&&gpsFresh&&engineOn===true?'idling':stopped?'stopped':'unknown';
 const label=moving?'In movimento':stopped?(gpsFresh?(engineOn===true?'Motore acceso · fermo':'Fermo'):'Fermo · ultima rilevazione'):'Stato non disponibile';
 return {state,label,age,gpsFresh,speed};
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
 text('gps-time','Aggiornato: '+fmt(d.dateTime));
  $('gps-time').dateTime=d.dateTime||'';
  $('gps-time').title=v.gpsFresh?'Posizione recente':'Ultima posizione registrata (dato non recente)';
 $('gps-time').classList.toggle('gps-stale',!v.gpsFresh);
 $('state-dot').className='dot '+v.state;
 if(marker){setState(v.state,d.bearing);}
 lastDisplayedState=v.state;
}
// Aggiorna l'eta del dato anche tra due interrogazioni Geotab.
setInterval(()=>{if(signedIn&&latestData)updateVehicleStatus(latestData)},15000);
function render(data){
 const accepted=rememberGps(data.status);
 const d=accepted||data.status||{};
 const m=data.measurements||{},a=data.assetDiagnostics||{};
 const odometerCandidate=a.odometer;
 if(odometerCandidate?.value!=null&&Number.isFinite(Number(odometerCandidate.value))&&Number(odometerCandidate.value)>=0){
  const incoming=Date.parse(odometerCandidate.dateTime),previous=Date.parse(lastKnownOdometer?.dateTime);
  if(!lastKnownOdometer||Number.isFinite(incoming)&&(!Number.isFinite(previous)||incoming>=previous))lastKnownOdometer=odometerCandidate;
 }
 const merged={...data,status:d,assetDiagnostics:{...a,odometer:lastKnownOdometer||a.odometer}};
 latestData=merged;
 text('vehicle-name',data.vehicle?.name||'Peugeot 2008');
 text('updated','Aggiornato: '+fmt(data.fetchedAt));
 updateVehicleStatus(merged);
 if(gpsCoordinates(d))void geocodePosition(d);
 const speed=d.speed===null||d.speed===undefined?NaN:Number(d.speed);
 const validEngine=r=>r&&r.value!==null&&r.value!==undefined&&fresh(r.dateTime,5)&&Number.isFinite(Number(r.value));
 const rpm=validEngine(a.engineSpeed)?Number(a.engineSpeed.value):null;
 const ignition=validEngine(a.ignition)?Number(a.ignition.value):null;
 const active=validEngine(a.engineActive)?Number(a.engineActive.value):null;
 const engineOn=rpm!==null?rpm>0:ignition!==null?ignition===1:active!==null?active===1:null;
 const state=vehicleState(merged).state;
 text('asset-speed',Number.isFinite(speed)?Math.round(speed)+' km/h':'—');text('asset-speed-time',fmt(d.dateTime));
 text('communicating',d.isDeviceCommunicating===true?'Connesso':d.isDeviceCommunicating===false?'Non comunica':'—');
 text('comm-time','GPS: '+fmt(d.dateTime));
 text('engine',engineOn===true?'Acceso':engineOn===false?'Spento':'Non disponibile');
 text('engine-time',a.engineSpeed?.dateTime?'Giri: '+a.engineSpeed.value+' rpm · '+fmt(a.engineSpeed.dateTime):'Ultima lettura non disponibile');
 showMeasurement('fuel','fuel-time',m.fuel,v=>Math.round(v)+' %');
 showMeasurement('battery','battery-time',m.battery,v=>v.toFixed(2)+' V');
 // Geotab DiagnosticOdometerId reports metres. Reject obviously invalid readings.
 showMeasurement('odometer','odometer-time',merged.assetDiagnostics.odometer,v=>v>=0?(v/1000).toLocaleString('it-IT',{maximumFractionDigits:1})+' km':'—');
  const odo=Number(merged.assetDiagnostics.odometer?.value);
  text('summary-odometer',merged.assetDiagnostics.odometer&&merged.assetDiagnostics.odometer.value!==null&&merged.assetDiagnostics.odometer.value!==undefined&&Number.isFinite(odo)&&odo>=0?(odo/1000).toLocaleString('it-IT',{maximumFractionDigits:0})+' km':'— km');
  $('summary-odometer').title=merged.assetDiagnostics.odometer?.dateTime?'Chilometraggio rilevato: '+fmt(merged.assetDiagnostics.odometer.dateTime):'Chilometraggio non disponibile';
 const sats=a.trackedSatellites||a.gpsSatellites;
 if(sats&&fresh(sats.dateTime,15)&&Number.isFinite(sats.value)){
  const n=Math.round(sats.value);colored('satellites',n+' satelliti',n>=7?'green':n>=4?'orange':'red');
 }else colored('satellites','Non disponibile','unknown');
 text('satellites-time',sats?.dateTime?'Rilevato: '+fmt(sats.dateTime):'Nessun dato');
 const cell=a.cellularSignal;
 if(cell&&fresh(cell.dateTime,15)&&Number.isFinite(cell.value)){
  const v=cell.value;
  // Tentative scale interpretation; keep raw value visible.
  // Some modems use dBm, others 0..5 or other scales.
  let level='unknown';
  if(v>=0&&v<=5)level=v>=4?'green':v>=2?'orange':'red';
  else if(v>=-120&&v<=-30)level=v>=-85?'green':v>=-105?'orange':'red';
  colored('cellular',String(v)+' · '+(level==='unknown'?'scala sconosciuta':'qualità indicativa'),level);
 }else colored('cellular','Non disponibile','unknown');
 text('cellular-time',cell?.dateTime?'Rilevato: '+fmt(cell.dateTime)+' · scala da verificare':'Nessun dato');
 const access=Array.isArray(data.accessDiagnostics)?data.accessDiagnostics:[];
 const names={driver:'Conducente',passenger:'Passeggero',rearRight:'Posteriore destra',rearLeft:'Posteriore sinistra',cargoHatchCandidate:'Portellone (da confermare)'};
 $('access-signals').innerHTML=access.length?access.map(x=>`<div class="access-card"><b>${safe(names[x.key]||x.description)}</b><span>${x.latestValue===0?'0 · probabile chiusura':x.latestValue===1?'1 · probabile apertura':'Nessuna lettura'}</span><small>${safe(fmt(x.latestDateTime))} · ${safe(x.sampleCount)} campioni</small></div>`).join(''):'<p>Diagnostiche non disponibili.</p>';
 const trips=Array.isArray(data.trips)?data.trips:[];
 $('trips').innerHTML=trips.length?trips.map(t=>`<article class="trip-item"><b>${safe(fmt(t.start||t.dateTime))} → ${safe(fmt(t.stop))}</b><small>${Number.isFinite(t.distance)?(t.distance/1000).toFixed(1)+' km':'Distanza non disponibile'} · Durata: ${safe(t.drivingDuration||'—')}</small></article>`).join(''):'<p>Nessun viaggio disponibile.</p>';
 return (gpsCoordinates(d)?drawMap(d,state):Promise.resolve()).then(()=>{lastDisplayedState=state});
}
function schedule(){
 clearTimeout(refreshTimer);
 if(!signedIn)return;
 refreshTimer=setTimeout(()=>{if(document.visibilityState==='visible')load();else schedule()},driving?2000:30000);
}
async function load(){
 if(loading||!signedIn)return;loading=true;clearTimeout(refreshTimer);
 $('refresh').disabled=true;text('message','');
 try{
  const {data,error}=await client.functions.invoke('peugeot-api',{body:{action:'dashboard'}});
  if(error){let msg=error.message;try{msg=(await error.context?.json())?.error||msg}catch{}throw Error(msg)}
  if(data?.error)throw Error(data.error);
  // Wait for the dashboard to be painted before Google Maps initializes.
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  try{await render(data);text('connection','Dati aggiornati');}
  catch(mapError){text('message','Dati caricati, ma mappa non disponibile: '+(mapError.message||String(mapError)));text('connection','Dati aggiornati');}
 }catch(e){text('message',e.message||String(e));text('connection','Errore dati')}
 finally{loading=false;$('refresh').disabled=false;schedule()}
}
$('login-form').addEventListener('submit',async e=>{
 e.preventDefault();text('message','');
 const {error}=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});
 $('password').value='';if(error){text('message',error.message);return}
 toggle(true);await load();
});
$('logout').addEventListener('click',async()=>{await client.auth.signOut();toggle(false)});
$('refresh').addEventListener('click',load);
$('layers-toggle').addEventListener('click',()=>{
 const panel=$('layers-panel');panel.hidden=!panel.hidden;
 $('layers-toggle').setAttribute('aria-expanded',String(!panel.hidden));
});
document.querySelectorAll('input[name="map-style"]').forEach(input=>input.addEventListener('change',()=>{
 if(input.checked){selectMapMode(input.value);$('layers-panel').hidden=true;$('layers-toggle').setAttribute('aria-expanded','false');}
}));
$('center-map').addEventListener('click',()=>{if(map&&position)map.panTo({lat:position.lat,lng:position.lon})});
document.querySelectorAll('.nav-button').forEach(b=>b.addEventListener('click',()=>showPanel(b.dataset.panel)));
$('close-drawer').addEventListener('click',()=>showPanel('map'));
$('lookup-address').addEventListener('click',async()=>{
 if(!position){setAddress('Posizione non disponibile');return}
 $('lookup-address').disabled=true;
 try{geocodeKey='';await geocodePosition({latitude:position.lat,longitude:position.lon},true)}
 finally{$('lookup-address').disabled=false}
});

window.addEventListener('resize',resizeMap);
document.addEventListener('visibilitychange',()=>{if(signedIn&&document.visibilityState==='visible'){resizeMap();load()}});
client.auth.getSession().then(async({data})=>{toggle(!!data.session);if(data.session)await load()}).catch(e=>text('message',e.message));
})();
