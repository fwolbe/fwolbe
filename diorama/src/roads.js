import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cardboard, WALL_GLSL } from './materials.js';

// ploughed roads keep less snow than the gardens
export const ROAD_SNOW = { value: 0 };
export const DRIVABLE = new Set(['residential', 'tertiary', 'secondary', 'primary', 'unclassified', 'service', 'living_street']);
const RIBBON = new Set([...DRIVABLE, 'rail']);

function resample(pts, maxStep) {
  const out = [pts[0]];
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(d / maxStep));
    for (let i = 1; i <= n; i++) out.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
  }
  return out;
}

// Roads are smooth cardboard strips laid over the contour steps; cars drive on them.
export function roadHeight(field) { return (x, z) => field.sample(x, z) + 0.18; }

export function buildRoads(data, field, surf) {
  const top = [], topN = [], topC = [], skirt = [], skirtN = [];
  const ry = roadHeight(field);
  const half = data.half;
  const inside = (p) => Math.abs(p[0]) <= half && Math.abs(p[1]) <= half;
  for (const rd of data.roads) {
    if (!RIBBON.has(rd.k) || rd.p.length < 2) continue;
    const pts = resample(rd.p, 1.5).map(p => [Math.max(-half, Math.min(half, p[0])), Math.max(-half, Math.min(half, p[1]))]);
    const w = rd.w / 2;
    const c = new THREE.Color(rd.k === 'rail' ? '#8b8178' : rd.k === 'service' ? '#525155' : '#454448');
    const L = [], R = [];
    for (let k = 0; k < pts.length; k++) {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const nx = -dz, nz = dx;
      L.push([pts[k][0] + nx * w, pts[k][1] + nz * w]); R.push([pts[k][0] - nx * w, pts[k][1] - nz * w]);
    }
    for (let k = 0; k + 1 < pts.length; k++) {
      if (!inside(pts[k]) && !inside(pts[k + 1])) continue;
      const q = [L[k], R[k], R[k + 1], L[k + 1]].map(p => [Math.max(-half, Math.min(half, p[0])), Math.max(-half, Math.min(half, p[1]))]);
      const Y = q.map(p => ry(p[0], p[1]));
      const v = q.map((p, i) => [p[0], Y[i], p[1]]);
      // two triangles, facing up
      for (const [a, b, d] of [[v[0], v[1], v[2]], [v[0], v[2], v[3]]]) {
        const e1 = [b[0] - a[0], b[2] - a[2]], e2 = [d[0] - a[0], d[2] - a[2]];
        const cy = e1[1] * e2[0] - e1[0] * e2[1];
        const tri = cy >= 0 ? [a, b, d] : [a, d, b];
        for (const p of tri) { top.push(...p); topN.push(0, 1, 0); topC.push(c.r, c.g, c.b); }
      }
      // skirts down to the steps, both sides
      for (const [p, s] of [[q[0], q[3]], [q[2], q[1]]]) {
        const yp = ry(p[0], p[1]), ys = ry(s[0], s[1]);
        const bp = Math.min(surf(p[0], p[1]), yp - .2) - .05, bs = Math.min(surf(s[0], s[1]), ys - .2) - .05;
        let dx = s[0] - p[0], dz = s[1] - p[1]; const l = Math.hypot(dx, dz) || 1;
        let nx = -dz / l, nz = dx / l;
        // make skirts face away from the road centre
        const mx = (p[0] + s[0]) / 2 - pts[k][0], mz = (p[1] + s[1]) / 2 - pts[k][1];
        let A = p, B = s, yA = yp, yB = ys, bA = bp, bB = bs;
        if (nx * mx + nz * mz < 0) { A = s; B = p; yA = ys; yB = yp; bA = bs; bB = bp; nx = -nx; nz = -nz; }
        skirt.push(A[0], bA, A[1], B[0], bB, B[1], B[0], yB, B[1], A[0], bA, A[1], B[0], yB, B[1], A[0], yA, A[1]);
        for (let i = 0; i < 6; i++) skirtN.push(nx, 0, nz);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(top, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(topN, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(topC, 3));
  const roadMat = cardboard(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), {
    key: 'road',
    colorBody: `diffuseColor.rgb *= .92 + .16 * vnoise(vW.xz * 1.7);`,
    uniforms: { uSnow: ROAD_SNOW },
  });
  const roads = new THREE.Mesh(g, roadMat);
  roads.receiveShadow = true;
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(skirt, 3));
  sg.setAttribute('normal', new THREE.Float32BufferAttribute(skirtN, 3));
  const skirtMat = cardboard(new THREE.MeshStandardMaterial({ color: '#b89466', roughness: .95 }), {
    key: 'skirt', fragmentHead: WALL_GLSL, colorBody: `diffuseColor.rgb = kraft(vW, vWN, .45);`,
  });
  const skirts = new THREE.Mesh(sg, skirtMat);
  skirts.receiveShadow = true; skirts.castShadow = true;
  const group = new THREE.Group(); group.add(roads, skirts);
  return { group, roadMat };
}

// Road graph: nodes where segments meet, edges as polylines; used by the traffic.
export function roadGraph(data) {
  const key = (p) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
  const count = new Map();
  const lines = data.roads.filter(r => DRIVABLE.has(r.k) && r.p.length > 1);
  for (const r of lines) r.p.forEach((p, i) => { const k = key(p); count.set(k, (count.get(k) || 0) + (i === 0 || i === r.p.length - 1 ? 2 : 1)); });
  const nodes = new Map(), edges = [];
  const node = (p) => { const k = key(p); if (!nodes.has(k)) nodes.set(k, { k, x: p[0], z: p[1], out: [] }); return nodes.get(k); };
  for (const r of lines) {
    let cur = [r.p[0]];
    for (let i = 1; i < r.p.length; i++) {
      cur.push(r.p[i]);
      const k = key(r.p[i]);
      if (i === r.p.length - 1 || count.get(k) > 1) {
        const a = node(cur[0]), b = node(cur[cur.length - 1]);
        const pts = resample(cur, 2);
        const len = pts.reduce((s, p, j) => j ? s + Math.hypot(p[0] - pts[j - 1][0], p[1] - pts[j - 1][1]) : 0, 0);
        if (len > 1) {
          const e = { a, b, pts, len, k: r.k, name: r.n };
          edges.push(e); a.out.push({ e, dir: 1 }); b.out.push({ e, dir: -1 });
        }
        cur = [r.p[i]];
      }
    }
  }
  return { nodes: [...nodes.values()], edges };
}

// Street lamps every ~32 m along drivable roads, alternating sides.
export function buildLamps(data, field) {
  const ry = roadHeight(field);
  const spots = [];
  const half = data.half - 2;
  for (const r of data.roads) {
    if (!DRIVABLE.has(r.k) || r.k === 'service') continue;
    const pts = resample(r.p, 1);
    let acc = 14, side = 1;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      acc += Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (acc < 32) continue;
      acc = 0; side = -side;
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      const x = b[0] + (-dz / l) * (r.w / 2 + .7) * side, z = b[1] + (dx / l) * (r.w / 2 + .7) * side;
      if (Math.abs(x) > half || Math.abs(z) > half) continue;
      if (spots.some(s => (s.x - x) ** 2 + (s.z - z) ** 2 < 220)) continue;
      spots.push({ x, z, y: ry(x, z) - .18, ax: dx / l, az: dz / l, side, nx: -dz / l * -side, nz: dx / l * -side });
    }
  }
  const pole = mergeGeometries([
    new THREE.CylinderGeometry(.09, .12, 5.2, 5).translate(0, 2.6, 0).toNonIndexed(),
    new THREE.BoxGeometry(.9, .1, .1).translate(.42, 5.15, 0).toNonIndexed(),
  ]);
  const head = new THREE.BoxGeometry(.55, .18, .3).translate(.85, 5.05, 0);
  const poleMat = cardboard(new THREE.MeshStandardMaterial({ color: '#3c3a38', roughness: .7 }), { key: 'pole' });
  const headMat = new THREE.MeshStandardMaterial({ color: '#f3e7c8', emissive: '#ffcf80', emissiveIntensity: 0 });
  const poles = new THREE.InstancedMesh(pole, poleMat, spots.length);
  const heads = new THREE.InstancedMesh(head, headMat, spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  spots.forEach((s, i) => {
    q.setFromAxisAngle(up, -Math.atan2(s.nz, s.nx));
    m.compose(new THREE.Vector3(s.x, s.y, s.z), q, one);
    poles.setMatrixAt(i, m); heads.setMatrixAt(i, m);
  });
  poles.castShadow = true;
  // pools of light on the road: additive discs that only show at night
  const tex = radialTexture('rgba(255,205,130,1)');
  const poolMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -4 });
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat, spots.length);
  spots.forEach((s, i) => {
    const px = s.x + s.nx * .85, pz = s.z + s.nz * .85;
    m.compose(new THREE.Vector3(px, ry(px, pz) + .08, pz), new THREE.Quaternion(), new THREE.Vector3(8.5, 1, 8.5));
    pools.setMatrixAt(i, m);
  });
  pools.renderOrder = 2;
  const group = new THREE.Group(); group.add(poles, heads, pools);
  return { group, headMat, poolMat, count: spots.length };
}

export function radialTexture(rgba) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, rgba); gr.addColorStop(.35, rgba.replace(/[\d.]+\)$/, '.45)')); gr.addColorStop(1, rgba.replace(/[\d.]+\)$/, '0)'));
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
