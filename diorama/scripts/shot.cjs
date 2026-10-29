// Headless screenshots for checking the look: node scripts/shot.cjs "<query>" out.png [w h]
const { chromium } = require('playwright');
(async () => {
  const [q = '', out = 'shot.png', w = 1400, h = 860] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: +w, height: +h } });
  const logs = [];
  p.on('console', m => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text().slice(0, 400)); });
  p.on('pageerror', e => logs.push('pageerror: ' + e.message + e.stack.slice(0, 600)));
  await p.route(/fonts\.(googleapis|gstatic)|open-meteo/, r => r.abort());
  const t0 = Date.now();
  await p.goto('file://' + process.cwd() + '/dist/index.html?shot&pr=1&' + q, { waitUntil: 'commit' });
  await p.waitForFunction(() => window.__ready, null, { timeout: 170000 }).catch(() => logs.push('not ready'));
  await p.screenshot({ path: out, timeout: 280000 });
  console.log(await p.evaluate(() => { const r = window.__diorama.renderer.info.render; return 'tris ' + r.triangles + ' calls ' + r.calls; }));
  console.log('ms', Date.now() - t0);
  console.log(logs.slice(0, 15).join('\n'));
  await b.close();
})();
