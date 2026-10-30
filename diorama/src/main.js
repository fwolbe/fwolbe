import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import DATA from 'site-data';
import { makeField, surface, buildTerrain } from './terrain.js';
import { cardboard, U, WALL_GLSL, STYLES } from './materials.js';
import { makePlate } from './plate.js';
import { paintGround } from './ground.js';
import { buildBuildings } from './buildings.js';
import { buildTrees, buildHedges } from './trees.js';
import { buildRoads, roadGraph, buildLamps, roadHeight, ROAD_SNOW } from './roads.js';
import { buildTraffic } from './cars.js';
import { buildBuses } from './buses.js';
import { sunPosition, sunDirection, lightingFor, sunEvents } from './sky.js';
import { buildWeather, PRESETS, fetchLive } from './weather.js';
import { TiltShiftShader, FinishShader } from './post.js';
import { setupUI } from './ui.js';
import { local, atLocal } from './tz.js';

const SITE = __SITE__;
const LAT = DATA.origin.lat, LON = DATA.origin.lon, HALF = DATA.half;
document.getElementById('site-name').textContent = SITE.name;
document.getElementById('site-sub').textContent = SITE.subtitle;
const params = new URLSearchParams(location.search);
const MOBILE = matchMedia('(pointer: coarse)').matches || innerWidth < 760;
const BASE = 10;

