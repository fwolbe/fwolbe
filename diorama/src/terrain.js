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

// Clip a convex polygon of [x, z, f] points against half-planes nx*x + nz*z <= d.
function clipPlanes(poly, planes) {
  for (const [nx, nz, d] of planes) {
    if (poly.length < 3) return poly;
    const out = [];
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length];
      const da = nx * a[0] + nz * a[1] - d, db = nx * b[0] + nz * b[1] - d;
      if (da <= 0) out.push(a);
      if ((da <= 0) !== (db <= 0)) {
        const t = da / (da - db);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      }
    }
    poly = out;
  }
  return poly;
}

// Clip by the scalar f: keep f >= v (above) or f <= v.
function clipLevel(poly, v, keepAbove) {
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

// Builds the board as stacked cardboard sheets cut to the plate outline: each contour band is a
// flat top at its level, with a riser wall wherever the ground crosses the next level.
// step = 0 gives a smooth surface instead.
export function buildTerrain(field, step, baseDepth, plate) {
  const pos = [], nor = [];
  const { n, cell, half, h } = field;
  const s = step > 0 ? step : 1;
  const smooth = step <= 0;
  const P = (i, j) => [i * cell - half, j * cell - half, h[j * n + i] / s];
  const r = plate.r;
  const normalAt = (x, z) => {
    const e = 1.5, dx = (field.sample(x + e, z) - field.sample(x - e, z)) / (2 * e), dz = (field.sample(x, z + e) - field.sample(x, z - e)) / (2 * e);
    const l = Math.hypot(dx, 1, dz); return [-dx / l, 1 / l, -dz / l];
  };

  function fan(poly, yOf) {
    for (let k = 1; k + 1 < poly.length; k++) {
      let a = poly[0], b = poly[k], c = poly[k + 1];
      const cy = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
      if (cy < 0) [b, c] = [c, b];
      for (const p of [a, b, c]) {
        pos.push(p[0], yOf(p), p[1]);
        if (smooth) nor.push(...normalAt(p[0], p[1])); else nor.push(0, 1, 0);
      }
    }
  }
  function quad(p, q, y0p, y1p, y0q, y1q, nx, nz) {
    let a = p, b = q, a0 = y0p, a1 = y1p, b0 = y0q, b1 = y1q;
    const dx = q[0] - p[0], dz = q[1] - p[1];
    if (-dz * nx + dx * nz < 0) { a = q; b = p; a0 = y0q; a1 = y1q; b0 = y0p; b1 = y1p; }
    pos.push(a[0], a0, a[1], b[0], b0, b[1], b[0], b1, b[1], a[0], a0, a[1], b[0], b1, b[1], a[0], a1, a[1]);
    for (let k = 0; k < 6; k++) nor.push(nx, 0, nz);
  }

  const i0 = Math.max(0, Math.floor((-r + half) / cell) - 1), i1 = Math.min(n - 2, Math.ceil((r + half) / cell));
  for (let j = i0; j <= i1; j++) for (let i = i0; i <= i1; i++) {
    const A = P(i, j), B = P(i + 1, j), C = P(i + 1, j + 1), D = P(i, j + 1);
    const allIn = [A, B, C, D].every(p => plate.inside(p[0], p[1]));
    const cx = (A[0] + C[0]) / 2, cz = (A[1] + C[1]) / 2;
    if (!allIn && !plate.inside(cx, cz, -cell * 1.5)) continue;
    for (const T0 of [[A, B, C], [A, C, D]]) {
      let T = T0.map(p => [p[0], p[1], p[2] + (p[2] % 1 === 0 ? 1e-4 : 0)]);
      if (!allIn) { T = clipPlanes(T, plate.planes); if (T.length < 3) continue; }
      if (smooth) { fan(T, p => p[2] * s); continue; }
      const fs = T.map(p => p[2]);
      const L0 = Math.floor(Math.min(...fs)), L1 = Math.floor(Math.max(...fs));
      if (L0 === L1) { fan(T, () => L0 * s); continue; }
      for (let L = L0; L <= L1; L++) {
        let poly = T;
        if (L > L0) poly = clipLevel(poly, L, true);
        if (L < L1) poly = clipLevel(poly, L + 1, false);
        if (poly.length >= 3) fan(poly, () => L * s);
      }
      // walls face downhill, along the triangle's gradient
      const [p0, p1, p2] = T0;
      const e1x = p1[0] - p0[0], e1z = p1[1] - p0[1], e1f = p1[2] - p0[2];
      const e2x = p2[0] - p0[0], e2z = p2[1] - p0[1], e2f = p2[2] - p0[2];
      const det = e1x * e2z - e2x * e1z;
      const gx = (e1f * e2z - e2f * e1z) / det, gz = (e1x * e2f - e2x * e1f) / det;
      const gl = Math.hypot(gx, gz) || 1;
      for (let L = L0 + 1; L <= L1; L++) {
        const pts = [];
        for (let k = 0; k < T.length; k++) {
          const a = T[k], b = T[(k + 1) % T.length];
          if ((a[2] - L) * (b[2] - L) < 0) { const t = (L - a[2]) / (b[2] - a[2]); pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
        }
        if (pts.length === 2) quad(pts[0], pts[1], (L - 1) * s, L * s, (L - 1) * s, L * s, -gx / gl, -gz / gl);
      }
    }
  }

  // the cut edge of the board, down to the base, following the plate outline
  const yb = -baseDepth;
  const poly = plate.poly, m = poly.length;
  for (let k = 0; k < m; k++) {
    const a = poly[k], b = poly[(k + 1) % m];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), pieces = Math.max(1, Math.ceil(len / 1));
    let nx = b[1] - a[1], nz = -(b[0] - a[0]); const nl = Math.hypot(nx, nz); nx /= nl; nz /= nl;
    if (nx * (a[0] + b[0]) + nz * (a[1] + b[1]) < 0) { nx = -nx; nz = -nz; }
    for (let q = 0; q < pieces; q++) {
      const t0 = q / pieces, t1 = (q + 1) / pieces;
      const p = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], e = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
      const fa = field.sample(p[0], p[1]) / s, fb = field.sample(e[0], e[1]) / s;
      if (smooth) { quad(p, e, yb, fa * s, yb, fb * s, nx, nz); continue; }
      const cuts = [0, 1];
      for (let L = Math.ceil(Math.min(fa, fb)); L <= Math.max(fa, fb); L++) { const t = (L - fa) / (fb - fa); if (t > 0 && t < 1) cuts.push(t); }
      cuts.sort((x, y) => x - y);
      for (let c = 0; c + 1 < cuts.length; c++) {
        const u0 = cuts[c], u1 = cuts[c + 1], lvl = Math.floor(fa + (fb - fa) * (u0 + u1) / 2);
        const q0 = [p[0] + (e[0] - p[0]) * u0, p[1] + (e[1] - p[1]) * u0], q1 = [p[0] + (e[0] - p[0]) * u1, p[1] + (e[1] - p[1]) * u1];
        quad(q0, q1, yb, lvl * s, yb, lvl * s, nx, nz);
      }
    }
  }
  // underside
  for (let k = 1; k + 1 < m; k++) {
    const a = poly[0], b = poly[k], c = poly[k + 1];
    pos.push(a[0], yb, a[1], b[0], yb, b[1], c[0], yb, c[1]);
    for (let q = 0; q < 3; q++) nor.push(0, -1, 0);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}
