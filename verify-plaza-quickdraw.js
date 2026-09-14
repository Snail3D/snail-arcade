const { chromium } = require('playwright');

(async () => {
  const errors = [];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('file://' + process.env.HOME + '/snail-arcade/games/elpaso-plaza-quickdraw/index.html');
  await page.waitForTimeout(800);

  const modeOf = () => page.evaluate(() => window.__elpaso.mode);

  const t0 = await modeOf();
  console.log('mode@load:', t0);

  // canvas not blank: sample pixels from a screenshot region
  const buf = await page.screenshot({ clip: { x: 0, y: 0, width: 960, height: 600 } });
  const uniq = new Set();
  for (let i = 0; i < buf.length; i += 97) uniq.add(buf[i]);
  console.log('pixel bytes spread:', uniq.size, uniq.size > 20 ? 'NOT BLANK' : 'POSSIBLY BLANK');

  // start the game
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  console.log('mode@start:', await modeOf()); // expect 'set'

  // wait out the random 1.2-3.0s cue delay
  await page.waitForTimeout(3300);
  const mid = await modeOf();
  console.log('mode@cue:', mid); // expect 'draw' (or 'clear'/'down' if crew was lightning-fast)

  // aim at the gunman's head area and fire; he's somewhere in the plaza — sweep shots
  const crew = await page.evaluate(() => window.__elpaso.crew.map(e => ({ x: e.x, gy: e.gy, s: e.s })));
  console.log('crew:', JSON.stringify(crew));
  for (const e of crew) {
    await page.mouse.move(e.x, e.gy - 118 * e.s);   // head
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(120);
  }
  const after = await page.evaluate(() => ({ mode: window.__elpaso.mode, alive: window.__elpaso.crew.filter(e => e.alive).length, score: window.__elpaso.score }));
  console.log('after volley:', JSON.stringify(after)); // expect mode 'clear', alive 0, score > 0

  // advance to next wave
  if (after.mode === 'clear') {
    await page.waitForTimeout(1000);
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    console.log('mode@next:', await modeOf()); // expect 'set'
  }

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO PAGE ERRORS');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
