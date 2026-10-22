(() => {
'use strict';
const $=id=>document.getElementById(id);
const cfg=window.PEUGEOT_CONFIG;
const fmt=v=>v?new Date(v).toLocaleString('it-IT',{dateStyle:'short',timeStyle:'short',second:'2-digit'}):'—';
const safe=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fresh=(time,minutes=5)=>!!time&&Date.now()-new Date(time).getTime()>=0&&Date.now()-new Date(time).getTime()<=minutes*60000;
if(!cfg||!cfg.supabaseUrl||!cfg.supabasePublishableKey||cfg.supabaseUrl.includes('YOUR-')||!window.supabase){
  $('message').textContent='Configurazione Supabase mancante o libreria non disponibile.';return;
}
const client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey);
let map,marker,position=null,lastGpsTime=null,animation=null,refreshTimer=null,loading=false,signedIn=false,driving=false,latestData=null;
const carSvg=`<svg class="peugeot-car-svg" viewBox="0 0 52 88" xmlns="http://www.w3.org/2000/svg">
<rect x="3" y="18" width="7" height="18" rx="3" fill="#203246"/><rect x="42" y="18" width="7" height="18" rx="3" fill="#203246"/>
<rect x="3" y="54" width="7" height="17" rx="3" fill="#203246"/><rect x="42" y="54" width="7" height="17" rx="3" fill="#203246"/>
<path d="M15 4 Q26 0 37 4 L44 16 L45 69 Q44 79 36 83 L16 83 Q8 79 7 69 L8 16Z" fill="var(--car-color)" stroke="#e4f1f9" stroke-width="1.6"/>
<path d="M15 10 L37 10 L40 25 L12 25Z" fill="#9ac8df" stroke="var(--car-dark)" stroke-width="1.4"/>
<path d="M12 30 L40 30 L42 56 L10 56Z" fill="#193e55" stroke="#86b9d1"/>
<path d="M12 61 L40 61 L37 75 L15 75Z" fill="#8db8cc" stroke="var(--car-dark)"/>
<path d="M12 14 L16 13 M36 13 L40 14" stroke="#f7f3df" stroke-width="3" stroke-linecap="round"/>
<path d="M12 79 L17 80 M35 80 L40 79" stroke="#f6a4a9" stroke-width="3" stroke-linecap="round"/>
</svg>`;
function markerIcon(state){
 return L.divIcon({className:'peugeot-icon',html:`<div class="peugeot-marker ${state}"><div class="peugeot-car-rotate">${state==='moving'?'<span class="direction-arrow">▲</span>':''}${carSvg}</div></div>`,iconSize:[48,75],iconAnchor:[24,38]});
}
function setState(state,bearing){
 $('state-dot').className='dot '+state;
 if(marker){
  marker.setIcon(markerIcon(state));
  const rotating=marker.getElement()?.querySelector('.peugeot-car-rotate');
  if(rotating&&Number.isFinite(Number(bearing)))rotating.style.transform=`rotate(${Number(bearing)}deg)`;
 }
}
function cancelAnimation(){if(animation!==null)cancelAnimationFrame(animation);animation=null}
function moveMarker(lat,lon){
 cancelAnimation();const start=marker.getLatLng(),begin=performance.now(),duration=1600;
 const tick=now=>{const t=Math.min(1,(now-begin)/duration),e=t*t*(3-2*t);
 marker.setLatLng([start.lat+(lat-start.lat)*e,start.lng+(lon-start.lng)*e]);
 if(t<1)animation=requestAnimationFrame(tick);else animation=null;};
 animation=requestAnimationFrame(tick);
}
function drawMap(status,state){
 const lat=Number(status.latitude),lon=Number(status.longitude);
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||!window.L)return;
 if(!map){
  map=L.map('map',{zoomControl:false}).setView([lat,lon],15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);
  L.control.zoom({position:'bottomright'}).addTo(map);
  marker=L.marker([lat,lon],{icon:markerIcon(state)}).addTo(map).bindPopup('Ultima posizione Geotab della Peugeot 2008');
 }else{
  const changed=!position||position.lat!==lat||position.lon!==lon;
  const newer=status.dateTime&&(!lastGpsTime||new Date(status.dateTime)>new Date(lastGpsTime));
  if(changed&&newer&&state==='moving')moveMarker(lat,lon);
  else if(changed){cancelAnimation();marker.setLatLng([lat,lon]);}
  if(changed&&state==='moving'&&!map.getBounds().pad(-.2).contains([lat,lon]))map.panTo([lat,lon]);
 }
 position={lat,lon};
 if(status.dateTime&&(!lastGpsTime||new Date(status.dateTime)>new Date(lastGpsTime)))lastGpsTime=status.dateTime;
 setState(state,status.bearing);
 requestAnimationFrame(()=>map.invalidateSize({pan:false}));
}
function showPanel(panel){
 const open=panel!=='map';$('drawer').hidden=!open;
 $('asset-panel').hidden=panel!=='asset';$('trips-panel').hidden=panel!=='trips';
 $('drawer-title').textContent=panel==='trips'?'Percorsi':'Asset';
 document.querySelectorAll('.nav-button').forEach(b=>{
  const active=b.dataset.panel===panel;b.classList.toggle('active',active);
  if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');
 });
 if(map)setTimeout(()=>map.invalidateSize({pan:false}),80);
}
function toggle(logged){
 signedIn=logged;$('login-panel').hidden=logged;$('dashboard').hidden=!logged;
 $('logout').hidden=!logged;$('refresh').hidden=!logged;
 if(!logged){clearTimeout(refreshTimer);cancelAnimation();showPanel('map');}
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
function render(data){
 latestData=data;const d=data.status||{},m=data.measurements||{},a=data.assetDiagnostics||{};
 text('vehicle-name',data.vehicle?.name||'Peugeot 2008');
 text('updated','Aggiornato: '+fmt(data.fetchedAt));
 const gpsFresh=fresh(d.dateTime,5);
 const speed=Number(d.speed);
 const moving=gpsFresh&&d.isDriving===true&&Number.isFinite(speed)&&speed>0;
 const engineFresh=(a.engineSpeed&&fresh(a.engineSpeed.dateTime,5))||(a.ignition&&fresh(a.ignition.dateTime,5))||(a.engineActive&&fresh(a.engineActive.dateTime,5));
 const engineOn=engineFresh&&(
  (a.engineSpeed&&fresh(a.engineSpeed.dateTime,5)&&a.engineSpeed.value>0)||
  (a.ignition&&fresh(a.ignition.dateTime,5)&&a.ignition.value===1)||
  (a.engineActive&&fresh(a.engineActive.dateTime,5)&&a.engineActive.value===1));
 const stationary=gpsFresh&&d.isDriving===false&&Number.isFinite(speed)&&speed===0;
 const state=moving?'moving':stationary&&engineOn?'idling':stationary?'stopped':'unknown';
 driving=state==='moving';
 const labels={moving:'In movimento',idling:'Motore acceso · in sosta',stopped:'Fermo',unknown:'Stato non aggiornato'};
 text('driving',labels[state]);text('speed',Number.isFinite(speed)?Math.round(speed)+' km/h':'—');
 text('gps-time','Ultimo GPS: '+fmt(d.dateTime)+(gpsFresh?'':' · storico'));
 text('asset-speed',Number.isFinite(speed)?Math.round(speed)+' km/h':'—');text('asset-speed-time',fmt(d.dateTime));
 text('communicating',d.isDeviceCommunicating===true?'Connesso':d.isDeviceCommunicating===false?'Non comunica':'—');
 text('comm-time','GPS: '+fmt(d.dateTime));
 text('engine',engineOn?'Acceso':engineFresh?'Spento / non rilevato':'Non disponibile');
 text('engine-time',a.engineSpeed?.dateTime?'Giri: '+a.engineSpeed.value+' rpm · '+fmt(a.engineSpeed.dateTime):'Ultima lettura non disponibile');
 showMeasurement('fuel','fuel-time',m.fuel,v=>Math.round(v)+' %');
 showMeasurement('battery','battery-time',m.battery,v=>v.toFixed(2)+' V');
 // Geotab DiagnosticOdometerId reports metres. Reject obviously invalid readings.
 showMeasurement('odometer','odometer-time',a.odometer,v=>v>=0?(v/1000).toLocaleString('it-IT',{maximumFractionDigits:1})+' km':'—');
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
 drawMap(d,state);
}
function schedule(){
 clearTimeout(refreshTimer);
 if(!signedIn)return;
 refreshTimer=setTimeout(()=>{if(document.visibilityState==='visible')load();else schedule()},driving?20000:90000);
}
async function load(){
 if(loading||!signedIn)return;loading=true;clearTimeout(refreshTimer);
 $('refresh').disabled=true;text('message','');
 try{
  const {data,error}=await client.functions.invoke('peugeot-api',{body:{action:'dashboard'}});
  if(error){let msg=error.message;try{msg=(await error.context?.json())?.error||msg}catch{}throw Error(msg)}
  if(data?.error)throw Error(data.error);
  render(data);text('connection','Dati aggiornati');
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
$('center-map').addEventListener('click',()=>{if(map&&position)map.setView([position.lat,position.lon],Math.max(14,map.getZoom()))});
document.querySelectorAll('.nav-button').forEach(b=>b.addEventListener('click',()=>showPanel(b.dataset.panel)));
$('close-drawer').addEventListener('click',()=>showPanel('map'));
$('lookup-address').addEventListener('click',async()=>{
 if(!position){text('address','Posizione non disponibile');return}
 $('lookup-address').disabled=true;text('address','Ricerca indirizzo…');
 try{
  // Only after user click; sends coordinates to Nominatim.
  const u=new URL('https://nominatim.openstreetmap.org/reverse');
  u.search=new URLSearchParams({lat:String(position.lat),lon:String(position.lon),format:'jsonv2',zoom:'18','accept-language':'it'});
  const r=await fetch(u,{headers:{Accept:'application/json'}});
  if(!r.ok)throw Error('Geocodifica non disponibile');
  const d=await r.json();text('address',d.display_name||'Indirizzo non disponibile');
 }catch{text('address','Indirizzo non disponibile')}
 finally{$('lookup-address').disabled=false}
});
document.addEventListener('visibilitychange',()=>{if(signedIn&&document.visibilityState==='visible')load()});
client.auth.getSession().then(async({data})=>{toggle(!!data.session);if(data.session)await load()}).catch(e=>text('message',e.message));
})();
