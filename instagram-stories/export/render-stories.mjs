// Render 5 Instagram Stories as PNG 1080x1920
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FINAL = path.resolve(__dirname, '..', 'final');
const OUT   = path.resolve(FINAL, 'stories');

const stories = [
  { file: 'story-01-hook.html',            out: '01-hook.png' },
  { file: 'story-02-platino.html',         out: '02-platino.png' },
  { file: 'story-03-diamante.html',        out: '03-diamante.png' },
  { file: 'story-04-antes-despues.html',   out: '04-antes-despues.png' },
  { file: 'story-05-cta-campeon.html',     out: '05-cta-campeon.png' },
  { file: 'story-06-pro-player.html',      out: '06-pro-player.png' },
  { file: 'story-07-ganar-configura.html', out: '07-ganar-configura.png' },
  { file: 'story-08-quote-eze.html',       out: '08-quote-eze.png' },
  { file: 'story-09-numeros.html',         out: '09-numeros.png' },
  { file: 'story-10-cta-personal.html',    out: '10-cta-personal.png' },
];

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none']
});

for (const { file, out } of stories) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });

  const filePath = 'file:///' + path.resolve(FINAL, file).replace(/\\/g, '/');
  console.log('→ Rendering', file);

  await page.goto(filePath, { waitUntil: 'networkidle0' });
  // Ensure fonts loaded
  await page.evaluate(() => document.fonts.ready);
  // Short delay for any JS-driven initial state
  await new Promise(r => setTimeout(r, 400));

  const outPath = path.resolve(OUT, out);
  await page.screenshot({ path: outPath, type: 'png', omitBackground: false, fullPage: false });
  await page.close();

  console.log('  ✓', out);
}

await browser.close();
console.log('\n✅ 5 stories exportadas a:', OUT);
