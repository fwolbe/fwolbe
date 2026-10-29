import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cardboard } from './materials.js';

const WALL = { white: '#f2ede2', cream: '#efdfba', yellow: '#e8c063', falu: '#a8432f', grey: '#bdb9ae', blue: '#93abc0', green: '#a1b28e', brick: '#a65a3e' };
const ROOF = { tile: '#c4643a', darktile: '#8e3f2b', black: '#3d3c3f', grey: '#727579', copper: '#6f9c87' };
const TRIM = '#f6f1e6';

// Window pattern and lit windows at night, drawn on the walls from a per-vertex wall coordinate.
const WIN_GLSL = /* glsl */`
  varying vec4 vWall;
  float winMask(vec4 w, out float id){
    float u = w.x, v = w.y, len = mod(w.z, 1000.), cap = floor(w.z / 1000.) * .1;
    float n = max(1., floor(len / 3.4));
    float sp = len / n;
    float cu = (floor(u / sp) + .5) * sp;
    float fl = floor(v / 3.0);
    float fv = v - fl * 3.0;
    id = floor(u / sp) * 7.13 + fl * 3.71 + w.w * 91.7;
    float inX = step(abs(u - cu), .55);
    float inY = step(.95, fv) * step(fv, 2.25);
    float top = (fl * 3.0 + 2.25);
    return inX * inY * step(.5, len) * step(0., v) * step(top, cap) * step(1.6, len);
  }
`;

function addWallQuad(out, a, b, y0, y1, yGround, seed, eave) {
  // a, b: [x, z]; outward normal = (b-a) x up
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
  const p = out.pos, w = out.wall, nrm = out.nor;
  const nx = -dz / len, nz = dx / len;
  p.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y0, a[1], b[0], y1, b[1], a[0], y1, a[1]);
  const vr = (y) => y - yGround;
  // z packs the wall length and the height windows must stay under (cap, decimetres)
  const cap = Math.max(0, Math.floor((eave - yGround - 0.35) * 10));
  const z = out.noWindows ? 0 : cap * 1000 + Math.min(len, 999);
  w.push(0, vr(y0), z, seed, len, vr(y0), z, seed, len, vr(y1), z, seed, 0, vr(y0), z, seed, len, vr(y1), z, seed, 0, vr(y1), z, seed);
  for (let k = 0; k < 6; k++) nrm.push(nx, 0, nz);
}

function ccw(pts) {
  let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a; // >0: counter-clockwise in x/z with z down = clockwise seen from above
}

// Rectangle corners for a building's oriented box, optionally grown by o.
function rectPts(b, o = 0) {
  const { cx, cz, len, wid, ang } = b.obb;
  const ux = Math.cos(ang), uz = Math.sin(ang), vx = -uz, vz = ux;
  const L = len / 2 + o, W = wid / 2 + o;
  return [[cx - ux * L - vx * W, cz - uz * L - vz * W], [cx + ux * L - vx * W, cz + uz * L - vz * W],
    [cx + ux * L + vx * W, cz + uz * L + vz * W], [cx - ux * L + vx * W, cz - uz * L + vz * W]];
}

function pushTri(arr, a, b, c) {
  // flat triangle; orient so the normal faces away from the building centre / upward
  arr.push(...a, ...b, ...c);
}

