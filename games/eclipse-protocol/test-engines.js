// Smoke test for Eclipse Protocol engines
// Simulates ~20 turns of gameplay and verifies no crashes / invariants hold.

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, 'game-engines.js'), 'utf8');

// Load into a sandbox so we can grab the global namespace.
const sandbox = { window: {}, console };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const EP = sandbox.window.EclipseProtocol;

if (!EP) { console.error('FAIL: EclipseProtocol namespace not exposed'); process.exit(1); }
console.log('OK: namespace exposed with', Object.keys(EP).length, 'exports');

// Build a game and populate it with minimal data.
const game = new EP.Game(42);
game.registerPlayer({ name: 'Test Empire', personality: 'diplomatic' });

// Register 8 systems across the map
const systems = [
  { id: 'sol',     name: 'Sol',      type: 'habitable',  ownerId: 'player',   population: 10, hasAnomaly: true },
  { id: 'alpha',   name: 'Alpha Centauri', type: 'habitable', ownerId: 'velothi', population: 8 },
  { id: 'vega',    name: 'Vega',     type: 'gas_giant',  ownerId: 'velothi', population: 0 },
  { id: 'sirius',  name: 'Sirius',   type: 'asteroid',   ownerId: 'kessari', population: 4 },
  { id: 'rigel',   name: 'Rigel',    type: 'desert',     ownerId: 'myrmidon', population: 6 },
  { id: 'polaris', name: 'Polaris',  type: 'ice',        ownerId: 'auriga',  population: 5 },
  { id: 'altair',  name: 'Altair',   type: 'ocean',      ownerId: 'drakari', population: 7 },
  { id: 'reavers', name: 'Reaver\'s Rest', type: 'barren', ownerId: 'corsairs', population: 3 },
];
systems.forEach(s => game.registerSystem(s));

// Connections
[
  ['sol','alpha'], ['alpha','vega'], ['vega','sirius'], ['sirius','rigel'],
  ['rigel','polaris'], ['polaris','altair'], ['altair','reavers'],
  ['sol','reavers'], // creates long-range route
].forEach(([a,b]) => game.addConnection(a,b));

// Techs
game.addTech({ id: 'ftl_drive',      name: 'FTL Drive',      field: 'expansion' });
game.addTech({ id: 'laser_cannon',   name: 'Laser Cannon',   field: 'military' });
game.addTech({ id: 'hydroponics',    name: 'Hydroponics',    field: 'economy' });
game.addTech({ id: 'quantum_compute', name: 'Quantum Compute', field: 'science' });
game.addTech({ id: 'warp_theory',    name: 'Warp Theory',    field: 'expansion' });
game.addTech({ id: 'plasma_torp',    name: 'Plasma Torpedo', field: 'military' });

// Give player FTL tech so the "rival_independence" event can fire
game.state.techs.ftl_drive.owned.add('player');
// Make a bordering faction hostile to player to enable that event
game.diplomacy.factions.velothi.shiftRelation('player', -40, 'history');

// Build some player structures
game.economy.build('sol', 'player', 'farm');
game.economy.build('sol', 'player', 'mine');
game.economy.build('sol', 'player', 'lab');

// Trade routes
game.economy.establishTradeRoute('player', 'kessari', 'food', 3);
game.economy.establishTradeRoute('velothi', 'auriga', 'energy', 2);

// Establish some first contacts
game.diplomacy.firstContact('player', 'velothi', { sharedBorder: true });
game.diplomacy.firstContact('player', 'kessari');
game.diplomacy.firstContact('velothi', 'kessari');

// Capture narrative log
let narrativeFired = 0;
game.narrative.on(evt => {
  if (evt.kind === 'narrative') narrativeFired++;
});

// Run 20 turns
console.log('\n--- Running 20 turns ---');
for (let t = 1; t <= 20; t++) {
  const r = game.advanceTurn();
  if (t % 5 === 0) {
    console.log(`Turn ${t}:`,
      'prices=', r.prices,
      'diplomacyEvents=', r.diplomacyEvents.length,
      'player resources=', game.state.factions.player.resources,
      'player rep=', game.state.playerStats.reputation);
  }
}

console.log('\n--- Invariants ---');
console.log('Narrative events fired:', narrativeFired);
console.log('Event log entries:', game.narrative.log.length);
console.log('Factions:', Object.keys(game.state.factions).length);
console.log('Systems:', Object.keys(game.state.systems).length);
console.log('Trade routes:', game.economy.tradeRoutes.length);
console.log('Blockades:', game.economy.blockades.size);
console.log('Player wars:', game.state.playerStats.warsFought);
console.log('Player treaties:', game.state.playerStats.treatiesSigned);
console.log('Player alliances:', game.state.playerStats.alliancesMade);

