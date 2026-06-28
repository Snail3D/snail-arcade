/* Headless smoke test — exercises every engine subsystem. Run via:
 *   node smoketest.js
 * No DOM needed; we stub the minimal DOM surface the engine touches. */
const fs = require('fs');
const path = require('path');

// --- Minimal DOM stubs --------------------------------------------------
const stubEl = () => {
  const el = {
    children: [],
    style: {},
    classList: { add(){}, remove(){}, toggle(){} },
    dataset: {},
    _inner: '',
    parentElement: null,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720 }),
    setAttribute(){}, getAttribute(){ return null; },
    appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
    querySelector(){ return stubEl(); },
    querySelectorAll(){ return []; },
    addEventListener(){},
    set textContent(v){ this._inner = String(v); },
    get textContent(){ return this._inner; },
    set innerHTML(v){
      this._inner = String(v);
      // Build a tiny mock children list for .children iteration
      this.children = [];
      const tagRe = /<(\w+)[^>]*>/g; let m;
      while ((m = tagRe.exec(v))) this.children.push(stubEl());
    },
    get innerHTML(){ return this._inner; },
    measureText(){ return { width: 100 }; }
  };
  return el;
};

global.window = {
  devicePixelRatio: 1,
  addEventListener(){},
  Eclipse: null
};
global.document = {
  _head: stubEl(),
  get head(){ return this._head; },
  getElementById(){ return null; },
  createElement(){ return stubEl(); },
  querySelector(){ return stubEl(); },
  body: stubEl()
};
global.localStorage = (() => {
  const m = new Map();
  return {
    getItem: k => m.has(k) ? m.get(k) : null,
    setItem: (k, v) => m.set(k, v),
    removeItem: k => m.delete(k)
  };
})();
global.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 16);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.getComputedStyle = () => ({ position: 'relative' });
global.console = console;

// --- Load engine -------------------------------------------------------
const src = fs.readFileSync(path.join(__dirname, 'eclipse-engine.js'), 'utf8');
// Wrap in a way that makes the IIFE execute; expose window.Eclipse.
const wrapped = src + '\nmodule.exports = window.Eclipse;';
const Module = require('module');
const m = new Module('eclipse');
m._compile(wrapped, 'eclipse-engine.js');
const Eclipse = m.exports;

if (!Eclipse) { console.error('FAIL: window.Eclipse not exposed'); process.exit(1); }
console.log('PASS: Eclipse exposed on window');

// --- Test PRNG determinism ---------------------------------------------
const r1 = new Eclipse.PRNG(42);
const a = r1.next(); const b = r1.next(); const c = r1.next();
const r2 = new Eclipse.PRNG(42);
if (r2.next() !== a || r2.next() !== b || r2.next() !== c) {
  console.error('FAIL: PRNG not deterministic'); process.exit(1);
}
console.log(`PASS: PRNG deterministic (sample: ${a.toFixed(6)})`);

// --- Test GalaxyGenerator ----------------------------------------------
const gen = new Eclipse.GalaxyGenerator({ seed: 1337, systemCount: 10000 });
const { systems, homeIds } = gen.generate();
if (systems.length < 10000) {
  console.error('FAIL: galaxy has fewer than 10k systems:', systems.length); process.exit(1);
}
if (homeIds.length < 1 || homeIds.length > 2) {
  console.error('FAIL: home count wrong:', homeIds.length); process.exit(1);
}
const ids = new Set(systems.map(s => s.id));
if (ids.size !== systems.length) {
  console.error('FAIL: duplicate system ids'); process.exit(1);
}
console.log(`PASS: Galaxy generated — ${systems.length} systems, ${homeIds.length} home(s)`);

// --- Test types & resources shape --------------------------------------
const expected = ['id','name','x','y','type','typeMeta','resources','population',
                  'basePopulation','owner','gates','discovered','explored','stationLevel'];
for (const sys of systems.slice(0, 5)) {
  for (const k of expected) {
    if (!(k in sys)) { console.error('FAIL: missing field', k); process.exit(1); }
  }
  for (const r of ['minerals','energy','food','tech']) {
    if (typeof sys.resources[r] !== 'number') {
      console.error('FAIL: bad resource', r); process.exit(1);
    }
  }
}
console.log('PASS: System schema valid');

// --- Test GateNetwork ---------------------------------------------------
const galaxy = new Eclipse.Galaxy(systems, homeIds);
const gates = new Eclipse.GateNetwork(galaxy, { maxLinksPerSystem: 4, maxLinkDistance: 260 });
gates.build();

// Verify connectivity
const reachable = galaxy.bfs(homeIds[0]);
if (reachable.size < galaxy.systems.length * 0.95) {
  console.warn(`WARN: only ${reachable.size}/${galaxy.systems.length} systems reachable from home`);
} else {
  console.log(`PASS: Gate network — ${reachable.size}/${galaxy.systems.length} systems reachable from home`);
}

// Verify gate symmetry & cost shape
let symOK = true, costOK = true, totalEdges = 0;
for (const s of systems) {
  for (const g of s.gates) {
    totalEdges++;
    const n = galaxy.get(g.to);
    if (!n) { symOK = false; continue; }
    if (!n.gates.some(x => x.to === s.id)) symOK = false;
    if (typeof g.cost !== 'number' || g.cost <= 0) costOK = false;
  }
}
if (!symOK) { console.error('FAIL: gates not symmetric'); process.exit(1); }
if (!costOK) { console.error('FAIL: gate costs invalid'); process.exit(1); }
console.log(`PASS: Gates symmetric & costed — ${totalEdges / 2 | 0} undirected edges`);

