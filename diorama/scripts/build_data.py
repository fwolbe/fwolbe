"""Turn raw downloads (Copernicus DEM, Meta canopy height, Overture Maps) into one compact
scene file in local metres: x = east, z = south, origin at home."""
import json, math, hashlib, os
import numpy as np, rasterio
from rasterio.windows import from_bounds
from scipy import ndimage
from shapely.geometry import shape, Polygon, MultiPolygon, LineString, box, Point
from shapely.ops import unary_union
from shapely.prepared import prep

HERE = os.path.dirname(__file__)
RAW = os.path.join(HERE, "..", "data-raw")
OUT = os.path.join(HERE, "..", "src", "data.json")

CFG = json.load(open(os.path.join(os.path.dirname(__file__), "..", "config.json")))
LAT0, LON0 = CFG["lat"], CFG["lon"]
H = float(CFG.get("half", 260))   # half size of the diorama, metres
CELL = 2.0                     # terrain grid resolution, metres
MY = 111132.0
MX = 111320.0 * math.cos(math.radians(LAT0))
CLIP = box(-H, -H, H, H)

def to_local(lon, lat):
    return ((lon - LON0) * MX, -(lat - LAT0) * MY)

def to_ll(x, z):
    return (LON0 + x / MX, LAT0 - z / MY)

