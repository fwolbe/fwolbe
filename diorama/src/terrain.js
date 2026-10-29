import * as THREE from 'three';

// Heightfield in metres above the lowest point, scaled by the vertical exaggeration.
export function makeField(t, exag) {
  const n = t.n, cell = t.cell, half = t.size / 2;
  const h = new Float32Array(t.h.length);
  for (let i = 0; i < h.length; i++) h[i] = t.h[i] * exag;
  function at(i, j) { return h[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))]; }
  function sample(x, z) {
    const fx = (x + half) / cell, fz = (z + half) / cell;
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
  }
  let max = 0; for (const v of h) max = Math.max(max, v);
  return { n, cell, half, size: t.size, h, at, sample, max };
}

// The surface things stand on: contour steps (step > 0) or the smooth field.
export function surface(field, step) {
  return step > 0
    ? (x, z) => Math.floor(field.sample(x, z) / step + 1e-4) * step
    : (x, z) => field.sample(x, z);
}

const UP = [0, 1, 0];

// Builds the terrain as stacked cardboard sheets: each contour band is a flat top at its level,
// with a riser wall wherever the ground crosses the next level.
export function buildTerrain(field, step, baseDepth) {
  const pos = [], nor = [];
  const { n, cell, half, h } = field;
  const P = (i, j) => [i * cell - half, j * cell - half, h[j * n + i]];

  function tri(a, b, c, y) {
    // a, b, c are [x, z] at height y; emit facing +y
    const abx = b[0] - a[0], abz = b[1] - a[1], acx = c[0] - a[0], acz = c[1] - a[1];
    const cy = abz * acx - abx * acz; // y of (ab x ac)
    if (cy >= 0) { pos.push(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1]); }
    else { pos.push(a[0], y, a[1], c[0], y, c[1], b[0], y, b[1]); }
    nor.push(...UP, ...UP, ...UP);
  }
  function quad(p, q, y0, y1, nx, nz) {
    // vertical quad p->q, facing (nx, nz)
    const dx = q[0] - p[0], dz = q[1] - p[1];
    // (q - p) x up = (-dz, 0, dx)... facing check:
    let a = p, b = q;
    if ((dz * -1) * nx + dx * nz < 0) { a = q; b = p; }
    // two triangles a0 b0 b1, a0 b1 a1 with normal = (b-a) x up
    pos.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y0, a[1], b[0], y1, b[1], a[0], y1, a[1]);
    for (let k = 0; k < 6; k++) nor.push(nx, 0, nz);
  }
  function clip(poly, v, keepAbove) {
    const out = [];
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length];
      const ina = keepAbove ? a[2] >= v : a[2] <= v, inb = keepAbove ? b[2] >= v : b[2] <= v;
      if (ina) out.push(a);
      if (ina !== inb) {
        const t = (v - a[2]) / (b[2] - a[2]);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, v]);
      }
    }
    return out;
  }

  if (step <= 0) {
    const g = new THREE.PlaneGeometry(field.size, field.size, n - 1, n - 1);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) p.setY(k, field.sample(p.getX(k), p.getZ(k)));
    g.computeVertexNormals();
    return g;
  }

  const s = step;
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const A = P(i, j), B = P(i + 1, j), C = P(i + 1, j + 1), D = P(i, j + 1);
    for (const T of [[A, B, C], [A, C, D]]) {
      const v = T.map(p => [p[0], p[1], p[2] / s + ((p[2] / s) % 1 === 0 ? 1e-4 : 0)]);
      const fmin = Math.min(v[0][2], v[1][2], v[2][2]), fmax = Math.max(v[0][2], v[1][2], v[2][2]);
      const L0 = Math.floor(fmin), L1 = Math.floor(fmax);
      if (L0 === L1) { tri(v[0], v[1], v[2], L0 * s); continue; }
      for (let L = L0; L <= L1; L++) {
        let poly = v;
        if (L > L0) poly = clip(poly, L, true);
        if (L < L1) poly = clip(poly, L + 1, false);
        for (let k = 1; k + 1 < poly.length; k++) tri(poly[0], poly[k], poly[k + 1], L * s);
      }
      // gradient of f in the triangle, walls face downhill
      const [p0, p1, p2] = v;
      const e1x = p1[0] - p0[0], e1z = p1[1] - p0[1], e1f = p1[2] - p0[2];
      const e2x = p2[0] - p0[0], e2z = p2[1] - p0[1], e2f = p2[2] - p0[2];
      const det = e1x * e2z - e2x * e1z;
      const gx = (e1f * e2z - e2f * e1z) / det, gz = (e1x * e2f - e2x * e1f) / det;
      const gl = Math.hypot(gx, gz) || 1;
      for (let L = L0 + 1; L <= L1; L++) {
        const pts = [];
        for (const [a, b] of [[p0, p1], [p1, p2], [p2, p0]]) {
          if ((a[2] - L) * (b[2] - L) < 0) {
            const t = (L - a[2]) / (b[2] - a[2]);
            pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
          }
        }
        if (pts.length === 2) quad(pts[0], pts[1], (L - 1) * s, L * s, -gx / gl, -gz / gl);
      }
    }
  }

  // outer sides of the slab, down to the base
  const yb = -baseDepth;
  const sides = [
    { pts: (k) => P(k, 0), nx: 0, nz: -1 }, { pts: (k) => P(k, n - 1), nx: 0, nz: 1 },
    { pts: (k) => P(0, k), nx: -1, nz: 0 }, { pts: (k) => P(n - 1, k), nx: 1, nz: 0 },
  ];
  for (const sd of sides) {
    for (let k = 0; k < n - 1; k++) {
      const a = sd.pts(k), b = sd.pts(k + 1);
      const fa = a[2] / s, fb = b[2] / s;
      const cuts = [0];
      const lo = Math.min(fa, fb), hi = Math.max(fa, fb);
      for (let L = Math.ceil(lo); L <= hi; L++) { const t = (L - fa) / (fb - fa); if (t > 0 && t < 1) cuts.push(t); }
      cuts.push(1); cuts.sort((x, y) => x - y);
      for (let c = 0; c + 1 < cuts.length; c++) {
        const t0 = cuts[c], t1 = cuts[c + 1], tm = (t0 + t1) / 2;
        const lvl = Math.floor(fa + (fb - fa) * tm);
        const q0 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
        const q1 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
        quad(q0, q1, yb, lvl * s, sd.nx, sd.nz);
      }
    }
  }
  // bottom
  const H = half;
  pos.push(-H, yb, -H, H, yb, -H, H, yb, H, -H, yb, -H, H, yb, H, -H, yb, H);
  for (let k = 0; k < 6; k++) nor.push(0, -1, 0);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

// Smooth-mode sides (the stepped builder makes its own).
export function buildSmoothSides(field, baseDepth) {
  const pos = [], nor = [];
  const { n, cell, half, h } = field;
  const P = (i, j) => [i * cell - half, j * cell - half, h[j * n + i]];
  const yb = -baseDepth;
  const sides = [
    { pts: (k) => P(k, 0), nx: 0, nz: -1 }, { pts: (k) => P(k, n - 1), nx: 0, nz: 1 },
    { pts: (k) => P(0, k), nx: -1, nz: 0 }, { pts: (k) => P(n - 1, k), nx: 1, nz: 0 },
  ];
  for (const sd of sides) for (let k = 0; k < n - 1; k++) {
    let a = sd.pts(k), b = sd.pts(k + 1);
    const dx = b[0] - a[0], dz = b[1] - a[1];
    if ((-dz) * sd.nx + dx * sd.nz < 0) [a, b] = [b, a];
    pos.push(a[0], yb, a[1], b[0], yb, b[1], b[0], b[2], b[1], a[0], yb, a[1], b[0], b[2], b[1], a[0], a[2], a[1]);
    for (let q = 0; q < 6; q++) nor.push(sd.nx, 0, sd.nz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}
