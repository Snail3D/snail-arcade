// Real browser-based verification of the flat-earth-sim game.
const { chromium } = require('playwright');
const fs = require('fs');

const HTML_PATH = '/Users/snailmac/snail-arcade/games/flat-earth-sim/index.html';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const page = await ctx.newPage();

  const pageErrors = [], consoleErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  let exitCode = 0;
  const log = (label, ok, extra = '') => {
    console.log((ok ? 'OK ' : 'FAIL') + '  ' + label + (extra ? ' — ' + extra : ''));
    if (!ok) exitCode = 1;
  };

  try {
    await page.goto('file://' + HTML_PATH, { waitUntil: 'load' });
    await page.waitForSelector('canvas#c', { timeout: 3000 });
    log('page loads without throwing', true);

    const dims = await page.evaluate(() => {
      const c = document.getElementById('c');
      return { w: c.width, h: c.height, fe: typeof window._fe };
    });
    log('canvas sized + sim exposed', dims.w > 0 && dims.h > 0 && dims.fe === 'object', `${dims.w}x${dims.h} _fe=${dims.fe}`);

    // instrument RAF + sample pixels
    await page.evaluate(() => {
      window.__fc = 0; window.__uc = new Set();
      const orig = window.requestAnimationFrame;
      window.requestAnimationFrame = function (cb) {
        return orig.call(window, (t) => {
          window.__fc++;
          try {
            const c = document.getElementById('c'); const cx = c.getContext('2d');
            for (const [x, y] of [[5,5],[c.width-5,5],[5,c.height-5],[c.width-5,c.height-5],[c.width/2|0,c.height/2|0]]) {
              const p = cx.getImageData(x, y, 1, 1).data;
              window.__uc.add(`${p[0]},${p[1]},${p[2]}`);
            }
          } catch (e) {}
          return cb(t);
        });
      };
    });

    // play through the year -> day advances, sun radius changes
    await page.click('#playBtn');
    await page.waitForTimeout(2500);
    const stats = await page.evaluate(() => ({
      frames: window.__fc,
      colors: window.__uc.size,
      day: window._fe.day(),
      sunR: window._fe.sunR()
    }));
    log('rendered > 60 frames', stats.frames > 60, `${stats.frames} frames`);
    log('pixels vary (rendering, not blank)', stats.colors > 5, `${stats.colors} distinct colors`);
    log('playing advances the day', stats.day > 0 && stats.day < 365, `day=${stats.day.toFixed(1)} sunR=${stats.sunR}`);

    const shot = '/tmp/flat-earth-sim.png';
    await page.screenshot({ path: shot });
    log('screenshot captured', fs.statSync(shot).size > 5000, `${fs.statSync(shot).size} bytes`);

    // scrub slider to a summer day -> sun radius should increase
    await page.evaluate(() => {
      const s = document.getElementById('slider');
      s.value = 172; s.dispatchEvent(new Event('input'));
    });
    const summer = await page.evaluate(() => window._fe.sunR());
    await page.evaluate(() => {
      const s = document.getElementById('slider');
      s.value = 0; s.dispatchEvent(new Event('input'));
    });
    const winter = await page.evaluate(() => window._fe.sunR());
    log('sun radius varies with season (analemma)', summer > winter + 20, `summer=${summer} winter=${winter}`);

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
