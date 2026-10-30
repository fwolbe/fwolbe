"""Download elevation (Copernicus GLO-30) and 1 m canopy height (Meta/WRI) around a site's centre.

    python3 scripts/fetch_rasters.py <site>"""
import os, json, math, sys, urllib.request
import numpy as np, rasterio
from rasterio.windows import from_bounds
from rasterio.warp import transform_bounds

HERE = os.path.dirname(__file__)
SITE = os.path.join(HERE, "..", "sites", sys.argv[1] if len(sys.argv) > 1 else "example")
RAW = os.path.join(SITE, "raw")
CFG = json.load(open(os.path.join(SITE, "site.json")))
lat0, lon0, R = CFG["lat"], CFG["lon"], float(CFG.get("half", 260)) * 1.6
os.makedirs(RAW, exist_ok=True)

lat_t, lon_t = math.floor(lat0), math.floor(lon0)
name = f"Copernicus_DSM_COG_10_N{lat_t:02d}_00_E{lon_t:03d}_00_DEM"
dem = os.path.join(RAW, "cop30.tif")
if not os.path.exists(dem):
    urllib.request.urlretrieve(f"https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif", dem)

def quadkey(lat, lon, z):
    n = 2 ** z; x = int((lon + 180) / 360 * n)
    y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
    return "".join(str(((x >> (i - 1)) & 1) + 2 * ((y >> (i - 1)) & 1)) for i in range(z, 0, -1))

dlat = R / 111132; dlon = R / (111320 * math.cos(math.radians(lat0)))
b = (lon0 - dlon, lat0 - dlat, lon0 + dlon, lat0 + dlat)
os.environ["GDAL_DISABLE_READDIR_ON_OPEN"] = "EMPTY_DIR"
url = f"/vsicurl/https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm/{quadkey(lat0, lon0, 9)}.tif"
with rasterio.open(url) as s:
    bb = transform_bounds("EPSG:4326", s.crs, *b)
    a = s.read(1, window=from_bounds(*bb, s.transform))
np.save(os.path.join(RAW, "chm.npy"), a)
json.dump({"bounds": bb, "crs": "EPSG:3857", "b4326": b}, open(os.path.join(RAW, "chm.json"), "w"))
print("dem", dem, "chm", a.shape)
