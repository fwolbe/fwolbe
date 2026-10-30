import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cardboard } from './materials.js';

const WALL = { greige: '#e3ddd1', white: '#f2ede2', cream: '#efdfba', yellow: '#e8c063', falu: '#a8432f', grey: '#bdb9ae', blue: '#93abc0', green: '#a1b28e', brick: '#a65a3e' };
const ROOF = { tile: '#c4643a', darktile: '#8e3f2b', black: '#3d3c3f', grey: '#727579', copper: '#6f9c87', redtile: '#9a4630', anthracite: '#33363b' };
const TRIM = '#f6f1e6';

// Window pattern and lit windows at night, drawn on the walls from a per-vertex wall coordinate.
const WIN_GLSL = /* glsl */`
  varying vec4 vWall;
  float winMask(vec4 w, out float id){
    float u = w.x, v = w.y, len = mod(w.z, 1000.), cap = floor(w.z / 1000.) * .1;
    if (w.w > 9. && w.w < 20.) {
      // church: one row of tall round-arched windows
      float n2 = max(1., floor(len / 3.2)), sp2 = len / n2, dx = abs(u - (floor(u / sp2) + .5) * sp2);
      id = floor(u / sp2) * 7.13 + w.w * 91.7;
      float body = step(dx, .5) * step(1.5, v) * step(v, 3.0);
      float arch = step(3.0, v) * step(length(vec2(dx, v - 3.0)), .5);
      return max(body, arch) * step(3.6, cap) * step(2.5, len);
    }
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

// a building's own frame: s along its length, t across it
function frame(b) {
  const { cx, cz, ang } = b.obb, ux = Math.cos(ang), uz = Math.sin(ang), vx = -uz, vz = ux;
  const at = (s, t) => [cx + ux * s + vx * t, cz + uz * s + vz * t];
  return { at, list: (st) => st.map(([s, t]) => at(s, t)) };
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
  diffuseColor.rgb *= mix(1., .82 + .18 * line, step(.15, abs(vWN.y)) * step(abs(vWN.y), .97) * clamp(1. - rpx, 0., 1.) * step(uStyle, .5));
`;

