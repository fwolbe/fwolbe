import { PRESETS } from './weather.js';

import { hm, local, atLocal } from './tz.js';
const ICON = { Clear: '☀', 'Some clouds': '⛅', Overcast: '☁', Fog: '🌫', Drizzle: '🌦', Rain: '🌧', Snow: '❄', Showers: '🌦', 'Snow showers': '🌨', Thunder: '⛈', Storm: '⛈' };

export function setupUI({ state, events, onTerrain, onTime, onView }) {
  const $ = (s) => document.querySelector(s);
  const slider = $('#time'), clock = $('#clock'), liveBtn = $('#live'), lapse = $('#lapse');
  const wxLabel = $('#wx'), sunLbl = $('#sunlbl');

  function syncTime() {
    const d = state.time;
    const l = local(d); slider.value = l.h * 60 + l.m;
    clock.textContent = hm(d);
    liveBtn.classList.toggle('on', state.live && !state.lapse);
    lapse.classList.toggle('on', state.lapse);
  }
  slider.addEventListener('input', () => {
    state.live = false; state.lapse = false;
    const m = Number(slider.value);
    state.time = atLocal(state.time, Math.floor(m / 60), m % 60); onTime(); syncTime();
  });
  liveBtn.addEventListener('click', () => { state.live = true; state.lapse = false; state.time = new Date(); onTime(); syncTime(); });
  lapse.addEventListener('click', () => { state.lapse = !state.lapse; if (state.lapse) state.live = false; syncTime(); });
  document.querySelectorAll('[data-at]').forEach(b => b.addEventListener('click', () => {
    const ev = events(); let d = new Date(state.time);
    const at = b.dataset.at;
    const set = (src, offMin) => { d = new Date(src.getTime() + offMin * 6e4); };
    if (at === 'sunrise' && ev.rise) set(ev.morning || ev.rise, 0);
    else if (at === 'golden' && ev.set) set(ev.golden || ev.set, 0);
    else if (at === 'noon' && ev.noon) set(ev.noon, 0);
    else if (at === 'dusk' && ev.set) set(ev.set, 22);
    else if (at === 'night') d = atLocal(d, 22, 30);
    state.live = false; state.lapse = false; state.time = d; onTime(); syncTime();
  }));
  document.querySelectorAll('[data-wx]').forEach(b => b.addEventListener('click', () => {
    state.weatherMode = b.dataset.wx;
    document.querySelectorAll('[data-wx]').forEach(x => x.classList.toggle('on', x === b));
  }));
  document.querySelector(`[data-wx="${state.weatherMode}"]`)?.classList.add('on');

  // pop-up menus above the dock
  document.querySelectorAll('.menu-btn').forEach(b => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const m = document.getElementById(b.dataset.menu), open = !m.classList.contains('open');
    document.querySelectorAll('.menu').forEach(x => x.classList.remove('open'));
    document.querySelectorAll('.menu-btn').forEach(x => x.classList.remove('on'));
    if (open) { m.classList.add('open'); b.classList.add('on'); }
  }));
  document.querySelectorAll('.menu').forEach(m => m.addEventListener('click', e => e.stopPropagation()));
  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest('#dock')) return;
    document.querySelectorAll('.menu').forEach(x => x.classList.remove('open'));
    document.querySelectorAll('.menu-btn').forEach(x => x.classList.remove('on'));
  });
  const LOADING = { cardboard: 'Cutting cardboard…', white: 'Sanding the model…', felt: 'Felting the wool…' };
  function rebuildNow(kind) {
    const l = document.getElementById('loading');
    l.textContent = LOADING[state.style]; l.classList.remove('done');
    setTimeout(() => { onTerrain(kind); l.classList.add('done'); }, 40);
  }
  const seg = (name, key, parse, rebuild) => {
    document.querySelectorAll(`[data-${name}]`).forEach(b => {
      b.classList.toggle('on', parse(b.dataset[name]) === state[key]);
      b.addEventListener('click', () => {
        state[key] = parse(b.dataset[name]);
        document.querySelectorAll(`[data-${name}]`).forEach(x => x.classList.toggle('on', x === b));
        if (rebuild) rebuildNow(rebuild);
      });
    });
  };
  seg('step', 'step', Number, true);
  seg('exag', 'exag', Number, true);
  seg('tilt', 'tilt', (v) => v === '1');
  seg('labels', 'labels', (v) => v === '1');
  seg('spin', 'autoRotate', (v) => v === '1');
  seg('style', 'style', String, 'style');
  seg('shape', 'shape', String, 'plate');
  const crop = $('#crop'), cropOut = $('#crop-out');
  const showCrop = () => { cropOut.textContent = `${Math.round(crop.value * 2)} m`; };
  crop.value = state.crop; showCrop();
  crop.addEventListener('input', showCrop);
  crop.addEventListener('change', () => { state.crop = Number(crop.value); rebuildNow('plate'); });
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => onView(b.dataset.view)));

  let status = 'loading live weather…';
  function weatherStatus(w, err) { status = err ? 'No live feed' : ''; }

  let last = '';
  function tick(altDeg, cur, w) {
    if (state.live && !state.lapse) syncTime(); else clock.textContent = hm(state.time);
    const temp = w.temp != null ? `${Math.round(w.temp)}°` : '';
    const lbl = state.weatherMode === 'live' ? (w.live ? w.label : status || 'Live') : PRESETS[state.weatherMode].label;
    const ev = events();
    const s = `${ICON[lbl] || ''} ${lbl} ${temp}`;
    const sunTxt = `☀ ${ev.rise ? hm(ev.rise) : '–'}  ☾ ${ev.set ? hm(ev.set) : '–'}`;
    if (s + sunTxt !== last) { wxLabel.textContent = s; sunLbl.textContent = sunTxt; last = s + sunTxt; }
  }
  syncTime();
  return { syncTime, tick, weatherStatus };
}
