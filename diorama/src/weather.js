import * as THREE from 'three';
import { cardboard, WALL_GLSL } from './materials.js';

export const PRESETS = {
  clear: { cloud: .05, rain: 0, snow: 0, fog: 0, wind: .25, label: 'Clear' },
  partly: { cloud: .35, rain: 0, snow: 0, fog: 0, wind: .35, label: 'Some clouds' },
  cloudy: { cloud: .85, rain: 0, snow: 0, fog: .1, wind: .45, label: 'Overcast' },
  rain: { cloud: .95, rain: .8, snow: 0, fog: .2, wind: .6, label: 'Rain' },
  snow: { cloud: .9, rain: 0, snow: .8, fog: .25, wind: .3, label: 'Snow', cover: 1 },
  fog: { cloud: .6, rain: 0, snow: 0, fog: .85, wind: .1, label: 'Fog' },
  storm: { cloud: 1, rain: 1, snow: 0, fog: .3, wind: 1, label: 'Storm' },
};

// Live conditions from Open-Meteo (CORS-friendly, uses MET Nordic for Sweden).
export async function fetchLive(lat, lon) {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,precipitation,rain,snowfall,cloud_cover,wind_speed_10m,wind_direction_10m,weather_code,snow_depth,is_day` +
    `&timezone=Europe%2FStockholm&wind_speed_unit=ms`;
  const r = await fetch(u, { cache: 'no-store' });
  if (!r.ok) throw new Error('weather ' + r.status);
  const c = (await r.json()).current;
  const code = c.weather_code;
  const w = { cloud: (c.cloud_cover ?? 0) / 100, rain: 0, snow: 0, fog: 0, wind: Math.min(1, (c.wind_speed_10m ?? 2) / 12),
    windDir: c.wind_direction_10m ?? 220, temp: c.temperature_2m, code, cover: (c.snow_depth ?? 0) > 0.01 ? 1 : 0, live: true };
  if ([45, 48].includes(code)) w.fog = .85;
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) w.rain = Math.min(1, .35 + (c.precipitation ?? 0) / 3);
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) w.snow = Math.min(1, .45 + (c.snowfall ?? 0));
  if (code >= 95) { w.rain = 1; w.wind = Math.max(w.wind, .8); }
  w.label = describe(code);
  return w;
}
export function describe(code) {
  if (code === 0) return 'Clear'; if (code <= 2) return 'Some clouds'; if (code === 3) return 'Overcast';
  if (code <= 48) return 'Fog'; if (code <= 57) return 'Drizzle'; if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow'; if (code <= 82) return 'Showers'; if (code <= 86) return 'Snow showers'; return 'Thunder';
}

function cloudShape(rand) {
  const s = new THREE.Shape();
  const n = 4 + Math.floor(rand() * 3), w = 22 + rand() * 18;
  // a flat base with bumps on top, like a cut-out cloud
  s.moveTo(-w / 2, 0);
  for (let i = 0; i < n; i++) {
    const x0 = -w / 2 + (w * i) / n, x1 = -w / 2 + (w * (i + 1)) / n, r = (x1 - x0) / 2;
    const h = (i === 0 || i === n - 1 ? .6 : 1) * (4 + rand() * 6);
    s.bezierCurveTo(x0, h * .9, x1, h * 1.1 + r, x1, 0.0001 + (i === n - 1 ? 0 : 1.5));
  }
  s.lineTo(-w / 2, 0);
  return s;
}

export function buildWeather(half, topY) {
  const group = new THREE.Group();
  let seed = 3; const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // clouds: cream cut-outs standing on the wind, casting shadows over the town
  const cloudMat = cardboard(new THREE.MeshStandardMaterial({ color: '#f4efe4', roughness: 1 }), {
    key: 'cloud', fragmentHead: WALL_GLSL,
    colorBody: `if (abs(vWN.y) < .5 && dot(vWN, vec3(0.,0.,1.)) < .9 && dot(vWN, vec3(0.,0.,-1.)) < .9) diffuseColor.rgb = kraft(vW, vWN, 1.4) * 1.15;`,
  });
  const clouds = [];
  const shadowOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
  for (let i = 0; i < 16; i++) {
    const g = new THREE.ExtrudeGeometry(cloudShape(rand), { depth: 1.4, bevelEnabled: false, curveSegments: 6 });
    g.translate(0, 0, -.7);
    const m = new THREE.Mesh(g, cloudMat);
    // the cut-out itself casts no shadow (standing on edge it throws road-like stripes in a low
    // sun); an invisible flat blob at its height throws a soft cloud-shaped patch instead
    m.castShadow = false;
    const blob = new THREE.Shape(), n = 14, w = 16 + rand() * 10;
    for (let k = 0; k <= n; k++) {
      const a = k / n * Math.PI * 2, rr = w * (.8 + .25 * Math.sin(a * 3 + rand() * 6));
      const p = [Math.cos(a) * rr, Math.sin(a) * rr * .6];
      k ? blob.lineTo(...p) : blob.moveTo(...p);
    }
    const shade = new THREE.Mesh(new THREE.ShapeGeometry(blob).rotateX(-Math.PI / 2), shadowOnly);
    shade.castShadow = true; shade.position.y = 4;
    m.add(shade);
    m.position.set((rand() - .5) * half * 1.8, topY + 45 + rand() * 40, (rand() - .5) * half * 1.8);
    m.rotation.y = rand() * Math.PI;
    m.scale.setScalar((.9 + rand() * .9) * Math.max(.3, Math.min(1, half / 220)));
    m.userData = { k: i / 16, bob: rand() * 6 };
    clouds.push(m); group.add(m);
  }

  // rain: thin streaks falling through the box above the town
  const N = 5000;
  const rainGeo = new THREE.BufferGeometry();
  const rp = new Float32Array(N * 6), seeds = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { seeds[i * 3] = (rand() - .5) * half * 2; seeds[i * 3 + 1] = rand(); seeds[i * 3 + 2] = (rand() - .5) * half * 2; }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  const rainMat = new THREE.LineBasicMaterial({ color: '#cfdcea', transparent: true, opacity: .55, depthWrite: false });
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false;
  group.add(rain);

  // snow: drifting points
  const sg = new THREE.BufferGeometry();
  const sp = new Float32Array(N * 3);
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const snowMat = new THREE.PointsMaterial({ color: '#ffffff', size: 3.6, sizeAttenuation: false, transparent: true, opacity: .9, depthWrite: false });
  const snow = new THREE.Points(sg, snowMat);
  snow.frustumCulled = false;
  group.add(snow);

  const H = 120;
  function update(t, dt, w, groundAt) {
    const wd = THREE.MathUtils.degToRad((w.windDir ?? 220) + 180); // direction the wind blows toward
    const wx = Math.sin(wd), wz = -Math.cos(wd);
    const speed = 1.5 + w.wind * 9;
    const nVisible = Math.round(clouds.length * Math.min(1, w.cloud * 1.05));
    clouds.forEach((c, i) => {
      c.visible = i < nVisible;
      c.position.x += wx * speed * dt; c.position.z += wz * speed * dt;
      const lim = half * .92;
      if (c.position.x > lim) c.position.x -= lim * 2; if (c.position.x < -lim) c.position.x += lim * 2;
      if (c.position.z > lim) c.position.z -= lim * 2; if (c.position.z < -lim) c.position.z += lim * 2;
      c.rotation.y = Math.atan2(wx, wz) + Math.PI / 2 + Math.sin(i) * .4;
      c.position.y = topY + Math.min(45, 12 + half * .15) + c.userData.bob * Math.min(6, half / 30) + Math.sin(t * .3 + i) * 1.2;
      c.material.color.set(w.rain > .3 ? '#c9c6c0' : '#f4efe4');
    });
    const area = Math.max(.12, Math.min(1, (half / 260) ** 2));
    const nr = Math.floor(N * w.rain * area);
    rain.visible = nr > 0;
    if (rain.visible) {
      rain.geometry.setDrawRange(0, nr * 2);
      const fall = 38, len = 3.2;
      for (let i = 0; i < nr; i++) {
        const x = seeds[i * 3], z = seeds[i * 3 + 2];
        const ph = (seeds[i * 3 + 1] + t * fall / H) % 1;
        const y = topY + 20 + H * (1 - ph);
        const k = i * 6;
        const sx = wx * w.wind * 1.4, sz = wz * w.wind * 1.4;
        rp[k] = x + sx * ph * 8; rp[k + 1] = y; rp[k + 2] = z + sz * ph * 8;
        rp[k + 3] = rp[k] + sx; rp[k + 4] = y - len; rp[k + 5] = rp[k + 2] + sz;
        const g = groundAt(x, z);
        if (rp[k + 4] < g) { rp[k + 1] = rp[k + 4] = -999; }
      }
      rain.geometry.attributes.position.needsUpdate = true;
    }
    const ns = Math.floor(N * w.snow * area);
    snow.visible = ns > 0;
    if (snow.visible) {
      snow.geometry.setDrawRange(0, ns);
      for (let i = 0; i < ns; i++) {
        const ph = (seeds[i * 3 + 1] + t * 2.2 / H) % 1;
        const x = seeds[i * 3] + Math.sin(t * .7 + i) * 2 + wx * w.wind * ph * 30;
        const z = seeds[i * 3 + 2] + Math.cos(t * .5 + i * 1.3) * 2 + wz * w.wind * ph * 30;
        sp[i * 3] = x; sp[i * 3 + 1] = topY + 10 + H * (1 - ph); sp[i * 3 + 2] = z;
        if (sp[i * 3 + 1] < groundAt(x, z)) sp[i * 3 + 1] = -999;
      }
      snow.geometry.attributes.position.needsUpdate = true;
    }
  }
  return { group, update, rainMat, snowMat };
}
