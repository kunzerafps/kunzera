import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.resolve(__dirname, '..', '..', 'ENTREGA-CLIENTE', 'VER-ENTREGA-STANDALONE.html');

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox']});
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1200 });

const errors = [];
page.on('pageerror', e => errors.push('JS error: ' + e.message));
page.on('requestfailed', r => errors.push('Request failed: ' + r.url().slice(0, 80) + '...'));

await page.goto('file:///' + HTML.replace(/\\/g, '/'), { waitUntil: 'networkidle0' });

// Count loaded media
const counts = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('img')];
  const vids = [...document.querySelectorAll('video')];
  return {
    imgs: imgs.length,
    imgsLoaded: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
    videos: vids.length,
    videosReady: vids.filter(v => v.readyState >= 2).length,
    videosData: vids.map(v => ({ src: v.currentSrc.slice(0,40), ready: v.readyState, dur: v.duration }))
  };
});

console.log('Imágenes:', counts.imgsLoaded + '/' + counts.imgs, 'cargadas');
console.log('Videos:', counts.videosReady + '/' + counts.videos, 'listos');
console.log('Videos data:', counts.videosData);
if (errors.length) console.log('Errores:', errors);
await browser.close();
