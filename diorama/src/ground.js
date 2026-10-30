import * as THREE from 'three';

// Paints the land-use map that the terrain tops sample: a patchwork of paper pieces.
export const GROUND = {
  meadow: '#9aa363', lawn: '#94a65e', forest: '#6c7d44', scrub: '#8a9656', water: '#3f8fbf',
  waterEdge: '#d9eef2', sand: '#d8bf86', pitch: '#7ea64e', cemetery: '#86a05a', road: '#454448',
  path: '#cdb991', rail: '#8a8075', parking: '#5c5b5e',
};

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function shade(hex, f, hue = 0) {
  const c = new THREE.Color(hex);
  const hsl = {}; c.getHSL(hsl);
  c.setHSL((hsl.h + hue + 1) % 1, Math.min(1, hsl.s * (0.9 + f * 0.2)), Math.min(1, hsl.l * (0.9 + f * 0.2)));
  return '#' + c.getHexString();
}

export function paintGround(data, px) {
  const size = data.half * 2, S = px / size;
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const g = cv.getContext('2d');
  const X = (p) => (p[0] + data.half) * S, Z = (p) => (p[1] + data.half) * S;
  const path = (pts) => { g.beginPath(); pts.forEach((p, k) => k ? g.lineTo(X(p), Z(p)) : g.moveTo(X(p), Z(p))); };
  const poly = (o, holes = []) => { g.beginPath(); for (const r of [o, ...holes]) { r.forEach((p, k) => k ? g.lineTo(X(p), Z(p)) : g.moveTo(X(p), Z(p))); g.closePath(); } };

  g.fillStyle = GROUND.meadow; g.fillRect(0, 0, px, px);
  const order = ['land:grass', 'land:shrub', 'land_cover:shrub', 'land_use:residential', 'land:forest', 'land_cover:forest',
    'land_use:cemetery', 'land_use:pitch', 'land_use:playground', 'water:pond', 'water:lake'];
  const colour = (k) => k.includes('forest') ? GROUND.forest : k.includes('shrub') ? GROUND.scrub : k.includes('cemetery') ? GROUND.cemetery
    : k.includes('pitch') ? GROUND.pitch : k.includes('playground') ? GROUND.sand : k.startsWith('water') ? GROUND.water
    : k.includes('residential') ? GROUND.lawn : GROUND.meadow;
  const areas = [...data.areas].sort((a, b) => order.indexOf(a.k) - order.indexOf(b.k));
  for (const a of areas) {
    if (!order.includes(a.k)) continue;
    poly(a.o, a.h);
    if (a.k.startsWith('water')) {
      g.lineJoin = 'miter'; g.strokeStyle = GROUND.waterEdge; g.lineWidth = 3.2 * S; g.stroke();
    }
    g.fillStyle = colour(a.k); g.fill('evenodd');
  }

  // garden plots: each a slightly different sheet of green paper with a pencil edge
  const r = rng(11);
  for (const p of data.plots) {
    poly(p);
    g.fillStyle = shade(GROUND.lawn, r() * 1.6 - .3, (r() - .5) * 0.06);
    g.fill();
    g.strokeStyle = 'rgba(60,70,30,.35)'; g.lineWidth = 0.35 * S; g.stroke();
  }

  // paths and streams under everything else
  for (const rd of data.roads) {
    if (!['footway', 'path', 'steps', 'cycleway', 'stream'].includes(rd.k)) continue;
    path(rd.p);
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = rd.k === 'stream' ? GROUND.water : GROUND.path;
    g.lineWidth = rd.w * S; g.stroke();
    if (rd.k === 'steps') { g.setLineDash([0.35 * S, 0.35 * S]); g.strokeStyle = 'rgba(80,60,40,.5)'; g.stroke(); g.setLineDash([]); }
  }

  // roads: the dark board shows, with a soft drop shadow from the cut-out plates around it
  g.save();
  g.shadowColor = 'rgba(30,20,10,.55)'; g.shadowBlur = 1.6 * S;
  for (const rd of data.roads) {
    if (['footway', 'path', 'steps', 'cycleway', 'stream'].includes(rd.k)) continue;
    path(rd.p); g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = rd.k === 'rail' ? GROUND.rail : GROUND.road; g.lineWidth = (rd.w + 1.2) * S; g.stroke();
  }
  g.restore();

  const tex = new THREE.CanvasTexture(cv);
  tex.flipY = false; // canvas row 0 is the north edge (z = -half), which the shader maps to v = 0
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}
