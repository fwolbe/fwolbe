"""Build a site from scratch: download its data and turn it into the scene file.

    python3 scripts/make_site.py <site>           then: node scripts/build.mjs <site>

A site is a folder sites/<site>/ with a site.json (see sites/example/). Downloads go to
sites/<site>/raw/ and the scene to sites/<site>/data.json; none of it belongs in git."""
import os, sys, subprocess
here = os.path.dirname(os.path.abspath(__file__))
site = sys.argv[1]
if not os.path.exists(os.path.join(here, "..", "sites", site, "site.json")):
    sys.exit(f"sites/{site}/site.json not found: copy sites/example/ and set its coordinates")
for step in ("fetch_rasters.py", "fetch_overture.py", "build_data.py"):
    print("==", step, flush=True)
    subprocess.run([sys.executable, os.path.join(here, step), site], check=True)
