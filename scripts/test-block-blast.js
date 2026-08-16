// Functional test for Block Blast brick double-dip fix.
// Each scenario fully resets grid + tray so there is no state leakage.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto('file://' + path.resolve(__dirname, '..', 'games', 'block-blast', 'index.html'), { waitUntil: 'load' });
  await page.waitForTimeout(500);

  const result = await page.evaluate(() => {
    function fresh() {
      grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
      tray = [null, null, null];
      score = 0; combo = 0; gameOver = false; newBestFlag = false;
    }

    // --- Scenario A: full row of UNCRACKED bricks, place a piece elsewhere.
    // Old bug: each placement re-detects the "full" brick row, awards 8*10*combo
    // and increments combo forever. Fixed: bricks just get cracked, no line reward.
    fresh();
    for (let c = 0; c < SIZE; c++) grid[0][c] = { color: COLORS[0], type: 'brick', cracked: false };
    tray[0] = { cells: [[0, 0]], type: 'normal', color: COLORS[1] };
    placePiece(0, 7, 0); // single cell, far from the brick row
    const after1 = { score, combo, cracked: grid[0][0].cracked };

    // --- Scenario A2: now the brick row is all CRACKED; next hit clears it.
    fresh();
    for (let c = 0; c < SIZE; c++) grid[0][c] = { color: COLORS[0], type: 'brick', cracked: true };
    tray[0] = { cells: [[0, 0]], type: 'normal', color: COLORS[1] };
    placePiece(0, 7, 0); // triggers the full (cracked) row to clear
    const after2 = { score, combo, rowCleared: grid[0].every(v => !v) };

    // --- Scenario B: normal line clear still rewards.
    fresh();
    for (let c = 0; c < SIZE - 1; c++) grid[7][c] = { color: COLORS[0], type: 'normal', cracked: false };
    tray[2] = { cells: [[0, 0]], type: 'normal', color: COLORS[3] };
    placePiece(2, 7, SIZE - 1); // completes row 7 (all normal)
    const afterClear = { score, combo, rowCleared: grid[7].every(v => !v) };

    // --- Scenario C: cracked brick row clears properly on trigger.
    fresh();
    for (let c = 0; c < SIZE; c++) grid[3][c] = { color: COLORS[0], type: 'brick', cracked: true };
    tray[0] = { cells: [[0, 0]], type: 'normal', color: COLORS[1] };
    placePiece(0, 6, 5); // triggers fullLines -> row 3 all cracked bricks -> removed
    const afterCracked = { score, combo, rowCleared: grid[3].every(v => !v) };

    return { after1, after2, afterClear, afterCracked };
  });

  let fail = 0;
  const check = (label, ok, extra) => { console.log((ok ? 'OK   ' : 'FAIL ') + label + (extra ? ` — ${extra}` : '')); if (!ok) fail = 1; };

  check('A: uncracked brick row gives no line score', result.after1.score === 1, `score=${result.after1.score} (expect 1)`);
  check('A: combo stays 0 after brick-only "clear"', result.after1.combo === 0, `combo=${result.after1.combo}`);
  check('A: bricks got cracked', result.after1.cracked === true);
  check('A2: second hit clears cracked row (intended 2-hit mechanic)', result.after2.score === 91 && result.after2.combo === 1, `score=${result.after2.score} combo=${result.after2.combo}`);
  check('A2: row actually cleared', result.after2.rowCleared === true);
  check('B: normal line clear rewards (1 cell + 10*combo)', result.afterClear.score === 11 && result.afterClear.combo === 1, `score=${result.afterClear.score} combo=${result.afterClear.combo}`);
  check('B: row actually cleared', result.afterClear.rowCleared === true);
  check('C: cracked brick row clears on trigger', result.afterCracked.rowCleared === true, `score=${result.afterCracked.score} combo=${result.afterCracked.combo}`);
  check('C: cracked clear awards line score', result.afterCracked.score === 91, `score=${result.afterCracked.score}`);
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  process.exit(fail);
})().catch(e => { console.error('test crashed:', e.message); process.exit(1); });
