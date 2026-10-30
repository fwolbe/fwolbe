// Bundles the app with one site's data into self-contained HTML:
//   node scripts/build.mjs <site>
//   dist/<site>/index.html    – standalone page (host it anywhere; live weather and buses work)
//   dist/<site>/artifact.html – the same page without the document skeleton, for claude.ai artifacts
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
const site = process.argv[2] || 'example';
const dir = resolve('sites', site);
if (!existsSync(resolve(dir, 'data.json'))) { console.error(`sites/${site}/data.json missing: run python3 scripts/make_site.py ${site}`); process.exit(1); }
const cfg = JSON.parse(readFileSync(resolve(dir, 'site.json'), 'utf8'));
const SITE = { name: cfg.name || site, subtitle: cfg.subtitle || '', timezone: cfg.timezone || 'Europe/Stockholm',
  relay: cfg.transit?.relay || '', transitSite: cfg.transit?.site || '' };
const r = await build({
  entryPoints: ['src/main.js'], bundle: true, minify: !process.env.DEV, format: 'iife', write: false, target: 'es2020',
  loader: { '.json': 'json' }, legalComments: 'none',
  alias: { 'site-data': resolve(dir, 'data.json') },
  define: { __SITE__: JSON.stringify(SITE) },
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const esc = (s) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const html = readFileSync('src/index.html', 'utf8')
  .replace('<title>Diorama</title>', `<title>${esc(SITE.name)} Diorama</title>`)
  .replace('<script>/*APP*/</script>', () => `<script>${js}</script>`);
mkdirSync(`dist/${site}`, { recursive: true });
writeFileSync(`dist/${site}/index.html`, html);
const art = html
  .replace(/<!doctype html>\s*<html[^>]*>\s*<head>\s*/i, '')
  .replace(/<meta charset[^>]*>\s*<meta name="viewport"[^>]*>\s*/i, '')
  .replace(/<\/head>\s*<body>\s*/i, '')
  .replace(/<\/body>\s*<\/html>\s*$/i, '');
writeFileSync(`dist/${site}/artifact.html`, art);
console.log(`dist/${site}/index.html`, Math.round(html.length / 1024), 'KB');