export function buildBuildings(data, surf, inside = () => true) {
  const walls = { pos: [], nor: [], wall: [], col: [] };
  const roofGeoms = [], trimGeoms = [], edgeGeoms = [];
  const info = [];
  const c = new THREE.Color();
  for (const b of data.buildings) {
    if (!rectPts(b, .4).every(p => inside(p[0], p[1]))) continue;
    const pitched = b.roof !== 'flat' && b.rect > 0.76;
    const pts = pitched ? (b.walls ? frame(b).list(b.walls) : rectPts(b)) : b.fp.slice(0, b.fp.length - 1);
    if (pts.length < 3) continue;
    const ys = pts.map(p => surf(p[0], p[1]));
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const yGround = b.g ? surf(b.g[0], b.g[1]) : surf(b.obb.cx, b.obb.cz);
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
    c.offsetHSL(0, 0, (seed % 1 - .5) * .06);
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
        const wc = new THREE.Color(WALL[b.wc] || WALL.white).offsetHSL(0, 0, (seed % 1 - .5) * .06);
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
    if (b.vanes || b.chimney) roofGeoms.push(...chapelDetails(b, eave));
    if (b.extras && b.extras.length) roofGeoms.push(...houseExtras(b, eave, yGround, surf));
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
      // plinth: the church has a tall dark-painted one
      bool chapel = vWall.w > 9.;
      // hand-modelled houses (seed 20+): grey surrounds around each window
      if (vWall.w >= 20.) {
        float sid; float ring = winMask(vec4(vWall.x, vWall.y - .14, vWall.z, vWall.w), sid) + winMask(vec4(vWall.x, vWall.y + .14, vWall.z, vWall.w), sid)
          + winMask(vec4(vWall.x + .14, vWall.y, vWall.z, vWall.w), sid) + winMask(vec4(vWall.x - .14, vWall.y, vWall.z, vWall.w), sid);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.42, .45, .49), step(.5, ring) * (1. - wm));
      }
      float baseBand = 1. - step(chapel ? .75 : .3, vWall.y);
      diffuseColor.rgb = mix(diffuseColor.rgb, chapel ? vec3(.2, .21, .23) : vec3(.55, .53, .5), baseBand * .9);
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
  const c = new THREE.Color(hex).offsetHSL(0, 0, (seed % 1 - .5) * .07);
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) { a[k * 3] = c.r; a[k * 3 + 1] = c.g; a[k * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
}

// Iron crosses on the gable peaks and a rendered chimney, as on Bymarkskyrkan.
function chapelDetails(b, eave) {
  const { cx, cz, len, wid, ang } = b.obb;
  const ux = Math.cos(ang), uz = Math.sin(ang), vx = -uz, vz = ux;
  const tan = Math.tan(THREE.MathUtils.degToRad(b.pitch)), ridge = eave + (wid / 2) * tan;
  const out = [];
  const put = (g, s, t, y, colour) => { g = g.toNonIndexed(); g.rotateY(-ang); g.translate(cx + ux * s + vx * t, y, cz + uz * s + vz * t); setColour(g, colour, .5); out.push(g); };
  if (b.vanes) for (const end of [-1, 1]) {
    const s = end * (len / 2 + .3);
    put(new THREE.BoxGeometry(.12, 1.8, .12), s, 0, ridge + .9, '#2a2826');
    put(new THREE.BoxGeometry(.12, .12, .8), s, 0, ridge + 1.25, '#2a2826');
  }
  if (b.chimney) {
    const s = len * .18, t = -wid * .16, yRoof = eave + (wid / 2 - Math.abs(t)) * tan;
    const h = ridge + .5 - yRoof + 1;
    put(new THREE.BoxGeometry(.9, h, .9), s, t, yRoof - 1 + h / 2, '#3b3b3e');
  }
  return out;
}

// Dormers, chimneys, canopies, pergolas and balconies for hand-modelled houses, placed in the
// building's own frame: s along its length, t across it.
function houseExtras(b, eave, yGround, surf) {
  const { cx, cz, len, wid, ang } = b.obb;
  const ux = Math.cos(ang), uz = Math.sin(ang), vx = -uz, vz = ux;
  const tan = Math.tan(THREE.MathUtils.degToRad(b.pitch));
  const at = (s, t) => [cx + ux * s + vx * t, cz + uz * s + vz * t];
  // hip roof height over a point: limited by the nearest eave line
  const roofY = (s, t) => eave + Math.max(0, Math.min(len / 2 - Math.abs(s), wid / 2 - Math.abs(t))) * tan;
  const out = [], outList = out;
  const box = (sx, sy, sz, s, t, y, colour) => {
    const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed(); g.rotateY(-ang);
    const [x, z] = at(s, t); g.translate(x, y + sy / 2, z); setColour(g, colour, .5); out.push(g);
  };
  for (const e of b.extras) {
    if (e.type === 'chimney') {
      const yr = roofY(e.s, e.t), top = eave + Math.min(len, wid) / 2 * tan + e.up;
      box(e.w, top - yr + .8, e.w, e.s, e.t, yr - .8, '#3c3f44');
      box(e.w + .14, .12, e.w + .14, e.s, e.t, top, '#2c2e32');
      if (e.vane) { box(.06, 1.1, .06, e.s, e.t, top, '#2a2826'); box(.5, .05, .05, e.s, e.t, top + .9, '#2a2826'); }
    } else if (e.type === 'dormer') {
      // a small shed dormer on the slope facing -s, with a window in its front wall
      const dir = Math.sign(e.s) || -1, front = e.s, yr = roofY(front, e.t), h = .85;
      box(1.4, h + .6, e.w, front - dir * .7, e.t, yr - .6, '#e3ddd1');
      box(1.7, .12, e.w + .25, front - dir * .6, e.t, yr + h, '#33363b');
      box(.06, .5, e.w * .55, front + dir * .02, e.t, yr + .18, '#2b333c');
    } else if (e.type === 'canopy') {
      const y = yGround + e.y;
      box(e.d, .16, e.w, e.s - e.d / 2, e.t, y, '#2f3236');
      for (const tt of [-1, 1]) box(.12, e.y, .12, e.s - e.d + .15, e.t + tt * (e.w / 2 - .2), yGround - .3, '#4a4e54');
      box(1.4, .5, e.w * .8, e.s - .7, e.t, yGround - .4, '#6d6e70');
    } else if (e.type === 'loggia' && b.notch) {
      // two-storey corner loggia: balcony slab with a white board railing, posts, a ceiling
      const n = b.notch, ss = n.corner.includes('e') ? 1 : -1, tt = n.corner.includes('s') ? 1 : -1;
      const L = len / 2, W = wid / 2, sc = ss * (L - n.ds / 2), tc = tt * (W - n.dt / 2), y = yGround + e.y;
      box(n.ds, .2, n.dt, sc, tc, y, '#ecebe6');
      box(n.ds, .16, n.dt, sc, tc, eave - .16, '#f2f1ec');
      box(n.ds, 1.0, .06, sc, tt * W, y + .2, '#f4f3ee');
      box(.06, 1.0, n.dt, ss * L, tc, y + .2, '#f4f3ee');
      const yb = surf(...at(ss * L, tt * W)) - .5;
      box(.14, eave - yb, .14, ss * L - ss * .07, tt * W - tt * .07, yb, '#f4f3ee');
      box(.14, eave - yb, .14, ss * (L - n.ds) + ss * .07, tt * W - tt * .07, yb, '#f4f3ee');
      box(.14, eave - y, .14, ss * L - ss * .07, tt * (W - n.dt) + tt * .07, y, '#f4f3ee');
    } else if (e.type === 'deck') {
      // raised wooden deck on the slope, closed with weathered board screens
      // screens on every side except the one against the house (e.open)
      const y = yGround + e.y, wood = '#8e8173', post = '#6f6255';
      const s0 = e.s - e.w / 2, s1 = e.s + e.w / 2, t0 = e.t - e.d / 2, t1 = e.t + e.d / 2;
      box(e.w, .14, e.d, e.s, e.t, y - .14, '#8a7a68');
      const low = Math.min(...[[s0, t0], [s1, t0], [s0, t1], [s1, t1]].map(p => surf(...at(...p)))) - .3, hgt = y + 1.15 - low;
      const sides = { south: [e.w, .08, e.s, t1, 'x'], north: [e.w, .08, e.s, t0, 'x'], east: [.08, e.d, s1, e.t, 'z'], west: [.08, e.d, s0, e.t, 'z'] };
      for (const [name, [sx, sz, s, t, dir]] of Object.entries(sides)) {
        if (name === e.open) continue;
        box(sx, hgt, sz, s, t, low, wood);
        const n = Math.max(2, Math.round((dir === 'x' ? e.w : e.d) / 1.1));
        for (let k = 0; k <= n; k++) box(.14, hgt + .1, .14, dir === 'x' ? s0 + k * e.w / n : s, dir === 'x' ? t : t0 + k * e.d / n, low, post);
      }
    } else if (e.type === 'awning') {
      // grey fabric awnings over the windows of one face, k-th window counted from its west/north end
      const ws = b.walls || [[-len / 2, -wid / 2], [len / 2, -wid / 2], [len / 2, wid / 2], [-len / 2, wid / 2]];
      const vert = e.face === 'west' || e.face === 'east';
      const edge = e.face === 'west' ? Math.min(...ws.map(p => p[0])) : e.face === 'east' ? Math.max(...ws.map(p => p[0]))
        : e.face === 'north' ? Math.min(...ws.map(p => p[1])) : Math.max(...ws.map(p => p[1]));
      const on = ws.filter(p => Math.abs((vert ? p[0] : p[1]) - edge) < .01).map(p => vert ? p[1] : p[0]);
      const a = Math.min(...on), fl = Math.max(...on) - a, n = Math.max(1, Math.floor(fl / 3.4)), out = Math.sign(edge);
      const y = yGround + e.floor * 3 + 2.3;
      for (const k of e.k) {
        const c = a + (k + .5) * fl / n;
        const g = new THREE.BoxGeometry(vert ? 1.0 : 1.8, .08, vert ? 1.8 : 1.0).toNonIndexed();
        if (vert) g.rotateZ(out * .5); else g.rotateX(-out * .5);
        const [x, z] = vert ? at(edge + out * .45, c) : at(c, edge + out * .45);
        g.rotateY(-ang); g.translate(x, y, z); setColour(g, '#5f6368', .5); outList.push(g);
      }
    } else if (e.type === 'pergola') {
      const [x, z] = at(e.s, e.t), y0 = surf(x, z), wood = '#a49b8d';
      for (const ss of [-1, 1]) for (const tt of [-1, 1]) box(.16, e.y, .16, e.s + ss * (e.w / 2 - .2), e.t + tt * (e.d / 2 - .2), y0, wood);
      for (const tt of [-1, 1]) box(e.w, .2, .14, e.s, e.t + tt * (e.d / 2 - .2), y0 + e.y - .2, wood);
      for (let k = -e.w / 2 + .3; k <= e.w / 2 - .3; k += .55) box(.08, .12, e.d + .3, e.s + k, e.t, y0 + e.y, wood);
    } else if (e.type === 'balcony') {
      const y = yGround + e.y;
      box(e.w, .18, e.d, e.s, e.t, y, '#ecebe6');
      box(e.w, 1, .05, e.s, e.t + e.d / 2, y + .18, '#f2f1ec');
      for (const ss of [-1, 1]) box(.05, 1, e.d, e.s + ss * e.w / 2, e.t, y + .18, '#f2f1ec');
      for (const ss of [-1, 1]) box(.14, y - surf(...at(e.s, e.t)) + .5, .14, e.s + ss * (e.w / 2 - .1), e.t + e.d / 2 - .1, surf(...at(e.s, e.t)) - .5, '#f2f1ec');
    }
  }
  return out;
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
