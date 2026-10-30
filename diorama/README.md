# Cardboard neighbourhood diorama

An interactive tabletop model of a real neighbourhood, built as stacked cardboard: every contour layer is a sheet of board, houses are paper-craft boxes, trees are faceted paper. You can pan, zoom and rotate it. Sun, sky and lights follow the real clock and date, and weather follows the live forecast. Simulated traffic drives the real street network.

Style reference: *Cardboard Racer*, zoomed out from track scale to neighbourhood scale.

## What is real and what is made up

| Layer | Source | Notes |
|---|---|---|
| Streets, footpaths, buildings, land use, water, bus stops | [Overture Maps](https://overturemaps.org) (OpenStreetMap + Microsoft ML buildings) | Read with HTTP range requests, no API key |
| Terrain | [Copernicus GLO-30 DEM](https://registry.opendata.aws/copernicus-dem/) | 30 m surface model, smoothed. Real relief, shown ×1.5 by default (switchable to true scale) |
| Tree positions and heights | [Meta/WRI 1 m canopy height](https://registry.opendata.aws/dataforgood-fb-forests/) | Picks up tall trees only; garden trees are filled in (see below) |
| Sun position, sunrise and sunset | Computed (SunCalc formulas) | In the site's time zone |
| Weather | [Open-Meteo](https://open-meteo.com) current conditions (MET Nordic) | Only when the page is hosted normally; the claude.ai artifact sandbox blocks the request |
| Leaf colour | The real date | Spring, summer, autumn or bare |
| **Approximated:** hedges and most garden trees | Derived | Hedges only along street frontages; garden trees spread per house within each street block. Real property lines are not in the open data, so none are drawn |
| **Approximated:** roof shapes and colours, wall colours, heights | Derived | From footprint shape and size; colours are a plausible Swedish mix, not observed |
| **Simulated:** traffic | Simulated | Car count follows a weekday/weekend time-of-day curve |
| Buses | Live vehicle positions (Trafiklab GTFS Regional Realtime, Swedish operators) via `relay/` | Kept on the street network; only in Live time and only on a hosted page |

## Sites

Each place is a folder `sites/<site>/`. Only `sites/example/` is in git; real sites stay local because
they pin real places, usually homes.

| File | What it holds |
|---|---|
| `site.json` | `name`, `subtitle` (shown on the page and the nameplate), `lat`/`lon` of the centre, `half` (half the plate in metres), `timezone`, and optionally `transit: { relay, site }` for live buses |
| `overrides.json` | Optional hand-modelled buildings, keyed by OpenStreetMap way id (see below) |
| `raw/`, `data.json` | Downloads and the built scene, made by the scripts |

```sh
pip install rasterio numpy scipy shapely pyarrow fsspec aiohttp requests
npm install
cp -r sites/example sites/home && $EDITOR sites/home/site.json   # set the centre
python3 scripts/make_site.py home       # downloads + builds sites/home/data.json (about a minute)
node scripts/build.mjs home             # -> dist/home/index.html (standalone) and artifact.html
```

### Hand-modelled buildings

Footprints come from the map, but how a building is roofed doesn't. `overrides.json` replaces a mapped
building with parts: boxes relative to the footprint's centroid (`dx` east, `dz` south, metres) with
`eave`, `pitch`, `roof` (`gable`, `hip`, `mono`, `flat`), colours, and extras (`dormer`, `chimney`,
`canopy`, `pergola`, `deck`, `loggia` via a `notch` cut from one corner, `vanes`). A part with
`"own": true` keeps the mapped box. `garden` clears filler trees around it and plants named ones.

### Keys and secrets

Nothing secret lives in this repo. The Trafiklab key and the site centres used for buses are Cloudflare
secrets on the relay (`relay/README.md`). Weather (Open-Meteo) and all map data need no key.

URL options on a built page: `?t=16:30` fixes the time, `?weather=snow|rain|fog|clear|partly|cloudy|storm`,
`?view=home|street|top|overview`, `?step=3` (contour layer in metres, `0` = smooth), `?exag=1.5`,
`?tilt=0`, `?style=white|felt`, `?crop=120&shape=round|square` (crop is the half-size in metres),
`?buses=<relay>`, `?busdebug` (red pins at the raw reported bus positions).

## Next

- Line numbers on buses (needs the GTFS Regional Static feed for route names).
- Lantmäteriet 1 m laser elevation and tree data in place of the 30 m DEM and the filled-in garden trees.
- Observed roof colours from orthophoto.
