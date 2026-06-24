// Render 5 Instagram Videos as MP4 1080x1920 @ 30fps
import puppeteer from 'puppeteer';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FINAL = path.resolve(__dirname, '..', 'final');
const OUT   = path.resolve(FINAL, 'videos');
const TMP   = path.resolve(__dirname, '.tmp-frames');

const videos = [
  { file: 'video-01-fps-counter.html',         out: '01-fps-counter.mp4' },
  { file: 'video-02-boot-sequence.html',       out: '02-boot-sequence.mp4' },
  { file: 'video-03-antes-despues-wipe.html',  out: '03-antes-despues-wipe.mp4' },
  { file: 'video-04-pricing-reveal.html',      out: '04-pricing-reveal.mp4' },
  { file: 'video-05-glitch-cta.html',          out: '05-glitch-cta.mp4' },
];

const FPS = 30;

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
if (fs.existsSync(TMP))  fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', d => { stderr += d.toString(); });
    p.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg exit ' + code + '\n' + stderr)));
  });
}

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none']
});

for (const { file, out } of videos) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => { window.__EXPORT_MODE = true; });

  const filePath = 'file:///' + path.resolve(FINAL, file).replace(/\\/g, '/');
  console.log('\n→ Rendering', file);

  await page.goto(filePath, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);

  const duration = await page.evaluate(() => window.__duration || 6);
  const totalFrames = Math.round(duration * FPS);
  console.log(`  Duración: ${duration}s · Frames: ${totalFrames} @ ${FPS}fps`);

  // Per-video tmp folder
  const tmpDir = path.resolve(TMP, path.parse(file).name);
  fs.mkdirSync(tmpDir, { recursive: true });

  // Render each frame
  for (let i = 0; i < totalFrames; i++) {
    const t = i / FPS;
    await page.evaluate(tt => window.render(tt), t);
    const framePath = path.resolve(tmpDir, 'f' + String(i).padStart(5, '0') + '.png');
    await page.screenshot({ path: framePath, type: 'png', omitBackground: false });
    if (i % 30 === 0) process.stdout.write(`  frame ${i}/${totalFrames}\r`);
  }
  console.log(`  ✓ ${totalFrames} frames capturados`);

  await page.close();

  // Compose MP4
  const outPath = path.resolve(OUT, out);
  console.log('  ↪ compilando MP4 con ffmpeg…');
  await runFfmpeg([
    '-y',
    '-framerate', String(FPS),
    '-i', path.resolve(tmpDir, 'f%05d.png'),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '18',
    '-preset', 'medium',
    '-movflags', '+faststart',
    '-vf', 'scale=1080:1920',
    outPath
  ]);
  console.log('  ✓', out);

  // Cleanup frames for this video
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

await browser.close();
fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n✅ 5 videos exportados a:', OUT);