const state = {
  live: true, time: new Date(), lapse: false,
  weatherMode: params.get('weather') || 'live', live_w: null, weather: { ...PRESETS.partly },
  step: Number(params.get('step') ?? 0), exag: Number(params.get('exag') ?? 1.5),
  tilt: params.get('tilt') !== '0', autoRotate: false,
  style: STYLES[params.get('style')] != null ? params.get('style') : 'cardboard',
  crop: Number(params.get('crop') || 120), shape: params.get('shape') === 'square' ? 'square' : 'round',
};
let plate = makePlate(state.shape, state.crop);
if (params.get('date')) state.time = new Date(params.get('date') + 'T12:00:00Z');
if (params.get('t')) { const [h, m] = params.get('t').split(':').map(Number); state.live = false; state.time = atLocal(state.time, h, m || 0); }

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('shot') });
renderer.setPixelRatio(params.has('pr') ? Number(params.get('pr')) : Math.min(devicePixelRatio, MOBILE ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = !params.has('noshadow');
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.info.autoReset = false;
document.getElementById('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 2, 5000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = .08;
controls.screenSpacePanning = false;
controls.minDistance = 30; controls.maxDistance = 1400;
controls.maxPolarAngle = 1.32; controls.minPolarAngle = .12;
controls.zoomToCursor = true;
controls.autoRotateSpeed = .35;

// ------------------------------------------------------------------ lights
const hemi = new THREE.HemisphereLight('#c3d4f0', '#857558', 1);
const sun = new THREE.DirectionalLight('#fff1dc', 3);
sun.castShadow = true;
sun.shadow.mapSize.set(MOBILE ? 2048 : 4096, MOBILE ? 2048 : 4096);
const sc = sun.shadow.camera; sc.left = -400; sc.right = 400; sc.top = 400; sc.bottom = -400; sc.near = 10; sc.far = 1600;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = .6; sun.shadow.radius = 3;
const moon = new THREE.DirectionalLight('#8fa6ff', 0);
moon.position.set(-200, 400, -100);
scene.add(hemi, sun, sun.target, moon);

// ------------------------------------------------------------------ table
const tableMat = cardboard(new THREE.MeshStandardMaterial({ color: '#5b4c3f', roughness: 1 }), {
  key: 'table', cat: 'SELF', colorBody: `diffuseColor.rgb *= .85 + .15 * vnoise(vW.xz * .02) + .05 * vnoise(vW.xz * .4);`,
});
const table = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000).rotateX(-Math.PI / 2), tableMat);
table.position.y = -BASE - .02;
table.receiveShadow = true;
scene.add(table);

// ------------------------------------------------------------------ the diorama (rebuilt when terrain settings change)
const groundTex = paintGround(DATA, MOBILE ? 2048 : 4096);
const terrainMat = cardboard(new THREE.MeshStandardMaterial({ roughness: .95 }), {
  key: 'terrain', cat: 'SELF',
  uniforms: { uGround: { value: groundTex }, uHalf: { value: HALF }, uTop: { value: 100 } },
  fragmentHead: `uniform sampler2D uGround; uniform float uHalf, uTop; ${WALL_GLSL}`,
  colorBody: `
    vec3 tex = texture2D(uGround, (vW.xz + uHalf) / (2. * uHalf)).rgb;
    bool water = tex.b > tex.r + .12 && tex.b > tex.g;
    float lv = floor(vW.y / uStep + .02);
    if (vWN.y > .5) {
      float hgt = clamp(vW.y / uTop, 0., 1.);
      if (uStyle < .5) {
        // each sheet a slightly different board; higher sheets lighter and warmer
        diffuseColor.rgb = tex * (.92 + .08 * fract(lv * .618)) * (.74 + .4 * hgt);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.06, 1.02, .9), hgt * .6);
      } else if (uStyle < 1.5) {
        diffuseColor.rgb = water ? vec3(.78, .85, .9) : vec3(.95, .935, .905) * (.95 + .06 * fract(lv * .618));
      } else {
        float l = dot(tex, vec3(.299, .587, .114));
        vec3 f = mix(mix(vec3(l), tex, 1.12), vec3(l) * 1.02 + .05, .16);
        diffuseColor.rgb = f * (.74 + .42 * feltFibre(vW, vWN)) * (.88 + .1 * fract(lv * .618) + .1 * hgt);
      }
    } else if (vWN.y < -.5) {
      diffuseColor.rgb = vec3(.42, .32, .22);
    } else if (uStyle < .5) {
      diffuseColor.rgb = kraft(vW, vWN, uStep);
    } else if (uStyle < 1.5) {
      float lay = fract(vW.y / uStep), px = fwidth(vW.y / uStep);
      float seam = 1. - smoothstep(0., max(px * 1.5, .04), lay) * smoothstep(0., max(px * 1.5, .04), 1. - lay);
      diffuseColor.rgb = mix(vec3(.9, .88, .84), vec3(.6, .58, .55), seam * .7);
    } else {
      // a sheet of moss felt per layer, blanket-stitched along its top edge
      float lay = fract(vW.y / uStep);
      float h = abs(vWN.x) > abs(vWN.z) ? vW.z : vW.x;
      float spx = fwidth(h / .9);
      float stitch = step(.86, lay) * step(lay, .93) * step(fract(h / .9), .55) * clamp(1. - spx * 2., 0., 1.);
      vec3 felt = vec3(.40, .47, .30) * (.74 + .42 * feltFibre(vW, vWN)) * (.85 + .15 * fract(floor(vW.y / uStep) * .618));
      diffuseColor.rgb = mix(felt, vec3(.93, .88, .74), stitch);
    }`,
});

// relay for real-time buses: ?buses=<url>, or busRelay in config.json at build time
const BUS_RELAY = params.get('buses') || SITE.relay;
let buses = null;
let world = null, field = null, surf = null, traffic = null, lamps = null, roadMat = null, graph = null, home = null;
function build() {
  if (world) { scene.remove(world); world.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
  world = new THREE.Group();
  field = makeField(DATA.terrain, state.exag);
  surf = surface(field, state.step);
  U.uStep.value = state.step > 0 ? state.step : 2;
  terrainMat.userData.top = field.max;
  plate = makePlate(state.shape, state.crop);
  // relief inside this plate; the board is only as thick as the lowest ground needs
  let lo = Infinity, hi = -Infinity;
  for (let x = -plate.r; x <= plate.r; x += 2) for (let z = -plate.r; z <= plate.r; z += 2) {
    if (!plate.inside(x, z)) continue; const y = surf(x, z); lo = Math.min(lo, y); hi = Math.max(hi, y);
  }
  plate.lo = lo; plate.hi = hi;
  plate.bottom = lo - THREE.MathUtils.clamp(plate.r * .04, 3, BASE);
  table.position.y = plate.bottom - .02;
  const tg = buildTerrain(field, state.step, -plate.bottom, plate);
  const terrain = new THREE.Mesh(tg, terrainMat);
  terrain.receiveShadow = true; terrain.castShadow = true;
  world.add(terrain);
  const roads = buildRoads(DATA, field, surf, plate); roadMat = roads.roadMat; world.add(roads.group);
  const bld = buildBuildings(DATA, surf, plate.inside); world.add(bld.group);
  buildingLines = bld.lines;
  world.add(buildTrees(DATA, surf, state.time, state.style, plate.inside).group);
  world.add(buildHedges(DATA, surf, state.time, plate.inside));
  lamps = buildLamps(DATA, field, plate); world.add(lamps.group);
  graph = roadGraph(DATA);
  traffic = buildTraffic(graph, field, plate); world.add(traffic.group);
  if (buses) buses.dispose();
  buses = buildBuses(DATA, field, graph, () => plate, BUS_RELAY, SITE.transitSite); world.add(buses.group);
  home = homeMarker(bld.info); world.add(home.obj);
  world.add(nameplate());
  scene.add(world);
  if (weatherFx) { scene.remove(weatherFx.group); }
  weatherFx = buildWeather(plate.r, hi); scene.add(weatherFx.group);
  applyStyle();
}

// Per-style table, outlines and grade
let buildingLines = null;
const STYLE_LOOK = {
  cardboard: { table: '#5b4c3f', lines: .45, sat: 1.08, exposure: 1 },
  white: { table: '#3b2e25', lines: .28, sat: .92, exposure: .86 },
  felt: { table: '#4d5a55', lines: 0, sat: 1.12, exposure: 1.02 },
};
function applyStyle() {
  const look = STYLE_LOOK[state.style];
  U.uStyle.value = STYLES[state.style];
  tableMat.color.set(look.table);
  if (buildingLines) { buildingLines.visible = look.lines > 0; buildingLines.material.opacity = look.lines; buildingLines.material.color.set(state.style === 'white' ? '#6b6560' : '#3a2617'); }
  finish.uniforms.sat.value = look.sat;
  styleExposure = look.exposure;
}
let styleExposure = 1;

// A cardboard map pin over home.
function homeMarker(info) {
  let best = null, bd = 1e9;
  for (const i of info) { const d = Math.hypot(i.b.obb.cx, i.b.obb.cz); if (i.b.kind !== 'shed' && d < bd) { bd = d; best = i; } }
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.bezierCurveTo(-1.2, 2.2, -3.2, 3.6, -3.2, 5.6); s.absarc(0, 5.6, 3.2, Math.PI, 0, true); s.bezierCurveTo(3.2, 3.6, 1.2, 2.2, 0, 0);
  const hole = new THREE.Path(); hole.absarc(0, 5.6, 1.3, 0, Math.PI * 2, false); s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: .7, bevelEnabled: false, curveSegments: 18 }); g.translate(0, 0, -.35);
  const pin = new THREE.Mesh(g, cardboard(new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: .8, emissive: '#f2c230', emissiveIntensity: 0 }), { key: 'pin', cat: 'KEEP' }));
  pin.castShadow = true;
  const obj = new THREE.Group(); obj.add(pin);
  const x = best ? best.b.obb.cx : 0, z = best ? best.b.obb.cz : 0, y = best ? best.top + 3 : surf(0, 0) + 10;
  obj.position.set(x, y, z);
  return { obj, pin, base: y, x, z };
}