function roofGeom(b, base, eaveY) {
  const tris = [], fascia = [];
  const o = b.kind === 'shed' ? 0.25 : 0.5;
  const pitch = THREE.MathUtils.degToRad(b.pitch);
  const { cx, cz, len, wid, ang } = b.obb;
  const ux = Math.cos(ang), uz = Math.sin(ang), vx = -uz, vz = ux;
  const P = (s, t, y) => [cx + ux * s + vx * t, y, cz + uz * s + vz * t];
  const L = len / 2 + o, W = wid / 2 + o;
  const y0 = eaveY - o * Math.tan(pitch);
  const th = 0.22;
  let ridge;
  if (b.roof === 'gable') {
    const yr = eaveY + (wid / 2) * Math.tan(pitch);
    ridge = yr;
    const a = P(-L, -W, y0), bb = P(L, -W, y0), c = P(L, 0, yr), d = P(-L, 0, yr);
    const e = P(-L, W, y0), f = P(L, W, y0);
    tris.push([a, c, bb], [a, d, c], [e, f, c], [e, c, d]);
    // gable walls
    const g0 = P(-len / 2, -wid / 2, eaveY), g1 = P(-len / 2, wid / 2, eaveY), g2 = P(-len / 2, 0, yr - 0.02);
    const h0 = P(len / 2, -wid / 2, eaveY), h1 = P(len / 2, wid / 2, eaveY), h2 = P(len / 2, 0, yr - 0.02);
    fascia.push([g0, g2, g1], [h0, h1, h2]);
  } else if (b.roof === 'hip') {
    const yr = eaveY + (wid / 2) * Math.tan(pitch);
    ridge = yr;
    const r = Math.max(0, len / 2 - wid / 2);
    const a = P(-L, -W, y0), bb = P(L, -W, y0), c = P(L, W, y0), d = P(-L, W, y0);
    const r0 = P(-r, 0, yr), r1 = P(r, 0, yr);
    tris.push([a, r1, bb], [a, r0, r1], [c, r1, r0], [c, r0, d], [bb, r1, c], [d, r0, a]);
  } else if (b.roof === 'mono') {
    const yr = eaveY + wid * Math.tan(pitch);
    ridge = yr;
    const a = P(-L, -W, y0), bb = P(L, -W, y0), c = P(L, W, yr + o * Math.tan(pitch)), d = P(-L, W, yr + o * Math.tan(pitch));
    tris.push([a, c, bb], [a, d, c]);
    const g0 = P(-len / 2, -wid / 2, eaveY), g1 = P(-len / 2, wid / 2, eaveY), g2 = P(-len / 2, wid / 2, yr);
    const h0 = P(len / 2, -wid / 2, eaveY), h1 = P(len / 2, wid / 2, eaveY), h2 = P(len / 2, wid / 2, yr);
    fascia.push([g0, g2, g1], [h0, h1, h2]);
    // high wall
    fascia.push([g1, g2, h2], [g1, h2, h1]);
  }
  return { tris, fascia, ridge, rim: [P(-L, -W, y0), P(L, -W, y0), P(L, W, y0), P(-L, W, y0)], th };
}

