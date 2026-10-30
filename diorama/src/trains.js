import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cardboard } from './materials.js';
import { roadHeight } from './roads.js';

// Live trains from the relay's /trains (Trafikverket TrainPosition). A reported position is put on
// the nearest railway line from the map; between reports the train runs on along that line, and
// its carriages follow the track behind the front.
const POLL_MS = 15000;
const CARS = 2, CAR_LEN = 26, GAP = .8;

function carGeometry(front) {
  const paint = (g, c) => { g = g.toNonIndexed(); const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) col.toArray(a, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const L = CAR_LEN;
  const parts = [
    paint(new THREE.BoxGeometry(L, 3.0, 3.0).translate(0, 2.3, 0), '#e9e6df'),            // body
    paint(new THREE.BoxGeometry(L + .04, .55, 3.04).translate(0, 1.15, 0), '#2f6b4f'),   // lower band
    paint(new THREE.BoxGeometry(L - 1.6, .9, 3.06).translate(0, 2.65, 0), '#27313a'),    // window band
    paint(new THREE.BoxGeometry(L - .6, .3, 2.6).translate(0, 3.95, 0), '#b9bcc0'),      // roof
    paint(new THREE.BoxGeometry(L - 4, .7, 2.4).translate(0, .45, 0), '#2a2a2c'),         // bogies
  ];
  if (front) {
    parts.push(paint(new THREE.BoxGeometry(.1, 1.2, 2.4).translate(L / 2 + .02, 2.75, 0), '#1e262d'));  // windscreen
    parts.push(paint(new THREE.BoxGeometry(.12, .45, 1.8).translate(L / 2 + .04, 3.55, 0), '#f2c230')); // destination sign
  }
  return mergeGeometries(parts);
}

export function buildTrains(data, field, getPlate, relayUrl, siteId) {
  const ry = roadHeight(field);
  const lat0 = data.origin.lat, lon0 = data.origin.lon;
  const MY = 111132, MX = 111320 * Math.cos(lat0 * Math.PI / 180);
  const local = (lat, lon) => [(lon - lon0) * MX, -(lat - lat0) * MY];

  // railway lines from the map, with distance along each
  const lines = data.roads.filter(r => r.k === 'rail' && r.p.length > 1).map(r => {
    const cum = [0];
    for (let k = 1; k < r.p.length; k++) cum.push(cum[k - 1] + Math.hypot(r.p[k][0] - r.p[k - 1][0], r.p[k][1] - r.p[k - 1][1]));
    return { pts: r.p, cum, len: cum[cum.length - 1] };
  });
  const group = new THREE.Group();
  const status = { state: relayUrl && lines.length ? 'connecting' : 'off', count: 0, near: 0 };
  if (!lines.length || !relayUrl) return { group, update() {}, status, dispose() {} };

  const MAX = 6;
  const mat = cardboard(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .7 }), { key: 'train' });
  const fronts = new THREE.InstancedMesh(carGeometry(true), mat, MAX * 2);
  const middles = new THREE.InstancedMesh(carGeometry(false), mat, MAX * CARS);
  const glowMat = new THREE.MeshBasicMaterial({ color: '#ffd890', transparent: true, opacity: 0 });
  const glow = new THREE.InstancedMesh(new THREE.BoxGeometry(CAR_LEN - 2, .8, 3.08).translate(0, 2.65, 0), glowMat, MAX * CARS);
  for (const m of [fronts, middles]) m.castShadow = true;
  // instances move anywhere on the plate: don't cull them by where the mesh started
  for (const m of [fronts, middles, glow]) m.frustumCulled = false;
  fronts.count = middles.count = glow.count = 0;
  group.add(fronts, middles, glow);

  function match(x, z) {
    let best = null, bd = 30 * 30;
    for (const ln of lines) for (let k = 1; k < ln.pts.length; k++) {
      const a = ln.pts[k - 1], b = ln.pts[k], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
      const d2 = (a[0] + dx * t - x) ** 2 + (a[1] + dz * t - z) ** 2;
      if (d2 < bd) { bd = d2; best = { ln, d: ln.cum[k - 1] + t * Math.sqrt(l2), k }; }
    }
    return best;
  }
  function pointAt(ln, d) {
    d = Math.max(0, Math.min(ln.len, d));
    let k = 1; while (k < ln.pts.length - 1 && ln.cum[k] < d) k++;
    const a = ln.pts[k - 1], b = ln.pts[k], seg = ln.cum[k] - ln.cum[k - 1] || 1, t = (d - ln.cum[k - 1]) / seg;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  const trains = new Map();
  async function poll() {
    try {
      const r = await fetch(relayUrl.replace(/\/$/, '') + '/trains' + (siteId ? '?site=' + encodeURIComponent(siteId) : ''), { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || r.status);
      const now = Date.now() / 1000, seen = new Set();
      for (const t of j.trains) {
        const [x, z] = local(t.lat, t.lon), prev = trains.get(t.id);
        const on = match(x, z);
        seen.add(t.id);
        if (!on) { trains.delete(t.id); continue; }
        // direction along the line: from movement since the last report, else from the bearing
        let dir = prev ? prev.dir : 0;
        if (prev && prev.on.ln === on.ln && Math.abs(on.d - prev.on.d) > 5) dir = Math.sign(on.d - prev.on.d);
        else if (t.bearing != null) {
          const h = t.bearing * Math.PI / 180, a = on.ln.pts[on.k - 1], b = on.ln.pts[on.k];
          dir = Math.sign(Math.sin(h) * (b[0] - a[0]) - Math.cos(h) * (b[1] - a[1])) || 1;
        }
        trains.set(t.id, { on, dir: dir || 1, speed: Math.min(t.speed ?? 0, 60), ts: Math.min(t.ts || now, now), shown: prev ? prev.shown : on.d });
      }
      for (const id of [...trains.keys()]) if (!seen.has(id)) trains.delete(id);
      status.state = 'live'; status.count = trains.size;
    } catch (e) { status.state = 'error'; status.error = String(e.message || e); }
  }
  poll();
  const timer = setInterval(poll, POLL_MS);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  function update(dt, live, night) {
    const plate = getPlate(), now = Date.now() / 1000;
    let nf = 0, nm = 0, ng = 0, near = 0;
    for (const t of trains.values()) {
      const ln = t.on.ln, age = Math.min(30, Math.max(0, now - t.ts));
      const target = Math.max(0, Math.min(ln.len, t.on.d + t.dir * t.speed * age));
      t.shown += Math.abs(target - t.shown) > 150 ? target - t.shown : (target - t.shown) * (1 - Math.exp(-dt * 1.5));
      if (!live) continue;
      let any = false;
      for (let c = 0; c < CARS; c++) {
        // car c's two ends along the track, counted back from the front
        const dFront = t.shown - t.dir * c * (CAR_LEN + GAP), dBack = dFront - t.dir * CAR_LEN;
        const a = pointAt(ln, dFront), b = pointAt(ln, dBack), cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
        if (!plate.inside(cx, cz, CAR_LEN / 2)) continue;
        any = true;
        const yaw = Math.atan2(a[1] - b[1], a[0] - b[0]);
        q.setFromAxisAngle(up, -yaw);
        m.compose(p.set(cx, ry(cx, cz) - .05, cz), q, one);
        if (c === 0 || c === CARS - 1) {
          // the end cars face outward: the last one is turned round
          if (c === CARS - 1 && c !== 0) { q.setFromAxisAngle(up, -yaw + Math.PI); m.compose(p, q, one); }
          if (nf < fronts.instanceMatrix.count) fronts.setMatrixAt(nf++, m);
        } else if (nm < MAX * CARS) middles.setMatrixAt(nm++, m);
        if (ng < MAX * CARS) glow.setMatrixAt(ng++, m);
      }
      if (any) near++;
    }
    fronts.count = nf; middles.count = nm; glow.count = ng;
    for (const im of [fronts, middles, glow]) im.instanceMatrix.needsUpdate = true;
    glowMat.opacity = night * .85;
    status.near = near;
  }
  return { group, update, status, dispose: () => clearInterval(timer) };
}
