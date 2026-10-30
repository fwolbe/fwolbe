# Bus relay (Cloudflare Worker)

Holds the Trafiklab key, fetches live vehicle positions (GTFS Regional Realtime) for a Swedish
transit operator and returns only the buses near a diorama site, as small JSON with CORS open.
The key never reaches the browser.

`GET /buses?site=<site>` → `{ fetched, total, buses: [{ id, lat, lon, bearing, speed, route, ts }] }`

`GET /trains?site=<site>` → `{ fetched, trains: [{ id, number, lat, lon, bearing, speed, ts }] }` from Trafikverket's
open API (`TrainPosition`: GPS positions of trains on the Swedish network, all operators). Needs
`TRAFIKVERKET_KEY` (free, from Trafikverket's open data portal); trains within `TRAIN_RADIUS_M`
(default 4000) of the site. If Trafikverket rejects the query, the response carries their error text.

## Deploy (Cloudflare connected to GitHub/GitLab)

1. Cloudflare dashboard → Workers & Pages → Create → Import a repository → this repo.
   Root directory: `diorama/relay`. Build/deploy command: `npx wrangler deploy` (the default).
2. Worker → Settings → Variables and Secrets → add, as type **Secret**:
   - `TRAFIKLAB_RT_KEY`: your Trafiklab key for **GTFS Regional Realtime** (buses)
   - `TRAFIKVERKET_KEY`: your Trafikverket open API key (trains)
   - `SITES`: one entry per diorama site, for example
     `{"home": {"center": "57.78,14.16", "operator": "jlt"}, "cabin": {"center": "59.85,17.64", "operator": "ul"}}`
     (secret, because site centres are usually homes)
3. Open `https://<worker>.<your-subdomain>.workers.dev/buses?site=home`: you should get JSON.
4. In each site's `sites/<site>/site.json` set `"transit": {"relay": "https://<worker>...", "site": "home"}`.

Operator ids are Trafiklab's (`jlt`, `sl`, `ul`, `skane`, `otraf`, `krono`, `klt`, `vt`, …). One feed per
operator is fetched at most once per `CACHE_S` seconds (default 20), however many sites and viewers
share it; raise it if your key's monthly quota is small. `CENTER` (single "lat,lon") still works for a
one-site setup without `?site=`.
