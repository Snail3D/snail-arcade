// Real browser-based verification of the gravity snail game.
// Uses playwright (already a dependency) and headless chromium.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const HTML_PATH = '/Users/snailmac/snail-arcade/games/gravity-snail-m3synth/index.html';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await ctx.newPage();

  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  let exitCode = 0;
  const log = (label, ok, extra = '') => {
    console.log((ok ? 'OK ' : 'FAIL') + '  ' + label + (extra ? ' — ' + extra : ''));
    if (!ok) exitCode = 1;
  };

  try {
    // ---- 1. Load the page ----
    await page.goto('file://' + HTML_PATH, { waitUntil: 'load' });
    await page.waitForSelector('canvas#game', { timeout: 3000 });
    log('page loads without throwing', true);

    // ---- 2. Canvas sized correctly ----
    const dims = await page.evaluate(() => {
      const c = document.getElementById('game');
      return { w: c.width, h: c.height, cssW: c.style.width, cssH: c.style.height };
    });
    log('canvas has nonzero size', dims.w > 0 && dims.h > 0, `${dims.w}x${dims.h} (css ${dims.cssW} x ${dims.cssH})`);

    // ---- 3. Instrument frame loop, verify rendering ----
    await page.evaluate(() => {
      window.__frameCount = 0;
      window.__uniqueColors = new Set();
      const origRAF = window.requestAnimationFrame;
      window.requestAnimationFrame = function (cb) {
        return origRAF.call(window, (t) => {
          window.__frameCount++;
          try {
            const c = document.getElementById('game');
            const cx = c.getContext('2d');
            const samples = [[5, 5], [c.width - 5, 5], [5, c.height - 5], [c.width - 5, c.height - 5], [c.width / 2 | 0, c.height / 2 | 0]];
            for (const [x, y] of samples) {
              const p = cx.getImageData(x, y, 1, 1).data;
              window.__uniqueColors.add(`${p[0]},${p[1]},${p[2]}`);
            }
          } catch (e) {}
          return cb(t);
        });
      };
    });

    // ---- 4. Click to start, simulate gameplay ----
    await page.click('canvas#game');
    await page.waitForTimeout(200);

    // alternating thrust/fall (real gameplay pattern)
    for (let i = 0; i < 5; i++) {
      await page.keyboard.down('Space');
      await page.waitForTimeout(700);
      await page.keyboard.up('Space');
      await page.waitForTimeout(350);
    }
    // stop thrusting and let snail die
    await page.waitForTimeout(4000);

    const stats = await page.evaluate(() => ({
      frames: window.__frameCount,
      uniqueColors: window.__uniqueColors.size,
      sampleColors: Array.from(window.__uniqueColors).slice(0, 12)
    }));

    log('rendered > 60 frames during ~8s of input', stats.frames > 60, `${stats.frames} frames`);
    log('canvas pixels actually vary (rendering, not blank)', stats.uniqueColors > 5, `${stats.uniqueColors} distinct colors`);

    // ---- 5. Capture screenshots of menu and death states ----
    const shotMenu = '/tmp/snail-m3synth-menu.png';
    const shotPlay = '/tmp/snail-m3synth-play.png';
    await page.screenshot({ path: shotPlay });
    const playBytes = fs.statSync(shotPlay).size;
    log('playing screenshot captured', playBytes > 5000, `${playBytes} bytes`);

    // Force death by reloading and immediately letting the snail fall
    await page.evaluate(() => location.reload());
    await page.waitForLoadState('load');
    await page.waitForSelector('canvas#game');
    await page.click('canvas#game');
    await page.waitForTimeout(8000); // no input — snail should fall and die

    const shotDead = '/tmp/snail-m3synth-dead.png';
    await page.screenshot({ path: shotDead });
    const deadBytes = fs.statSync(shotDead).size;
    log('death screenshot captured', deadBytes > 5000, `${deadBytes} bytes`);

    // ---- 6. No JS errors during entire run ----
    log('zero page errors during run', pageErrors.length === 0, pageErrors.join(' | ') || 'clean');
    log('zero console errors during run', consoleErrors.length === 0, consoleErrors.join(' | ') || 'clean');

  } catch (e) {
    console.log('FAIL  harness crashed:', e.message);
    exitCode = 1;
  } finally {
    await browser.close();
  }

  console.log('');
  console.log(exitCode === 0 ? 'VERIFICATION: PASS' : 'VERIFICATION: FAIL');
  process.exit(exitCode);
})();