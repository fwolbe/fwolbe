import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cardboard } from './materials.js';
import { roadHeight, radialTexture } from './roads.js';

const COLOURS = ['#2f5fb3', '#e2b62c', '#c23b2f', '#2f8a5a', '#f1ece0', '#2b2b2e', '#7d8a96', '#d8742c'];

function carGeometry() {
  const body = new THREE.BoxGeometry(4.2, .9, 1.8).translate(0, .75, 0).toNonIndexed();
  const cab = new THREE.BoxGeometry(2.2, .7, 1.6).translate(-.25, 1.5, 0).toNonIndexed();
  const stripe = new THREE.BoxGeometry(4.24, .02, .22).translate(0, 1.21, .2).toNonIndexed();
  const stripe2 = new THREE.BoxGeometry(4.24, .02, .22).translate(0, 1.21, -.2).toNonIndexed();
  const wheels = [];
  for (const [x, z] of [[1.35, .85], [-1.35, .85], [1.35, -.85], [-1.35, -.85]]) {
    wheels.push(new THREE.CylinderGeometry(.38, .38, .3, 8).rotateX(Math.PI / 2).translate(x, .38, z).toNonIndexed());
  }
  const glass = new THREE.BoxGeometry(2.25, .45, 1.64).translate(-.25, 1.52, 0).toNonIndexed();
  const paint = (g, c) => { const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) col.toArray(a, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  // body parts get white (tinted per instance), stripes/wheels/glass fixed colours via vertex colour < 0 marker
  const tint = mergeGeometries([paint(body, '#ffffff'), paint(cab, '#ffffff')]);
  const fixed = mergeGeometries([paint(stripe, '#f4efe4'), paint(stripe2, '#f4efe4'), ...wheels.map(w => paint(w, '#262422')), paint(glass, '#33404c')]);
  return { tint, fixed };
}

export function buildTraffic(graph, field, plate) {
  const ry = roadHeight(field);
  const MAX = 26;
  const geo = carGeometry();
  const tintMat = cardboard(new THREE.MeshStandardMaterial({ roughness: .6 }), { key: 'car' });
  const fixMat = cardboard(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .7 }), { key: 'carfix', cat: 'DARK' });
  const bodies = new THREE.InstancedMesh(geo.tint, tintMat, MAX);
  const fixed = new THREE.InstancedMesh(geo.fixed, fixMat, MAX);
  bodies.castShadow = fixed.castShadow = true;
  // lights: front (warm) and rear (red) emissive dots, plus a beam on the road at night
  const lampGeo = new THREE.BoxGeometry(.12, .2, .32);
  const headMat = new THREE.MeshBasicMaterial({ color: '#fff3d0' });
  const tailMat = new THREE.MeshBasicMaterial({ color: '#ff2a1a' });
  const heads = new THREE.InstancedMesh(lampGeo, headMat, MAX * 2);
  const tails = new THREE.InstancedMesh(lampGeo, tailMat, MAX * 2);
  const beamTex = beamTexture();
  const beamMat = new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 });
  const beams = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), beamMat, MAX);
  beams.renderOrder = 3;
  const group = new THREE.Group(); group.add(bodies, fixed, heads, tails, beams);

  // only the streets that cross the plate carry traffic; cars enter from beyond its edge
  const all = graph.edges;
  const edges = all.filter(e => e.pts.some(p => plate.inside(p[0], p[1])));
  const away = (n) => !plate.inside(n.x, n.z, -10);
  const entries = [];
  for (const e of edges) { if (away(e.a)) entries.push({ e, dir: 1 }); if (away(e.b)) entries.push({ e, dir: -1 }); }
  const lenAll = all.reduce((s, e) => s + e.len, 0), lenHere = edges.reduce((s, e) => s + e.len, 0);
  const share = Math.min(1, lenHere / lenAll * 1.4 + .05);
  const cars = [];
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const col = new THREE.Color();

  function spawn(car, anywhere) {
    let e, dir, s;
    if (!edges.length) { car.active = false; return; }
    if (!anywhere && entries.length) {
      const o = entries[Math.floor(rand() * entries.length)];
      e = o.e; dir = o.dir; s = 0;
    } else {
      e = edges[Math.floor(rand() * edges.length)]; dir = rand() < .5 ? 1 : -1; s = rand() * e.len;
    }
    Object.assign(car, { e, dir, s, v: 0, vmax: (e.k === 'tertiary' ? 11 : 8) * (.85 + rand() * .3), active: true, wait: 0 });
  }
  for (let i = 0; i < MAX; i++) {
    const c = { i, active: false };
    col.set(COLOURS[i % COLOURS.length]); bodies.setColorAt(i, col);
    cars.push(c);
  }

  function pointAt(e, d) {
    // d in [0, len] from e.a
    const p = e.pts; let acc = 0;
    for (let k = 1; k < p.length; k++) {
      const l = Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]);
      if (acc + l >= d || k === p.length - 1) {
        const t = l ? Math.min(1, (d - acc) / l) : 0;
        return [p[k - 1][0] + (p[k][0] - p[k - 1][0]) * t, p[k - 1][1] + (p[k][1] - p[k - 1][1]) * t];
      }
      acc += l;
    }
    return p[p.length - 1];
  }

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const hide = new THREE.Matrix4().makeScale(0, 0, 0);
  const fwd = new THREE.Vector3(), upv = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  let target = 10;

  function update(dt, density, night) {
    target = Math.round(MAX * density * share);
    let active = cars.filter(c => c.active).length;
    for (const c of cars) {
      if (!c.active && active < target) { spawn(c, active < target * .6 && update.first); active++; }
    }
    update.first = false;
    for (const c of cars) {
      if (!c.active) { for (const im of [bodies, fixed, beams]) im.setMatrixAt(c.i, hide); heads.setMatrixAt(c.i * 2, hide); heads.setMatrixAt(c.i * 2 + 1, hide); tails.setMatrixAt(c.i * 2, hide); tails.setMatrixAt(c.i * 2 + 1, hide); continue; }
      // keep distance to the car ahead in the same lane
      let gap = 1e9;
      for (const o of cars) if (o !== c && o.active && o.e === c.e && o.dir === c.dir) {
        const d = (o.s - c.s);
        if (d > 0 && d < gap) gap = d;
      }
      const want = gap < 9 ? 0 : gap < 22 ? c.vmax * (gap - 9) / 13 : c.vmax;
      c.v += Math.max(-8 * dt, Math.min(2.5 * dt, want - c.v));
      c.s += c.v * dt;
      if (c.s >= c.e.len) {
        const end = c.dir === 1 ? c.e.b : c.e.a;
        const opts = end.out.filter(o => o.e !== c.e && edges.includes(o.e));
        if (away(end)) { c.active = false; active--; continue; }
        if (!opts.length) {
          c.dir = -c.dir; c.s = 0; // turn around in a dead end
        } else {
          const o = opts[Math.floor(rand() * opts.length)];
          c.e = o.e; c.dir = o.dir; c.s = 0; c.vmax = (c.e.k === 'tertiary' ? 11 : 8) * (.85 + rand() * .3);
          c.v *= .6;
        }
        if (active > target && rand() < .3) { c.active = false; active--; continue; }
      }
      const d0 = c.dir === 1 ? c.s : c.e.len - c.s;
      const d1 = c.dir === 1 ? Math.min(c.e.len, c.s + 2) : Math.max(0, c.e.len - c.s - 2);
      const p0 = pointAt(c.e, d0), p1 = pointAt(c.e, d1);
      let dx = p1[0] - p0[0], dz = p1[1] - p0[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const lane = c.e.k === 'service' ? .2 : 1.45;
      const x = p0[0] - dz * lane, z = p0[1] + dx * lane;
      if (!plate.inside(x, z, 2.5)) {
        // off the edge of the board: keep driving, but out of sight
        for (const im of [bodies, fixed, beams]) im.setMatrixAt(c.i, hide);
        for (const k of [0, 1]) { heads.setMatrixAt(c.i * 2 + k, hide); tails.setMatrixAt(c.i * 2 + k, hide); }
        continue;
      }
      const yF = ry(x + dx * 1.4, z + dz * 1.4), yB = ry(x - dx * 1.4, z - dz * 1.4);
      const y = (yF + yB) / 2;
      fwd.set(dx * 2.8, yF - yB, dz * 2.8).normalize();
      side.crossVectors(fwd, upv).normalize();
      const upn = new THREE.Vector3().crossVectors(side, fwd);
      basis.makeBasis(fwd, upn, side);
      q.setFromRotationMatrix(basis);
      m.compose(v.set(x, y - .05, z), q, one);
      bodies.setMatrixAt(c.i, m); fixed.setMatrixAt(c.i, m);
      const lm = new THREE.Matrix4();
      for (const [im, ox, k] of [[heads, 2.12, 0], [tails, -2.12, 0]]) {
        for (const oz of [-.6, .6]) {
          lm.makeTranslation(ox, .85, oz); lm.premultiply(m);
          im.setMatrixAt(c.i * 2 + (oz > 0 ? 1 : 0), lm);
        }
      }
      const bm = new THREE.Matrix4().compose(new THREE.Vector3(9, .1, 0), new THREE.Quaternion(), new THREE.Vector3(14, 1, 6.5));
      bm.premultiply(m);
      beams.setMatrixAt(c.i, bm);
    }
    for (const im of [bodies, fixed, heads, tails, beams]) im.instanceMatrix.needsUpdate = true;
    beamMat.opacity = night * .55;
    tailMat.color.setRGB(.6 + night * .9, .08, .05);
    headMat.color.setRGB(.9 + night * .6, .85 + night * .5, .7 + night * .4);
  }
  update.first = true;
  return { group, update, cars };
}

function beamTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 256, 0);
  gr.addColorStop(0, 'rgba(255,240,200,.9)'); gr.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(0, 54); g.lineTo(256, 0); g.lineTo(256, 128); g.lineTo(0, 74); g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  // soften the edges
  return t;
}