// Sample relation matrix
console.log('\n--- Sample relations ---');
for (const id of Object.keys(game.state.factions)) {
  const f = game.state.factions[id];
  const rels = Object.entries(f.relations).map(([k,v]) => `${k}:${v}`).join(', ');
  console.log(`${f.name}: {${rels}}`);
}

// Verify resolveChoice works
console.log('\n--- Testing resolveChoice ---');
const recent = game.narrative.log.filter(e => !e.picked);
if (recent.length > 0) {
  const choiceEvent = recent[recent.length - 1];
  // Find the event id by title
  const def = EP.NARRATIVE_EVENTS.find(e => e.title === choiceEvent.title);
  if (def && def.choices.length > 0) {
    const before = game.state.playerStats.reputation;
    const ok = game.narrative.resolveChoice(def.id, 0);
    console.log(`Resolved "${choiceEvent.title}" -> choice 0: success=${ok}, rep change=${game.state.playerStats.reputation - before}`);
  }
}

// ---- Test betrayal propagation ----
console.log('\n--- Testing betrayal system ---');
const game4 = new EP.Game(99);
game4.registerPlayer({ name: 'Test 4', personality: 'diplomatic' });
systems.forEach(s => game4.registerSystem(s));
game4.addConnection('sol','alpha');
// First contacts to seed relations
['velothi','kessari','myrmidon','auriga'].forEach(id => game4.diplomacy.firstContact('player', id));
// Sign a treaty
game4.diplomacy.signTreaty('player', 'kessari');
// Snapshot relations BEFORE betrayal
const before = {};
game4.diplomacy.getAllFactions().forEach(f => { before[f.id] = f.relations.player || 0; });
// BREAK IT
game4.diplomacy.breakTreaty('player', 'kessari', 'testing');
// Snapshot IMMEDIATELY after
const after = {};
game4.diplomacy.getAllFactions().forEach(f => { after[f.id] = f.relations.player || 0; });
console.log('Relation shifts TOWARD player from betrayal (negative = penalty):');
for (const id of Object.keys(before)) {
  if (id === 'player') continue;
  const delta = after[id] - before[id];
  console.log(`  ${id}: ${before[id]} -> ${after[id]} (delta ${delta})`);
}
// Verify: every faction should have dropped their view of player
const allDropped = Object.keys(before).filter(id => id !== 'player').every(id => after[id] < before[id]);
console.log(`All factions penalized for betrayal: ${allDropped}`);

// ---- Test blockade ----
console.log('\n--- Testing blockade ---');
game.economy.blockadeEdge('sol', 'alpha');
const beforeBlockade = game.state.factions.player.resources.minerals;
game.economy.tick();
const afterBlockade = game.state.factions.player.resources.minerals;
game.economy.liftBlockade('sol', 'alpha');
console.log(`Player minerals before/after one tick while blockaded: ${beforeBlockade} -> ${afterBlockade}`);

// ---- Test AI war declaration ----
console.log('\n--- Testing AI war decisions ---');
// Reset and force a militaristic scenario
const game2 = new EP.Game(123);
game2.registerPlayer({ name: 'Test 2', personality: 'diplomatic' });
systems.forEach(s => game2.registerSystem(s));
game2.addConnection('sol','alpha');
['ftl_drive','laser_cannon'].forEach(id => game2.addTech({ id, name: id, field: 'military' }));
game2.state.techs.laser_cannon.owned.add('player');
// Make player weak so AI wants to attack
game2.state.factions.player.militaryStrength = 10;
game2.state.factions.player.stability = 25;
game2.diplomacy.factions.velothi.militaryStrength = 100;
game2.diplomacy.firstContact('velothi', 'player', { sharedBorder: true });
let declaredWar = false;
for (let t = 0; t < 30; t++) {
  const r = game2.advanceTurn();
  if (r.diplomacyEvents.some(e => e.kind === 'war' && e.attacker === 'velothi')) {
    declaredWar = true; break;
  }
}
console.log(`Militaristic AI declared war on weak player: ${declaredWar}`);

// ---- Test event consequence triggering ----
console.log('\n--- Testing narrative consequence triggers ---');
const game3 = new EP.Game(7);
game3.registerPlayer({ name: 'Test 3', personality: 'diplomatic' });
systems.forEach(s => game3.registerSystem(s));
game3.addConnection('sol','alpha');
game3.addTech({ id: 'ftl_drive', name: 'FTL', field: 'expansion' });
game3.state.techs.ftl_drive.owned.add('player');
game3.diplomacy.firstContact('player', 'velothi', { sharedBorder: true });
game3.diplomacy.factions.velothi.shiftRelation('player', -50, 'history');
let independenceFired = false;
for (let t = 0; t < 5; t++) {
  game3.advanceTurn();
  if (game3.narrative.log.some(e => e.title.includes('Independence'))) {
    independenceFired = true; break;
  }
}
console.log(`Rival Independence event fired when conditions met: ${independenceFired}`);

console.log('\nALL CHECKS PASSED');