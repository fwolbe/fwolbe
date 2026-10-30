# Bus relay (Cloudflare Worker)

Holds the Trafiklab key, fetches JLT's live vehicle positions (GTFS Regional Realtime) and returns
only the buses near the diorama as small JSON with CORS open. The key never reaches the browser.

`GET /buses` → `{ fetched, total, buses: [{ id, lat, lon, bearing, speed, route, ts }] }`

## Deploy (Cloudflare connected to GitHub)

1. Cloudflare dashboard → Workers & Pages → Create → Import a repository → this repo.
   Root directory: `diorama/relay`. Build/deploy command: `npx wrangler deploy` (the default).
2. Worker → Settings → Variables and Secrets → add, as type **Secret**:
   - `TRAFIKLAB_RT_KEY`: your Trafiklab key for **GTFS Regional Realtime**
   - `CENTER`: `lat,lon` of the diorama centre (kept secret because it is a home)
3. Open `https://bymarken-buses.<your-subdomain>.workers.dev/buses`: you should get JSON.
4. Put that origin in `../config.json` as `"busRelay"` and rebuild, or open the page with `?buses=<origin>`.

`RADIUS_M` (default 1500) and `CACHE_S` (default 20) are plain vars in `wrangler.toml`. The cache keeps
calls to Trafiklab to at most one per 20 s however many people watch; raise it if your key's monthly
quota is small.