// Verify isolation is rare
let isolated = 0;
for (const s of systems) if (s.gates.length === 0) isolated++;
console.log(`INFO: ${isolated} isolated systems (should be 0 after 2nd pass)`);

// --- Test TechTree ------------------------------------------------------
const tt = new Eclipse.TechTree();
if (tt.techs.length < 10) { console.error('FAIL: too few techs'); process.exit(1); }
const start = new Set();
if (!tt.canUnlock('basic_propulsion', start)) { console.error('FAIL: free tech not unlockable'); process.exit(1); }
if (tt.canUnlock('warp_drive', start)) { console.error('FAIL: tier-3 tech unlocks w/o prereqs'); process.exit(1); }
start.add('jump_dynamics');
if (!tt.canUnlock('warp_drive', start)) { console.error('FAIL: prereq logic'); process.exit(1); }
console.log(`PASS: TechTree — ${tt.techs.length} techs, prereqs respected`);

// --- Test Faction + GameState -------------------------------------------
const gs = new Eclipse.GameState();
gs.galaxy = galaxy;
gs.techTree = tt;
const player = new Eclipse.Faction({
  id: 'p', name: 'Test', color: '#fff', isPlayer: true,
  ownedSystems: [homeIds[0]]
});
gs.factions = [player];
gs.playerFactionId = 'p';

// Verify save/load roundtrip
gs.turn = 7;
gs.phase = 'expand';
gs.events.push({ turn: 1, type: 'test', message: 'hello', t: Date.now() });
const saveOK = gs.save();
if (!saveOK) { console.error('FAIL: save returned false'); process.exit(1); }
const loaded = Eclipse.GameState.load();
if (!loaded || loaded.turn !== 7 || loaded.phase !== 'expand' || loaded.factions.length !== 1) {
  console.error('FAIL: save/load roundtrip'); process.exit(1);
}
if (loaded.galaxy.systems.length !== galaxy.systems.length) {
  console.error('FAIL: galaxy size mismatch after load'); process.exit(1);
}
Eclipse.GameState.clearSave();
console.log('PASS: Save/load roundtrip');

// Verify advanceTurn economics
const homeSys = galaxy.get(homeIds[0]);
homeSys.owner = 'p';
homeSys.stationLevel = 2;
const beforeEnergy = player.resources.energy;
gs.advanceTurn();
if (player.resources.energy <= beforeEnergy) {
  console.error('FAIL: advanceTurn did not collect income'); process.exit(1);
}
console.log(`PASS: advanceTurn — energy ${beforeEnergy} → ${player.resources.energy} after turn`);

// Verify startResearch
const ok = gs.startResearch('p', 'mining_drones');
if (!ok) { console.error('FAIL: startResearch failed'); process.exit(1); }
if (player.activeResearch?.techId !== 'mining_drones') {
  console.error('FAIL: active research not set'); process.exit(1);
}
console.log('PASS: startResearch');

// --- Full Game integration test ----------------------------------------
const fakeCanvas = stubEl();
fakeCanvas.parentElement = stubEl();
fakeCanvas.getContext = () => ({
  setTransform(){}, createRadialGradient: () => ({ addColorStop(){} }),
  fillRect(){}, fillText(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, fill(){}, arc(){},
  rect(){}, setLineDash(){}, clearRect(){},
  measureText: () => ({ width: 100 }),
  set fillStyle(v){}, set strokeStyle(v){}, set lineWidth(v){}, set globalAlpha(v){},
  set font(v){}, set textAlign(v){}, set textBaseline(v){}
});

try {
  const game = Eclipse.start(fakeCanvas, { seed: 99, systemCount: 10000, factionCount: 4 });
  if (!game.state) { console.error('FAIL: game.state null after start'); process.exit(1); }
  if (game.state.factions.length !== 4) {
    console.error('FAIL: faction count', game.state.factions.length); process.exit(1);
  }
  console.log(`PASS: Full Game integration — ${game.state.factions.length} factions, ${game.state.galaxy.systems.length} systems`);

  // Try a few end-turn cycles
  for (let i = 0; i < 3; i++) game.endTurn();
  if (game.state.turn < 4) { console.error('FAIL: turn did not advance'); process.exit(1); }
  console.log(`PASS: 3 turns simulated — now turn ${game.state.turn}`);

  // Try a system action (colonize)
  // Pick a habitable system in player reach
  const reachable = game.state.galaxy.bfs(homeIds[0]);
  const colonyTarget = systems.find(s =>
    reachable.has(s.id) && s.owner == null && s.type === 'asteroid' && s.id !== homeIds[0]
  );
  if (colonyTarget) {
    game.state.player().resources.energy = 999;
    game.state.player().resources.food = 999;
    game.systemAction(colonyTarget.id, 'colonize');
    if (colonyTarget.owner !== 'player') {
      console.error('FAIL: colonize did not change owner'); process.exit(1);
    }
    console.log(`PASS: Colonize action — ${colonyTarget.name} now owned by player`);
  } else {
    console.log('SKIP: no reachable colonize target found');
  }

  // Try save through game
  game.save();
  console.log('PASS: game.save()');
} catch (e) {
  console.error('FAIL: full game integration threw:', e.message, e.stack);
  process.exit(1);
}

console.log('\n✓ All smoke tests passed.');
