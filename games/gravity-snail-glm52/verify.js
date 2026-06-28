// Headless verification harness for Gravity Snail
// Loads index.html in jsdom, stubs canvas 2d + rAF, then drives the game
// through real frames and asserts the mechanics actually work.

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

// --- Stub canvas 2d context: no-op drawing ---
function makeCtx() {
  const target = {};
  const ctx = new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (prop === "measureText") return () => ({ width: 10 });
      if (prop === "createLinearGradient" || prop === "createRadialGradient")
        return () => ({ addColorStop: () => {} });
      return typeof prop === "string" ? () => {} : undefined;
    },
    set(t, prop, val) { t[prop] = val; return true; }
  });
  return ctx;
}

let rafCbs = [];
let simTime = 0;
const TIME_STEP = 1000 / 60;

const dom = new JSDOM(html, {
  runScripts: "outside-only",
  pretendToBeVisual: false,
  url: "http://localhost/"
});
const { window } = dom;
const { document } = window;

// --- Patch environment ---
window.requestAnimationFrame = (cb) => { rafCbs.push(cb); return rafCbs.length; };
window.cancelAnimationFrame = () => {};
window.performance = { now: () => simTime };
window.innerWidth = 800;
window.innerHeight = 600;
window.localStorage = {
  store: {},
  getItem(k) { return this.store[k] ?? null; },
  setItem(k, v) { this.store[k] = String(v); },
};

// Canvas stub
const canvas = {
  width: 0, height: 0, style: {},
  getContext: () => makeCtx(),
  addEventListener: () => {},
  removeEventListener: () => {},
};
document.getElementById = (id) => id === "game" ? canvas : null;

// --- Run the game's script, expose internal state ---
const scriptBody = html.match(/<script>([\s\S]*?)<\/script>/)[1];
window.eval(scriptBody + `
  window.__gs = {
    get state(){return state;}, set state(v){state=v;},
    get snail(){return snail;},
    get obstacles(){return obstacles;},
    get leaves(){return leaves;},
    get particles(){return particles;},
    get score(){return score;},
    get scrollSpeed(){return scrollSpeed;},
    get shake(){return shake;}, set shake(v){shake=v;},
    get thrusting(){return thrusting;}, set thrusting(v){thrusting=v;},
    get parallax(){return parallax;},
    get bestScore(){return bestScore;},
    resetGame, startGame, die
  };
`);
const gs = window.__gs;

// --- Helpers ---
let pass = 0, fail = 0;
function ok(name, cond, extra = "") {
  if (cond) { pass++; console.log("  PASS:", name); }
  else { fail++; console.error("  FAIL:", name, extra); }
}
function stepFrames(n) {
  for (let i = 0; i < n; i++) {
    simTime += TIME_STEP;
    const cbs = rafCbs;
    rafCbs = [];
    for (const cb of cbs) cb(simTime);
  }
}

// ================= TESTS =================
console.log("\n=== Gravity Snail headless verification ===\n");

// 1. Boot
ok("initial state is menu", gs.state === "menu", "state=" + gs.state);
ok("snail object exists", !!gs.snail);
ok("obstacles seeded", gs.obstacles.length > 0, "count=" + gs.obstacles.length);
ok("leaves array exists", Array.isArray(gs.leaves));
ok("particles array exists", Array.isArray(gs.particles));
ok("3 parallax layers", gs.parallax.length === 3);

// 2. Start game
gs.startGame();
ok("startGame transitions to play", gs.state === "play", "state=" + gs.state);
ok("score reset to 0", gs.score === 0);

// 3. Gravity: no input → snail falls (short burst, stay in safe zone)
gs.resetGame(); gs.state = "play";
gs.snail.y = 200; gs.snail.vy = 0;
const startY = gs.snail.y;
gs.thrusting = false;
stepFrames(30);
ok("snail falls under gravity", gs.snail.y > startY, "y: " + startY.toFixed(0) + " -> " + gs.snail.y.toFixed(0));
ok("downward velocity", gs.snail.vy > 0, "vy=" + gs.snail.vy.toFixed(0));

