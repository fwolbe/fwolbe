import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { cardboard } from './materials.js';

// Leaf colours by season, for the real date at Jönköping.
export function seasonOf(date) {
  const d = (date - new Date(Date.UTC(date.getUTCFullYear(), 0, 1))) / 864e5;
  if (d < 105 || d > 318) return 'winter';
  if (d < 140) return 'spring';
  if (d < 258) return 'summer';
  return 'autumn';
}
const LEAF = {
  spring: ['#9cc25a', '#8ab54f', '#b0cd6a', '#a6c76b'],
  summer: ['#6f9a3e', '#5f8c37', '#7ea845', '#6a933f', '#86a94c'],
  autumn: ['#c99a3a', '#b8782f', '#d2ab4a', '#a65a30', '#9a9a44', '#7f8c3c', '#b98e3e', '#6f8a3a', '#8b7a52'],
  winter: ['#7a6a58', '#6e604f', '#857462'],
};
const CONIFER = ['#3f6a3a', '#355f35', '#4a7442', '#2f5531'];

const SWAY = `
  vec4 ipos = instanceMatrix[3];
  float sw = sin(uTime * 1.6 + ipos.x * .37 + ipos.z * .23) + .4 * sin(uTime * 3.1 + ipos.x);
  transformed.x += sw * uWind * .09 * max(position.y, 0.);
  transformed.z += cos(uTime * 1.3 + ipos.z * .31) * uWind * .06 * max(position.y, 0.);
`;

function faceted(geo) { const g = geo.toNonIndexed(); g.computeVertexNormals(); return g; }

export function buildTrees(data, surf, date) {
  const season = seasonOf(date);
  const parts = {
    crown: faceted(new THREE.IcosahedronGeometry(1, 1)).translate(0, 0, 0),
    small: faceted(new THREE.IcosahedronGeometry(1, 0)),
    birch: faceted(new THREE.IcosahedronGeometry(1, 1)),
    cone: faceted(mergeGeometries([
      new THREE.ConeGeometry(1, .55, 7).translate(0, .28, 0).toNonIndexed(),
      new THREE.ConeGeometry(.78, .48, 7).translate(0, .58, 0).toNonIndexed(),
      new THREE.ConeGeometry(.52, .42, 7).translate(0, .84, 0).toNonIndexed(),
    ])),
    trunk: new THREE.CylinderGeometry(.5, .7, 1, 6).translate(0, .5, 0).toNonIndexed(),
  };
  const leafMat = cardboard(new THREE.MeshStandardMaterial({ roughness: .95, flatShading: true }), { key: 'leaf', vertexBody: SWAY });
  const trunkMat = cardboard(new THREE.MeshStandardMaterial({ roughness: .95 }), { key: 'trunk' });

  const lists = { crown: [], small: [], birch: [], cone: [], trunk: [] };
  const rnd = (s, k) => { const x = Math.sin(s * 9301 + k * 49297) * 233280; return x - Math.floor(x); };
  for (const [x, z, h0, r0, kind, s] of data.trees) {
    const y = surf(x, z);
    const h = Math.max(h0, 1.2), r = r0;
    const lc = LEAF[season], pick = (arr) => arr[Math.floor(rnd(s, 1) * arr.length) % arr.length];
    if (kind === 'spruce') {
      lists.trunk.push({ x, y, z, sx: .35, sy: h * .2, sz: .35, c: '#6b4a2e' });
      lists.cone.push({ x, y: y + h * .12, z, sx: r * 1.1, sy: h * .95, sz: r * 1.1, c: pick(CONIFER), ry: s * 6 });
    } else if (kind === 'pine') {
      lists.trunk.push({ x, y, z, sx: .3, sy: h * .75, sz: .3, c: '#8a5a36' });
      lists.crown.push({ x, y: y + h * .78, z, sx: r, sy: r * .6, sz: r, c: pick(CONIFER), ry: s * 6 });
    } else if (kind === 'birch') {
      lists.trunk.push({ x, y, z, sx: .22, sy: h * .55, sz: .22, c: '#e9e4d8' });
      lists.birch.push({ x, y: y + h * .64, z, sx: r * .85, sy: h * .34, sz: r * .85, c: season === 'autumn' ? (rnd(s, 5) < .5 ? '#cfae48' : '#a9a24a') : pick(lc), ry: s * 6 });
    } else if (kind === 'bush') {
      lists.small.push({ x, y: y + h * .35, z, sx: r, sy: Math.max(h * .55, .6), sz: r, c: season === 'winter' ? '#5f6e45' : shadeHex(pick(LEAF.summer), -.08), ry: s * 6 });
    } else if (kind === 'fruit') {
      lists.trunk.push({ x, y, z, sx: .2, sy: h * .45, sz: .2, c: '#6b4a2e' });
      lists.small.push({ x, y: y + h * .62, z, sx: r, sy: h * .38, sz: r, c: pick(lc), ry: s * 6 });
    } else {
      lists.trunk.push({ x, y, z, sx: .3, sy: h * .45, sz: .3, c: '#6b4a2e' });
      lists.crown.push({ x, y: y + h * .6, z, sx: r, sy: h * .42, sz: r * (.9 + rnd(s, 2) * .2), c: pick(lc), ry: s * 6 });
    }
  }
  const group = new THREE.Group();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
  for (const [k, list] of Object.entries(lists)) {
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(parts[k], k === 'trunk' ? trunkMat : leafMat, list.length);
    list.forEach((t, i) => {
      e.set(0, t.ry || 0, 0); q.setFromEuler(e);
      m.compose(new THREE.Vector3(t.x, t.y, t.z), q, new THREE.Vector3(t.sx, t.sy, t.sz));
      mesh.setMatrixAt(i, m);
      col.set(t.c); col.offsetHSL((rnd(i, 3) - .5) * .02, 0, (rnd(i, 4) - .5) * .08);
      mesh.setColorAt(i, col);
    });
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  }
  return { group, season };
}

function shadeHex(hex, d) { return '#' + new THREE.Color(hex).offsetHSL(0, 0, d).getHexString(); }

// Hedges: boxes of clipped green along plot edges.
export function buildHedges(data, surf, date) {
  const season = seasonOf(date);
  const geo = faceted(new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0));
  const mat = cardboard(new THREE.MeshStandardMaterial({ roughness: .95 }), { key: 'hedge' });
  const mesh = new THREE.InstancedMesh(geo, mat, data.hedges.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  data.hedges.forEach((hd, i) => {
    const [a, b] = [hd.p[0], hd.p[hd.p.length - 1]];
    const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const y = Math.min(surf(a[0], a[1]), surf(b[0], b[1]), surf(cx, cz));
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(b[1] - a[1], b[0] - a[0]));
    m.compose(new THREE.Vector3(cx, y - .3, cz), q, new THREE.Vector3(len, hd.h + .3, hd.t === 'thuja' ? 1.1 : .9));
    mesh.setMatrixAt(i, m);
    col.set(hd.t === 'thuja' ? '#3f6338' : season === 'autumn' ? '#7d8a3a' : season === 'winter' ? '#6a6a48' : '#5d8a3a');
    col.offsetHSL(0, 0, (Math.sin(i * 12.9898) * .5) * .06);
    mesh.setColorAt(i, col);
  });
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}
