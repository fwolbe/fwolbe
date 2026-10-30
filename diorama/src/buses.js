import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cardboard } from './materials.js';
import { roadHeight } from './roads.js';

// Real-time JLT buses from the relay (see relay/). Positions arrive every ~15-20 s; between
// reports each bus glides along its reported heading, kept on the nearest street.
const POLL_MS = 15000;

function busGeometry() {
  const paint = (g, c) => { g = g.toNonIndexed(); const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) col.toArray(a, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const parts = [
    paint(new THREE.BoxGeometry(12, 2.4, 2.55).translate(0, 1.75, 0), '#c8322b'),       // body
    paint(new THREE.BoxGeometry(12.04, .9, 2.59).translate(0, 2.05, 0), '#2b3440'),     // window band
    paint(new THREE.BoxGeometry(11.6, .25, 2.4).translate(0, 3.05, 0), '#f1ece0'),      // roof
    paint(new THREE.BoxGeometry(.06, 1.4, 2.2).translate(6.02, 2.0, 0), '#2b3440'),     // windscreen
    paint(new THREE.BoxGeometry(.08, .5, 1.6).translate(6.04, 2.95, 0), '#f2c230'),     // destination sign
  ];
  for (const [x, z] of [[3.9, 1.2], [-3.4, 1.2], [3.9, -1.2], [-3.4, -1.2]]) {
    parts.push(paint(new THREE.CylinderGeometry(.5, .5, .32, 10).rotateX(Math.PI / 2).translate(x, .5, z), '#262422'));
  }
  return mergeGeometries(parts);
}

export function buildBuses(data, field, graph, getPlate, relayUrl) {
  const ry = roadHeight(field);
  const lat0 = data.origin.lat, lon0 = data.origin.lon;
  const MY = 111132, MX = 111320 * Math.cos(lat0 * Math.PI / 180);
  const local = (lat, lon) => [(lon - lon0) * MX, -(lat - lat0) * MY];
  const MAX = 12;
  const mat = cardboard(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .7 }), { key: 'bus' });
  const mesh = new THREE.InstancedMesh(busGeometry(), mat, MAX);
  mesh.castShadow = true; mesh.count = 0;
  const glowMat = new THREE.MeshBasicMaterial({ color: '#ffd890', transparent: true, opacity: 0 });
  const glow = new THREE.InstancedMesh(new THREE.BoxGeometry(10, .7, 2.62).translate(-.6, 2.05, 0), glowMat, MAX);
  glow.count = 0;
  const group = new THREE.Group(); group.add(mesh, glow);

  // every drivable street as segments, for snapping a reported position onto the road
  const segs = [];
  for (const e of graph.edges) for (let k = 1; k < e.pts.length; k++) segs.push([e.pts[k - 1], e.pts[k]]);
  function snap(x, z) {
    let best = null, bd = 25 * 25;
    for (const [a, b] of segs) {
      const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
      const px = a[0] + dx * t, pz = a[1] + dz * t, d = (px - x) ** 2 + (pz - z) ** 2;
      if (d < bd) { bd = d; best = [px, pz, Math.atan2(dz, dx)]; }
    }
    return best;
  }

  const buses = new Map();
  const status = { state: relayUrl ? 'connecting' : 'off', count: 0, near: 0, error: null };
  async function poll() {
    if (!relayUrl) return;
    try {
      const r = await fetch(relayUrl.replace(/\/$/, '') + '/buses', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || r.status);
      const now = Date.now() / 1000, seen = new Set();
      for (const b of j.buses) {
        const [x, z] = local(b.lat, b.lon);
        const speed = b.speed ?? 0, head = b.bearing != null ? b.bearing * Math.PI / 180 : null;
        // GTFS bearing: degrees clockwise from north; local x is east, z is south
        const vx = head != null ? Math.sin(head) * speed : 0, vz = head != null ? -Math.cos(head) * speed : 0;
        const prev = buses.get(b.id);
        const rec = { id: b.id, route: b.route, rx: x, rz: z, vx, vz, ts: Math.min(b.ts || now, now), x: prev ? prev.x : x, z: prev ? prev.z : z, yaw: prev ? prev.yaw : (head != null ? Math.atan2(vz, vx) : 0) };
        buses.set(b.id, rec); seen.add(b.id);
      }
      for (const id of [...buses.keys()]) if (!seen.has(id)) buses.delete(id);
      status.state = 'live'; status.count = buses.size; status.error = null;
    } catch (e) {
      status.state = 'error'; status.error = String(e.message || e);
    }
  }
  poll();
  const timer = setInterval(poll, POLL_MS);

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  function update(dt, live, night) {
    const plate = getPlate();
    let i = 0, near = 0;
    const now = Date.now() / 1000;
    for (const b of buses.values()) {
      // where the bus should be now: last report plus its motion since, capped at 30 s
      const age = Math.min(30, Math.max(0, now - b.ts));
      let tx = b.rx + b.vx * age, tz = b.rz + b.vz * age;
      const s = snap(tx, tz);
      if (s) { tx = s[0]; tz = s[1]; }
      const k = 1 - Math.exp(-dt * 1.5);
      const dx = tx - b.x, dz = tz - b.z;
      if (Math.hypot(dx, dz) > 120) { b.x = tx; b.z = tz; } else { b.x += dx * k; b.z += dz * k; }
      if (Math.hypot(dx, dz) > .3) b.yaw = Math.atan2(dz, dx);
      else if (s) { const a = s[2]; b.yaw = Math.abs(((a - b.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < Math.PI / 2 ? a : a + Math.PI; }
      if (!live || !plate.inside(b.x, b.z, 6) || i >= MAX) continue;
      near++;
      q.setFromAxisAngle(up, -b.yaw);
      m.compose(p.set(b.x, ry(b.x, b.z) - .1, b.z), q, one);
      mesh.setMatrixAt(i, m); glow.setMatrixAt(i, m);
      i++;
    }
    mesh.count = glow.count = i;
    mesh.instanceMatrix.needsUpdate = glow.instanceMatrix.needsUpdate = true;
    glowMat.opacity = night * .9;
    status.near = i;
  }
  return { group, update, status, dispose: () => clearInterval(timer) };
}
