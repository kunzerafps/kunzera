// Build a single self-contained HTML with all images and videos embedded as base64
// This works regardless of how the client opens it (ZIP, desktop, double-click, etc.)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DELIVERY = path.resolve(__dirname, '..', '..', 'ENTREGA-CLIENTE');
const STORIES = path.resolve(DELIVERY, 'stories');
const VIDEOS  = path.resolve(DELIVERY, 'videos');
const SRC_HTML = path.resolve(DELIVERY, 'VER-ENTREGA.html');
const OUT_HTML = path.resolve(DELIVERY, 'VER-ENTREGA-STANDALONE.html');

const html = fs.readFileSync(SRC_HTML, 'utf-8');

function embed(file, mime) {
  const buf = fs.readFileSync(file);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

let result = html;
let totalBytes = 0;

// Embed stories
const stories = fs.readdirSync(STORIES).filter(f => f.endsWith('.png'));
for (const s of stories) {
  const uri = embed(path.resolve(STORIES, s), 'image/png');
  const rel = `stories/${s}`;
  const before = result.length;
  result = result.split(rel).join(uri);
  totalBytes += fs.statSync(path.resolve(STORIES, s)).size;
  console.log(`  ✓ ${s.padEnd(28)} (${(fs.statSync(path.resolve(STORIES, s)).size/1024).toFixed(0)} KB)`);
}

// Embed videos
const videos = fs.readdirSync(VIDEOS).filter(f => f.endsWith('.mp4'));
for (const v of videos) {
  const uri = embed(path.resolve(VIDEOS, v), 'video/mp4');
  const rel = `videos/${v}`;
  result = result.split(rel).join(uri);
  totalBytes += fs.statSync(path.resolve(VIDEOS, v)).size;
  console.log(`  ✓ ${v.padEnd(28)} (${(fs.statSync(path.resolve(VIDEOS, v)).size/1024).toFixed(0)} KB)`);
}

// Update title to signal standalone
result = result.replace('<title>KUNZERA · Entrega · 10 stories + 5 videos</title>',
                        '<title>KUNZERA · Entrega (standalone, se abre en cualquier PC)</title>');

fs.writeFileSync(OUT_HTML, result, 'utf-8');
const size = fs.statSync(OUT_HTML).size;
console.log(`\n✅ Archivo autocontenido: ${OUT_HTML}`);
console.log(`   Tamaño final: ${(size/1024/1024).toFixed(1)} MB (media original: ${(totalBytes/1024/1024).toFixed(1)} MB)`);