function triGeom(tris, outwardFrom) {
  const pos = [];
  for (let [a, b, c] of tris) {
    const e1 = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const e2 = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const n = e1.clone().cross(e2);
    const mid = new THREE.Vector3((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3);
    const out = mid.clone().sub(outwardFrom);
    if (n.dot(out) < 0) [b, c] = [c, b];
    pos.push(...a, ...b, ...c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Roof tiles: rows of shading along the slope, from world height.
const ROOF_GLSL = /* glsl */`
  float rows = fract(vW.y / .32);
  float rpx = fwidth(vW.y / .32);
  float line = smoothstep(.0, max(rpx * 1.5, .08), rows) * smoothstep(0., max(rpx * 1.5, .08), 1. - rows);
  diffuseColor.rgb *= mix(1., .82 + .18 * line, step(.15, abs(vWN.y)) * step(abs(vWN.y), .97) * clamp(1. - rpx, 0., 1.));
`;

export function buildBuildings(data, surf, rnd) {
  const walls = { pos: [], nor: [], wall: [], col: [] };
  const roofGeoms = [], trimGeoms = [], edgeGeoms = [];
  const info = [];
  const c = new THREE.Color();
  for (const b of data.buildings) {
    const pitched = b.roof !== 'flat' && b.rect > 0.76;
    const pts = pitched ? rectPts(b) : b.fp.slice(0, b.fp.length - 1);
    if (pts.length < 3) continue;
    const ys = pts.map(p => surf(p[0], p[1]));
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const yGround = surf(b.obb.cx, b.obb.cz);
    let eave = yGround + b.eave;
    eave = Math.max(eave, yMax + 2.4);
    const base = yMin - 0.4;
    const seed = b.seed;
    let ring = pts;
    if (ccw(ring) > 0) ring = [...ring].reverse();
    const before = walls.pos.length;
    walls.noWindows = b.kind === 'shed';
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], q = ring[(k + 1) % ring.length];
      addWallQuad(walls, a, q, base, eave, yGround, seed + k * 0.13, eave);
    }
    c.set(WALL[b.wc] || WALL.white);
    c.offsetHSL(0, 0, (seed - .5) * .06);
    for (let k = before; k < walls.pos.length; k += 3) walls.col.push(c.r, c.g, c.b);

    const centre = new THREE.Vector3(b.obb.cx, eave - 5, b.obb.cz);
    let top = eave;
    if (pitched) {
      const r = roofGeom(b, base, eave);
      top = r.ridge;
      const rg = triGeom(r.tris, new THREE.Vector3(b.obb.cx, eave - 3, b.obb.cz));
      setColour(rg, ROOF[b.rc] || ROOF.tile, seed);
      roofGeoms.push(rg);
      // soffit (underside) and fascia band give the roof sheet a thickness
      const [p0, p1, p2, p3] = r.rim;
      const dn = (p) => [p[0], p[1] - r.th, p[2]];
      const rimTris = [];
      const rimPts = [p0, p1, p2, p3];
      for (let k = 0; k < 4; k++) { const a = rimPts[k], q = rimPts[(k + 1) % 4]; rimTris.push([a, q, dn(q)], [a, dn(q), dn(a)]); }
      const fg = triGeom(rimTris, new THREE.Vector3(b.obb.cx, r.rim[0][1], b.obb.cz));
      setColour(fg, TRIM, 0.5);
      trimGeoms.push(fg);
      if (r.fascia.length) {
        const gg = triGeom(r.fascia, new THREE.Vector3(b.obb.cx, eave, b.obb.cz));
        const wc = new THREE.Color(WALL[b.wc] || WALL.white).offsetHSL(0, 0, (seed - .5) * .06);
        setColour(gg, '#' + wc.getHexString(), 0.5);
        trimGeoms.push(gg);
      }
      edgeGeoms.push(new THREE.EdgesGeometry(rg, 20));
    } else {
      // flat roof: cap + low parapet
      const shape = new THREE.Shape(ring.map(p => new THREE.Vector2(p[0], -p[1])));
      const cap = new THREE.ShapeGeometry(shape);
      cap.rotateX(-Math.PI / 2);
      cap.translate(0, eave + 0.02, 0);
      setColour(cap, b.kind === 'shed' ? '#58565a' : '#6b6a6e', seed);
      roofGeoms.push(cap);
      const par = [];
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k], q = ring[(k + 1) % ring.length];
        par.push([[a[0], eave, a[1]], [q[0], eave, q[1]], [q[0], eave + .35, q[1]]], [[a[0], eave, a[1]], [q[0], eave + .35, q[1]], [a[0], eave + .35, a[1]]]);
      }
      const pg = triGeom(par, new THREE.Vector3(b.obb.cx, eave, b.obb.cz));
      setColour(pg, TRIM, .5);
      trimGeoms.push(pg);
      top = eave + .35;
    }
    // outline of the walls
    const ep = [];
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k], q = ring[(k + 1) % ring.length];
      ep.push(a[0], eave, a[1], q[0], eave, q[1], a[0], base + 0.4, a[1], a[0], eave, a[1]);
    }
    const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3));
    edgeGeoms.push(eg);
    if (b.kind === 'church') {
      const t = churchTower(b, eave, surf);
      roofGeoms.push(...t.roofs); trimGeoms.push(...t.walls);
      top = Math.max(top, t.top);
    }
    info.push({ b, ground: yGround, top, eave });
  }

  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(walls.pos, 3));
  wg.setAttribute('normal', new THREE.Float32BufferAttribute(walls.nor, 3));
  wg.setAttribute('color', new THREE.Float32BufferAttribute(walls.col, 3));
  wg.setAttribute('aWall', new THREE.Float32BufferAttribute(walls.wall, 4));

  const wallMat = cardboard(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .92 }), {
    key: 'wall',
    vertexHead: 'attribute vec4 aWall; varying vec4 vWall;',
    vertexBody: 'vWall = aWall;',
    fragmentHead: WIN_GLSL,
    colorBody: `
      float wid; float wm = winMask(vWall, wid);
      float lit = step(fract(sin(wid) * 43758.5453), .55);
      vec3 glass = mix(vec3(.17, .22, .28), vec3(.98, .78, .42), lit * uNight);
      float frame = wm;
      diffuseColor.rgb = mix(diffuseColor.rgb, glass, frame);
      float baseBand = 1. - step(0.3, vWall.y);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.55, .53, .5), baseBand * .85);
    `,
    emissiveBody: `
      float wid2; float wm2 = winMask(vWall, wid2);
      float lit2 = step(fract(sin(wid2) * 43758.5453), .55);
      totalEmissiveRadiance += vec3(1., .62, .26) * wm2 * lit2 * uNight * 2.2;
    `,
  });
  const roofMat = cardboard(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85, flatShading: true }), { key: 'roof', colorBody: ROOF_GLSL });
  const trimMat = cardboard(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, side: THREE.DoubleSide }), { key: 'trim' });

  const group = new THREE.Group();
  const wallMesh = new THREE.Mesh(wg, wallMat);
  const roofMesh = new THREE.Mesh(mergeGeometries(roofGeoms.map(clean)), roofMat);
  const trimMesh = new THREE.Mesh(mergeGeometries(trimGeoms.map(clean)), trimMat);
  for (const m of [wallMesh, roofMesh, trimMesh]) { m.castShadow = true; m.receiveShadow = true; group.add(m); }
  const lines = new THREE.LineSegments(mergeGeometries(edgeGeoms.map(g => { const q = new THREE.BufferGeometry(); q.setAttribute('position', g.attributes.position); return q; })),
    new THREE.LineBasicMaterial({ color: 0x3a2617, transparent: true, opacity: .45 }));
  group.add(lines);
  return { group, info, lines };
}

