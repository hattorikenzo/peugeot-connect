import { withSupabase } from 'npm:@supabase/server@1';

// Peugeot Connect — MyGeotab session reuse and rate-limit handling.
// Cache is per Edge Function isolate, NOT shared across instances.
const DEVICE_ID = Deno.env.get('GEOTAB_DEVICE_ID') || 'b1';
const ALLOWED_USER_ID = Deno.env.get('ALLOWED_USER_ID');
const GEOTAB_DATABASE = Deno.env.get('GEOTAB_DATABASE');
const GEOTAB_USERNAME = Deno.env.get('GEOTAB_USERNAME');
const GEOTAB_PASSWORD = Deno.env.get('GEOTAB_PASSWORD');
const STATUS_MS = 5000; // real GPS polling; UI may animate more frequently
const DEVICE_MS = 60 * 60_000;
const TRIPS_MS = 3 * 60_000;
const TELEMETRY_MS = 60_000;
const AUTH_MIN_INTERVAL_MS = 65_000; // local safety margin, not a global rate limiter

type JsonObject = Record<string, unknown>;
type Login = { credentials: JsonObject; path?: unknown };
type Entry = { value: unknown; updated: number };
class GeotabError extends Error {
  constructor(message: string, public kind: string, public retryAfterMs = 0) { super(message); }
}
const cache = new Map<string, Entry>();
const pending = new Map<string, Promise<unknown>>();
let loginCache: { host: string; credentials: JsonObject } | null = null;
let loginPending: Promise<{ host: string; credentials: JsonObject }> | null = null;
let lastAuthAttempt = 0;
let authCooldownUntil = 0;
let apiCooldownUntil = 0;

