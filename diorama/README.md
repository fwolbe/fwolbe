# Cardboard neighbourhood diorama

An interactive tabletop model of a real neighbourhood, built as stacked cardboard: every contour layer is a sheet of board, houses are paper-craft boxes, trees are faceted paper. You can pan, zoom and rotate it. Sun, sky and lights follow the real clock and date, and weather follows the live forecast. Simulated traffic drives the real street network.

Style reference: *Cardboard Racer*, zoomed out from track scale to neighbourhood scale.

## What is real and what is made up

| Layer | Source | Notes |
|---|---|---|
| Streets, footpaths, buildings, land use, water, bus stops | [Overture Maps](https://overturemaps.org) (OpenStreetMap + Microsoft ML buildings) | Read with HTTP range requests, no API key |
| Terrain | [Copernicus GLO-30 DEM](https://registry.opendata.aws/copernicus-dem/) | 30 m surface model, smoothed. Real relief, shown ×1.5 by default (switchable to true scale) |
| Tree positions and heights | [Meta/WRI 1 m canopy height](https://registry.opendata.aws/dataforgood-fb-forests/) | Picks up tall trees only; garden trees are filled in (see below) |
| Sun position, sunrise and sunset | Computed (SunCalc formulas) | Always in Jönköping time (Europe/Stockholm) |
| Weather | [Open-Meteo](https://open-meteo.com) current conditions (MET Nordic) | Only when the page is hosted normally; the claude.ai artifact sandbox blocks the request |
| Leaf colour | The real date | Spring, summer, autumn or bare |
| **Approximated:** hedges and most garden trees | Derived | Hedges only along street frontages; garden trees spread per house within each street block. Real property lines are not in the open data, so none are drawn |
| **Approximated:** roof shapes and colours, wall colours, heights | Derived | From footprint shape and size; colours are a plausible Swedish mix, not observed |
| **Simulated:** traffic | Simulated | Car count follows a weekday/weekend time-of-day curve |
| Buses | JLT live vehicle positions (Trafiklab GTFS Regional Realtime) via `relay/` | Only in Live time and only on a hosted page; the claude.ai artifact sandbox blocks the request |

## Build

```sh
cp config.example.json config.json      # set lat/lon of the centre and half-size in metres
pip install rasterio numpy scipy shapely pyarrow fsspec aiohttp requests
python3 scripts/fetch_rasters.py         # DEM + canopy height  -> data-raw/
cd data-raw && python3 ../scripts/fetch_overture.py buildings/building transportation/segment \
    base/land_use base/land base/land_cover base/water base/infrastructure places/place && cd ..
python3 scripts/build_data.py            # -> src/data.json
npm install && node scripts/build.mjs    # -> dist/index.html (standalone), dist/artifact.html
```

`config.json`, the raw downloads and the built data stay out of git because they pin a home location.

Styles: cardboard, architect's white model and needle felt (◧ Model menu, or `?style=white|felt`). The plate can be cropped around home from 80 m to the full 520 m, square or round; the default is a 240 m round plate with a smooth surface (`?crop=120&shape=round`, crop is the half-size in metres).

URL options on the standalone page: `?t=16:30` fixes the time, `?weather=snow|rain|fog|clear|partly|cloudy|storm`, `?view=home|street|top|overview`, `?step=3` (contour layer in metres, `0` = smooth), `?exag=1.5`, `?tilt=0`.

## Next

- Line numbers on buses (needs the GTFS Regional Static feed for route names).
- Lantmäteriet 1 m laser elevation and tree data in place of the 30 m DEM and the filled-in garden trees.
- Observed roof colours from orthophoto.
