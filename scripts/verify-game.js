// General-purpose game verification harness.
// Usage: node scripts/verify-game.js <game-slug> [extra-seconds]
// Loads games/<slug>/index.html in headless chromium, waits, simulates input,
// reports console/page errors and whether the canvas is actually animating.
const { chromium } = require('playwright');
const path = require('path');

const slug = process.argv[2];
if (!slug) { console.error('usage: node verify-game.js <game-slug> [seconds]'); process.exit(2); }
const waitSec = parseFloat(process.argv[3] || '6');

const HTML_PATH = path.resolve(__dirname, '..', 'games', slug, 'index.html');
const fs = require('fs');
if (!fs.existsSync(HTML_PATH)) { console.error(`FAIL  ${slug} — no index.html at ${HTML_PATH}`); process.exit(1); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const page = await ctx.newPage();

  const pageErrors = [];
  const consoleErrors = [];
  const consoleWarnings = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error') consoleErrors.push(m.text());
    else if (m.type() === 'warning') consoleWarnings.push(m.text());
  });

  let exitCode = 0;
  const log = (label, ok, extra = '') => {
    console.log((ok ? 'OK   ' : 'FAIL ') + label + (extra ? ` — ${extra}` : ''));
    if (!ok) exitCode = 1;
  };

  try {
    await page.goto('file://' + HTML_PATH, { waitUntil: 'load', timeout: 15000 });
    log('page loads without throwing', true);

    // Instrument requestAnimationFrame to count frames + sample canvas pixels
    await page.evaluate(() => {
      window.__frameCount = 0;
      window.__colorSamples = new Set();
      const origRAF = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = function (cb) {
        return origRAF((t) => {
          window.__frameCount++;
          try {
            const canvases = document.querySelectorAll('canvas');
            for (const c of canvases) {
              if (!c.width || !c.height) continue;
              const cx = c.getContext('2d');
              if (!cx) continue;
              // Denser 5x5 sample grid so sparse content (backgrounds, particles) is caught.
              const N = 5;
              for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
                const x = Math.max(0, Math.min(c.width - 1, Math.round((i + .5) * c.width / N)));
                const y = Math.max(0, Math.min(c.height - 1, Math.round((j + .5) * c.height / N)));
                const d = cx.getImageData(x, y, 1, 1).data;
                window.__colorSamples.add(`${d[0]},${d[1]},${d[2]}`);
              }
            }
          } catch (e) { /* ignore */ }
          cb(t);
        });
      };
    }).catch(() => {});

    await page.waitForTimeout(1500);

    // Simulate input: click center, then a spread of keys
    await page.mouse.click(450, 350).catch(() => {});
    await page.waitForTimeout(300);
    for (const key of ['Enter', 'Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      await page.keyboard.press(key).catch(() => {});
      await page.waitForTimeout(120);
    }

    // Let it run for the requested duration
    await page.waitForTimeout(waitSec * 1000);

    const stats = await page.evaluate(() => ({
      frames: window.__frameCount || 0,
      colors: (window.__colorSamples || new Set()).size,
      canvases: document.querySelectorAll('canvas').length,
      buttons: document.querySelectorAll('button').length,
    })).catch(() => null);

    if (stats) {
      if (stats.canvases > 0) {
        log('render loop is running', stats.frames > 10, `${stats.frames} frames in ~${waitSec + 2}s`);
        log('canvas pixels change over time', stats.colors > 1, `${stats.colors} unique sampled colors`);
      } else {
        // DOM-based game: check the UI is present and interactive, not a blank page.
        const domAlive = await page.evaluate(() => {
          const t = document.body.innerText || '';
          return (document.querySelectorAll('button, [role=button], .cell, .piece').length > 0) || t.length > 20;
        }).catch(() => false);
        log('DOM game UI is present', domAlive, `${stats.buttons} buttons`);
      }
    } else {
      log('frame instrumentation', false, 'could not read stats');
    }

    // Check for visible error overlays / crash text in DOM
    const bodyText = (await page.evaluate(() => document.body.innerText).catch(() => '')) || '';
    const crashHints = ['undefined is not', 'is not a function', 'Cannot read propert', 'NaN, NaN'];
    const crashHit = crashHints.find(h => bodyText.includes(h));
    log('no visible crash text in DOM', !crashHit, crashHit || '');

    // Screenshot for manual inspection
    const shot = path.resolve(__dirname, '..', 'generated', `verify-${slug}.png`);
    fs.mkdirSync(path.dirname(shot), { recursive: true });
    await page.screenshot({ path: shot }).catch(() => {});

  } catch (e) {
    log('verification completed', false, e.message.slice(0, 120));
  }

  const uniq = a => [...new Set(a)];
  if (pageErrors.length) { console.log(`\nPAGE ERRORS (${pageErrors.length}):`); uniq(pageErrors).slice(0, 8).forEach(e => console.log('  ✗ ' + e.slice(0, 200))); exitCode = 1; }
  if (consoleErrors.length) { console.log(`\nCONSOLE ERRORS (${consoleErrors.length}):`); uniq(consoleErrors).slice(0, 8).forEach(e => console.log('  ✗ ' + e.slice(0, 200))); exitCode = 1; }
  if (consoleWarnings.length) { console.log(`\nCONSOLE WARNINGS (${consoleWarnings.length}):`); uniq(consoleWarnings).slice(0, 5).forEach(e => console.log('  ! ' + e.slice(0, 160))); }
  if (!pageErrors.length && !consoleErrors.length) console.log('\nNo JS errors detected.');

  await browser.close();
  process.exit(exitCode);
})().catch(e => { console.error('harness crashed:', e.message); process.exit(1); });