// true (unexaggerated) height above the lowest point
const RAW = makeField(DATA.terrain, 1);
const DATA_RELIEF = (x, z) => RAW.sample(x, z);

// A brass-and-card nameplate on the south face of the slab.
function nameplate() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#2a2420'; g.fillRect(0, 0, 1024, 160);
  g.strokeStyle = '#f2c230'; g.lineWidth = 8; g.strokeRect(14, 14, 996, 132);
  g.fillStyle = '#f2c230'; g.font = 'italic 900 74px "Russo One", "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(`${SITE.name}${SITE.subtitle ? ' · ' + SITE.subtitle.split('·')[0].trim() : ''}`.toUpperCase(), 512, 72, 960);
  g.font = '600 26px system-ui, sans-serif'; g.fillStyle = '#e9dcc0';
  let lo = Infinity, hi = -Infinity;
  for (let x = -plate.r; x <= plate.r; x += 4) for (let z = -plate.r; z <= plate.r; z += 4) if (plate.inside(x, z)) { const v = DATA_RELIEF(x, z); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  g.fillText(`${LAT.toFixed(4)}° N   ${LON.toFixed(4)}° E   ·   ${Math.round(hi - lo)} m relief`, 512, 124);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(120, 18.75), new THREE.MeshStandardMaterial({ map: t, roughness: .6 }));
  const yb = plate.bottom;
  const w = Math.min(120, plate.r * 1.1), half = w / 2, zf = plate.r - .01;
  let y = Infinity; for (let x = -half; x <= half; x += 2) y = Math.min(y, surf(x, plate.round ? Math.sqrt(Math.max(0, zf * zf - x * x)) : zf));
  const sc = Math.min(w / 120, (y - yb) / 22);
  m.scale.setScalar(Math.max(.15, sc));
  m.position.set(0, yb + 18.75 * m.scale.y / 2 + .6, plate.r + .15);
  return m;
}