function hostFromAuth(path: unknown): string {
  if (path === 'ThisServer' || !path) return 'my.geotab.com';
  if (typeof path !== 'string' || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.geotab\.com$/i.test(path)) {
    throw new GeotabError('Host Geotab non riconosciuto', 'configuration');
  }
  return path;
}
function retryDelay(value: string | null): number {
  if (!value) return 60_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(300_000, Math.ceil(seconds * 1000) + 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(300_000, Math.max(1000, date - Date.now() + 1000)) : 60_000;
}
async function rpc(host: string, method: string, params: JsonObject, typeName = ''): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`https://${host}/apiv1`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    const error = body?.error;
    const kind = String(error?.data?.type || '');
    const message = String(error?.message || '');
    if (res.status === 429 || kind === 'OverLimitException' || /quota exceeded/i.test(message)) {
      const delay = retryDelay(res.headers.get('Retry-After'));
      if (method === 'Authenticate') authCooldownUntil = Math.max(authCooldownUntil, Date.now() + delay);
      else apiCooldownUntil = Math.max(apiCooldownUntil, Date.now() + delay);
      throw new GeotabError('Limite temporaneo API Geotab', 'rate_limit', delay);
    }
    if (!res.ok) throw new GeotabError(`HTTP ${res.status}`, res.status >= 500 ? 'transient' : 'http');
    if (error) {
      if (kind === 'InvalidUserException' && method !== 'Authenticate' && /session/i.test(message)) {
        throw new GeotabError('Sessione Geotab scaduta', 'session');
      }
      throw new GeotabError(`Geotab ${kind || 'API'}: ${message}`, kind || 'api');
    }
    return body.result;
  } catch (e) {
    if (e instanceof GeotabError) throw e;
    throw new GeotabError('Timeout o errore di rete Geotab', 'transient');
  } finally { clearTimeout(timeout); }
}
async function authenticate(force = false): Promise<{ host: string; credentials: JsonObject }> {
  if (!force && loginCache) return loginCache;
  if (loginPending) return loginPending;
  if (Date.now() < authCooldownUntil || Date.now() - lastAuthAttempt < AUTH_MIN_INTERVAL_MS) {
    throw new GeotabError('Autenticazione temporaneamente in attesa', 'rate_limit', Math.max(authCooldownUntil - Date.now(), AUTH_MIN_INTERVAL_MS - (Date.now() - lastAuthAttempt)));
  }
  lastAuthAttempt = Date.now();
  loginPending = (async () => {
    const result = await rpc('my.geotab.com', 'Authenticate', {
      database: GEOTAB_DATABASE, userName: GEOTAB_USERNAME, password: GEOTAB_PASSWORD,
    }) as Login;
    if (!result?.credentials) throw new GeotabError('Autenticazione Geotab non riuscita', 'auth');
    loginCache = { host: hostFromAuth(result.path), credentials: result.credentials };
    return loginCache;
  })();
  try { return await loginPending; } finally { loginPending = null; }
}
async function geotabGet(typeName: string, search: JsonObject, resultsLimit: number): Promise<any[]> {
  if (Date.now() < apiCooldownUntil) throw new GeotabError('Attesa limite API', 'rate_limit', apiCooldownUntil - Date.now());
  let auth = await authenticate();
  try {
    return await rpc(auth.host, 'Get', { typeName, search, resultsLimit, credentials: auth.credentials }, typeName);
  } catch (e) {
    if (!(e instanceof GeotabError) || e.kind !== 'session') throw e;
    // Authenticate only after an invalid/expired session; retry original Get exactly once.
    loginCache = null;
    auth = await authenticate(true);
    return await rpc(auth.host, 'Get', { typeName, search, resultsLimit, credentials: auth.credentials }, typeName);
  }
}
async function cachedGet(key: string, ttlMs: number, typeName: string, search: JsonObject, resultsLimit: number): Promise<{ value: any[]; stale: boolean }> {
  const existing = cache.get(key);
  if (existing && Date.now() - existing.updated < ttlMs) return { value: existing.value as any[], stale: false };
  if (!pending.has(key)) {
    const job = geotabGet(typeName, search, resultsLimit).then(value => {
      cache.set(key, { value, updated: Date.now() });
      return value;
    }).finally(() => pending.delete(key));
    pending.set(key, job);
  }
  try { return { value: await pending.get(key) as any[], stale: false }; }
  catch (e) {
    console.warn('Peugeot API partial', key, e instanceof GeotabError ? e.kind : 'unknown');
    if (existing) return { value: existing.value as any[], stale: true };
    throw e;
  }
}
function safe<T>(p: Promise<T>): Promise<{ ok: true; data: T } | { ok: false }> {
  return p.then(data => ({ ok: true as const, data }), () => ({ ok: false as const }));
}
export default {
  fetch: withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'POST') return Response.json({ error: 'Metodo non consentito' }, { status: 405 });
    if (!ALLOWED_USER_ID || ctx.userClaims?.id !== ALLOWED_USER_ID) {
      return Response.json({ error: 'Utente non autorizzato' }, { status: 403 });
    }
    if (!GEOTAB_DATABASE || !GEOTAB_USERNAME || !GEOTAB_PASSWORD) {
      return Response.json({ error: 'Configurazione server incompleta' }, { status: 503 });
    }
    try {
      const input = await req.json();
      if (input?.action !== 'dashboard') return Response.json({ error: 'Azione non consentita' }, { status: 400 });
      const now = new Date();
      const from = new Date(now.getTime() - 7 * 86400000).toISOString();
      // Independent reads: slow history cannot block current position.
      const [device, status, trip, telemetry] = await Promise.all([
        safe(cachedGet('device', DEVICE_MS, 'Device', { id: DEVICE_ID }, 1)),
        safe(cachedGet('status', STATUS_MS, 'DeviceStatusInfo', { deviceSearch: { id: DEVICE_ID } }, 1)),
        safe(cachedGet('trips', TRIPS_MS, 'Trip', { deviceSearch: { id: DEVICE_ID }, fromDate: from }, 20)),
        safe(cachedGet('telemetry', TELEMETRY_MS, 'StatusData', { deviceSearch: { id: DEVICE_ID }, fromDate: new Date(now.getTime() - 6 * 3600000).toISOString() }, 100)),
      ]);
      const devices = device.ok ? device.data.value : (cache.get('device')?.value as any[] || []);
      const statuses = status.ok ? status.data.value : (cache.get('status')?.value as any[] || []);
      const trips = trip.ok ? trip.data.value : (cache.get('trips')?.value as any[] || []);
      const samples = telemetry.ok ? telemetry.data.value : (cache.get('telemetry')?.value as any[] || []);
      const vehicle = devices?.[0];
      const s = statuses?.[0] || null;
      if (!vehicle && !s) {
        console.error('Peugeot API error', 'Nessun dato disponibile; verificare quota, autenticazione e permessi');
        return Response.json({ error: 'Dati Geotab temporaneamente non disponibili. Riprova tra poco.' }, { status: 503, headers: { 'Retry-After': '30' } });
      }
      return Response.json({
        fetchedAt: now.toISOString(),
        vehicle: vehicle ? { name: vehicle.name, deviceType: vehicle.deviceType } : null,
        status: s ? { dateTime: s.dateTime, latitude: s.latitude, longitude: s.longitude, speed: s.speed,
          bearing: s.bearing, isDriving: s.isDriving, isDeviceCommunicating: s.isDeviceCommunicating } : null,
        trips: (trips || []).map((t: any) => ({ dateTime: t.dateTime, stop: t.stop, distance: t.distance, drivingDuration: t.drivingDuration })),
        telemetry: (samples || []).slice(0, 30).map((v: any) => ({ dateTime: v.dateTime, data: v.data, diagnostic: v.diagnostic })),
        stale: !status.ok || (status.ok && status.data.stale),
        partial: !device.ok || !status.ok || !trip.ok || !telemetry.ok,
      }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (e) {
      console.error('Peugeot API error', e instanceof GeotabError ? e.kind : 'unknown');
      return Response.json({ error: 'Impossibile caricare i dati Geotab.' }, { status: 502 });
    }
  }),
};
