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

  // Buses live on the street network: a report is matched to the nearest real street (never a
  // driveway or service road), and between reports a bus drives along the streets, not across them.
  const BUS_ROADS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street']);
  const edges = graph.edges.filter(e => BUS_ROADS.has(e.k)).map(e => {
    const cum = [0];
    for (let k = 1; k < e.pts.length; k++) cum.push(cum[k - 1] + Math.hypot(e.pts[k][0] - e.pts[k - 1][0], e.pts[k][1] - e.pts[k - 1][1]));
    return Object.assign(e, { cum, len: cum[cum.length - 1] });
  });
  const MATCH_M = 15;
  function match(x, z, hx, hz) {
    let best = null, bd = MATCH_M * MATCH_M;
    for (const e of edges) for (let k = 1; k < e.pts.length; k++) {
      const a = e.pts[k - 1], b = e.pts[k], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
      const d2 = (a[0] + dx * t - x) ** 2 + (a[1] + dz * t - z) ** 2;
      if (d2 < bd) {
        bd = d2;
        const along = hx * dx + hz * dz;
        best = { e, d: e.cum[k - 1] + t * Math.sqrt(l2), dir: along === 0 ? 0 : Math.sign(along) };
      }
    }
    return best;
  }
  function pointAt(e, d) {
    d = Math.max(0, Math.min(e.len, d));
    let k = 1; while (k < e.pts.length - 1 && e.cum[k] < d) k++;
    const a = e.pts[k - 1], b = e.pts[k], seg = e.cum[k] - e.cum[k - 1] || 1, t = (d - e.cum[k - 1]) / seg;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(b[1] - a[1], b[0] - a[0])];
  }
  // drive `dist` metres from (e, d) in direction dir, taking the straightest street at junctions
  function advance(pos, dist) {
    let { e, d, dir } = pos;
    if (!dir) return pos;
    let left = dist;
    for (let hop = 0; hop < 8; hop++) {
      const room = dir > 0 ? e.len - d : d;
      if (left <= room) return { e, d: d + dir * left, dir };
      left -= room;
      const node = dir > 0 ? e.b : e.a, [,, heading] = pointAt(e, dir > 0 ? e.len - .5 : .5);
      const h = dir > 0 ? heading : heading + Math.PI;
      let next = null, bestTurn = 1.6;   // never turn sharper than ~90 degrees
      for (const o of node.out) {
        if (o.e === e || !BUS_ROADS.has(o.e.k) || !o.e.cum) continue;
        const [,, h2] = pointAt(o.e, o.dir > 0 ? .5 : o.e.len - .5);
        const out = o.dir > 0 ? h2 : h2 + Math.PI;
        const turn = Math.abs(((out - h + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (turn < bestTurn) { bestTurn = turn; next = o; }
      }
      if (!next) return { e, d: dir > 0 ? e.len : 0, dir };   // end of the known streets: wait there
      e = next.e; dir = next.dir; d = dir > 0 ? 0 : e.len;
    }
    return { e, d, dir };
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
        const prev = buses.get(b.id);
        // GTFS bearing: degrees clockwise from north; local x is east, z is south
        const head = b.bearing != null ? b.bearing * Math.PI / 180 : null;
        let hx = head != null ? Math.sin(head) : 0, hz = head != null ? -Math.cos(head) : 0;
        if (head == null && prev) { hx = x - prev.rx; hz = z - prev.rz; }
        const on = match(x, z, hx, hz);
        seen.add(b.id);
        if (!on) { buses.delete(b.id); continue; }       // not on a street we know: don't invent one
        if (!on.dir && prev && prev.on && prev.on.e === on.e) on.dir = prev.on.dir;
        const [px, pz] = pointAt(on.e, on.d);
        buses.set(b.id, { id: b.id, route: b.route, rx: x, rz: z, on, speed: Math.min(b.speed ?? 0, 20), ts: Math.min(b.ts || now, now),
          x: prev ? prev.x : px, z: prev ? prev.z : pz, yaw: prev ? prev.yaw : pointAt(on.e, on.d)[2] + (on.dir < 0 ? Math.PI : 0) });
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
      // where the bus should be now: its matched street position driven on by speed x time
      // since the report (capped at 25 s), along the streets
      const age = Math.min(25, Math.max(0, now - b.ts));
      const pos = advance(b.on, b.speed * age);
      const [tx, tz, th] = pointAt(pos.e, pos.d);
      const k = 1 - Math.exp(-dt * 2);
      const dx = tx - b.x, dz = tz - b.z;
      if (Math.hypot(dx, dz) > 40) { b.x = tx; b.z = tz; } else { b.x += dx * k; b.z += dz * k; }
      const want = th + (pos.dir < 0 ? Math.PI : 0);
      if (pos.dir) b.yaw += (((want - b.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * k;
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