// ------------------------------------------------------------------ weather + post
let weatherFx = null;

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { samples: 4, type: THREE.HalfFloatType }));
composer.setPixelRatio(renderer.getPixelRatio());
composer.addPass(new RenderPass(scene, camera));
let gtao = null;
if (!MOBILE && params.get('ao') !== '0') {
  gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = .9;
  gtao.updateGtaoMaterial({ radius: 2.2, distanceExponent: 1.5, thickness: 2, scale: 1.2, samples: 12 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
  composer.addPass(gtao);
}
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), .0, .55, .82);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const tilts = [0, 1, 2, 3].map(i => { const p = new ShaderPass(TiltShiftShader); p.uniforms.dir.value.set(i % 2 ? 0 : 1, i % 2 ? 1 : 0); composer.addPass(p); return p; });
const [tiltH, tiltV] = tilts;
const finish = new ShaderPass(FinishShader);
composer.addPass(finish);

function resize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  for (const p of tilts) p.uniforms.res.value.set(innerWidth, innerHeight);
}
addEventListener('resize', resize);

// ------------------------------------------------------------------ time, light, weather state
let events = sunEvents(state.time, LAT, LON);
function trafficDensity(d) {
  const l = local(d), h = l.h + l.m / 60, wd = l.dow % 6 !== 0;
  const g = (c, w) => Math.exp(-(((h - c) / w) ** 2));
  let v = .06 + .32 * g(13, 4.5) + (wd ? .62 * g(7.6, 1) + .55 * g(16.6, 1.4) : .25 * g(12, 3));
  if (h < 5.5 || h > 23) v = .04;
  return Math.min(1, v);
}
function currentWeather() {
  if (state.weatherMode === 'live') return state.live_w || PRESETS.partly;
  return { ...PRESETS[state.weatherMode], windDir: state.live_w?.windDir ?? 230, temp: state.live_w?.temp };
}
const cur = { cloud: .3, rain: 0, snow: 0, fog: 0, wind: .3, cover: 0 };
function applyLight(dt) {
  const p = sunPosition(state.time, LAT, LON);
  const altDeg = p.alt * 180 / Math.PI;
  const L = lightingFor(altDeg);
  const w = currentWeather();
  const k = 1 - Math.exp(-dt * 1.5);
  for (const key of ['cloud', 'rain', 'snow', 'fog', 'wind']) cur[key] += ((w[key] ?? 0) - cur[key]) * k;
  cur.cover += ((w.cover ?? (w.snow > .3 ? 1 : 0)) - cur.cover) * (1 - Math.exp(-dt * .5));
  const overcast = THREE.MathUtils.smoothstep(cur.cloud, .4, 1);
  const dir = sunDirection(p);
  const d = dir.y > .02 ? dir : new THREE.Vector3(dir.x, .02, dir.z).normalize();
  sun.position.copy(d).multiplyScalar(700); sun.target.position.set(0, 0, 0);
  sun.color.copy(L.sun);
  sun.intensity = L.sunI * (1 - overcast * .78) * (1 - cur.fog * .5);
  sun.shadow.radius = 2 + overcast * 10 + (state.style === 'felt' ? 5 : 0);
  hemi.color.copy(L.sky).lerp(new THREE.Color('#b9bcc2'), overcast * .5);
  hemi.groundColor.copy(L.ground);
  hemi.intensity = L.hemiI * (1 + overcast * .35) * (1 + THREE.MathUtils.smoothstep(altDeg, -3, 2) * (1 - THREE.MathUtils.smoothstep(altDeg, 6, 16)) * .5);
  moon.intensity = L.night * .55;
  const bg = L.bg.clone().lerp(new THREE.Color('#9ea3a8').multiplyScalar(.4 + (1 - L.night) * .6), overcast * .6);
  scene.background = bg;
  const fogDen = cur.fog;
  if (!scene.fog) scene.fog = new THREE.Fog(bg, 400, 3000);
  scene.fog.color.copy(bg);
  scene.fog.near = THREE.MathUtils.lerp(900, 60, fogDen); scene.fog.far = THREE.MathUtils.lerp(3200, 520, fogDen);
  U.uNight.value = L.night;
  U.uWet.value = cur.rain;
  U.uSnow.value = cur.cover;
  ROAD_SNOW.value = cur.cover * .35;
  U.uWind.value = cur.wind;
  bloom.strength = .15 + L.night * .85;
  bloom.threshold = .82 - L.night * .2;
  const golden = THREE.MathUtils.smoothstep(altDeg, -3, 2) * (1 - THREE.MathUtils.smoothstep(altDeg, 6, 16));
  renderer.toneMappingExposure = (1.0 + L.night * .25 + golden * .45) * styleExposure;
  if (lamps) { lamps.headMat.emissiveIntensity = L.night * 3.2; lamps.poolMat.opacity = L.night * .42; }
  if (roadMat) roadMat.roughness = .9 - cur.rain * .55;
  finish.uniforms.night.value = L.night;
  return { altDeg, L };
}

