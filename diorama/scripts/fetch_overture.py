"""Pull Overture Maps features inside a site's area using HTTP range reads (no S3 SDK needed).

    python3 scripts/fetch_overture.py <site>          all the layers the diorama uses"""
import os, sys, json, math, re, requests, fsspec, pyarrow.parquet as pq
from concurrent.futures import ThreadPoolExecutor
from shapely import wkb
from shapely.geometry import mapping

SITE = os.path.join(os.path.dirname(__file__), "..", "sites", sys.argv[1] if len(sys.argv) > 1 else "example")
RAW = os.path.join(SITE, "raw")
CFG = json.load(open(os.path.join(SITE, "site.json")))
LAT0, LON0, R = CFG["lat"], CFG["lon"], float(CFG.get("half", 260)) + 80
DLAT = R / 111132; DLON = R / (111320 * math.cos(math.radians(LAT0)))
BX = (LON0 - DLON, LAT0 - DLAT, LON0 + DLON, LAT0 + DLAT)
BASE = "https://overturemaps-us-west-2.s3.amazonaws.com"
def latest_release():
    t = requests.get(f"https://overturemaps-us-west-2.s3.amazonaws.com/?list-type=2&prefix=release/&delimiter=/", timeout=60).text
    return sorted(re.findall(r"<Prefix>(release/[^<]+/)</Prefix>", t))[-1].rstrip("/")
REL = os.environ.get("OVERTURE_RELEASE") or latest_release()
fs = fsspec.filesystem("http")

def keys(prefix):
    out, token = [], None
    while True:
        u = f"{BASE}/?list-type=2&prefix={prefix}" + (f"&continuation-token={requests.utils.quote(token)}" if token else "")
        t = requests.get(u, timeout=60).text
        out += re.findall(r"<Key>([^<]*\.parquet)</Key>", t)
        m = re.search(r"<NextContinuationToken>([^<]*)</NextContinuationToken>", t)
        if not m: return out
        token = m.group(1)

def hits(key):
    f = pq.ParquetFile(fs.open(f"{BASE}/{key}", block_size=1 << 20))
    md, names = f.metadata, f.schema_arrow.names
    groups = []
    for i in range(md.num_row_groups):
        rg = md.row_group(i); st = {}
        for j in range(rg.num_columns):
            c = rg.column(j)
            if c.path_in_schema.startswith("bbox.") and c.statistics and c.statistics.has_min_max:
                st[c.path_in_schema] = (c.statistics.min, c.statistics.max)
        if not st: groups.append(i); continue
        if st["bbox.xmin"][0] < BX[2] and st["bbox.xmax"][1] > BX[0] and st["bbox.ymin"][0] < BX[3] and st["bbox.ymax"][1] > BX[1]:
            groups.append(i)
    if not groups: return []
    rows = []
    for g in groups:
        tb = f.read_row_group(g).to_pylist()
        for r in tb:
            b = r["bbox"]
            if b["xmin"] < BX[2] and b["xmax"] > BX[0] and b["ymin"] < BX[3] and b["ymax"] > BX[1]:
                r["geometry"] = mapping(wkb.loads(r["geometry"]))
                rows.append(r)
    return rows

def pull(theme, typ):
    ks = keys(f"{REL}/theme={theme}/type={typ}/")
    with ThreadPoolExecutor(24) as ex:
        res = [r for rs in ex.map(hits, ks) for r in rs]
    def clean(o):
        if isinstance(o, dict): return {k: clean(v) for k, v in o.items() if v is not None}
        if isinstance(o, (list, tuple)): return [clean(v) for v in o]
        if isinstance(o, bytes): return None
        return o
    os.makedirs(RAW, exist_ok=True)
    json.dump(clean(res), open(os.path.join(RAW, f"{typ}.json"), "w"))
    print(typ, len(ks), "files ->", len(res), flush=True)

LAYERS = ["buildings/building", "transportation/segment", "base/land_use", "base/land", "base/land_cover",
          "base/water"]
if __name__ == "__main__":
    print("overture", REL)
    for spec in sys.argv[2:] or LAYERS:
        pull(*spec.split("/"))