function clean(g) {
  if (g.index) g = g.toNonIndexed();
  const q = new THREE.BufferGeometry();
  q.setAttribute('position', g.attributes.position);
  if (!g.attributes.normal) g.computeVertexNormals();
  q.setAttribute('normal', g.attributes.normal);
  q.setAttribute('color', g.attributes.color);
  return q.index ? q : q;
}

function setColour(g, hex, seed) {
  const c = new THREE.Color(hex).offsetHSL(0, 0, (seed - .5) * .07);
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) { a[k * 3] = c.r; a[k * 3 + 1] = c.g; a[k * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
}

function churchTower(b, eave, surf) {
  const { cx, cz, len, wid, ang } = b.obb;
  const ux = Math.cos(ang), uz = Math.sin(ang);
  const tx = cx + ux * (len / 2 + 2.2), tz = cz + uz * (len / 2 + 2.2);
  const g0 = surf(tx, tz) - 0.4, h = eave + 9;
  const tw = new THREE.BoxGeometry(4.2, h - g0, 4.2).toNonIndexed();
  tw.rotateY(-ang); tw.translate(tx, (h + g0) / 2, tz);
  setColour(tw, '#a65a3e', .5);
  const sp = new THREE.ConeGeometry(3.4, 7, 4).toNonIndexed();
  sp.rotateY(Math.PI / 4 - ang); sp.translate(tx, h + 3.5, tz);
  setColour(sp, '#6f9c87', .5);
  const cr1 = new THREE.BoxGeometry(.25, 2.2, .25).toNonIndexed(); cr1.translate(tx, h + 8, tz); setColour(cr1, '#d9b45a', .5);
  const cr2 = new THREE.BoxGeometry(1.2, .25, .25).toNonIndexed(); cr2.rotateY(-ang); cr2.translate(tx, h + 8.4, tz); setColour(cr2, '#d9b45a', .5);
  return { roofs: [sp, cr1, cr2], walls: [tw], top: h + 9 };
}
