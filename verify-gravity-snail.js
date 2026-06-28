const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let errors = [];
  page.on('pageerror', (err) => {
    errors.push(err.message);
  });

  await page.goto('file:///Users/snailmac/snail-arcade/games/gravity-snail-supercloud/index.html', { waitUntil: 'networkidle' });

  // Wait a bit for the game loop to run
  await page.waitForTimeout(2000);

  // Check if canvas exists and has content
  const canvasExists = await page.evaluate(() => {
    return !!document.getElementById('game');
  });

  const canvasWidth = await page.evaluate(() => {
    return document.getElementById('game')?.width || 0;
  });

  const canvasHeight = await page.evaluate(() => {
    return document.getElementById('game')?.height || 0;
  });

  // Check if game is in menu state (should be after load)
  const gameState = await page.evaluate(() => {
    return window.state || 'unknown';
  });

  // Simulate a click to start the game
  await page.click('#game');
  await page.waitForTimeout(100);

  const gameStateAfterClick = await page.evaluate(() => {
    return window.state || 'unknown';
  });

  // Simulate thrust (mousedown + mouseup)
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.up();

  // Wait for game loop to run with thrust
  await page.waitForTimeout(500);

  // Check for any new errors after gameplay
  const finalErrors = [...errors];

  await browser.close();

  console.log('=== VERIFICATION RESULTS ===');
  console.log(`Canvas exists: ${canvasExists}`);
  console.log(`Canvas dimensions: ${canvasWidth}x${canvasHeight}`);
  console.log(`Initial state: ${gameState}`);
  console.log(`After click state: ${gameStateAfterClick}`);
  console.log(`Errors during execution: ${finalErrors.length}`);

  if (finalErrors.length > 0) {
    console.log('\nERRORS:');
    finalErrors.forEach((err, i) => {
      console.log(`  ${i + 1}. ${err}`);
    });
    process.exit(1);
  } else {
    console.log('\n✓ All checks passed - no runtime errors detected');
  }
})();
