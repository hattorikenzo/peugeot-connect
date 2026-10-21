import { withSupabase } from 'npm:@supabase/server@1';

const DEVICE_ID = Deno.env.get('GEOTAB_DEVICE_ID') || 'b1';
const ALLOWED_USER_ID = Deno.env.get('ALLOWED_USER_ID');
const GEOTAB_DATABASE = Deno.env.get('GEOTAB_DATABASE');
const GEOTAB_USERNAME = Deno.env.get('GEOTAB_USERNAME');
const GEOTAB_PASSWORD = Deno.env.get('GEOTAB_PASSWORD');

async function rpc(host: string, method: string, params: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`https://${host}/apiv1`, {
      method: 'POST', headers: {'content-type':'application/json'},
      body: JSON.stringify({jsonrpc:'2.0',id:1,method,params}), signal:controller.signal
    });
    if (!res.ok) throw new Error(`Geotab HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(`Geotab: ${json.error.message || 'errore API'}`);
    return json.result;
  } finally { clearTimeout(timeout); }
}

function hostFromAuth(path: unknown): string {
  if (path === 'ThisServer' || !path) return 'my.geotab.com';
  if (typeof path !== 'string' || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.geotab\.com$/i.test(path)) {
    throw new Error('Host Geotab non riconosciuto');
  }
  return path;
}

export default {
  fetch: withSupabase({auth:'user'}, async (req, ctx) => {
    if (req.method !== 'POST') return Response.json({error:'Metodo non consentito'},{status:405});
    // Important: never expose Geotab to other signed-in Supabase users.
    if (!ALLOWED_USER_ID || ctx.userClaims?.id !== ALLOWED_USER_ID) {
      return Response.json({error:'Utente non autorizzato'},{status:403});
    }
    if (!GEOTAB_DATABASE || !GEOTAB_USERNAME || !GEOTAB_PASSWORD) {
      return Response.json({error:'Configurazione server incompleta'},{status:503});
    }
    try {
      const input = await req.json();
      if (input?.action !== 'dashboard') return Response.json({error:'Azione non consentita'},{status:400});
      const login = await rpc('my.geotab.com','Authenticate',{
        database:GEOTAB_DATABASE,userName:GEOTAB_USERNAME,password:GEOTAB_PASSWORD
      });
      if (!login?.credentials) throw new Error('Autenticazione Geotab non riuscita');
      const host = hostFromAuth(login.path);
      const get = (typeName:string, search:Record<string,unknown>, resultsLimit:number) =>
        rpc(host,'Get',{typeName,search,resultsLimit,credentials:login.credentials});
      const now = new Date();
      const from = new Date(now.getTime()-7*86400000).toISOString();
      const [devices,statuses,trips,samples] = await Promise.all([
        get('Device',{id:DEVICE_ID},1),
        get('DeviceStatusInfo',{deviceSearch:{id:DEVICE_ID}},1),
        get('Trip',{deviceSearch:{id:DEVICE_ID},fromDate:from},20),
        get('StatusData',{deviceSearch:{id:DEVICE_ID},fromDate:new Date(now.getTime()-6*3600000).toISOString()},100)
      ]);
      const vehicle = devices?.[0];
      if (!vehicle) return Response.json({error:'Veicolo non trovato nel database Geotab'},{status:404});
      const s = statuses?.[0] || null;
      // Strict output whitelist: never return device configuration, VIN, credentials, or arbitrary data.
      return Response.json({
        fetchedAt:now.toISOString(),
        vehicle:{name:vehicle.name,deviceType:vehicle.deviceType},
        status:s?{dateTime:s.dateTime,latitude:s.latitude,longitude:s.longitude,speed:s.speed,
          bearing:s.bearing,isDriving:s.isDriving,isDeviceCommunicating:s.isDeviceCommunicating}:null,
        trips:(trips || []).map((t:Record<string,unknown>)=>({dateTime:t.dateTime,stop:t.stop,distance:t.distance,drivingDuration:t.drivingDuration})),
        telemetry:(samples || []).slice(0,30).map((v:Record<string,unknown>)=>({dateTime:v.dateTime,data:v.data,diagnostic:v.diagnostic}))
      },{headers:{'Cache-Control':'no-store'}});
    } catch(e) {
      console.error('Peugeot API error',e instanceof Error ? e.message : 'unknown');
      return Response.json({error:'Impossibile caricare i dati Geotab. Verifica i segreti, il database e i permessi API.'},{status:502});
    }
  })
};
