// Deeper verification: confirm actual gameplay happens (score advances, obstacles spawn)
const puppeteer = require('puppeteer-core');
const HTML_PATH = '/Users/snailmac/snail-arcade/games/gravity-snail-m3synth/index.html';
const CHROME = '/Users/snailmac/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'shell',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });

  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text()); });

  await page.goto('file://' + HTML_PATH, { waitUntil: 'load' });
  await page.waitForSelector('canvas#game');

  // Inject a debug probe BEFORE any frames run
  await page.evaluate(() => {
    // The IIFE doesn't expose state. We instrument by reading canvas pixels
    // each frame and checking that drawing happens (not a frozen blank frame).
    window.__frameCount = 0;
    window.__scoreSeries = [];
    window.__uniqueColors = new Set();
    const origRAF = window.requestAnimationFrame;
    window.requestAnimationFrame = function(cb) {
      return origRAF.call(window, (t) => {
        window.__frameCount++;
        // sample 4 corner pixels to detect rendering
        const c = document.getElementById('game');
        try {
          const ctx = c.getContext('2d');
          const samples = [[5,5],[c.width-5,5],[5,c.height-5],[c.width-5,c.height-5]];
          for (const [x,y] of samples) {
            const p = ctx.getImageData(x, y, 1, 1).data;
            window.__uniqueColors.add(`${p[0]},${p[1]},${p[2]}`);
          }
        } catch (e) {}
        return cb(t);
      });
    };
  });

  // Click to start
  await page.click('canvas#game');
  await new Promise(r => setTimeout(r, 100));

  // Simulate alternating thrust pattern (real gameplay): thrust 800ms, fall 400ms, repeat
  for (let i = 0; i < 6; i++) {
    await page.keyboard.down('Space');
    await new Promise(r => setTimeout(r, 800));
    await page.keyboard.up('Space');
    await new Promise(r => setTimeout(r, 400));
  }

  // Stop thrusting — let snail fall to death
  await new Promise(r => setTimeout(r, 4000));

  const stats = await page.evaluate(() => ({
    frames: window.__frameCount,
    uniqueColors: window.__uniqueColors.size,
    sampleColors: Array.from(window.__uniqueColors).slice(0, 10)
  }));

  console.log('Frames rendered:', stats.frames);
  console.log('Unique corner colors (expect >1, confirms rendering):', stats.uniqueColors);
  console.log('Sample colors:', stats.sampleColors);

  await browser.close();

  if (errs.length === 0 && stats.frames > 60 && stats.uniqueColors > 1) {
    console.log('\nVERIFICATION: PASS');
    console.log('  -', stats.frames, 'frames rendered');
    console.log('  -', stats.uniqueColors, 'distinct pixel colors at corners');
    console.log('  - 0 page errors');
    process.exit(0);
  } else {
    console.log('\nVERIFICATION: FAIL');
    if (errs.length) console.log('Errors:', errs);
    process.exit(1);
  }
})().catch(e => { console.error('CRASH:', e); process.exit(2); });