// ------------------------------------------------------------------ boot
build();
resize();

const ui = setupUI({
  state, events: () => events,
  onTerrain(kind) { build(); if (kind === 'plate') flyTo('overview'); },
  onTime() { events = sunEvents(state.time, LAT, LON); },
  onView(kind) { flyTo(kind); },
});

async function refreshWeather() {
  try { state.live_w = await fetchLive(LAT, LON); ui.weatherStatus(state.live_w, null); }
  catch (e) { ui.weatherStatus(null, e); }
}
refreshWeather(); setInterval(refreshWeather, 10 * 60e3);

// camera intro: from high above, settle into a three-quarter view toward home
const look = new THREE.Vector3(0, surf(0, 0), 0);
controls.target.copy(look);
const views = {
  home: { az: 1.15, pol: 1.02, dist: 260 },
  overview: { az: .42, pol: 1.1, dist: 800 },
  top: { az: 0, pol: .14, dist: 980 },
  street: { az: 1.2, pol: 1.25, dist: 95 },
};
function sph(v) { return new THREE.Vector3(Math.sin(v.pol) * Math.sin(v.az), Math.cos(v.pol), Math.sin(v.pol) * Math.cos(v.az)).multiplyScalar(v.dist); }
let fly = null;
function flyTo(kind) {
  let v = views[kind]; if (!v) return;
  const k = plate.r / 260, mid = (plate.lo + plate.hi) / 2;
  if (kind === 'overview') v = { ...v, dist: Math.max(150, v.dist * k) };
  if (kind === 'top') v = { ...v, dist: Math.max(170, v.dist * k) };
  if (kind === 'home') v = { ...v, dist: Math.min(v.dist, plate.r * 1.5 + 70) };
  const tgt = kind === 'home' || kind === 'street' ? new THREE.Vector3(home.x, surf(home.x, home.z), home.z)
    : kind === 'overview' ? new THREE.Vector3(10 * k, mid * .75, 70 * k) : new THREE.Vector3(0, mid, 0);
  controls.maxDistance = Math.max(450, plate.r * 5);
  fly = { t: 0, dur: 1.8, p0: camera.position.clone(), t0: controls.target.clone(), p1: tgt.clone().add(sph(v)), t1: tgt };
}
camera.position.copy(look).add(sph({ az: .2, pol: .35, dist: 1500 }));
if (params.get('view')) flyTo(params.get('view')); else flyTo('overview');
if (params.has('shot')) { fly.t = fly.dur; }
if (params.get('cam')) {
  // debug: ?cam=x,z,height,tx,tz puts the camera at a ground point looking at another
  const [x, z, h, tx, tz] = params.get('cam').split(',').map(Number);
  fly = null; camera.position.set(x, surf(x, z) + h, z); controls.target.set(tx, surf(tx, tz) + 4, tz);
}
controls.addEventListener('start', () => { fly = null; });

