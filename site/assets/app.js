(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const config = window.PEUGEOT_CONFIG;
  if (!config || config.supabaseUrl.includes('YOUR-') || config.supabasePublishableKey.includes('YOUR_')) {
    $('message').textContent = 'Configurazione mancante: crea site/config.js usando config.example.js.';
    return;
  }
  if (!window.supabase) { $('message').textContent = 'Libreria Supabase non caricata.'; return; }
  const client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
  let map, marker, lastPosition = null;
  let markerAnimation = null, refreshTimer = null, loading = false, signedIn = false;
  let latestDriving = false, lastGpsTimestamp = null;
  const MOVE_REFRESH_MS = 20000;
  const PARKED_REFRESH_MS = 90000;
  const iconMarkup = `<div class="peugeot-marker" aria-label="Peugeot 2008 blu">
    <div class="peugeot-car-rotate">
      <svg class="peugeot-car-svg" viewBox="0 0 52 88" role="img" aria-label="Peugeot 2008 blu vista dall'alto" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="26" cy="45" rx="19" ry="39" fill="#00142b" opacity=".25"/>
        <rect x="3" y="17" width="7" height="18" rx="3" fill="#172b42"/><rect x="42" y="17" width="7" height="18" rx="3" fill="#172b42"/>
        <rect x="3" y="55" width="7" height="17" rx="3" fill="#172b42"/><rect x="42" y="55" width="7" height="17" rx="3" fill="#172b42"/>
        <path d="M15 4 Q26 0 37 4 L44 16 L45 69 Q44 79 36 83 L16 83 Q8 79 7 69 L8 16Z" fill="#1762bd" stroke="#d3e9ff" stroke-width="1.7"/>
        <path d="M15 9 L37 9 L40 24 L12 24Z" fill="#a4d4f4" stroke="#113c72" stroke-width="1.5"/>
        <path d="M12 29 L40 29 L42 55 L10 55Z" fill="#07375c" stroke="#6ba8d8" stroke-width="1.2"/>
        <path d="M12 61 L40 61 L37 75 L15 75Z" fill="#82b8e0" stroke="#0e4174" stroke-width="1.2"/>
        <path d="M17 4 L35 4" stroke="#e8f6ff" stroke-width="3" stroke-linecap="round"/>
        <path d="M11 13 L16 12 M36 12 L41 13" stroke="#f8f5df" stroke-width="3" stroke-linecap="round"/>
        <path d="M12 78 L18 80 M34 80 L40 78" stroke="#ed4e5e" stroke-width="3" stroke-linecap="round"/>
        <path d="M26 28 L26 55" stroke="#2475bf" stroke-width="1.5" opacity=".7"/>
      </svg>
    </div>
  </div>`;
  function vehicleIcon() { return L.divIcon({className:'peugeot-icon',html:iconMarkup,iconSize:[52,88],iconAnchor:[26,44]}); }
  function rotateMarker(bearing) {
    if (!marker || !Number.isFinite(Number(bearing))) return;
    const car = marker.getElement()?.querySelector('.peugeot-car-rotate');
    if (car) car.style.transform = `rotate(${Number(bearing)}deg)`;
  }
  function cancelMarkerAnimation() { if (markerAnimation !== null) cancelAnimationFrame(markerAnimation); markerAnimation = null; }
  function animateMarker(target, duration=1400) {
    cancelMarkerAnimation();
    const start = marker.getLatLng();
    const begin = performance.now();
    function frame(now) {
      const t = Math.min(1,(now-begin)/duration);
      const eased = t*t*(3-2*t);
      marker.setLatLng([start.lat+(target.lat-start.lat)*eased,start.lng+(target.lon-start.lng)*eased]);
      if (t < 1) markerAnimation = requestAnimationFrame(frame);
      else markerAnimation = null;
    }
    markerAnimation = requestAnimationFrame(frame);
  }
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    if (!signedIn) return;
    refreshTimer = setTimeout(() => {
      if (document.visibilityState === 'visible') load();
      else scheduleRefresh();
    }, latestDriving ? MOVE_REFRESH_MS : PARKED_REFRESH_MS);
  }
  const date = v => v ? new Date(v).toLocaleString('it-IT', {dateStyle:'short',timeStyle:'short'}) : '—';
  const safe = v => String(v ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function showError(error) { $('message').textContent = error?.message || String(error); }
  function toggle(isLogged) { signedIn = isLogged; if (!isLogged) { clearTimeout(refreshTimer); cancelMarkerAnimation(); } $('login-panel').hidden = isLogged; $('dashboard').hidden = !isLogged; $('connection').textContent = isLogged ? 'Accesso effettuato' : 'Non collegato'; }
  function renderRows(id, rows, fn) { $(id).innerHTML = rows.length ? rows.map(fn).join('') : '<div class="item">Nessun dato disponibile</div>'; }
  function drawMap(lat, lon, bearing, gpsTime, driving) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !window.L) return;
    if (!map) {
      map = L.map('map').setView([lat,lon],15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);
      marker = L.marker([lat,lon],{icon:vehicleIcon(),keyboard:true}).addTo(map).bindPopup('Ultima posizione Geotab della Peugeot 2008');
    } else {
      const changed = !lastPosition || lastPosition.lat !== lat || lastPosition.lon !== lon;
      // Animate only genuinely newer GPS coordinates; never invent a position.
      const newTimestamp = gpsTime && (!lastGpsTimestamp || new Date(gpsTime) > new Date(lastGpsTimestamp));
      if (changed && newTimestamp && driving) animateMarker({lat,lon});
      else if (changed) { cancelMarkerAnimation(); marker.setLatLng([lat,lon]); }
      if (changed && driving && !map.getBounds().pad(-0.2).contains([lat,lon])) map.panTo([lat,lon]);
    }
    rotateMarker(bearing);
    lastPosition = {lat,lon};
    if (gpsTime && (!lastGpsTimestamp || new Date(gpsTime) > new Date(lastGpsTimestamp))) lastGpsTimestamp = gpsTime;
    requestAnimationFrame(() => { map.invalidateSize({pan:false}); setTimeout(() => map.invalidateSize({pan:false}),250); });
  }
  async function load() {
    if (loading || !signedIn) return;
    loading = true;
    clearTimeout(refreshTimer);
    $('message').textContent = '';
    $('refresh').disabled = true;
    try {
      const {data,error} = await client.functions.invoke('peugeot-api',{body:{action:'dashboard'}});
      if (error) {
        let detail = error.message;
        try { const payload = await error.context?.json(); detail = payload?.error || detail; } catch { /* keep original */ }
        throw new Error(detail);
      }
      if (data?.error) throw new Error(data.error);
      const d=data?.status || {};
      latestDriving = d.isDriving === true;
      $('vehicle-name').textContent=data?.vehicle?.name || 'Peugeot 2008';
      $('updated').textContent='Ultimo aggiornamento dashboard: '+date(data?.fetchedAt);
      $('driving').textContent=d.isDriving===true?'In movimento':d.isDriving===false?'Ferma':'Non disponibile';
      $('speed').textContent=Number.isFinite(d.speed)?`${Math.round(d.speed)} km/h`:'—';
      $('gps-time').textContent=date(d.dateTime);
      $('communicating').textContent=d.isDeviceCommunicating===true?'Sì':d.isDeviceCommunicating===false?'No':'—';
      if (d.latitude != null && d.longitude != null && Number.isFinite(Number(d.latitude)) && Number.isFinite(Number(d.longitude))) {
        const changed = !lastPosition || lastPosition.lat !== Number(d.latitude) || lastPosition.lon !== Number(d.longitude);
        drawMap(Number(d.latitude),Number(d.longitude),d.bearing,d.dateTime,latestDriving);
        if (changed) $('address').textContent = 'Indirizzo non richiesto';
      }
      const measurements = data?.measurements || {};
      const renderMeasurement = (id, timeId, m, formatter) => {
        $(id).textContent = m && Number.isFinite(m.value) ? formatter(m.value) : 'Non disponibile';
        $(timeId).textContent = m?.dateTime ? 'Rilevato: '+date(m.dateTime)+(Date.now()-new Date(m.dateTime).getTime()>24*3600000?' · Dato storico':'') : 'Nessun campione disponibile';
      };
      renderMeasurement('fuel','fuel-time',measurements.fuel,v=>Math.round(v)+' %');
      renderMeasurement('battery','battery-time',measurements.battery,v=>v.toFixed(2)+' V');
      const doorState = (id,timeId,m) => {
        $(id).textContent = m && (m.value===0 || m.value===1) ? (m.value===1?'Aperta (segnale singolo)':'Chiusa (segnale singolo)') : 'Non disponibile';
        $(timeId).textContent = m?.dateTime ? 'Rilevato: '+date(m.dateTime)+(Date.now()-new Date(m.dateTime).getTime()>24*3600000?' · Dato storico':'') : 'Nessun campione disponibile';
      };
      doorState('doors','doors-time',measurements.doors);
      doorState('hatch','hatch-time',measurements.hatch);
      // v0.8: show all five access signals from the full seven-day window.
      // Values 0/1 are interpreted provisionally; never label as live state.
      const access = Array.isArray(data?.accessDiagnostics) ? data.accessDiagnostics : [];
      const accessNames = {driver:'Conducente',passenger:'Passeggero',rearRight:'Posteriore destra',rearLeft:'Posteriore sinistra',cargoHatchCandidate:'Portellone (da confermare)'};
      const accessIcons = {driver:'🚪',passenger:'🚪',rearRight:'🚪',rearLeft:'🚪',cargoHatchCandidate:'🚙'};
      const accessHtml = access.map(x => {
        const hasValue = x.latestValue === 0 || x.latestValue === 1;
        const age = x.latestDateTime ? Math.max(0, Date.now() - new Date(x.latestDateTime).getTime()) : Infinity;
        const historical = age > 24 * 3600000;
        const valueLabel = !hasValue ? 'Nessuna lettura' : (x.latestValue === 1 ? '1 · probabile apertura' : '0 · probabile chiusura');
        const extra = x.confirmedIdentity === false ? ' · Identità del segnale da confermare' : '';
        return `<article class="access-card">
          <div class="access-card-head"><span aria-hidden="true">${accessIcons[x.key] || '🚪'}</span><b>${safe(accessNames[x.key] || x.description)}</b></div>
          <strong>${safe(valueLabel)}</strong>
          <small>Ultima lettura: ${safe(date(x.latestDateTime))}${historical ? ' · Dato storico' : ' · Lettura entro 24 ore'}${extra}</small>
          <small>Campioni negli ultimi 7 giorni: ${safe(x.sampleCount ?? 0)}</small>
        </article>`;
      }).join('');
      $('access-signals').innerHTML = accessHtml || '<div class="item">Diagnostiche delle porte non disponibili: aggiornare la funzione peugeot-api alla v0.7 o successiva.</div>';
      // Avoid showing misleading legacy single-door/hatch labels.
      $('doors').textContent = access.length ? '4 segnali' : 'Non disponibile';
      $('doors-time').textContent = access.length ? 'Vedi le ultime letture sotto' : 'Nessun campione disponibile';
      const cargo = access.find(x => x.key === 'cargoHatchCandidate');
      $('hatch').textContent = cargo?.sampleCount ? 'Segnale rilevato' : 'Non disponibile';
      $('hatch-time').textContent = cargo?.latestDateTime ? 'Ultima lettura: '+date(cargo.latestDateTime)+' · Da confermare' : 'Nessun campione disponibile';
      renderRows('trips',data?.trips || [],t=>`<div class="item"><b>${safe(date(t.start || t.dateTime))} → ${safe(date(t.stop))}</b><div class="trip-meta">${Number.isFinite(t.distance)?(t.distance/1000).toFixed(1)+' km':'Distanza non disponibile'} · Durata: ${safe(t.drivingDuration || '—')}</div></div>`);
      renderRows('telemetry',data?.telemetry || [],s=>`<div class="item"><b>${safe(s.diagnostic?.name || s.diagnostic?.id || 'Diagnostica')}</b>Valore: ${safe(s.data)} · ${safe(date(s.dateTime))}</div>`);
      $('connection').textContent='Dati caricati';
    } catch(e) { showError(e); $('connection').textContent='Errore dati'; }
    finally { loading=false; $('refresh').disabled=false; scheduleRefresh(); }
  }
  $('login-form').addEventListener('submit',async e=>{
    e.preventDefault(); $('message').textContent='';
    const {error}=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});
    $('password').value=''; if(error) return showError(error);
    toggle(true); await load();
  });
  $('logout').addEventListener('click',async()=>{await client.auth.signOut();toggle(false);});
  $('refresh').addEventListener('click',load);
  $('lookup-address').addEventListener('click', async () => {
    if (!lastPosition) { $('address').textContent = 'Posizione GPS non disponibile'; return; }
    $('lookup-address').disabled = true;
    $('address').textContent = 'Ricerca indirizzo…';
    try {
      // Only on explicit click: this sends GPS coordinates to OpenStreetMap Nominatim.
      const url = new URL('https://nominatim.openstreetmap.org/reverse');
      url.search = new URLSearchParams({lat:String(lastPosition.lat),lon:String(lastPosition.lon),format:'jsonv2',zoom:'18', 'accept-language':'it'}).toString();
      const response = await fetch(url, {headers:{Accept:'application/json'}});
      if (!response.ok) throw new Error('Geocodifica non disponibile');
      const result = await response.json();
      $('address').textContent = result.display_name || 'Indirizzo non disponibile';
    } catch { $('address').textContent = 'Indirizzo non disponibile: riprova più tardi'; }
    finally { $('lookup-address').disabled = false; }
  });
  document.addEventListener('visibilitychange', () => { if (signedIn && document.visibilityState === 'visible') { clearTimeout(refreshTimer); load(); } });
  client.auth.getSession().then(async ({data})=>{toggle(!!data.session);if(data.session)await load();}).catch(showError);
})();