// 4. Thrust: hold → snail rises (fresh reset, mid-screen)
gs.resetGame(); gs.state = "play";
gs.snail.y = 300; gs.snail.vy = 200;
const thrustStartY = gs.snail.y;
gs.thrusting = true;
stepFrames(30);
ok("snail rises with thrust", gs.snail.y < thrustStartY, "y: " + thrustStartY.toFixed(0) + " -> " + gs.snail.y.toFixed(0));
ok("upward velocity", gs.snail.vy < 0, "vy=" + gs.snail.vy.toFixed(0));
gs.thrusting = false;

// 5. Speed increases over time
const speedEarly = gs.scrollSpeed;
stepFrames(300);
ok("scroll speed increases", gs.scrollSpeed > speedEarly,
   gs.scrollSpeed.toFixed(0) + " > " + speedEarly.toFixed(0));
ok("speed capped at max", gs.scrollSpeed <= 760 + 1);

// 6. Obstacles scroll left and recycle
const obXBefore = gs.obstacles[0] ? gs.obstacles[0].x : 0;
stepFrames(10);
const obXAfter = gs.obstacles[0] ? gs.obstacles[0].x : 0;
ok("obstacles move left", obXAfter < obXBefore, obXBefore.toFixed(0) + " -> " + obXAfter.toFixed(0));
ok("new obstacles keep spawning", gs.obstacles.length > 0);

// 7. Parallax layers move
const pxBefore = gs.parallax[0].items[0].x;
stepFrames(10);
ok("parallax layer moves", gs.parallax[0].items[0].x !== pxBefore);

// 8. Shake decays
gs.shake = 1.0;
const shakeBefore = gs.shake;
stepFrames(30);
ok("screen shake decays", gs.shake < shakeBefore, gs.shake.toFixed(2) + " < " + shakeBefore);

// 9. Death by floor + high score persistence (clean state)
//     Best-score logic: localStorage only updates when score BEATS previous best.
//     Verify by (a) confirming die() runs, (b) earning a score first, then dying.
gs.resetGame(); gs.state = "play";
gs.snail.y = 500; gs.snail.vy = 0;
ok("snail alive before hitting floor", gs.state === "play");
stepFrames(120);
ok("snail dies hitting floor", gs.state === "dead", "state=" + gs.state);

// Now verify high-score path: reset, earn points via leaves, die, check storage
window.localStorage.store = {}; // clear
gs.resetGame(); gs.state = "play";
gs.snail.y = 300; gs.snail.vy = 0; gs.thrusting = false;
gs.leaves.length = 0;
gs.leaves.push({ x: gs.snail.x, y: gs.snail.y, r: 11, phase: 0, collected: false, fade: 1 });
stepFrames(3);
ok("score earned before death", gs.score > 0, "score=" + gs.score);
// kill the snail
gs.state = "play"; // ensure die() will fire
gs.snail.y = 599;
stepFrames(5);
ok("snail dies with score", gs.state === "dead");
ok("high score saved to localStorage when beaten",
   window.localStorage.getItem("gravitySnail_best") !== null,
   "val=" + window.localStorage.getItem("gravitySnail_best"));

// 10. Restart
gs.startGame();
ok("restart returns to play", gs.state === "play");
ok("score reset after restart", gs.score === 0);

// 11. Leaf collision + particle burst
gs.resetGame(); gs.state = "play";
gs.snail.y = 300; gs.snail.vy = 0;
gs.thrusting = false;
// Place a leaf directly on the snail
gs.leaves.length = 0;
gs.leaves.push({ x: gs.snail.x, y: gs.snail.y, r: 11, phase: 0, collected: false, fade: 1 });
stepFrames(3);
const anyCollected = gs.leaves.some(l => l.collected) || gs.leaves.length === 0;
ok("leaf gets collected on contact", anyCollected, "leaves=" + gs.leaves.length + " collected=" + (gs.leaves[0] && gs.leaves[0].collected));
ok("particles emitted on collection", gs.particles.length > 0, "particles=" + gs.particles.length);
ok("score increases from leaf", gs.score >= 5, "score=" + gs.score);

// ================= RESULTS =================
console.log("\n=== Results ===");
console.log("  Passed:", pass);
console.log("  Failed:", fail);
console.log(fail === 0 ? "\nALL TESTS PASSED" : "\nSOME TESTS FAILED");
process.exit(fail === 0 ? 0 : 1);
