import * as THREE from 'three';
import { midnight } from './tz.js';

// Sun position (after SunCalc, Vladimir Agafonkin, BSD-2).
const rad = Math.PI / 180, J1970 = 2440588, J2000 = 2451545, e = rad * 23.4397;
const toDays = (d) => d.valueOf() / 864e5 - 0.5 + J1970 - J2000;
const decl = (l, b) => Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
const rasc = (l, b) => Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
function sunCoords(d) {
  const M = rad * (357.5291 + 0.98560028 * d);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  return { dec: decl(L, 0), ra: rasc(L, 0) };
}
export function sunPosition(date, lat, lng) {
  const lw = rad * -lng, phi = rad * lat, d = toDays(date);
  const c = sunCoords(d);
  const H = rad * (280.16 + 360.9856235 * d) - lw - c.ra;
  const alt = Math.asin(Math.sin(phi) * Math.sin(c.dec) + Math.cos(phi) * Math.cos(c.dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(c.dec) * Math.cos(phi));
  return { alt, az }; // az from south, positive toward west
}
export function sunDirection(p) {
  return new THREE.Vector3(-Math.sin(p.az) * Math.cos(p.alt), Math.sin(p.alt), Math.cos(p.az) * Math.cos(p.alt)).normalize();
}

// Find today's sunrise/sunset-ish times by scanning altitude (good to a minute).
export function sunEvents(day, lat, lng) {
  const start = midnight(day);
  const ev = { rise: null, set: null, noon: null };
  let prev = sunPosition(start, lat, lng).alt, best = -9;
  for (let m = 1; m <= 1440; m++) {
    const t = new Date(start.getTime() + m * 6e4), a = sunPosition(t, lat, lng).alt;
    if (prev < -0.0145 && a >= -0.0145) ev.rise = t;
    if (prev >= -0.0145 && a < -0.0145) ev.set = t;
    if (a > best) { best = a; ev.noon = t; }
    if (prev < .035 && a >= .035) ev.morning = t;          // sun 2° up
    if (prev >= .12 && a < .12) ev.golden = t;             // sun 7° up, going down
    prev = a;
  }
  if (!ev.golden && ev.set) ev.golden = new Date(ev.set.getTime() - 50 * 6e4);
  return ev;
}

const lerp = THREE.MathUtils.lerp, smooth = THREE.MathUtils.smoothstep;
const C = (h) => new THREE.Color(h);
const KEYS = [ // altitude (deg) -> sun colour, sun intensity, sky (hemi) colour, ground colour, hemi intensity, background
  [-18, C('#5a6ea8'), 0.0, C('#1d2a4d'), C('#120f14'), 0.32, C('#0b1020')],
  [-8, C('#6f7fc0'), 0.0, C('#2c3a66'), C('#1c1620'), 0.42, C('#18203b')],
  [-3, C('#ff8a5c'), 0.15, C('#5d5f94'), C('#3a2a2a'), 0.6, C('#3e3a5e')],
  [1, C('#ff7a3a'), 1.8, C('#d29a8a'), C('#7a4a30'), 1.15, C('#c98a6a')],
  [6, C('#ffa04a'), 3.2, C('#e8b48e'), C('#8a6040'), 1.25, C('#e7b07e')],
  [14, C('#ffd29a'), 3.2, C('#c4c8e0'), C('#7d6c50'), 1.1, C('#d9d3c4')],
  [30, C('#fff1dc'), 3.3, C('#c3d4f0'), C('#857558'), 1.1, C('#d6dbe0')],
  [60, C('#fff8ee'), 3.5, C('#cad9f2'), C('#8a7a5c'), 1.15, C('#dde2e6')],
];
export function lightingFor(altDeg) {
  let i = 0;
  while (i < KEYS.length - 2 && altDeg > KEYS[i + 1][0]) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = THREE.MathUtils.clamp((altDeg - a[0]) / (b[0] - a[0]), 0, 1);
  return {
    sun: a[1].clone().lerp(b[1], t), sunI: lerp(a[2], b[2], t),
    sky: a[3].clone().lerp(b[3], t), ground: a[4].clone().lerp(b[4], t), hemiI: lerp(a[5], b[5], t),
    bg: a[6].clone().lerp(b[6], t),
    night: 1 - smooth(altDeg, -6, 1.5),
  };
}
