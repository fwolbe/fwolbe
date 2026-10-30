// Cloudflare Worker: holds the Trafiklab key, fetches JLT bus positions and returns only the
// buses near the diorama, as JSON the page can read (CORS open, no key in the browser).
//
// Secrets / vars (set with wrangler, never committed):
//   TRAFIKLAB_RT_KEY  Trafiklab "GTFS Regional Realtime" key           (secret)
//   CENTER            "lat,lon" of the diorama centre                  (secret, it is a home)
//   RADIUS_M          how far out to include buses, default 1500
//   CACHE_S           seconds to reuse one Trafiklab response, default 20
import { decodeVehiclePositions } from './gtfsrt.js';

const FEED = (key) => `https://opendata.samtrafiken.se/gtfs-rt/jlt/VehiclePositions.pb?key=${encodeURIComponent(key)}`;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

function distM(aLat, aLon, bLat, bLon) {
  const k = Math.PI / 180, x = (bLon - aLon) * k * Math.cos((aLat + bLat) / 2 * k), y = (bLat - aLat) * k;
  return Math.hypot(x, y) * 6371000;
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    if (url.pathname !== '/buses') return new Response('Not found', { status: 404, headers: CORS });
    if (!env.TRAFIKLAB_RT_KEY || !env.CENTER) return json({ error: 'relay not configured: set TRAFIKLAB_RT_KEY and CENTER' }, 500);

    const ttl = Number(env.CACHE_S || 20);
    const cache = caches.default, cacheKey = new Request(url.origin + '/buses-cache');
    let res = await cache.match(cacheKey);
    if (!res) {
      const up = await fetch(FEED(env.TRAFIKLAB_RT_KEY), { headers: { 'Accept-Encoding': 'gzip' } });
      if (!up.ok) return json({ error: `trafiklab ${up.status}` }, 502);
      const all = decodeVehiclePositions(new Uint8Array(await up.arrayBuffer()));
      const [lat, lon] = env.CENTER.split(',').map(Number), R = Number(env.RADIUS_M || 1500);
      const buses = all.filter(b => distM(lat, lon, b.lat, b.lon) <= R);
      res = json({ fetched: Math.floor(Date.now() / 1000), total: all.length, buses }, 200, { 'Cache-Control': `public, max-age=${ttl}` });
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
    }
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  },
};

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS, ...extra } });
}
