// Gathers every built site into one folder for static hosting (e.g. Cloudflare Pages, put behind Access):
//   node scripts/pack.mjs            -> dist/hosted/<site>/index.html for each built site, plus an index page
// Build the sites first with scripts/build.mjs <site>.
import { readdirSync, existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'fs';
const out = 'dist/hosted';
rmSync(out, { recursive: true, force: true });
const sites = readdirSync('sites').filter(s => s !== 'example' && existsSync(`dist/${s}/index.html`));
if (!sites.length) { console.error('no built sites in dist/: run node scripts/build.mjs <site> first'); process.exit(1); }
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const links = [];
for (const s of sites) {
  mkdirSync(`${out}/${s}`, { recursive: true });
  copyFileSync(`dist/${s}/index.html`, `${out}/${s}/index.html`);
  const cfg = JSON.parse(readFileSync(`sites/${s}/site.json`, 'utf8'));
  links.push(`<a href="${esc(s)}/"><b>${esc(cfg.name || s)}</b><span>${esc(cfg.subtitle || '')}</span></a>`);
}
writeFileSync(`${out}/index.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dioramas</title><style>
:root{--bg:#2a1d14;--card:#1d1611;--ink:#f3e9d8;--muted:#b9a68c;--accent:#e9b93a}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--ink);font:16px/1.4 system-ui,sans-serif;display:grid;place-items:center}
main{width:min(420px,100% - 32px);display:grid;gap:12px}h1{color:var(--accent);font-style:italic;letter-spacing:.04em;margin:0 0 8px}
a{display:grid;padding:16px 18px;border:2px solid var(--accent);background:var(--card);color:var(--ink);text-decoration:none}
a span{color:var(--muted);font-size:13px;text-transform:uppercase;letter-spacing:.08em}a:hover{background:#2f241b}
</style></head><body><main><h1>DIORAMAS</h1>${links.join('')}</main></body></html>
`);
console.log(`${out}/: ${sites.join(', ')}`);