const clock = new THREE.Clock();
let t = 0, frames = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), .1);
  t += dt;
  if (state.live && !state.lapse) state.time = new Date();
  if (state.lapse) { state.time = new Date(state.time.getTime() + dt * 600e3); ui.syncTime(); }
  U.uTime.value = t;
  const { altDeg } = applyLight(dt);
  const w = currentWeather();
  weatherFx.update(t, dt, { ...cur, windDir: w.windDir }, (x, z) => (plate.inside(x, z) ? surf(x, z) : plate.bottom));
  traffic.update(state.lapse ? dt * 4 : dt, trafficDensity(state.time), U.uNight.value);
  buses.update(dt, state.live && !state.lapse, U.uNight.value);
  busLabel(buses.status);
  home.obj.position.y = home.base + Math.sin(t * 1.6) * .8;
  home.pin.rotation.y = t * .8;
  home.pin.material.emissiveIntensity = U.uNight.value * .6;
  if (fly) {
    fly.t += dt;
    const k = THREE.MathUtils.smootherstep(Math.min(1, fly.t / fly.dur), 0, 1);
    camera.position.lerpVectors(fly.p0, fly.p1, k);
    controls.target.lerpVectors(fly.t0, fly.t1, k);
    if (fly.t >= fly.dur) fly = null;
  }
  controls.autoRotate = state.autoRotate;
  controls.update();
  controls.target.x = THREE.MathUtils.clamp(controls.target.x, -plate.r, plate.r);
  controls.target.z = THREE.MathUtils.clamp(controls.target.z, -plate.r, plate.r);
  // shadow frustum follows what's in view
  const dist = camera.position.distanceTo(controls.target);
  const ext = THREE.MathUtils.clamp(dist * .9, 60, Math.min(400, plate.r * 1.5 + 20));
  const tgt = dist < 500 ? controls.target : new THREE.Vector3();
  sun.target.position.copy(tgt); sun.position.add(tgt);
  if (sc.right !== ext) { sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.updateProjectionMatrix(); }
  const tiltAmt = state.tilt ? THREE.MathUtils.clamp(3 + dist / 160, 3.5, 8) : 0;
  tilts.forEach((p, i) => { p.uniforms.amount.value = tiltAmt * (i < 2 ? .75 : .45); p.enabled = state.tilt; });
  finish.uniforms.time.value = t;
  if (terrainMat.userData.shader) terrainMat.userData.shader.uniforms.uTop.value = field.max;
  if (gtao) gtao.enabled = dist < 900;
  renderer.info.reset();
  composer.render(dt);
  ui.tick(altDeg, cur, currentWeather());
  frames++;
  if (params.has('shot') && frames >= Number(params.get('frames') || 12)) { window.__ready = true; return; }
  requestAnimationFrame(frame);
}
document.getElementById('loading').classList.add('done');
frame();
window.__diorama = { state, camera, controls, flyTo, renderer, scene };

// bus status under the clock
let busText = '';
function busLabel(s) {
  const busEl = document.getElementById('bus');
  let t = '';
  if (s.state === 'live') t = state.live && !state.lapse ? `🚌 ${s.near} on the plate · ${s.count} within 1.5 km` : '🚌 live buses only in Live time';
  else if (s.state === 'connecting') t = '🚌 connecting…';
  else if (s.state === 'error') t = '🚌 bus feed unavailable';
  if (t !== busText) { busEl.textContent = t; busEl.hidden = !t; busText = t; }
}

// compass: the arrow points to north on screen; tap to turn north up
const needle = document.querySelector('#compass i');
document.getElementById('compass').addEventListener('click', () => {
  const off = camera.position.clone().sub(controls.target);
  const r = off.length(), pol = Math.acos(off.y / r);
  fly = { t: 0, dur: 1.2, p0: camera.position.clone(), t0: controls.target.clone(), t1: controls.target.clone(),
    p1: controls.target.clone().add(sph({ az: 0, pol, dist: r })) };
});
(function spinNeedle() { needle.style.transform = `rotate(${controls.getAzimuthalAngle()}rad)`; requestAnimationFrame(spinNeedle); })();
