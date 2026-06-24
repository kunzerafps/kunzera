import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FINAL = path.resolve(__dirname, '..', 'final');

const [, , htmlFile, tArg, outPath] = process.argv;
const t = parseFloat(tArg);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--font-render-hinting=none']});
const page = await browser.newPage();
await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1});
await page.evaluateOnNewDocument(() => { window.__EXPORT_MODE = true; });
await page.goto('file:///' + path.resolve(FINAL, htmlFile).replace(/\\/g, '/'), { waitUntil: 'networkidle0'});
await page.evaluate(() => document.fonts.ready);
await page.evaluate(tt => window.render(tt), t);
await page.screenshot({ path: outPath });
await browser.close();
console.log('✅ frame saved:', outPath);
