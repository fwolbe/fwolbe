// Cloudflare Worker: holds the Trafiklab key, fetches live vehicle positions for a transit operator
// and returns only the buses near one diorama site, as JSON the page can read (CORS open, no key
// in the browser).
//
//   GET /buses?site=<site>
//
// Secrets / vars (set in Cloudflare, never committed):
//   TRAFIKLAB_RT_KEY  Trafiklab "GTFS Regional Realtime" key                         (secret)
//   SITES             JSON: { "<site>": { "center": "lat,lon", "operator": "jlt", "radius": 1500 } }
//                     (secret: sites are often homes)
//   CENTER            "lat,lon" used when no ?site= is given (older single-site setup)  (secret)
//   OPERATOR          default operator, e.g. "jlt", "sl", "ul", "skane", "otraf"       (var)
//   RADIUS_M          default radius in metres, 1500                                  (var)
//   CACHE_S           seconds to reuse one operator's feed, default 20                 (var)
//   TRAFIKVERKET_KEY  Trafikverket open API key, for /trains                          (secret)
//   TRAIN_RADIUS_M    how far out to include trains, default 4000                      (var)
//
//   GET /trains?site=<site>   live train positions near the site (Trafikverket TrainPosition)
import { decodeVehiclePositions } from './gtfsrt.js';

const FEED = (op, key) => `https://opendata.samtrafiken.se/gtfs-rt/${op}/VehiclePositions.pb?key=${encodeURIComponent(key)}`;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

function distM(aLat, aLon, bLat, bLon) {
  const k = Math.PI / 180, x = (bLon - aLon) * k * Math.cos((aLat + bLat) / 2 * k), y = (bLat - aLat) * k;
  return Math.hypot(x, y) * 6371000;
}
function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS, ...extra } });
}

function siteConfig(env, id) {
  if (id) {
    let sites = {};
    try { sites = JSON.parse(env.SITES || '{}'); } catch { return { error: 'SITES is not valid JSON' }; }
    const s = sites[id];
    if (!s) return { error: `unknown site "${id}"` };
    return { center: s.center, operator: s.operator || env.OPERATOR || 'jlt', radius: Number(s.radius || env.RADIUS_M || 1500) };
  }
  if (!env.CENTER) return { error: 'no ?site= given and no CENTER set' };
  return { center: env.CENTER, operator: env.OPERATOR || 'jlt', radius: Number(env.RADIUS_M || 1500) };
}

// one operator's decoded feed, shared by every site on it for CACHE_S seconds
async function operatorBuses(env, ctx, op, origin) {
  const ttl = Number(env.CACHE_S || 20);
  const cache = caches.default, key = new Request(`${origin}/feed-cache/${op}`);
  const hit = await cache.match(key);
  if (hit) return hit.json();
  const up = await fetch(FEED(op, env.TRAFIKLAB_RT_KEY), { headers: { 'Accept-Encoding': 'gzip' } });
  if (!up.ok) throw new Error(`trafiklab ${up.status}`);
  const all = decodeVehiclePositions(new Uint8Array(await up.arrayBuffer()));
  const body = { fetched: Math.floor(Date.now() / 1000), all };
  ctx.waitUntil(cache.put(key, new Response(JSON.stringify(body), { headers: { 'Cache-Control': `public, max-age=${ttl}` } })));
  return body;
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    if (url.pathname === '/trains') return trains(req, env, ctx, url);
    if (url.pathname !== '/buses') return new Response('Not found', { status: 404, headers: CORS });
    if (!env.TRAFIKLAB_RT_KEY) return json({ error: 'relay not configured: set TRAFIKLAB_RT_KEY' }, 500);
    const site = siteConfig(env, url.searchParams.get('site'));
    if (site.error) return json({ error: site.error }, 400);
    if (!/^[a-z0-9_-]+$/i.test(site.operator)) return json({ error: 'bad operator' }, 400);
    let feed;
    try { feed = await operatorBuses(env, ctx, site.operator, url.origin); }
    catch (e) { return json({ error: String(e.message || e) }, 502); }
    const [lat, lon] = site.center.split(',').map(Number);
    const buses = feed.all.filter(b => distM(lat, lon, b.lat, b.lon) <= site.radius);
    return json({ fetched: feed.fetched, total: feed.all.length, buses }, 200, { 'Cache-Control': 'no-store' });
  },
};

// Trains: Trafikverket's TrainPosition (GPS positions of trains on the Swedish network), filtered
// on their side to a circle around the site. Speed arrives in km/h and is returned in m/s.
const TV_URL = 'https://api.trafikinfo.trafikverket.se/v2/data.json';
async function trains(req, env, ctx, url) {
  if (!env.TRAFIKVERKET_KEY) return json({ error: 'relay not configured: set TRAFIKVERKET_KEY' }, 500);
  const site = siteConfig(env, url.searchParams.get('site'));
  if (site.error) return json({ error: site.error }, 400);
  const [lat, lon] = site.center.split(',').map(Number), radius = Number(env.TRAIN_RADIUS_M || 4000);
  const cache = caches.default, key = new Request(`${url.origin}/trains-cache/${lat.toFixed(4)},${lon.toFixed(4)},${radius}`);
  const hit = await cache.match(key);
  if (hit) return new Response(hit.body, { headers: { 'Content-Type': 'application/json', ...CORS } });
  const body = `<REQUEST><LOGIN authenticationkey="${env.TRAFIKVERKET_KEY}"/>` +
    `<QUERY objecttype="TrainPosition" namespace="järnväg.trafikinfo" schemaversion="${env.TV_SCHEMA || '1.1'}">` +
    `<FILTER><AND><EQ name="Status.Active" value="true"/>` +
    `<WITHIN name="Position.WGS84" shape="center" value="${lon} ${lat}" radius="${radius}m"/></AND></FILTER>` +
    `</QUERY></REQUEST>`;
  const up = await fetch(TV_URL, { method: 'POST', headers: { 'Content-Type': 'text/xml' }, body });
  if (!up.ok) return json({ error: `trafikverket ${up.status}`, detail: (await up.text()).slice(0, 300) }, 502);
  const res = (await up.json()).RESPONSE?.RESULT?.[0] || {};
  if (res.ERROR) return json({ error: 'trafikverket', detail: res.ERROR }, 502);
  const out = [];
  for (const t of res.TrainPosition || []) {
    const m = /POINT \(([-\d.]+) ([-\d.]+)\)/.exec(t.Position?.WGS84 || '');
    if (!m) continue;
    out.push({
      id: String(t.Train?.OperationalTrainNumber || t.Train?.AdvertisedTrainNumber || ''),
      number: t.Train?.AdvertisedTrainNumber ?? null,
      lat: Number(m[2]), lon: Number(m[1]), bearing: t.Bearing ?? null,
      speed: t.Speed != null ? t.Speed / 3.6 : null, ts: t.TimeStamp ? Math.floor(Date.parse(t.TimeStamp) / 1000) : null,
    });
  }
  const resp = json({ fetched: Math.floor(Date.now() / 1000), trains: out }, 200, { 'Cache-Control': `public, max-age=${Number(env.CACHE_S || 20)}` });
  ctx.waitUntil(cache.put(key, resp.clone()));
  return resp;
}
