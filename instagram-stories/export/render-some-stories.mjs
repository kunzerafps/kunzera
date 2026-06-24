// Render specific stories by arg list
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FINAL = path.resolve(__dirname, '..', 'final');
const OUT   = path.resolve(FINAL, 'stories');

const pairs = process.argv.slice(2);
if (pairs.length === 0 || pairs.length % 2 !== 0) {
  console.error('Usage: node render-some-stories.mjs <html1> <png1> [<html2> <png2> ...]');
  process.exit(1);
}

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none']
});

for (let i = 0; i < pairs.length; i += 2) {
  const htmlFile = pairs[i];
  const outFile = pairs[i + 1];
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
  const filePath = 'file:///' + path.resolve(FINAL, htmlFile).replace(/\\/g, '/');
  console.log('→', htmlFile);
  await page.goto(filePath, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.resolve(OUT, outFile), type: 'png' });
  await page.close();
  console.log('  ✓', outFile);
}
await browser.close();
console.log('Done.');
