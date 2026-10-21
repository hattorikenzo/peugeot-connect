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
  let map, marker;
  const date = v => v ? new Date(v).toLocaleString('it-IT', {dateStyle:'short',timeStyle:'short'}) : '—';
  const safe = v => String(v ?? '—').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function showError(error) { $('message').textContent = error?.message || String(error); }
  function toggle(isLogged) { $('login-panel').hidden = isLogged; $('dashboard').hidden = !isLogged; $('connection').textContent = isLogged ? 'Accesso effettuato' : 'Non collegato'; }
  function renderRows(id, rows, fn) { $(id).innerHTML = rows.length ? rows.map(fn).join('') : '<div class="item">Nessun dato disponibile</div>'; }
  function drawMap(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !window.L) return;
    if (!map) { map = L.map('map').setView([lat,lon],14); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map); marker=L.marker([lat,lon]).addTo(map); }
    else { marker.setLatLng([lat,lon]); map.setView([lat,lon],14); }
    requestAnimationFrame(() => { map.invalidateSize({pan:false}); setTimeout(() => map.invalidateSize({pan:false}), 250); });
  }
  async function load() {
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
      $('vehicle-name').textContent=data?.vehicle?.name || 'Peugeot 2008';
      $('updated').textContent='Ultimo aggiornamento dashboard: '+date(data?.fetchedAt);
      $('driving').textContent=d.isDriving===true?'In movimento':d.isDriving===false?'Ferma':'Non disponibile';
      $('speed').textContent=Number.isFinite(d.speed)?`${Math.round(d.speed)} km/h`:'—';
      $('gps-time').textContent=date(d.dateTime);
      $('communicating').textContent=d.isDeviceCommunicating===true?'Sì':d.isDeviceCommunicating===false?'No':'—';
      drawMap(Number(d.latitude),Number(d.longitude));
      renderRows('trips',data?.trips || [],t=>`<div class="item"><b>${safe(date(t.dateTime))} → ${safe(date(t.stop))}</b>Distanza: ${Number.isFinite(t.distance)?(t.distance/1000).toFixed(1)+' km':'—'} · Durata: ${safe(t.drivingDuration || t.idlingDuration || '—')}</div>`);
      renderRows('telemetry',data?.telemetry || [],s=>`<div class="item"><b>${safe(s.diagnostic?.id || 'Diagnostica')}</b>Valore: ${safe(s.data)} · ${safe(date(s.dateTime))}</div>`);
      $('connection').textContent='Dati caricati';
    } catch(e) { showError(e); $('connection').textContent='Errore dati'; }
    finally { $('refresh').disabled=false; }
  }
  $('login-form').addEventListener('submit',async e=>{
    e.preventDefault(); $('message').textContent='';
    const {error}=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});
    $('password').value=''; if(error) return showError(error);
    toggle(true); await load();
  });
  $('logout').addEventListener('click',async()=>{await client.auth.signOut();toggle(false);});
  $('refresh').addEventListener('click',load);
  client.auth.getSession().then(async ({data})=>{toggle(!!data.session);if(data.session)await load();}).catch(showError);
})();
