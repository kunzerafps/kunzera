// Render a single video by filename arg: node render-one-video.mjs <htmlFile> <outMp4>
import puppeteer from 'puppeteer';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FINAL = path.resolve(__dirname, '..', 'final');
const OUT   = path.resolve(FINAL, 'videos');

const [, , htmlFile, outFile] = process.argv;
if (!htmlFile || !outFile) { console.error('Usage: node render-one-video.mjs <html> <mp4>'); process.exit(1); }

const FPS = 30;
const TMP = path.resolve(__dirname, '.tmp-one', path.parse(htmlFile).name);
if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', d => stderr += d.toString());
    p.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg exit ' + code + '\n' + stderr)));
  });
}

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none']
});

const page = await browser.newPage();
await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(() => { window.__EXPORT_MODE = true; });

const filePath = 'file:///' + path.resolve(FINAL, htmlFile).replace(/\\/g, '/');
console.log('→ Rendering', htmlFile);
await page.goto(filePath, { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);

const duration = await page.evaluate(() => window.__duration || 6);
const total = Math.round(duration * FPS);
console.log(`  Duración: ${duration}s · Frames: ${total}`);

for (let i = 0; i < total; i++) {
  const t = i / FPS;
  await page.evaluate(tt => window.render(tt), t);
  await page.screenshot({ path: path.resolve(TMP, 'f' + String(i).padStart(5, '0') + '.png'), type: 'png' });
  if (i % 30 === 0) process.stdout.write(`  frame ${i}/${total}\r`);
}
console.log(`  ✓ ${total} frames`);

await page.close();
await browser.close();

const outPath = path.resolve(OUT, outFile);
console.log('  ↪ ffmpeg...');
await runFfmpeg([
  '-y',
  '-framerate', String(FPS),
  '-i', path.resolve(TMP, 'f%05d.png'),
  '-c:v', 'libx264',
  '-pix_fmt', 'yuv420p',
  '-crf', '18',
  '-preset', 'medium',
  '-movflags', '+faststart',
  '-vf', 'scale=1080:1920',
  outPath
]);

fs.rmSync(TMP, { recursive: true, force: true });
console.log('✅', outFile);
