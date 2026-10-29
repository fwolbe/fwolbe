// Bundles the app and inlines it into self-contained HTML:
//   dist/index.html    – standalone page (host it anywhere; live weather works)
//   dist/artifact.html – the same page without the document skeleton, for claude.ai artifacts
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
const r = await build({ entryPoints: ['src/main.js'], bundle: true, minify: !process.env.DEV, format: 'iife', write: false, target: 'es2020', loader: { '.json': 'json' }, legalComments: 'none' });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync('src/index.html', 'utf8').replace('<script>/*APP*/</script>', () => `<script>${js}</script>`);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
const art = html
  .replace(/<!doctype html>\s*<html[^>]*>\s*<head>\s*/i, '')
  .replace(/<meta charset[^>]*>\s*<meta name="viewport"[^>]*>\s*/i, '')
  .replace(/<\/head>\s*<body>\s*/i, '')
  .replace(/<\/body>\s*<\/html>\s*$/i, '');
writeFileSync('dist/artifact.html', art);
console.log('dist/index.html', Math.round(html.length / 1024), 'KB; dist/artifact.html', Math.round(art.length / 1024), 'KB');