def h01(s):
    return int(hashlib.md5(s.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF

def local_geom(g):
    def ring(cs): return [to_local(*c[:2]) for c in cs]
    t = g["type"]
    if t == "Polygon":
        return Polygon(ring(g["coordinates"][0]), [ring(r) for r in g["coordinates"][1:]])
    if t == "MultiPolygon":
        return MultiPolygon([Polygon(ring(p[0]), [ring(r) for r in p[1:]]) for p in g["coordinates"]])
    if t == "LineString":
        return LineString(ring(g["coordinates"]))
    if t == "Point":
        return Point(to_local(*g["coordinates"][:2]))
    raise ValueError(t)

def rnd(v, d=2):
    return round(float(v), d)

def coords(geom):
    return [[rnd(x), rnd(y)] for x, y in geom.coords]

def polys(geom):
    if geom.is_empty: return []
    if geom.geom_type == "Polygon": geom = [geom]
    elif geom.geom_type in ("MultiPolygon", "GeometryCollection"):
        geom = [g for g in geom.geoms if g.geom_type == "Polygon"]
    else: return []
    return [{"o": coords(p.exterior), "h": [coords(r) for r in p.interiors]} for p in geom if p.area > 1]

def load(name):
    return json.load(open(os.path.join(RAW, name + ".json")))

# ---------------------------------------------------------------- terrain
n = int(2 * H / CELL) + 1
xs = np.linspace(-H, H, n)
gx, gz = np.meshgrid(xs, xs)               # row = z, col = x
lon, lat = to_ll(gx, gz)
with rasterio.open(os.path.join(RAW, "cop30.tif")) as s:
    pad = 0.02
    w = from_bounds(lon.min() - pad, lat.min() - pad, lon.max() + pad, lat.max() + pad, s.transform)
    dem = s.read(1, window=w).astype(np.float64)
    tr = s.window_transform(w)
    inv = ~tr
    col, row = inv * (lon, lat)
    # DSM cells average roofs and canopy in; a light pre-smooth keeps hills, drops bumps
    dem = ndimage.gaussian_filter(dem, 0.6)
    height = ndimage.map_coordinates(dem, [row - 0.5, col - 0.5], order=3, mode="nearest")
height = ndimage.gaussian_filter(height, 3.0)
hmin = float(height.min())
terrain = {"n": n, "cell": CELL, "size": 2 * H, "min": rnd(hmin), "max": rnd(height.max()),
           "h": [rnd(v - hmin, 2) for v in height.ravel()]}
print("terrain", n, "x", n, "relief", round(height.max() - hmin, 1), "m")

# ---------------------------------------------------------------- buildings
def obb(p):
    r = p.minimum_rotated_rectangle
    c = list(r.exterior.coords)[:4]
    e0 = (c[1][0] - c[0][0], c[1][1] - c[0][1]); e1 = (c[2][0] - c[1][0], c[2][1] - c[1][1])
    l0, l1 = math.hypot(*e0), math.hypot(*e1)
    if l0 < l1: e0, l0, l1 = e1, l1, l0
    return {"cx": rnd(r.centroid.x), "cz": rnd(r.centroid.y), "len": rnd(l0), "wid": rnd(l1),
            "ang": rnd(math.atan2(e0[1], e0[0]), 4)}, (p.area / r.area if r.area else 0)

ROOF_COLOURS = [("tile", 0.50), ("darktile", 0.22), ("black", 0.18), ("grey", 0.10)]
WALL_COLOURS = [("white", .34), ("cream", .18), ("yellow", .16), ("falu", .10), ("grey", .10), ("blue", .06), ("green", .06)]
def pick(table, u):
    acc = 0
    for k, w in table:
        acc += w
        if u <= acc: return k
    return table[-1][0]

buildings = []
raw_ids = []
fp_union = []
for b in load("building"):
    if b.get("is_underground"): continue
    g = local_geom(b["geometry"]).intersection(CLIP)
    if g.is_empty or g.area < 6: continue
    if g.geom_type == "MultiPolygon": g = max(g.geoms, key=lambda q: q.area)
    g = g.simplify(0.25)
    fp_union.append(g)
    cls = b.get("class") or ""
    area = g.area
    box_, rect = obb(g)
    floors = b.get("num_floors")
    if cls == "church":
        kind, eave, pitch = "church", 9.0, 40
    elif cls in ("garage", "garages", "shed") or area < 45:
        kind, eave, pitch = "shed", 2.7, 12 if area < 30 else 18
    elif cls == "apartments" or area > 330:
        kind, eave, pitch = "block", (floors or 3) * 3.0, 20
    else:
        kind, eave, pitch = "house", (floors or 1.5) * 3.0 + 0.5, 34
    if floors and kind != "church":
        eave = floors * 3.0
    u = h01(b["id"])
    roof = "gable"
    if kind == "shed": roof = "mono" if u < .5 else "gable"
    elif box_["len"] / max(box_["wid"], .1) < 1.22: roof = "hip"
    elif kind == "block" and u < .35: roof = "flat"
    rec = {"id": b["id"][-8:], "kind": kind, "eave": rnd(eave, 1), "pitch": pitch, "roof": roof,
           "rect": rnd(rect, 3), "obb": box_, "fp": polys(g)[0]["o"] if polys(g) else None,
           "rc": pick(ROOF_COLOURS, h01(b["id"] + "r")), "wc": pick(WALL_COLOURS, h01(b["id"] + "w")),
           "seed": rnd(u, 4)}
    if kind == "church": rec["rc"], rec["wc"] = "copper", "brick"
    if rec["fp"]:
        buildings.append(rec); raw_ids.append(b["sources"][0].get("record_id", "").split("@")[0])
# Hand-modelled buildings: footprints alone can't say how a building is roofed. Parts are boxes
# relative to the footprint centroid (dx east, dz south, metres); ridges run along "len".
OVERRIDES = {
    # Bymarkskyrkan, from street-level photos: white rendered walls on a dark plinth, steep
    # red-brown tile gables, a taller west part, a lower east part, a gabled north porch,
    # a flat-roofed annex to the south, no tower.
    "w149877159": [
        {"dx": -5.35, "dz": -2.6, "len": 12.5, "wid": 12.4, "ang": 0, "eave": 6.6, "pitch": 54, "roof": "gable", "vanes": True, "chimney": True},
        {"dx": 5.15, "dz": -2.15, "len": 8.5, "wid": 12.1, "ang": 0, "eave": 4.8, "pitch": 52, "roof": "gable", "vanes": True},
        {"dx": .55, "dz": -11.3, "len": 5.4, "wid": 5.9, "ang": 1.5708, "eave": 3.6, "pitch": 52, "roof": "gable", "vanes": True},
        {"dx": 2.05, "dz": 7.65, "len": 17.5, "wid": 7.5, "ang": 0, "eave": 3.8, "pitch": 0, "roof": "flat"},
    ],
    # 31B, from street-level and drone photos: two storeys on a dark plinth, light greige render,
    # grey window surrounds, an anthracite hip roof with a street-side dormer and two chimneys,
    # a flat canopy over the double front door, a two-storey loggia cut into the south-east corner
    # and opening east (balcony above, covered patio below), a raised wooden deck with screens in
    # front of it to the east, and a freestanding pergola over the steps south-west of the house.
    # Extras are placed in the box's frame: s along its length (east), t across it (south).
    "w1179895567": [
        {"own": True, "eave": 6.3, "pitch": 27, "roof": "hip", "kind": "custom", "rc": "anthracite", "wc": "greige", "seed": 20.4,
         "gref": [-6.0, 0.0], "notch": {"corner": "se", "ds": 1.9, "dt": 4.4},
         "extras": [
             {"type": "dormer", "s": -3.6, "t": 0.0, "w": 1.9},
             {"type": "chimney", "s": 0.4, "t": -1.4, "w": .9, "up": .9},
             {"type": "chimney", "s": -1.4, "t": -2.2, "w": .55, "up": .6, "vane": True},
             {"type": "canopy", "s": -6.06, "t": 0.0, "w": 3.2, "d": 1.4, "y": 3.1},
             {"type": "loggia", "y": 3.3},
             {"type": "deck", "s": 7.41, "t": 4.3, "w": 6.5, "d": 6.2, "y": .55, "open": "west"},
             {"type": "pergola", "s": -7.6, "t": 9.0, "w": 4.2, "d": 3.2, "y": 2.5},
         ],
         # the garden as photographed: clear the random filler, keep it mostly lawn, add the
         # row of columnar conifers and the red Japanese maples by the front door
         "garden": {"clear": 16, "plant": [
             [-8.0, -6.6, 2.6, .55, "thuja"], [-8.0, -5.5, 2.8, .55, "thuja"], [-8.0, -4.4, 2.6, .55, "thuja"], [-8.0, -3.3, 2.7, .55, "thuja"],
             [-8.6, -1.4, 1.9, 1.5, "maple"], [-7.6, 2.6, 1.7, 1.3, "maple"],
             [-12.5, -9.5, 7.5, 2.2, "spruce"], [12.5, 8.5, 6.5, 3.0, "fruit"],
         ]}},
    ],
}
for src, parts in OVERRIDES.items():
    hit = next((i for i, b in enumerate(raw_ids) if b == src), None)
    if hit is None: continue
    base = buildings[hit]
    c = Polygon(base["fp"]).centroid
    del buildings[hit]; del raw_ids[hit]
    for k, pt in enumerate(parts):
        if pt.get("own"):   # keep the mapped footprint's own box
            o = base["obb"]; pt = {**pt, "dx": o["cx"] - c.x, "dz": o["cz"] - c.y, "len": o["len"], "wid": o["wid"], "ang": o["ang"]}
        cx, cz = c.x + pt["dx"], c.y + pt["dz"]
        g = pt.get("gref", [0, 0])
        rec = {"id": f'{base["id"]}-{k}', "kind": pt.get("kind", "chapel"), "eave": pt["eave"], "pitch": pt["pitch"], "roof": pt["roof"], "rect": 1.0,
               "obb": {"cx": rnd(cx), "cz": rnd(cz), "len": pt["len"], "wid": pt["wid"], "ang": pt["ang"]},
               "rc": pt.get("rc", "redtile"), "wc": pt.get("wc", "white"), "seed": pt.get("seed", 10 + k * .1),
               "g": [rnd(cx + g[0]), rnd(cz + g[1])] if "gref" in pt else [rnd(c.x), rnd(c.y)],
               "vanes": pt.get("vanes", False), "chimney": pt.get("chimney", False), "extras": pt.get("extras", []), "name": base.get("name")}
        if "notch" in pt:
            # walls follow the box with one corner cut out (the roof still covers it)
            n, L2, W2 = pt["notch"], pt["len"] / 2, pt["wid"] / 2
            ss, tt = (1 if "e" in n["corner"] else -1), (1 if "s" in n["corner"] else -1)
            walls = [[-L2, -W2], [L2, -W2], [L2, W2], [-L2, W2]]
            i = walls.index([ss * L2, tt * W2])
            cut = [[ss * L2, tt * (W2 - n["dt"])], [ss * (L2 - n["ds"]), tt * (W2 - n["dt"])], [ss * (L2 - n["ds"]), tt * W2]]
            if (ss * tt) < 0: cut = cut[::-1]
            rec["walls"] = [[rnd(a), rnd(b)] for a, b in walls[:i] + cut + walls[i + 1:]]
            rec["notch"] = n
        L, W, a = pt["len"] / 2, pt["wid"] / 2, pt["ang"]
        ux, uz, vx, vz = math.cos(a), math.sin(a), -math.sin(a), math.cos(a)
        rec["fp"] = [[rnd(cx + sx * ux * L + sy * vx * W), rnd(cz + sx * uz * L + sy * vz * W)] for sx, sy in [(-1, -1), (1, -1), (1, 1), (-1, 1), (-1, -1)]]
        buildings.append(rec); raw_ids.append(src)
fp = prep(unary_union(fp_union).buffer(1.0))
print("buildings", len(buildings))

# ---------------------------------------------------------------- roads
WIDTH = {"primary": 9, "secondary": 8, "tertiary": 7.5, "residential": 6.0, "unclassified": 5.5,
         "living_street": 5, "service": 3.6, "footway": 2.0, "path": 1.6, "cycleway": 2.4, "steps": 2.0,
         "pedestrian": 3.0, "track": 3.0}
roads = []
for s in load("segment"):
    g = local_geom(s["geometry"])
    if not g.intersects(CLIP.buffer(20)): continue
    g = g.intersection(CLIP.buffer(20))
    lines = [g] if g.geom_type == "LineString" else [q for q in getattr(g, "geoms", []) if q.geom_type == "LineString"]
    st, cl = s.get("subtype"), s.get("class")
    for ln in lines:
        if ln.length < 1: continue
        if st == "rail":
            roads.append({"k": "rail", "w": 4.0, "p": coords(ln.simplify(0.3))}); continue
        if st != "road": continue
        roads.append({"k": cl or "residential", "w": WIDTH.get(cl, 5),
                      "n": (s.get("names") or {}).get("primary"), "p": coords(ln.simplify(0.3))})
print("roads", len(roads))

# ---------------------------------------------------------------- areas
areas = []
def add_area(kind, geom):
    g = geom.intersection(CLIP.buffer(10))
    for p in polys(g.simplify(0.4)):
        areas.append({"k": kind, **p})
for f, key in [("land_use", "class"), ("land", "subtype"), ("land_cover", "subtype"), ("water", "subtype")]:
    for a in load(f):
        try: g = local_geom(a["geometry"])
        except ValueError: continue
        if g.geom_type in ("Polygon", "MultiPolygon"):
            add_area(f + ":" + str(a.get(key)), g)
        elif f == "water" and g.geom_type == "LineString" and g.intersects(CLIP):
            roads.append({"k": "stream", "w": 2.5, "p": coords(g.intersection(CLIP.buffer(10)).simplify(0.3))}) if g.intersection(CLIP.buffer(10)).geom_type == "LineString" else None
print("areas", len(areas))

# ---------------------------------------------------------------- trees from 1 m canopy height
chm = np.load(os.path.join(RAW, "chm.npy")).astype(np.float32)
meta = json.load(open(os.path.join(RAW, "chm.json")))
L, B, R_, T = meta["bounds"]
ry, rx = chm.shape
def ll_to_3857(lo, la):
    X = lo * 20037508.34 / 180
    Y = math.log(math.tan((90 + la) * math.pi / 360)) / (math.pi / 180) * 20037508.34 / 180
    return X, Y
sm = ndimage.gaussian_filter(chm, 1.0)
mx = ndimage.maximum_filter(sm, size=5)
peaks = np.argwhere((sm == mx) & (sm > 1.6))
trees = []
cand = []
for r, c in peaks:
    X = L + (c + .5) / rx * (R_ - L); Y = T - (r + .5) / ry * (T - B)
    lo = X / 20037508.34 * 180
    la = math.degrees(2 * math.atan(math.exp(Y / 20037508.34 * math.pi)) - math.pi / 2)
    x, z = to_local(lo, la)
    if abs(x) > H - 1.5 or abs(z) > H - 1.5: continue
    h = float(chm[r, c])
    if fp.contains(Point(x, z)): continue
    cand.append((h, x, z))
cand.sort(reverse=True)
grid = {}
for h, x, z in cand:
    rad = min(5.5, max(0.9, 0.22 * h + 0.6)) if h >= 3.5 else 0.6 + 0.35 * h
    k = (int(x // 6), int(z // 6))
    ok = True
    for dx in (-1, 0, 1):
        for dz in (-1, 0, 1):
            for (x2, z2, r2) in grid.get((k[0] + dx, k[1] + dz), []):
                if (x - x2) ** 2 + (z - z2) ** 2 < (0.7 * max(rad, r2)) ** 2: ok = False; break
    if not ok: continue
    grid.setdefault(k, []).append((x, z, rad))
    u = h01(f"{x:.1f},{z:.1f}")
    kind = "bush" if h < 3.5 else ("pine" if u < .14 else "spruce" if u < .30 else "birch" if u < .42 else "leaf")
    trees.append([rnd(x, 1), rnd(z, 1), rnd(h, 1), rnd(rad, 1), kind, rnd(u, 3)])
print("trees", len(trees), {k: sum(t[4] == k for t in trees) for k in ("bush", "leaf", "birch", "spruce", "pine")})

# ---------------------------------------------------------------- garden plots, hedges, filler trees
# The canopy model misses most garden trees, so plots are approximated as Voronoi cells of the
# houses inside each street block; hedges run along plot edges and the gardens get trees.
from shapely.ops import voronoi_diagram
from shapely.geometry import MultiPoint
import random
road_mask = unary_union([LineString(r["p"]).buffer(r["w"] / 2 + 0.8, cap_style=2) for r in roads
                         if r["k"] not in ("footway", "path", "steps", "stream") and len(r["p"]) > 1])
blocks = CLIP.difference(road_mask)
blocks = [b for b in getattr(blocks, "geoms", [blocks]) if b.area > 200]
homes = [b for b in buildings if b["kind"] in ("house", "block", "church") or b["id"].endswith("-0")]
cells = voronoi_diagram(MultiPoint([(b["obb"]["cx"], b["obb"]["cz"]) for b in homes]), envelope=CLIP.buffer(50))
plots = []
for blk in blocks:
    pb = prep(blk)
    for c in cells.geoms:
        q = c.intersection(blk)
        if q.is_empty or q.area < 60: continue
        if q.geom_type == "MultiPolygon": q = max(q.geoms, key=lambda a: a.area)
        if q.geom_type == "Polygon": plots.append(q)
print("plots", len(plots))
rng = random.Random(7)
hedges, garden = [], []
tree_pts = [(t[0], t[1], t[3]) for t in trees]
canopy = ndimage.gaussian_filter(chm, 6)
def canopy_at(x, z):
    lo, la = to_ll(x, z)
    X, Y = ll_to_3857(lo, la)
    c = int((X - L) / (R_ - L) * rx); r = int((T - Y) / (T - B) * ry)
    return float(canopy[min(max(r, 0), ry - 1), min(max(c, 0), rx - 1)])
for i, p in enumerate(plots):
    inner = p.buffer(-0.7, join_style=2)
    if inner.is_empty or inner.geom_type != "Polygon": continue
    ring = list(inner.exterior.coords)
    for a, b in zip(ring[:-1], ring[1:]):
        seg = LineString([a, b])
        if seg.length < 3: continue
        on_road = seg.buffer(2.5).intersects(road_mask)
        if on_road and rng.random() < 0.55:
            hedges.append({"p": coords(seg), "h": rnd(0.9 + rng.random() * 1.1, 1), "t": "thuja" if rng.random() < .3 else "leaf"})
    want = int(p.area / 170 * (0.5 + rng.random()) + min(3, canopy_at(p.centroid.x, p.centroid.y) * 2))
    minx, minz, maxx, maxz = inner.bounds
    pi = prep(inner.buffer(-1.0))
    tries = 0
    while want > 0 and tries < 60:
        tries += 1
        x, z = rng.uniform(minx, maxx), rng.uniform(minz, maxz)
        if not pi.contains(Point(x, z)) or fp.contains(Point(x, z)) or abs(x) > H - 2 or abs(z) > H - 2: continue
        u = rng.random()
        kind = "fruit" if u < .3 else "leaf" if u < .55 else "birch" if u < .68 else "spruce" if u < .80 else "pine" if u < .86 else "bush"
        h = {"fruit": 3.5, "leaf": 8, "birch": 11, "spruce": 12, "pine": 13, "bush": 1.8}[kind] * (0.7 + rng.random() * 0.6)
        rad = {"fruit": 2.0, "leaf": 3.4, "birch": 2.2, "spruce": 2.4, "pine": 2.6, "bush": 1.1}[kind] * (0.8 + rng.random() * 0.4)
        if any((x - a) ** 2 + (z - b) ** 2 < (0.8 * (rad + r2)) ** 2 for a, b, r2 in tree_pts): continue
        tree_pts.append((x, z, rad))
        garden.append([rnd(x, 1), rnd(z, 1), rnd(h, 1), rnd(rad, 1), kind, rnd(rng.random(), 3)])
        want -= 1
trees += garden
for src, parts in OVERRIDES.items():
    for pt in parts:
        gd = pt.get("garden")
        if not gd: continue
        o = next(b["obb"] for b in buildings if b["id"].endswith("-0") and b.get("extras") == pt.get("extras"))
        trees = [t for t in trees if math.hypot(t[0] - o["cx"], t[1] - o["cz"]) > gd["clear"]]
        hedges = [h for h in hedges if all(math.hypot(p[0] - o["cx"], p[1] - o["cz"]) > gd["clear"] for p in h["p"])]
        ux, uz = math.cos(o["ang"]), math.sin(o["ang"])
        for dx, dz, h, r, kind in gd["plant"]:
            trees.append([rnd(o["cx"] + ux * dx - uz * dz, 1), rnd(o["cz"] + uz * dx + ux * dz, 1), h, r, kind, .5])
# drawn houses use their oriented box, so keep every tree clear of those boxes too
def obb_poly(b, grow):
    o = b["obb"]; ux, uz = math.cos(o["ang"]), math.sin(o["ang"]); vx, vz = -uz, ux
    L, W = o["len"] / 2 + grow, o["wid"] / 2 + grow
    return Polygon([(o["cx"] + sx * ux * L + sy * vx * W, o["cz"] + sx * uz * L + sy * vz * W) for sx, sy in [(-1, -1), (1, -1), (1, 1), (-1, 1)]])
boxes = prep(unary_union([obb_poly(b, 1.2) for b in buildings]))
before = len(trees)
trees = [t for t in trees if not boxes.contains(Point(t[0], t[1]))]
print("hedges", len(hedges), "garden trees", len(garden), "dropped in houses", before - len(trees))

# ---------------------------------------------------------------- points of interest
pois = [{"k": "home", "name": "Hem", "x": 0.0, "z": 0.0}]
for p in load("place"):
    nm = (p.get("names") or {}).get("primary")
    if nm in ("Bymarkskyrkan", "Sippans Lekpark"):
        x, z = to_local(*p["geometry"]["coordinates"][:2])
        pois.append({"k": "place", "name": nm, "x": rnd(x), "z": rnd(z)})
for a in load("infrastructure"):
    if a.get("class") == "bus_stop":
        x, z = to_local(*a["geometry"]["coordinates"][:2])
        if abs(x) < H and abs(z) < H:
            pois.append({"k": "bus_stop", "name": (a.get("names") or {}).get("primary"), "x": rnd(x), "z": rnd(z)})

data = {"origin": {"lat": LAT0, "lon": LON0}, "half": H, "terrain": terrain, "buildings": buildings,
        "roads": roads, "areas": areas, "trees": trees, "hedges": hedges, "pois": pois}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(data, open(OUT, "w"), separators=(",", ":"))
print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")
