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
let activeBaseLayer=null,hybridLabels=null,mapMode="standard",mapLayerError=false;
let map,marker,position=null,lastGpsTime=null,animation=null,refreshTimer=null,loading=false,signedIn=false,driving=false,latestData=null;
let mapResizeObserver=null;
const carSvg=`<svg class="peugeot-car-svg" viewBox="0 0 40 64" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Peugeot 2008 SUV vista dall’alto">
<!-- Quattro ruote e assetto rialzato -->
<rect x="1.1" y="12" width="5.5" height="13" rx="2" fill="#202832" stroke="#0d1923" stroke-width=".6"/>
<rect x="33.4" y="12" width="5.5" height="13" rx="2" fill="#202832" stroke="#0d1923" stroke-width=".6"/>
<rect x="1.1" y="40" width="5.5" height="13" rx="2" fill="#202832" stroke="#0d1923" stroke-width=".6"/>
<rect x="33.4" y="40" width="5.5" height="13" rx="2" fill="#202832" stroke="#0d1923" stroke-width=".6"/>
<!-- Silhouette SUV: muso alto, abitacolo ampio, posteriore squadrato -->
<path d="M13 2 Q20 -.1 27 2 L32 8 Q34 12 34 18 L34 50 Q34 57 30 61 Q20 64 10 61 Q6 57 6 50 L6 18 Q6 12 8 8Z" fill="var(--car-color)" stroke="#f0f6fa" stroke-width="1.4"/>
<!-- Cofano con nervature -->
<path d="M11 9 Q20 6 29 9 L30 16 L10 16Z" fill="var(--car-color)" stroke="var(--car-dark)" stroke-width=".7"/>
<path d="M13 9 L12 14 M27 9 L28 14" stroke="#ffffff" stroke-opacity=".4" stroke-width=".8"/>
<!-- Parabrezza ampio e inclinato -->
<path d="M10 18 L30 18 L29 25 Q20 27 11 25Z" fill="#a6d9ed" stroke="#274b63" stroke-width="1"/>
<path d="M12 19 L27 19" stroke="#e8faff" stroke-opacity=".7" stroke-width="1"/>
<!-- Tetto panoramico rialzato e longheroni -->
<path d="M11 27 Q20 25 29 27 L29 43 Q20 46 11 43Z" fill="var(--car-dark)" stroke="#c9e1e9" stroke-width=".8"/>
<path d="M14 29 H26 V40 H14Z" fill="#4e7687" opacity=".85"/>
<path d="M8.7 25 L8.7 47 M31.3 25 L31.3 47" stroke="#e4e9e8" stroke-width="1.4" stroke-linecap="round"/>
<!-- Lunotto e portellone -->
<path d="M11 46 Q20 48 29 46 L30 53 Q20 56 10 53Z" fill="#8db8ce" stroke="#28485d" stroke-width=".9"/>
<path d="M10 56 Q20 59 30 56" fill="none" stroke="var(--car-dark)" stroke-width="1"/>
<!-- Firma luminosa anteriore e fanali posteriori -->
<path d="M8.8 8 L12 7 M28 7 L31.2 8" stroke="#fff4cf" stroke-width="2.3" stroke-linecap="round"/>
<path d="M8.8 57 L13 59 M27 59 L31.2 57" stroke="#ff9b9b" stroke-width="2.5" stroke-linecap="round"/>
</svg>`;
function markerIcon(state){
 return L.divIcon({className:'peugeot-icon',html:`<div class="peugeot-marker ${state}"><div class="peugeot-car-rotate">${state==='moving'?'<span class="direction-arrow">▲</span>':''}${carSvg}</div></div>`,iconSize:[26,42],iconAnchor:[13,21]});
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
function resizeMap(){
 if(!map)return;
 requestAnimationFrame(()=>requestAnimationFrame(()=>{
  map.invalidateSize({pan:false,debounceMoveend:true});
 }));
}

const layerDefinitions={
 standard:{url:'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',options:{maxZoom:19,maxNativeZoom:19,subdomains:'abc',attribution:'&copy; OpenStreetMap contributors'}},
 terrain:{url:'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',options:{maxZoom:19,maxNativeZoom:17,subdomains:'abc',attribution:'&copy; OpenStreetMap contributors, SRTM | &copy; OpenTopoMap (CC-BY-SA)'}},
 satellite:{url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',options:{maxZoom:19,maxNativeZoom:19,attribution:'Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community'}},
 hybrid:{url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',options:{maxZoom:19,maxNativeZoom:19,attribution:'Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community'}}
};
function selectMapMode(mode){
 if(!map||!layerDefinitions[mode])return;
 const def=layerDefinitions[mode];
 const next=L.tileLayer(def.url,{...def.options,keepBuffer:4,updateWhenIdle:true});
 // Keep the previous map visible until the first new tiles have loaded.
 next.once('load',()=>{
  if(activeBaseLayer&&activeBaseLayer!==next)map.removeLayer(activeBaseLayer);
  activeBaseLayer=next;
  if(hybridLabels){map.removeLayer(hybridLabels);hybridLabels=null;}
  if(mode==='hybrid'){
   hybridLabels=L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',{
    subdomains:'abcd',maxZoom:19,attribution:'&copy; CARTO &copy; OpenStreetMap contributors',pane:'overlayPane'
   }).addTo(map);
  }
  mapMode=mode;
  document.querySelectorAll('input[name="map-style"]').forEach(el=>el.checked=el.value===mode);
  $('map-layer-info').textContent='';
  resizeMap();
 });
 let errors=0;
 next.on('tileerror',()=>{
  errors++;
  if(errors>=3){
   $('map-layer-info').textContent='Alcune tessere non sono disponibili: prova un altro livello.';
   if(activeBaseLayer&&activeBaseLayer!==next)map.removeLayer(next);
  }
 });
 next.addTo(map);
}

function drawMap(status,state){
 const lat=Number(status.latitude),lon=Number(status.longitude);
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||!window.L)return;
 if(!map){
  map=L.map('map',{zoomControl:false}).setView([lat,lon],15);
  selectMapMode(mapMode);
  L.control.zoom({position:'bottomright'}).addTo(map);
  marker=L.marker([lat,lon],{icon:markerIcon(state)}).addTo(map).bindPopup('Ultima posizione Geotab della Peugeot 2008');
  if(window.ResizeObserver){
   mapResizeObserver=new ResizeObserver(()=>resizeMap());
   mapResizeObserver.observe($('map'));
  }
  setTimeout(resizeMap,100);
  setTimeout(resizeMap,500);
  setTimeout(resizeMap,1300);
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
 resizeMap();
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
  // Wait for the dashboard to be painted before Leaflet measures the map.
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
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
$('layers-toggle').addEventListener('click',()=>{
 const panel=$('layers-panel');panel.hidden=!panel.hidden;
 $('layers-toggle').setAttribute('aria-expanded',String(!panel.hidden));
});
document.querySelectorAll('input[name="map-style"]').forEach(input=>input.addEventListener('change',()=>{
 if(input.checked){selectMapMode(input.value);$('layers-panel').hidden=true;$('layers-toggle').setAttribute('aria-expanded','false');}
}));
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
window.addEventListener('resize',resizeMap);
document.addEventListener('visibilitychange',()=>{if(signedIn&&document.visibilityState==='visible'){resizeMap();load()}});
client.auth.getSession().then(async({data})=>{toggle(!!data.session);if(data.session)await load()}).catch(e=>text('message',e.message));
})();
