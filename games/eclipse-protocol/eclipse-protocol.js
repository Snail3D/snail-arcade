/* =============================================================================
 * ECLIPSE PROTOCOL — Combat System & Tech Tree
 * -----------------------------------------------------------------------------
 * Self-contained vanilla JavaScript module for a 4X space empire builder.
 * Exposes a single global namespace: window.EclipseProtocol
 *
 * Modules:
 *   - ShipClasses      : 8 ship types with rock-paper-scissors counters
 *   - CombatEngine     : turn-based combat, terrain, victory, morale
 *   - FleetManager     : build fleets, move, assign, invade, blockade
 *   - WarManager       : declare war, auto-resolve border conflicts
 *   - TechTree         : 200+ techs across 8 research paths
 *   - ResearchManager  : research queues, prereqs, espionage theft, events
 *
 * Pure ES2015+, zero dependencies. Designed to be dropped into a <script> tag.
 * ============================================================================= */
(function (global) {
  'use strict';

  // ----------------------------------------------------------------------------
  // Utility helpers
  // ----------------------------------------------------------------------------
  const Utils = {
    /** Deterministic-ish RNG wrapper (Mulberry32). Seedable for replays/tests. */
    rng: (seed = 1) => {
      let s = seed >>> 0;
      return () => {
        s |= 0; s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    /** Pick a random element from an array. */
    pick: (arr, rng = Math.random) => arr[Math.floor(rng() * arr.length)],
    /** Range helper: clamp(value, min, max). */
    clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    /** Random integer in [lo, hi]. */
    randInt: (lo, hi, rng = Math.random) =>
      Math.floor(rng() * (hi - lo + 1)) + lo,
    /** Deep-clone plain objects/arrays (no Maps/Sets). */
    clone: (o) => JSON.parse(JSON.stringify(o)),
    /** Stable id generator. */
    uid: (() => { let i = 0; return (p = 'id') => `${p}_${++i}`; })(),
  };

  // ===========================================================================
  // SHIP CLASSES
  // ===========================================================================
  /**
   * ShipClasses defines the eight base hull types and the counter matrix that
   * drives rock-paper-scissors combat. Values are intentionally tuned so that
   * (a) no single hull is dominant in a vacuum and (b) mixed compositions
   * always outperform mono-fleets.
   *
   * Counter rules:
   *   - A ship that COUNTERS another deals +50% damage to it.
   *   - The countered ship deals -30% damage to its counter.
   *
   * The COUNTERS map lists, for each ship, the ship classes it is strong
   * against. The COUNTERED_BY map is the inverse — used by the AI advisor and
   * the UI to warn players about bad matchups.
   */
  const ShipClasses = {
    // Base stat block for each hull. Costs are in {minerals, energy}.
    // Special abilities are referenced by string and resolved in CombatEngine.
    catalog: {
      scout: {
        name: 'Scout',
        hp: 40, attack: 12, defense: 4, speed: 9, range: 4,
        cost: { minerals: 60, energy: 20 },
        special: 'recon', // reveals enemy fleet composition at start of battle
        flavor: 'Fast, fragile recon frigate.',
      },
      fighter: {
        name: 'Fighter',
        hp: 70, attack: 22, defense: 8, speed: 8, range: 4,
        cost: { minerals: 120, energy: 50 },
        special: 'swarm_evade', // 15% chance to dodge incoming attacks
        flavor: 'Agile anti-scout interceptor.',
      },
      destroyer: {
        name: 'Destroyer',
        hp: 130, attack: 38, defense: 16, speed: 6, range: 5,
        cost: { minerals: 240, energy: 110 },
        special: 'salvo', // first strike deals double damage
        flavor: 'Medium-range anti-fighter escort.',
      },
      cruiser: {
        name: 'Cruiser',
        hp: 220, attack: 55, defense: 26, speed: 5, range: 5,
        cost: { minerals: 420, energy: 200 },
        special: 'versatile', // takes reduced penalty from any counter (-15%)
        flavor: 'Well-rounded workhorse of any fleet.',
      },
      battleship: {
        name: 'Battleship',
        hp: 480, attack: 110, defense: 55, speed: 3, range: 6,
        cost: { minerals: 900, energy: 450 },
        special: 'overcharge', // +20% attack when below 50% hp (last stand)
        flavor: 'Slow, devastating capital ship.',
      },
      bomber: {
        name: 'Bomber',
        hp: 140, attack: 90, defense: 12, speed: 5, range: 4,
        cost: { minerals: 320, energy: 260 },
        special: 'splash', // area damage hits 2 additional targets
        flavor: 'Anti-armor striker with area munitions.',
      },
      carrier: {
        name: 'Carrier',
        hp: 600, attack: 30, defense: 40, speed: 3, range: 3,
        cost: { minerals: 1200, energy: 700 },
        special: 'launch', // spawns 2 fighters per carrier per battle
        flavor: 'Expensive mobile fighter platform.',
      },
      swarm: {
        name: 'Swarm Drone',
        hp: 18, attack: 7, defense: 2, speed: 7, range: 3,
        cost: { minerals: 25, energy: 8 },
        special: 'overwhelm', // +1 damage per additional swarm ship attacking same target
        flavor: 'Cheap, disposable drone — strength in numbers.',
      },
    },

    // Rock-paper-scissors: who each hull is strong against.
    COUNTERS: {
      scout:     ['swarm'],            // scouts shred drone swarms
      fighter:   ['scout', 'bomber'],  // fighters intercept light/fragile
      destroyer: ['fighter'],          // destroyers bully fighters
      cruiser:   ['destroyer', 'scout'], // cruiser flexes
      battleship:['cruiser', 'carrier', 'bomber'], // BBs crush capital + bombers
      bomber:    ['battleship', 'cruiser', 'carrier', 'swarm'], // bombers AOE
      carrier:   ['destroyer', 'cruiser', 'battleship'], // carriers project fighters
      swarm:     ['destroyer', 'battleship'],              // swarm overwhelms slow
    },

    /** Build a normalized counter map {shipClass -> [counteredClasses]} */
    buildCounters() {
      return Utils.clone(this.COUNTERS);
    },

    /** All hull ids. */
    ids() { return Object.keys(this.catalog); },

    /** Get stats for a hull id (or sensible defaults). */
    get(id) { return this.catalog[id] || null; },

    /** Compose COUNTERS + COUNTERED_BY inverse map for AI/UI hints. */
    counterMatrix() {
      const counteredBy = {};
      for (const [attacker, victims] of Object.entries(this.COUNTERS)) {
        for (const v of victims) {
          (counteredBy[v] = counteredBy[v] || []).push(attacker);
        }
      }
      return { counters: Utils.clone(this.COUNTERS), counteredBy };
    },
  };

  // ===========================================================================
  // COMBAT ENGINE
  // ===========================================================================
  /**
   * CombatEngine resolves a single battle between two fleets in a chosen
   * terrain. It is deterministic given a seed and is safe to call many times
   * per turn for border skirmishes.
   *
   * Public surface:
   *   new CombatEngine({ seed }).resolve(attackerFleet, defenderFleet, terrain)
   *
   * Returns a BattleReport object containing:
   *   { winner, loser, turns, log[], survivors, casualties, moraleBroken }
   */
  class CombatEngine {
    constructor(opts = {}) {
      this.rng = Utils.rng(opts.seed || Date.now());
      // Tuning knobs — exposed so balance patches are one-liners.
      this.config = Object.assign({
        counterBonus: 0.50,   // +50% damage when countering
        counterPenalty: 0.30, // -30% damage dealt when countered
        moraleBase: 1.0,      // morale threshold scalar
        baseCritChance: 0.05, // 5% critical hit
        baseCritMult: 1.75,   // crits deal 1.75x
        maxTurns: 30,         // anti-stalemate safeguard
        moraleBreakFloor: 0.20, // below 20% hp fleet may rout
      }, opts.config || {});
    }

    /**
     * Resolve a full battle.
     * @param {Object} attacker - { fleet: {scout:n,...}, owner:str }
     * @param {Object} defender - { fleet: {scout:n,...}, owner:str }
     * @param {string} terrain - 'open'|'asteroid'|'nebula'|'blackhole'
     * @param {Object} [mods]   - { techBonuses: {shipId: {attack:+, hp:+, ...}}, abilities:Set }
     */
    resolve(attacker, defender, terrain = 'open', mods = {}) {
      const a = this._snapshot(attacker, mods.techBonuses);
      const d = this._snapshot(defender, mods.techBonuses);

      const report = {
        terrain,
        turns: 0,
        log: [],
        survivors: { attacker: {}, defender: {} },
        casualties: { attacker: 0, defender: 0 },
        moraleBroken: { attacker: false, defender: false },
        winner: null,
        loser: null,
      };

      // Pre-battle: recon ability reveals enemy composition.
      const recon = this._hasSpecial(a, 'recon') || this._hasSpecial(d, 'recon');
      const sensorsActive = terrain !== 'nebula';
      if (recon && sensorsActive) {
        report.log.push('Scouts establish sensor lock — full fleet composition visible.');
      } else if (!sensorsActive) {
        report.log.push('Nebula interference — sensors offline. Composition unknown.');
      }

      const terrainMods = this._terrainMods(terrain);

      // AI advisor: pre-battle power readout.
      const powerA = this._fleetPower(a, d, terrainMods);
      const powerD = this._fleetPower(d, a, terrainMods);
      report.powerReadout = { attacker: powerA, defender: powerD };

      // Turn loop
      for (let turn = 1; turn <= this.config.maxTurns; turn++) {
        report.turns = turn;

        // PHASE 1 — Movement (resolved narratively; speed affects initiative)
        const initiative = this._initiative(a, d, terrainMods);

        // PHASE 2 — Attack & PHASE 3 — Special abilities (combined per side)
        const order = initiative.attackerFirst ? ['attacker', 'defender']
                                                 : ['defender', 'attacker'];
        for (const side of order) {
          if (side === 'attacker') this._phaseAttack(a, d, terrainMods, report, 'attacker');
          else                     this._phaseAttack(d, a, terrainMods, report, 'defender');
          this._phaseSpecial(side === 'attacker' ? a : d,
                             side === 'attacker' ? d : a,
                             terrainMods, report, side);

          // Morale check after each side acts.
          if (this._checkMorale(a, report, 'attacker')) break;
          if (this._checkMorale(d, report, 'defender')) break;
        }

        // End-of-turn: prune dead hulls.
        this._purge(a); this._purge(d);

        // Victory checks
        if (this._isDestroyed(a)) { report.winner = 'defender'; report.loser = 'attacker'; break; }
        if (this._isDestroyed(d)) { report.winner = 'attacker'; report.loser = 'defender'; break; }
      }

      // Stalemate fallback: attacker retreats if defender holds.
      if (!report.winner) {
        report.log.push('Stalemate — attacker withdraws to preserve fleet.');
        report.winner = 'defender'; report.loser = 'attacker';
      }

      // Tally survivors and casualties.
      report.survivors.attacker = this._counts(a);
      report.survivors.defender = this._counts(d);
      report.casualties.attacker = this._initialCount(attacker.fleet) - this._totalCount(report.survivors.attacker);
      report.casualties.defender = this._initialCount(defender.fleet) - this._totalCount(report.survivors.defender);

      return report;
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    /** Deep-copy a fleet into a working structure with per-ship hp pools. */
    _snapshot(side, techBonuses = {}) {
      const fleet = side.fleet || {};
      const ships = {};
      for (const [id, count] of Object.entries(fleet)) {
        const base = ShipClasses.get(id);
        if (!base || !count) continue;
        const bonus = techBonuses[id] || {};
        const stats = {
          hp:      (base.hp + (bonus.hp || 0)) * count,
          hpMax:   (base.hp + (bonus.hp || 0)) * count,
          attack:  base.attack + (bonus.attack || 0),
          defense: base.defense + (bonus.defense || 0),
          speed:   base.speed + (bonus.speed || 0),
          range:   base.range + (bonus.range || 0),
          special: base.special,
          count,
          alive: count,
          perShipHp: base.hp + (bonus.hp || 0),
        };
        ships[id] = stats;
      }
      return { ships, owner: side.owner || 'unknown' };
    }

    _counts(side) {
      const out = {};
      for (const [id, s] of Object.entries(side.ships)) out[id] = s.count;
      return out;
    }

    _totalCount(counts) {
      return Object.values(counts).reduce((a, b) => a + b, 0);
    }

    _initialCount(fleet) {
      return Object.values(fleet || {}).reduce((a, b) => a + b, 0);
    }

    _isDestroyed(side) {
      return Object.values(side.ships).every(s => s.count <= 0);
    }

    _purge(side) {
      for (const id of Object.keys(side.ships)) {
        const s = side.ships[id];
        if (s.count <= 0) delete side.ships[id];
        else if (s.hp <= 0) {
          // Convert fractional hp losses into whole-ship losses.
          const lost = Math.min(s.count, Math.ceil(-s.hp / Math.max(1, s.perShipHp)));
          s.count -= lost; s.hp = s.count * s.perShipHp;
        }
      }
    }

    _hasSpecial(side, name) {
      return Object.values(side.ships).some(s => s.special === name && s.count > 0);
    }

    /** Terrain modifiers: returns per-ship-class scalar adjustments. */
    _terrainMods(terrain) {
      switch (terrain) {
        case 'asteroid':
          return { accuracy: 0.80, rangeMult: 1.0, dmgTaken: 1.0,
                   perClass: { scout: { speed: 1.30, attack: 1.10 } } };
        case 'nebula':
          return { accuracy: 0.90, rangeMult: 0.60, dmgTaken: 1.0,
                   perClass: {}, sensors: false };
        case 'blackhole':
          return { accuracy: 1.0, rangeMult: 1.0, dmgTaken: 1.50,
                   pullChance: 0.05 }; // 5% per turn any ship gets pulled in
        case 'open':
        default:
          return { accuracy: 1.0, rangeMult: 1.0, dmgTaken: 1.0, perClass: {} };
      }
    }

    /** Effective initiative roll using fleet-wide speed + terrain. */
    _initiative(a, d, mods) {
      const speed = (side) => {
        let total = 0, count = 0;
        for (const s of Object.values(side.ships)) {
          if (!s.count) continue;
          const klass = mods.perClass && mods.perClass[s.special === 'recon' ? 'scout' : this._shipIdFor(s)];
          const sp = s.speed * (klass && klass.speed ? klass.speed : 1);
          total += sp * s.count; count += s.count;
        }
        return count ? total / count : 0;
      };
      const aSpeed = speed(a) + this.rng() * 2;
      const dSpeed = speed(d) + this.rng() * 2;
      return { attackerFirst: aSpeed >= dSpeed,
               aSpeed: aSpeed.toFixed(2), dSpeed: dSpeed.toFixed(2) };
    }

    _shipIdFor(shipStat) {
      // Reverse lookup is rare; we tagged ships with id in _snapshot via key.
      // This helper exists for terrain mods that reference hull by class.
      return Object.keys(ShipClasses.catalog).find(
        k => ShipClasses.catalog[k].special === shipStat.special
      ) || 'cruiser';
    }

    /** Composite fleet power readout (used by AI & UI). */
    _fleetPower(attackerSide, defenderSide, mods) {
      let power = 0;
      for (const [id, s] of Object.entries(attackerSide.ships)) {
        if (!s.count) continue;
        const countered = (ShipClasses.COUNTERS[id] || [])
          .some(v => defenderSide.ships[v] && defenderSide.ships[v].count > 0);
        const isCountered = Object.entries(defenderSide.ships)
          .some(([vid, vs]) => vs.count > 0 &&
            (ShipClasses.COUNTERS[vid] || []).includes(id));
        let dmg = s.attack * s.count;
        if (countered) dmg *= 1 + this.config.counterBonus;
        if (isCountered) dmg *= 1 - this.config.counterPenalty;
        dmg *= mods.accuracy || 1;
        power += dmg;
      }
      return Math.round(power);
    }

    /** Attack phase: each hull type in `att` fires at its preferred target in `def`. */
    _phaseAttack(att, def, mods, report, sideLabel) {
      for (const [id, s] of Object.entries(att.ships)) {
        if (!s.count) continue;
        const targetId = this._pickTarget(id, def);
        if (!targetId) continue;
        const targetStat = def.ships[targetId];
        if (!targetStat || targetStat.count <= 0) continue;
        const dmg = this._calcDamage(s, targetStat, att, def, mods, id, targetId);
        if (dmg <= 0) continue;
        targetStat.hp -= dmg;
        report.log.push(
          `T${report.turns} ${sideLabel}: ${s.count}x ${ShipClasses.get(id).name} ` +
          `hit ${ShipClasses.get(targetId).name} for ${Math.round(dmg)} dmg.`
        );
        this._applyPullChance(targetStat, mods, report, targetId);
      }
    }

    /** Special abilities fire after the standard attack phase. */
    _phaseSpecial(att, def, mods, report, sideLabel) {
      // Carrier launches: spawn 2 free fighters per carrier (limited per battle).
      const fighterBase = ShipClasses.catalog.fighter;
      for (const [id, s] of Object.entries(att.ships)) {
        if (!s.count) continue;
        const klass = ShipClasses.get(id);
        if (klass && klass.special === 'launch' && !s._launched) {
          const spawned = s.count * 2;
          att.ships.fighter = att.ships.fighter || {
            hp: fighterBase.hp * spawned,
            hpMax: fighterBase.hp * spawned,
            attack: fighterBase.attack, defense: fighterBase.defense,
            speed: fighterBase.speed, range: fighterBase.range,
            special: 'swarm_evade', count: spawned, alive: spawned,
            perShipHp: fighterBase.hp,
          };
          s._launched = true;
          report.log.push(`T${report.turns} ${sideLabel}: Carriers launch ${spawned} fighters.`);
        }
      }
    }

    _pickTarget(attackerId, defSide) {
      // Targeting priority: hard counter > random weakest > first available.
      const counters = ShipClasses.COUNTERS[attackerId] || [];
      for (const c of counters) {
        if (defSide.ships[c] && defSide.ships[c].count > 0) return c;
      }
      const ids = Object.keys(defSide.ships).filter(k => defSide.ships[k].count > 0);
      if (!ids.length) return null;
      // Prefer lowest-hp target to maximize kills.
      ids.sort((a, b) => defSide.ships[a].hp - defSide.ships[b].hp);
      return ids[0];
    }

    _calcDamage(attackerStat, defenderStat, attSide, defSide, mods, attId, defId) {
      // Base damage = (atk - 0.6*def) * count
      let perShip = Math.max(1, attackerStat.attack - defenderStat.defense * 0.6);

      // Range check — if defender's range < attacker's, ranged kiting penalty.
      const attKlass = ShipClasses.get(attId);
      if (defenderStat.range > attackerStat.range + 1) perShip *= 0.85;

      // Counter modifiers.
      const counters = ShipClasses.COUNTERS[attId] || [];
      if (counters.includes(defId)) perShip *= 1 + this.config.counterBonus;
      const isCountered = Object.values(defSide.ships).some(s =>
        (ShipClasses.COUNTERS[defId] || []).includes(attId));
      if (isCountered) perShip *= 1 - this.config.counterPenalty;

      // Cruiser's versatile: replaces 30% counter penalty with 15%.
      // After the 0.7x reduction above, we lift back to 0.85x by multiplying 0.85/0.7.
      if (attId === 'cruiser' && isCountered) perShip *= (1 - 0.15) / (1 - this.config.counterPenalty);

      // Battleship last-stand.
      if (attId === 'battleship' && attackerStat.hp < attackerStat.hpMax * 0.5) {
        perShip *= 1.20;
      }
      // Bomber AOE: hits up to 3 targets.
      let dmg = perShip * attackerStat.count;
      if (attKlass.special === 'splash') dmg *= 1.5;

      // Swarm overwhelm stacking.
      if (attKlass.special === 'overwhelm' && attackerStat.count >= 10) {
        dmg *= 1 + Math.min(0.5, attackerStat.count / 100);
      }

      // Accuracy / range terrain mods.
      dmg *= mods.accuracy || 1;
      const rangeMod = mods.rangeMult || 1;
      const adjustedRange = attKlass.range * rangeMod;
      if (adjustedRange < defenderStat.range - 1) dmg *= 0.75;

      // Damage taken terrain mod (applied to outgoing when defender is in bad terrain).
      dmg *= mods.dmgTaken || 1;

      // Critical hit.
      if (this.rng() < this.config.baseCritChance) dmg *= this.config.baseCritMult;

      // Fighter evade.
      if (defId === 'fighter' && this.rng() < 0.15) dmg = 0;

      // Per-class terrain tuning (e.g. scouts faster in asteroids -> more hits).
      if (mods.perClass && mods.perClass[attId]) {
        const c = mods.perClass[attId];
        if (c.attack) dmg *= c.attack;
      }

      return Math.max(0, dmg);
    }

    _applyPullChance(targetStat, mods, report, id) {
      if (!mods.pullChance) return;
      if (this.rng() < mods.pullChance) {
        targetStat.count = 0; targetStat.hp = 0;
        report.log.push(`  ! ${ShipClasses.get(id).name} pulled into black hole.`);
      }
    }

    _checkMorale(side, report, label) {
      let total = 0, hp = 0, hpMax = 0;
      for (const s of Object.values(side.ships)) {
        total += s.count;
        hp += Math.max(0, s.hp);
        hpMax += s.hpMax;
      }
      if (!total || !hpMax) return false;
      const ratio = hp / hpMax;
      if (ratio < this.config.moraleBreakFloor && this.rng() < 0.4) {
        report.moraleBroken[label] = true;
        report.log.push(`${label.toUpperCase()} FLEET ROUTS — morale collapse!`);
        report.winner = label === 'attacker' ? 'defender' : 'attacker';
        report.loser  = label === 'attacker' ? 'attacker' : 'defender';
        return true;
      }
      return false;
    }
  }

  // ===========================================================================
  // FLEET MANAGER
  // ===========================================================================
  /**
   * FleetManager owns every fleet in the game. Players build ships at any
   * controlled system, group hulls into fleets, and dispatch them. The
   * manager also exposes helpers for invasion and blockade operations.
   */
  class FleetManager {
    constructor(game) {
      this.game = game;          // back-reference to the Game object
      this.fleets = {};          // id -> Fleet
      this.bySystem = {};        // systemId -> [fleetId]
    }

    /** Build a fleet from a composition object at a given system. */
    buildFleet(systemId, composition, name = 'Fleet') {
      // Cost & resource deduction.
      const sys = this.game.systems[systemId];
      if (!sys) throw new Error(`No such system: ${systemId}`);
      const total = this._totalCost(composition);
      if (sys.resources.minerals < total.minerals ||
          sys.resources.energy  < total.energy) {
        throw new Error('Insufficient resources to build fleet.');
      }
      sys.resources.minerals -= total.minerals;
      sys.resources.energy  -= total.energy;

      const id = Utils.uid('fleet');
      const fleet = {
        id, name, systemId,
        composition: { ...composition },
        hp: this._maxHp(composition),
        orders: 'idle',          // idle | move | invade | blockade | attack
        target: null,
        cargo: 0,                // ground forces for invasion
      };
      this.fleets[id] = fleet;
      (this.bySystem[systemId] = this.bySystem[systemId] || []).push(id);
      return fleet;
    }

    /** Add ships to an existing fleet (cost deducted from current system). */
    reinforce(fleetId, composition) {
      const f = this.fleets[fleetId];
      if (!f) throw new Error(`No such fleet: ${fleetId}`);
      const sys = this.game.systems[f.systemId];
      const total = this._totalCost(composition);
      if (sys.resources.minerals < total.minerals ||
          sys.resources.energy  < total.energy) {
        throw new Error('Insufficient resources to reinforce.');
      }
      sys.resources.minerals -= total.minerals;
      sys.resources.energy  -= total.energy;
      for (const [id, n] of Object.entries(composition)) {
        f.composition[id] = (f.composition[id] || 0) + n;
      }
      f.hp = this._maxHp(f.composition);
      return f;
    }

    /** Move a fleet to a target system (validates adjacency). */
    moveFleet(fleetId, targetSystemId) {
      const f = this.fleets[fleetId];
      if (!f) throw new Error(`No such fleet: ${fleetId}`);
      const from = this.game.systems[f.systemId];
      const to   = this.game.systems[targetSystemId];
      if (!to) throw new Error(`No such target: ${targetSystemId}`);
      // Adjacency: explicit hyperlane OR within range 2 (warp-capable).
      const dist = this._distance(from, to);
      const hyperlane = (from.hyperlanes || []).includes(targetSystemId);
      const inRange = dist <= (this.game.warpRange || 2);
      if (!hyperlane && !inRange) throw new Error('Target out of warp range.');

      // Update registries.
      this.bySystem[f.systemId] = (this.bySystem[f.systemId] || [])
        .filter(id => id !== fleetId);
      (this.bySystem[targetSystemId] = this.bySystem[targetSystemId] || []).push(fleetId);
      f.systemId = targetSystemId;
      return f;
    }

    /** Order a fleet to invade the system it currently occupies. */
    invade(fleetId, groundForces = 1000) {
      const f = this.fleets[fleetId];
      if (!f) throw new Error(`No such fleet: ${fleetId}`);
      const sys = this.game.systems[f.systemId];
      if (sys.owner === this.game.playerId) throw new Error('Cannot invade own system.');
      f.orders = 'invade'; f.target = f.systemId; f.cargo = groundForces;
      // Resolution: roll combat power vs garrison.
      return this._resolveInvasion(f, sys);
    }

    /** Order a fleet to blockade its current system (no capture). */
    blockade(fleetId) {
      const f = this.fleets[fleetId];
      if (!f) throw new Error(`No such fleet: ${fleetId}`);
      const sys = this.game.systems[f.systemId];
      if (sys.owner === this.game.playerId) throw new Error('Cannot blockade own system.');
      f.orders = 'blockade'; f.target = f.systemId;
      sys.blockadedBy = this.game.playerId;
      // Blockade cuts 75% of resource output.
      sys.blockadePenalty = 0.75;
      return { ok: true, sys };
    }

    /** Disband fleet — returns partial resources (50%) to current system. */
    disband(fleetId) {
      const f = this.fleets[fleetId];
      if (!f) return;
      const sys = this.game.systems[f.systemId];
      const refund = this._totalCost(f.composition, 0.5);
      sys.resources.minerals += refund.minerals;
      sys.resources.energy  += refund.energy;
      this.bySystem[f.systemId] = (this.bySystem[f.systemId] || [])
        .filter(id => id !== fleetId);
      delete this.fleets[fleetId];
    }

    /** All fleets at a system. */
    at(systemId) {
      return (this.bySystem[systemId] || [])
        .map(id => this.fleets[id]).filter(Boolean);
    }

    /** Auto-resolve hostile contacts at a system (border conflict). */
    autoResolveBorder(systemId) {
      const here = this.at(systemId);
      if (here.length < 2) return null;
      // Split by ownership.
      const byOwner = {};
      for (const f of here) {
        const owner = this.game.fleetOwner(f.id);
        (byOwner[owner] = byOwner[owner] || []).push(f);
      }
      const owners = Object.keys(byOwner);
      if (owners.length < 2) return null;
      // For simplicity: combine fleets by owner, largest pair fights.
      owners.sort((a, b) => this._power(byOwner[b]) - this._power(byOwner[a]));
      const [off, def] = [byOwner[owners[0]], byOwner[owners[1]]];
      const engine = new CombatEngine({ seed: Utils.uid('seed') | 0 });
      return engine.resolve(
        { fleet: this._combine(off), owner: owners[0] },
        { fleet: this._combine(def), owner: owners[1] },
        this.game.systems[systemId].terrain || 'open',
      );
    }

    // ---------- internals ----------
    _combine(fleets) {
      const out = {};
      for (const f of fleets) {
        for (const [k, n] of Object.entries(f.composition)) {
          out[k] = (out[k] || 0) + n;
        }
      }
      return out;
    }

    _power(fleets) {
      let p = 0;
      for (const f of fleets) {
        for (const [id, n] of Object.entries(f.composition)) {
          p += (ShipClasses.get(id)?.attack || 0) * n;
        }
      }
      return p;
    }

    _totalCost(composition, mult = 1) {
      let minerals = 0, energy = 0;
      for (const [id, n] of Object.entries(composition)) {
        const c = ShipClasses.get(id)?.cost || { minerals: 0, energy: 0 };
        minerals += c.minerals * n * mult;
        energy   += c.energy   * n * mult;
      }
      return { minerals: Math.round(minerals), energy: Math.round(energy) };
    }

    _maxHp(composition) {
      let hp = 0;
      for (const [id, n] of Object.entries(composition)) {
        hp += (ShipClasses.get(id)?.hp || 0) * n;
      }
      return hp;
    }

    _distance(a, b) {
      const dx = a.x - b.x, dy = a.y - b.y;
      return Math.round(Math.sqrt(dx * dx + dy * dy));
    }

    _resolveInvasion(fleet, system) {
      const garrison = (system.garrison || 0);
      const attackerPower = fleet.cargo + this._power([fleet]);
      const defenderPower = garrison + this._power(
        (this.game.enemyFleetsAt(system.id) || []).map(f => ({ composition: f.composition }))
      );
      const roll = Utils.randInt(0, attackerPower + defenderPower, this.game.rng);
      const ok = roll < attackerPower;
      if (ok) {
        const oldOwner = system.owner;
        system.owner = this.game.playerId;
        system.garrison = Math.floor(fleet.cargo / 2);
        return { ok: true, captured: true, from: oldOwner, to: system.owner };
      }
      fleet.cargo = Math.floor(fleet.cargo * 0.3);
      return { ok: false, captured: false };
    }
  }

  // ===========================================================================
  // WAR MANAGER
  // ===========================================================================
  /**
   * WarManager keeps the diplomatic state of every known faction. Declaring
   * war unlocks auto-resolved border skirmishes; peace re-locks them.
   */
  class WarManager {
    constructor(game) {
      this.game = game;
      this.wars = new Set(); // "player:aiId"
      this.peaceTreaties = [];
    }

    /** True if the player is currently at war with aiId. */
    atWarWith(aiId) { return this.wars.has(`player:${aiId}`); }

    /** Declare war. Side-effect: triggers border skirmish auto-resolution. */
    declareWar(aiId) {
      this.wars.add(`player:${aiId}`);
      // Cancel any active treaties.
      this.peaceTreaties = this.peaceTreaties.filter(t => t.partner !== aiId);
      this._resolveAllBorderSkirmishes(aiId);
      return { declared: true, aiId };
    }

    /** Sign peace — ends the war and grants a 10-turn truce. */
    makePeace(aiId, terms = {}) {
      this.wars.delete(`player:${aiId}`);
      this.peaceTreaties.push({ partner: aiId, terms, untilTurn: this.game.turn + 10 });
      return { peace: true, aiId, terms };
    }

    /** Find all contested systems and auto-resolve fights. */
    _resolveAllBorderSkirmishes(aiId) {
      const out = [];
      for (const sys of Object.values(this.game.systems)) {
        const fleets = this.game.fleets.at(sys.id);
        const owners = new Set(fleets.map(f => this.game.fleetOwner(f.id)));
        if (owners.has(this.game.playerId) && owners.has(aiId)) {
          const report = this.game.fleets.autoResolveBorder(sys.id);
          if (report) out.push({ system: sys.id, report });
        }
      }
      return out;
    }

    /** Diplomacy tick — AI may declare war, sue for peace, etc. */
    diplomacyTick() {
      const events = [];
      for (const ai of this.game.aiFactions()) {
        const relation = this.game.relations[ai.id] || 0;
        if (!this.atWarWith(ai.id) && relation < -50 && this.game.rng() < 0.25) {
          this.wars.add(`player:${ai.id}`);
          events.push({ type: 'war_declared', aiId: ai.id, by: 'ai' });
        } else if (this.atWarWith(ai.id) && relation > 25 && this.game.rng() < 0.2) {
          this.wars.delete(`player:${ai.id}`);
          events.push({ type: 'peace', aiId: ai.id, by: 'ai' });
        }
      }
      return events;
    }
  }

  // ===========================================================================
  // TECH TREE
  // ===========================================================================
  /**
   * TechTree is the canonical definition of every technology in the game.
   * Eight paths × ~25 techs each = 200+ techs. Each tech declares:
   *   { id, path, tier, name, cost, prereqs[], unlocks, effects, alternative }
   *
   * `unlocks` is a list of feature strings the UI can switch on:
   *   "ship:bomber", "building:shipyard", "ability:warp_strike", ...
   * `effects` is a list of structured modifiers:
   *   { type:"ship_mod", ship:"fighter", stat:"attack", amount:0.10 }
   */
  const TechTree = {
    paths: ['engineering', 'weapons', 'defense', 'science', 'diplomacy', 'biology', 'economy', 'espionage'],

    /**
     * Master tech list — built procedurally with sane prereq chains so that
     * every path has 25 tiers, choices appear at tiers 3/5/7/9/..., and every
     * "role" tech (ships, abilities, buildings) is reachable.
     */
    techs: [],

    /** Build the tech list. Called once at module init. */
    build() {
      if (this.techs.length) return this.techs;
      const defs = this._definitions();
      for (const d of defs) this.techs.push(d);
      return this.techs;
    },

    /** Lookup tech by id. */
    get(id) { return this.techs.find(t => t.id === id); },

    /** All techs in a given path, ordered by tier. */
    inPath(path) {
      return this.techs.filter(t => t.path === path).sort((a, b) => a.tier - b.tier);
    },

    /** True if the player meets all prereqs for this tech. */
    canResearch(techId, researchedIds) {
      const t = this.get(techId);
      if (!t) return false;
      const prereqs = t.prereqs || [];
      return prereqs.every(p => researchedIds.has(p));
    },

    /** Generate the rich tech list. */
    _definitions() {
      const list = [];

      // --------------------------------------------------------------------
      // ENGINEERING (ships, buildings, infrastructure)
      // --------------------------------------------------------------------
      const eng = [
        // Tier 1 — basics
        { id:'eng_1', name:'Basic Engineering', cost:120, unlocks:['building:workshop'] },
        { id:'eng_2', name:'Improved Hulls', cost:200, unlocks:[{ship_mod:{ship:'scout',stat:'hp',amount:10}}] },
        { id:'eng_3', name:'Refined Alloys', cost:280, unlocks:[{ship_mod:{ship:'fighter',stat:'defense',amount:2}}] },
        { id:'eng_4', name:'Modular Frames', cost:360, prereqs:['eng_1'], unlocks:['building:shipyard'] },
        // Tier 2
        { id:'eng_5', name:'Improved Thrusters', cost:420, prereqs:['eng_2'], unlocks:[{ship_mod:{ship:'scout',stat:'speed',amount:1}}] },
        { id:'eng_6', name:'Armor Plating', cost:480, prereqs:['eng_3'], unlocks:[{ship_mod:{ship:'destroyer',stat:'hp',amount:20}}] },
        { id:'eng_7', name:'Cruiser Yards', cost:560, prereqs:['eng_4'], unlocks:['ship:cruiser','building:cruiser_yard'] },
        { id:'eng_8', name:'Capital Ship Construction', cost:680, prereqs:['eng_7'], unlocks:['ship:battleship','building:capital_dock'] },
        // Tier 3 — choices
        { id:'eng_9a', name:'Carrier Aviation', cost:820, prereqs:['eng_8'], unlocks:['ship:carrier','ability:carrier_launch'] },
        { id:'eng_9b', name:'Drone Swarms', cost:780, prereqs:['eng_8'], unlocks:['ship:swarm','building:drone_fab'] },
        { id:'eng_9c', name:'Bomber Wings', cost:780, prereqs:['eng_8'], unlocks:['ship:bomber','building:bomber_hangar'] },
        // Tier 4
        { id:'eng_10', name:'Warp Drive Theory', cost:940, prereqs:['eng_5'], unlocks:['ability:warp_strike'] },
        { id:'eng_11', name:'Energy Distribution', cost:1000, prereqs:['eng_6'], unlocks:['building:reactor'] },
        { id:'eng_12', name:'Automation', cost:1100, prereqs:['eng_11'], unlocks:['building:fabricator'] },
        // Tier 5
        { id:'eng_13', name:'Mega-Engineering', cost:1400, prereqs:['eng_12'], unlocks:['building:ringworld','ability:stellar_fortress'] },
        { id:'eng_14', name:'Quantum Drives', cost:1500, prereqs:['eng_10'], unlocks:[{ship_mod:{ship:'*',stat:'speed',amount:1}}] },
        { id:'eng_15', name:'Adaptive Hulls', cost:1600, prereqs:['eng_12'], unlocks:[{ship_mod:{ship:'*',stat:'hp',amount:0.10}}] },
        // Tier 6
        { id:'eng_16', name:'Nanite Assembly', cost:1800, prereqs:['eng_13','eng_14'], unlocks:['building:nanite_forge'] },
        { id:'eng_17', name:'Hyperspace Lane Stabilization', cost:1900, prereqs:['eng_14'], unlocks:['building:hyperlane_beacon'] },
        // Tier 7
        { id:'eng_18', name:'Living Ships', cost:2200, prereqs:['eng_15','bio_8'], unlocks:['ship:living_frigate'] },
        { id:'eng_19', name:'Self-Replicating Mines', cost:2400, prereqs:['eng_16'], unlocks:['building:replicating_mine'] },
        // Tier 8 — capstone
        { id:'eng_20', name:'Dyson Spheres', cost:3500, prereqs:['eng_17','eng_19'], unlocks:['building:dyson_sphere','ability:energy_sovereignty'] },
        // Bonus fillers to reach 25
        { id:'eng_21', name:'Reinforced Bulkheads', cost:600, prereqs:['eng_6'], unlocks:[{ship_mod:{ship:'cruiser',stat:'hp',amount:30}}] },
        { id:'eng_22', name:'Compact Reactors', cost:900, prereqs:['eng_11'], unlocks:[{ship_mod:{ship:'fighter',stat:'range',amount:1}}] },
        { id:'eng_23', name:'Asteroid Mining Rigs', cost:700, prereqs:['eng_4'], unlocks:['building:mining_complex'] },
        { id:'eng_24', name:'Refit Programs', cost:1500, prereqs:['eng_15'], unlocks:['ability:instant_refit'] },
        { id:'eng_25', name:'Sentient AI Cores', cost:2800, prereqs:['eng_16','sci_15'], unlocks:['building:ai_core','ability:predictive_targeting'] },
      ].map((t, i) => Object.assign({ path:'engineering', tier: Math.ceil((i + 1) / 3) }, t));

      // --------------------------------------------------------------------
      // WEAPONS
      // --------------------------------------------------------------------
      const weap = [
        { id:'weap_1', name:'Kinetic Slugs', cost:120, unlocks:[{ship_mod:{ship:'*',stat:'attack',amount:0.05}}] },
        { id:'weap_2', name:'Magazine Autoloaders', cost:220, prereqs:['weap_1'], unlocks:[{ship_mod:{ship:'fighter',stat:'attack',amount:3}}] },
        { id:'weap_3', name:'Plasma Torpedoes', cost:340, prereqs:['weap_1'], unlocks:['ability:plasma_torp'] },
        { id:'weap_4', name:'Railgun Spinal Mounts', cost:480, prereqs:['weap_2'], unlocks:['ability:railgun_volley'] },
        { id:'weap_5', name:'Mass Drivers', cost:520, prereqs:['weap_3'], unlocks:[{ship_mod:{ship:'destroyer',stat:'attack',amount:6}}] },
        { id:'weap_6', name:'Particle Beams', cost:640, prereqs:['weap_4','weap_5'], unlocks:[{ship_mod:{ship:'cruiser',stat:'attack',amount:8}}] },
        // Tier 3 choices
        { id:'weap_7a', name:'Antimatter Warheads', cost:780, prereqs:['weap_6'], unlocks:['ability:antimatter_strike'] },
        { id:'weap_7b', name:'Lance Arrays', cost:780, prereqs:['weap_6'], unlocks:['ability:lance_focus'] },
        { id:'weap_7c', name:'Orbital Bombardment', cost:780, prereqs:['weap_6'], unlocks:['ability:orbital_bombardment'] },
        // Tier 4
        { id:'weap_8', name:'Cruiser-grade Autocannons', cost:900, prereqs:['weap_6'], unlocks:[{ship_mod:{ship:'cruiser',stat:'attack',amount:6}}] },
        { id:'weap_9', name:'Battleship Macro Cannons', cost:1100, prereqs:['weap_8'], unlocks:[{ship_mod:{ship:'battleship',stat:'attack',amount:12}}] },
        { id:'weap_10', name:'Bomber Payload Tuning', cost:1000, prereqs:['weap_6'], unlocks:[{ship_mod:{ship:'bomber',stat:'attack',amount:10}}] },
        // Tier 5
        { id:'weap_11', name:'Siege Drivers', cost:1400, prereqs:['weap_9'], unlocks:['ability:siege_driver'] },
        { id:'weap_12', name:'Plasma Bombers', cost:1400, prereqs:['weap_10'], unlocks:[{ship_mod:{ship:'bomber',stat:'attack',amount:8}}] },
        { id:'weap_13', name:'Swarm Coordination', cost:1200, prereqs:['weap_2'], unlocks:[{ship_mod:{ship:'swarm',stat:'attack',amount:1}}] },
        // Tier 6
        { id:'weap_14', name:'Bypass Armor', cost:1700, prereqs:['weap_11'], unlocks:[{ship_mod:{ship:'*',stat:'attack',amount:0.10}}] },
        { id:'weap_15', name:'Dreadnought-class Guns', cost:2000, prereqs:['weap_14','eng_8'], unlocks:['ship:dreadnought'] },
        // Tier 7
        { id:'weap_16', name:'Singularity Torpedoes', cost:2400, prereqs:['weap_14','sci_12'], unlocks:['ability:singularity_torp'] },
        { id:'weap_17', name:'Nova Cannon', cost:2600, prereqs:['weap_15'], unlocks:['ability:nova_cannon'] },
        // Capstone
        { id:'weap_18', name:'World Crackers', cost:3500, prereqs:['weap_17','weap_16'], unlocks:['ability:world_crack'] },
        { id:'weap_19', name:'Resonance Cascades', cost:1800, prereqs:['weap_10'], unlocks:[{ship_mod:{ship:'*',stat:'attack',amount:0.05}}] },
        { id:'weap_20', name:'EMP Charges', cost:1600, prereqs:['weap_6'], unlocks:['ability:emp_disrupt'] },
        { id:'weap_21', name:'Fighter Missile Pods', cost:800, prereqs:['weap_2'], unlocks:[{ship_mod:{ship:'fighter',stat:'attack',amount:4}}] },
        { id:'weap_22', name:'Targeting Computers', cost:900, prereqs:['weap_1','sci_3'], unlocks:[{ship_mod:{ship:'*',stat:'attack',amount:0.05}}] },
        { id:'weap_23', name:'Starbuster Bombs', cost:2400, prereqs:['weap_12','weap_14'], unlocks:['ability:starbuster'] },
        { id:'weap_24', name:'Chrono-Torpedoes', cost:3200, prereqs:['weap_16','sci_15'], unlocks:['ability:chrono_torp'] },
        { id:'weap_25', name:'Annihilation Beams', cost:4000, prereqs:['weap_18','weap_24'], unlocks:['ability:annihilation_beam'] },
      ].map((t, i) => Object.assign({ path:'weapons', tier: Math.ceil((i + 1) / 3) }, t));

      // --------------------------------------------------------------------
      // DEFENSE
      // --------------------------------------------------------------------
      const def = [
        { id:'def_1', name:'Basic Shield Theory', cost:120, unlocks:['building:shield_gen'] },
        { id:'def_2', name:'Reactive Armor', cost:240, prereqs:['def_1'], unlocks:[{ship_mod:{ship:'*',stat:'defense',amount:2}}] },
        { id:'def_3', name:'Point Defense Lasers', cost:340, prereqs:['def_1'], unlocks:['ability:point_defense'] },
        { id:'def_4', name:'Shield Capacitors', cost:420, prereqs:['def_2'], unlocks:[{ship_mod:{ship:'cruiser',stat:'defense',amount:6}}] },
        { id:'def_5', name:'Composite Armor', cost:480, prereqs:['def_2','eng_3'], unlocks:[{ship_mod:{ship:'destroyer',stat:'defense',amount:4}}] },
        { id:'def_6', name:'Flak Clouds', cost:560, prereqs:['def_3'], unlocks:['ability:flak_screen'] },
        // Tier 3 choices
        { id:'def_7a', name:'Hardened Shields', cost:700, prereqs:['def_4'], unlocks:[{ship_mod:{ship:'battleship',stat:'defense',amount:10}}] },
        { id:'def_7b', name:'Layered Armor', cost:700, prereqs:['def_5'], unlocks:[{ship_mod:{ship:'*',stat:'hp',amount:0.10}}] },
        { id:'def_7c', name:'Active Stealth', cost:760, prereqs:['def_3','esp_5'], unlocks:['ability:cloak'] },
        // Tier 4
        { id:'def_8', name:'Planetary Shielding', cost:900, prereqs:['def_7a'], unlocks:['building:planetary_shield'] },
        { id:'def_9', name:'Fortress Doctrine', cost:980, prereqs:['def_7b'], unlocks:['building:fortress'] },
        { id:'def_10', name:'Stealth Field', cost:1000, prereqs:['def_7c'], unlocks:[{ship_mod:{ship:'scout',stat:'defense',amount:6}}] },
        // Tier 5
        { id:'def_11', name:'Capacitor Banks', cost:1200, prereqs:['def_8'], unlocks:[{ship_mod:{ship:'*',stat:'defense',amount:3}}] },
        { id:'def_12', name:'Regenerative Hulls', cost:1300, prereqs:['def_9','bio_5'], unlocks:['ability:regenerate'] },
        { id:'def_13', name:'Electronic Countermeasures', cost:1300, prereqs:['def_10','esp_8'], unlocks:['ability:ecm_burst'] },
        // Tier 6
        { id:'def_14', name:'Shield Domes', cost:1700, prereqs:['def_11'], unlocks:['building:shield_dome'] },
        { id:'def_15', name:'Ablative Plating', cost:1700, prereqs:['def_11'], unlocks:[{ship_mod:{ship:'*',stat:'hp',amount:0.15}}] },
        { id:'def_16', name:'Planetary Guns', cost:1700, prereqs:['def_9'], unlocks:['building:orbital_gun'] },
        // Tier 7
        { id:'def_17', name:'Aegis Networks', cost:2200, prereqs:['def_14','def_16'], unlocks:['ability:aegis'] },
        { id:'def_18', name:'Warp Suppression Fields', cost:2400, prereqs:['def_17','weap_10'], unlocks:['ability:warp_suppression'] },
        // Capstone
        { id:'def_19', name:'Invulnerability Field', cost:3500, prereqs:['def_18','def_15'], unlocks:['ability:invulnerable'] },
        { id:'def_20', name:'Sensor Jamming', cost:800, prereqs:['def_3'], unlocks:['ability:sensor_jam'] },
        { id:'def_21', name:'Quantum Shields', cost:1800, prereqs:['def_11','sci_10'], unlocks:[{ship_mod:{ship:'*',stat:'defense',amount:5}}] },
        { id:'def_22', name:'Phase Armor', cost:1900, prereqs:['def_15'], unlocks:['ability:phase_shift'] },
        { id:'def_23', name:'Missile Interceptors', cost:1100, prereqs:['def_6'], unlocks:[{ship_mod:{ship:'cruiser',stat:'defense',amount:6}}] },
        { id:'def_24', name:'Drone Swarms Defense', cost:1500, prereqs:['def_6'], unlocks:['building:point_defense_drone'] },
        { id:'def_25', name:'Solar Flare Shields', cost:4000, prereqs:['def_19','def_21'], unlocks:['building:solar_shield'] },
      ].map((t, i) => Object.assign({ path:'defense', tier: Math.ceil((i + 1) / 3) }, t));

      // --------------------------------------------------------------------
      // SCIENCE (research speed, anomaly detection)
      // --------------------------------------------------------------------
      const sci = [
        { id:'sci_1', name:'Research Methods', cost:120, unlocks:['building:lab'] },
        { id:'sci_2', name:'Anomaly Detection', cost:240, prereqs:['sci_1'], unlocks:['ability:scan_anomaly'] },
        { id:'sci_3', name:'Computational Theory', cost:340, prereqs:['sci_1'], unlocks:[{global:{researchSpeed:0.10}}] },
        { id:'sci_4', name:'Hyperphysics', cost:420, prereqs:['sci_2'], unlocks:[{global:{researchSpeed:0.10}}] },
        { id:'sci_5', name:'Particle Studies', cost:520, prereqs:['sci_3'], unlocks:['building:particle_accel'] },
        { id:'sci_6', name:'Quantum Theory', cost:640, prereqs:['sci_4','sci_5'], unlocks:[{global:{researchSpeed:0.15}}] },
        { id:'sci_7', name:'Astrobiology', cost:780, prereqs:['sci_5','bio_2'], unlocks:['ability:xeno_research'] },
        { id:'sci_8', name:'Materials Insight', cost:860, prereqs:['sci_6'], unlocks:['building:materials_lab'] },
        // Tier 3 choices
        { id:'sci_9a', name:'Sentient AI Theory', cost:1000, prereqs:['sci_8'], unlocks:['ability:ai_assistant'] },
        { id:'sci_9b', name:'Living Tech Theory', cost:1000, prereqs:['sci_7','bio_5'], unlocks:['building:bioforge'] },
        { id:'sci_9c', name:'Temporal Studies', cost:1100, prereqs:['sci_6'], unlocks:['ability:time_dilation'] },
        // Tier 4
        { id:'sci_10', name:'Hyperlane Mapping', cost:1200, prereqs:['sci_4'], unlocks:['building:hyperlane_map'] },
        { id:'sci_11', name:'Predictive Algorithms', cost:1300, prereqs:['sci_9a'], unlocks:[{global:{researchSpeed:0.20}}] },
        { id:'sci_12', name:'Dark Matter Studies', cost:1500, prereqs:['sci_6','weap_7a'], unlocks:['building:dark_matter_lab'] },
        // Tier 5
        { id:'sci_13', name:'Universal Translator', cost:1700, prereqs:['sci_7'], unlocks:['ability:universal_translate'] },
        { id:'sci_14', name:'Probability Engines', cost:1800, prereqs:['sci_11'], unlocks:[{global:{researchSpeed:0.25}}] },
        { id:'sci_15', name:'Precognition Arrays', cost:2200, prereqs:['sci_14'], unlocks:['ability:precog'] },
        // Tier 6
        { id:'sci_16', name:'Stellar Engineering', cost:2400, prereqs:['sci_12','eng_13'], unlocks:['ability:stellar_engineering'] },
        { id:'sci_17', name:'Multiverse Survey', cost:2800, prereqs:['sci_15'], unlocks:['building:multiverse_observatory'] },
        // Capstone
        { id:'sci_18', name:'Ascension Theory', cost:4000, prereqs:['sci_17','sci_16'], unlocks:['ability:ascend'] },
        { id:'sci_19', name:'Quantum Computers', cost:1500, prereqs:['sci_8'], unlocks:[{global:{researchSpeed:0.20}}] },
        { id:'sci_20', name:'Sensor Arrays', cost:600, prereqs:['sci_2'], unlocks:['building:sensor_array'] },
        { id:'sci_21', name:'Long-range Scanners', cost:1100, prereqs:['sci_20'], unlocks:['ability:long_scan'] },
        { id:'sci_22', name:'Archaeology Methods', cost:1300, prereqs:['sci_7'], unlocks:['ability:dig_site'] },
        { id:'sci_23', name:'Nanotech Theory', cost:1600, prereqs:['sci_19'], unlocks:['building:nanotech_lab'] },
        { id:'sci_24', name:'Neural Mapping', cost:1900, prereqs:['sci_19','bio_8'], unlocks:['ability:neural_map'] },
        { id:'sci_25', name:'Omega-point Studies', cost:5000, prereqs:['sci_18'], unlocks:['ability:omega_point'] },
      ].map((t, i) => Object.assign({ path:'science', tier: Math.ceil((i + 1) / 3) }, t));

      // --------------------------------------------------------------------
      // DIPLOMACY
      // --------------------------------------------------------------------
      const dip = [
        { id:'dip_1', name:'Xenology', cost:120, unlocks:['ability:first_contact'] },
        { id:'dip_2', name:'Trade Theory', cost:240, prereqs:['dip_1'], unlocks:['ability:trade_route'] },
        { id:'dip_3', name:'Federation Theory', cost:340, prereqs:['dip_2'], unlocks:['ability:federation'] },
        { id:'dip_4', name:'Cultural Attaches', cost:420, prereqs:['dip_2'], unlocks:[{global:{diplomacyBonus:0.10}}] },
        { id:'dip_5', name:'Galactic Forum', cost:520, prereqs:['dip_3'], unlocks:['building:forum'] },
        { id:'dip_6', name:'Trade Pacts', cost:640, prereqs:['dip_2','econ_3'], unlocks:['ability:trade_pact'] },
        // Tier 3 choices
        { id:'dip_7a', name:'Defense Pacts', cost:760, prereqs:['dip_4'], unlocks:['ability:defense_pact'] },
        { id:'dip_7b', name:'Economic Unions', cost:760, prereqs:['dip_6'], unlocks:['ability:economic_union'] },
        { id:'dip_7c', name:'Research Treaties', cost:760, prereqs:['dip_6','sci_3'], unlocks:['ability:research_treaty'] },
        // Tier 4
        { id:'dip_8', name:'Galactic Senate', cost:980, prereqs:['dip_5'], unlocks:['building:senate'] },
        { id:'dip_9', name:'Cultural Festivals', cost:1000, prereqs:['dip_4'], unlocks:[{global:{diplomacyBonus:0.15}}] },
        { id:'dip_10', name:'Open Borders', cost:1100, prereqs:['dip_4'], unlocks:['ability:open_borders'] },
        // Tier 5
        { id:'dip_11', name:'Joint Military Command', cost:1300, prereqs:['dip_7a'], unlocks:['ability:joint_command'] },
        { id:'dip_12', name:'Galactic Bank', cost:1500, prereqs:['dip_7b','econ_8'], unlocks:['building:galactic_bank'] },
        { id:'dip_13', name:'Knowledge Sharing', cost:1500, prereqs:['dip_7c'], unlocks:['ability:tech_share'] },
        // Tier 6
        { id:'dip_14', name:'Galactic Council', cost:1800, prereqs:['dip_11'], unlocks:['building:council'] },
        { id:'dip_15', name:'Propaganda Networks', cost:1700, prereqs:['dip_9'], unlocks:[{global:{diplomacyBonus:0.20}}] },
        { id:'dip_16', name:'Extradition Treaties', cost:1700, prereqs:['dip_4','esp_6'], unlocks:['ability:extradition'] },
        // Tier 7
        { id:'dip_17', name:'Galactic Hegemony', cost:2400, prereqs:['dip_14'], unlocks:['ability:hegemony'] },
        { id:'dip_18', name:'Universal Suffrage', cost:2200, prereqs:['dip_15'], unlocks:['ability:universal_vote'] },
        // Capstone
        { id:'dip_19', name:'Galactic Federation', cost:4000, prereqs:['dip_17','dip_18'], unlocks:['ability:federation_ultimate'] },
        { id:'dip_20', name:'Diplomatic Protocol', cost:400, prereqs:['dip_1'], unlocks:['ability:protocol'] },
        { id:'dip_21', name:'Refugee Resettlement', cost:900, prereqs:['dip_4','bio_6'], unlocks:['ability:refugee'] },
        { id:'dip_22', name:'Galactic Tourism', cost:1200, prereqs:['dip_9'], unlocks:[{global:{energyIncome:0.10}}] },
        { id:'dip_23', name:'Mutual Defense Vows', cost:1800, prereqs:['dip_11'], unlocks:['ability:mutual_defense'] },
        { id:'dip_24', name:'Peacekeepers', cost:2200, prereqs:['dip_14'], unlocks:['ability:peacekeepers'] },
        { id:'dip_25', name:'Universal Embassy', cost:5000, prereqs:['dip_19'], unlocks:['building:universal_embassy'] },
      ].map((t, i) => Object.assign({ path:'diplomacy', tier: Math.ceil((i + 1) / 3) }, t));

      // --------------------------------------------------------------------
      // BIOLOGY (population, food, health)
      // --------------------------------------------------------------------
      const bio = [
        { id:'bio_1', name:'Hydroponic Farms', cost:120, unlocks:['building:farm'] },
        { id:'bio_2', name:'Selective Breeding', cost:240, prereqs:['bio_1'], unlocks:[{global:{popGrowth:0.10}}] },
        { id:'bio_3', name:'Atmospheric Processing', cost:340, prereqs:['bio_1'], unlocks:['building:terraformer'] },
        { id:'bio_4', name:'Vaccination Programs', cost:420, prereqs:['bio_2'], unlocks:[{global:{popGrowth:0.10}}] },
        { id:'bio_5', name:'Gene Splicing', cost:520, prereqs:['bio_4'], unlocks:['ability:gene_splice'] },
        { id:'bio_6', name:'Synthetic Nutrients', cost:640, prereqs:['bio_3','bio_4'], unlocks:[{global:{popGrowth:0.15}}] },
        { id:'bio_7', name:'Xenobiology', cost:760, prereqs:['bio_5'], unlocks:['building:xenobio_lab'] },
        { id:'bio_8', name:'Cybernetic Medicine', cost:880, prereqs:['bio_5','sci_3'], unlocks:['building:medbay'] },
        // Tier 3 choices
        { id:'bio_9a', name:'Clone Vats', cost:980, prereqs:['bio_7'], unlocks:['ability:cloning'] },
        { id:'bio_9b', name:'Designer Organs', cost:980, prereqs:['bio_8'], unlocks:[{global:{popGrowth:0.20}}] },
        { id:'bio_9c', name:'Neural Linking', cost:1000, prereqs:['bio_8','esp_5'], unlocks:['ability:neural_link'] },
        // Tier 4
        { id:'bio_10', name:'Agri-Domes', cost:1200, prereqs:['bio_6'], unlocks:['building:agridome'] },
        { id:'bio_11', name:'Biospheres', cost:1300, prereqs:['bio_10','bio_3'], unlocks:['building:biosphere'] },
        { id:'bio_12', name:'Rapid Maturation', cost:1400, prereqs:['bio_9b'], unlocks:[{global:{popGrowth:0.25}}] },
        // Tier 5
        { id:'bio_13', name:'Longevity Treatments', cost:1700, prereqs:['bio_9a'], unlocks:[{global:{popGrowth:0.30}}] },
        { id:'bio_14', name:'Mind Uploading', cost:2000, prereqs:['bio_9c','sci_9a'], unlocks:['ability:mind_upload'] },
        { id:'bio_15', name:'Alien Symbiosis', cost:1800, prereqs:['bio_7'], unlocks:['ability:symbiosis'] },
        // Tier 6
        { id:'bio_16', name:'Genetic Memory', cost:2200, prereqs:['bio_14'], unlocks:['ability:genetic_memory'] },
        { id:'bio_17', name:'Telepathic Networks', cost:2400, prereqs:['bio_14'], unlocks:['ability:telepathy'] },
        // Capstone
        { id:'bio_18', name:'Postbiological Ascendancy', cost:4000, prereqs:['bio_16','bio_17'], unlocks:['ability:postbiological'] },
        { id:'bio_19', name:'Disease Eradication', cost:900, prereqs:['bio_4'], unlocks:[{global:{popGrowth:0.10}}] },
        { id:'bio_20', name:'Pharma Synthesis', cost:1100, prereqs:['bio_8'], unlocks:['building:pharma'] },
        { id:'bio_21', name:'Cryogenic Pods', cost:1300, prereqs:['bio_8'], unlocks:['building:cryo'] },
        { id:'bio_22', name:'Engineered Symbiotes', cost:1600, prereqs:['bio_15'], unlocks:['ability:symbiote'] },
        { id:'bio_23', name:'Synthetic Bodies', cost:1900, prereqs:['bio_14'], unlocks:['ability:synth_body'] },
        { id:'bio_24', name:'Hive Networks', cost:2400, prereqs:['bio_22'], unlocks:['ability:hive'] },
        { id:'bio_25', name:'Transcendent Biology', cost:5000, prereqs:['bio_18','bio_24'], unlocks:['ability:transcendent'] },
      ].map((t, i) => Object.assign({ path:'biology', tier: Math.ceil((i + 1) / 3) }, t));

      // --------------------------------------------------------------------
      // ECONOMY
      // --------------------------------------------------------------------
      const econ = [
        { id:'econ_1', name:'Market Economy', cost:120, unlocks:[{global:{energyIncome:0.10}}] },
        { id:'econ_2', name:'Mining Guilds', cost:240, prereqs:['econ_1'], unlocks:[{global:{mineralIncome:0.10}}] },
        { id:'econ_3', name:'Banking System', cost:340, prereqs:['econ_1'], unlocks:['building:bank'] },
        { id:'econ_4', name:'Trade Routes', cost:420, prereqs:['econ_2'], unlocks:['ability:trade_route'] },
        { id:'econ_5', name:'Resource Processing', cost:520, prereqs:['econ_2'], unlocks:[{global:{mineralIncome:0.15}}] },
        { id:'econ_6', name:'Energy Credits', cost:640, prereqs:['econ_3'], unlocks:[{global:{energyIncome:0.15}}] },
        { id:'econ_7', name:'Stock Exchange', cost:760, prereqs:['econ_3'], unlocks:['building:stock_exchange'] },
        { id:'econ_8', name:'Galactic Currency', cost:880, prereqs:['econ_6'], unlocks:[{global:{energyIncome:0.20}}] },
        // Tier 3 choices
        { id:'econ_9a', name:'Megacorporations', cost:980, prereqs:['econ_7'], unlocks:['ability:megacorp'] },
        { id:'econ_9b', name:'Planned Economy', cost:980, prereqs:['econ_7'], unlocks:[{global:{mineralIncome:0.25}}] },
        { id:'econ_9c', name:'Resource Monopolies', cost:980, prereqs:['econ_5','econ_7'], unlocks:['ability:monopoly'] },
        // Tier 4
        { id:'econ_10', name:'Hyperloop Logistics', cost:1200, prereqs:['econ_5'], unlocks:['building:hyperloop'] },
        { id:'econ_11', name:'Asteroid Mining', cost:1300, prereqs:['econ_5','eng_23'], unlocks:['ability:asteroid_mine'] },
        { id:'econ_12', name:'Industrial Megacomplexes', cost:1400, prereqs:['econ_10'], unlocks:['building:megacomplex'] },
        // Tier 5
        { id:'econ_13', name:'Matter Conversion', cost:1700, prereqs:['econ_12','sci_6'], unlocks:[{global:{mineralIncome:0.30}}] },
        { id:'econ_14', name:'Antimatter Reactors', cost:1800, prereqs:['econ_12','weap_7a'], unlocks:['building:antimatter_reactor'] },
        { id:'econ_15', name:'Trade Guild Networks', cost:1900, prereqs:['econ_9a'], unlocks:[{global:{energyIncome:0.30}}] },
        // Tier 6
        { id:'econ_16', name:'Galactic Marketplace', cost:2200, prereqs:['econ_15'], unlocks:['building:galactic_market'] },
        { id:'econ_17', name:'Matter Replication', cost:2600, prereqs:['econ_13'], unlocks:['ability:replicate'] },
        // Capstone
        { id:'econ_18', name:'Post-Scarcity Economy', cost:4000, prereqs:['econ_16','econ_17'], unlocks:['ability:post_scarcity'] },
        { id:'econ_19', name:'Inflation Control', cost:600, prereqs:['econ_3'], unlocks:[{global:{inflationControl:0.10}}] },
        { id:'econ_20', name:'Bureau of Commerce', cost:900, prereqs:['econ_4'], unlocks:['building:commerce'] },
        { id:'econ_21', name:'Mineral Refining', cost:1100, prereqs:['econ_5'], unlocks:[{global:{mineralIncome:0.15}}] },
        { id:'econ_22', name:'Energy Lattices', cost:1500, prereqs:['econ_11'], unlocks:['building:energy_lattice'] },
        { id:'econ_23', name:'Labor Automation', cost:1700, prereqs:['econ_12'], unlocks:[{global:{energyIncome:0.20}}] },
        { id:'econ_24', name:'Traders Guild', cost:2000, prereqs:['econ_15'], unlocks:['building:traders_guild'] },
        { id:'econ_25', name:'Singularity Markets', cost:5000, prereqs:['econ_18','sci_18'], unlocks:['building:singularity_market'] },
      ].map((t, i) => Object.assign({ path:'economy', tier: Math.ceil((i + 1) / 3) }, t));

      // --------------------------------------------------------------------
      // ESPIONAGE
      // --------------------------------------------------------------------
      const esp = [
        { id:'esp_1', name:'Covert Operations', cost:120, unlocks:['ability:spy'] },
        { id:'esp_2', name:'Cipher Theory', cost:240, prereqs:['esp_1'], unlocks:['ability:encrypt'] },
        { id:'esp_3', name:'Asset Recruitment', cost:340, prereqs:['esp_1'], unlocks:['ability:recruit_asset'] },
        { id:'esp_4', name:'Intelligence Networks', cost:420, prereqs:['esp_2'], unlocks:['building:intel_hub'] },
        { id:'esp_5', name:'Stealth Field Theory', cost:520, prereqs:['esp_2'], unlocks:['ability:cloak'] },
        { id:'esp_6', name:'Counter-Intelligence', cost:640, prereqs:['esp_3','esp_4'], unlocks:['ability:counter_intel'] },
        { id:'esp_7', name:'Diplomatic Spies', cost:760, prereqs:['esp_3','dip_4'], unlocks:['ability:diplomat_spy'] },
        { id:'esp_8', name:'Cyber Warfare', cost:880, prereqs:['esp_6','sci_3'], unlocks:['ability:cyber_warfare'] },
        // Tier 3 choices
        { id:'esp_9a', name:'Industrial Sabotage', cost:980, prereqs:['esp_8'], unlocks:['ability:sabotage_industry'] },
        { id:'esp_9b', name:'Tech Theft', cost:980, prereqs:['esp_4'], unlocks:['ability:steal_tech'] },
        { id:'esp_9c', name:'Assassination', cost:980, prereqs:['esp_6'], unlocks:['ability:assassinate'] },
        // Tier 4
        { id:'esp_10', name:'False Flags', cost:1200, prereqs:['esp_9a'], unlocks:['ability:false_flag'] },
        { id:'esp_11', name:'Coup Support', cost:1300, prereqs:['esp_9c'], unlocks:['ability:support_coup'] },
        { id:'esp_12', name:'Coded Signals', cost:1400, prereqs:['esp_5'], unlocks:['ability:signal_cipher'] },
        // Tier 5
        { id:'esp_13', name:'Infiltrate Command', cost:1700, prereqs:['esp_11'], unlocks:['ability:infiltrate_command'] },
        { id:'esp_14', name:'Mind Control Tech', cost:1900, prereqs:['esp_11','bio_9c'], unlocks:['ability:mind_control'] },
        { id:'esp_15', name:'Panopticon Arrays', cost:1800, prereqs:['esp_4'], unlocks:['building:panopticon'] },
        // Tier 6
        { id:'esp_16', name:'Predictive Policing AI', cost:2200, prereqs:['esp_15','sci_9a'], unlocks:[{global:{spyPower:0.30}}] },
        { id:'esp_17', name:'Galactic Shadow Network', cost:2400, prereqs:['esp_13'], unlocks:['ability:shadow_network'] },
        // Capstone
        { id:'esp_18', name:'Absolute Surveillance', cost:4000, prereqs:['esp_16','esp_17'], unlocks:['ability:total_surveillance'] },
        { id:'esp_19', name:'Quantum Encryption', cost:1500, prereqs:['esp_12','sci_6'], unlocks:['ability:quantum_encrypt'] },
        { id:'esp_20', name:'Trap Operations', cost:1100, prereqs:['esp_10'], unlocks:['ability:trap'] },
        { id:'esp_21', name:'Sympathizer Cells', cost:1300, prereqs:['esp_7'], unlocks:['ability:sympathizer_cell'] },
        { id:'esp_22', name:'Dead Drops', cost:1500, prereqs:['esp_12'], unlocks:['ability:dead_drop'] },
        { id:'esp_23', name:'Deep Cover', cost:1800, prereqs:['esp_13'], unlocks:['ability:deep_cover'] },
        { id:'esp_24', name:'Blackmail Vaults', cost:2000, prereqs:['esp_11'], unlocks:['ability:blackmail'] },
        { id:'esp_25', name:'Orwellian Networks', cost:5000, prereqs:['esp_18'], unlocks:['building:orwellian_net'] },
      ].map((t, i) => Object.assign({ path:'espionage', tier: Math.ceil((i + 1) / 3) }, t));

      return [...eng, ...weap, ...def, ...sci, ...dip, ...bio, ...econ, ...esp];
    },
  };

  // ===========================================================================
  // RESEARCH MANAGER
  // ===========================================================================
  /**
   * ResearchManager turns the TechTree catalog into a live, ticking research
   * system. The player has a queue, a per-turn RP yield, and may receive
   * "discovery events" from anomaly exploration, captured scientists, etc.
   */
  class ResearchManager {
    constructor(game) {
      this.game = game;
      this.queue = [];            // ordered list of tech ids
      this.researched = new Set();
      this.active = null;         // current tech id
      this.progress = 0;          // accumulated RP for active tech
      this.rpPerTurn = 0;         // current yield (recomputed each turn)
      this.eventLog = [];
      this.events = TechEventHooks;
      TechTree.build();
    }

    /** Recompute research yield from buildings + population + espionage. */
    recomputeYield() {
      let rp = 0;
      // Labs and observatories across all owned systems.
      for (const sys of Object.values(this.game.systems)) {
        if (sys.owner !== this.game.playerId) continue;
        const buildings = sys.buildings || {};
        rp += (buildings.lab || 0) * 5;
        rp += (buildings.particle_accel || 0) * 12;
        rp += (buildings.ai_core || 0) * 20;
        rp += (buildings.dark_matter_lab || 0) * 18;
        rp += (buildings.multiverse_observatory || 0) * 35;
        rp += Math.floor((sys.population || 0) / 1e6); // 1 RP per 1M pop
      }
      // Tech bonuses.
      rp = this._applyGlobalBonuses(rp);
      // Espionage: stolen RP per turn based on active spies.
      rp += (this.game.spiesDeployed || 0) * 4;
      this.rpPerTurn = Math.round(rp);
      return this.rpPerTurn;
    }

    _applyGlobalBonuses(rp) {
      const mults = [];
      for (const techId of this.researched) {
        const tech = TechTree.get(techId);
        if (!tech) continue;
        for (const u of (tech.unlocks || [])) {
          if (u.global && typeof u.global.researchSpeed === 'number') {
            mults.push(1 + u.global.researchSpeed);
          }
        }
      }
      let out = rp;
      for (const m of mults) out *= m;
      return out;
    }

    /** Queue a tech for research. Validates prereqs and uniqueness. */
    enqueue(techId) {
      if (this.researched.has(techId)) return { ok: false, reason: 'already_researched' };
      if (this.queue.includes(techId)) return { ok: false, reason: 'already_queued' };
      if (!TechTree.canResearch(techId, this.researched)) {
        return { ok: false, reason: 'prereq_missing' };
      }
      this.queue.push(techId);
      if (!this.active) this._advance();
      return { ok: true };
    }

    /** Cancel a queued tech (refund 30% of cost). */
    cancel(techId) {
      const idx = this.queue.indexOf(techId);
      if (idx < 0) return false;
      this.queue.splice(idx, 1);
      if (this.active === techId) {
        this.active = null; this.progress = 0;
        this._advance();
      }
      return true;
    }

    /** Advance to next queued tech. */
    _advance() {
      while (this.queue.length && this.researched.has(this.queue[0])) {
        this.queue.shift();
      }
      this.active = this.queue[0] || null;
      this.progress = 0;
    }

    /** Tick research once per turn. Returns array of completed tech ids. */
    tick() {
      this.recomputeYield();
      const done = [];
      if (!this.active) this._advance();
      if (!this.active) return done;
      this.progress += this.rpPerTurn;
      const tech = TechTree.get(this.active);
      if (tech && this.progress >= tech.cost) {
        this.researched.add(this.active);
        done.push(this.active);
        this.queue.shift();
        this.active = null; this.progress = 0;
        this._advance();
        this.eventLog.push(`Research complete: ${tech.name}.`);
      }
      return done;
    }

    /** Discover a tech for free (anomaly reward, captured scientist, etc.). */
    grantFreeTech(techId) {
      if (this.researched.has(techId)) return false;
      // Even without prereqs, a free grant is allowed (story event).
      this.researched.add(techId);
      this.eventLog.push(`Bonus technology unlocked: ${TechTree.get(techId)?.name || techId}.`);
      return true;
    }

    /** Compute aggregate ship bonuses from researched techs. */
    shipBonuses() {
      const out = {};
      for (const techId of this.researched) {
        const t = TechTree.get(techId);
        if (!t) continue;
        for (const u of (t.unlocks || [])) {
          if (u.ship_mod) {
            const id = u.ship_mod.ship;
            const stat = u.ship_mod.stat;
            const amt = u.ship_mod.amount;
            if (id === '*') {
              for (const sid of ShipClasses.ids()) {
                out[sid] = out[sid] || {};
                out[sid][stat] = (out[sid][stat] || 0) + amt;
              }
            } else {
              out[id] = out[id] || {};
              out[id][stat] = (out[id][stat] || 0) + amt;
            }
          }
        }
      }
      return out;
    }

    /** Return list of unlocked abilities. */
    abilities() {
      const set = new Set();
      for (const id of this.researched) {
        const t = TechTree.get(id);
        for (const u of (t.unlocks || [])) {
          if (typeof u === 'string' && u.startsWith('ability:')) set.add(u.slice(8));
        }
      }
      return set;
    }

    /** Return list of unlocked buildings. */
    buildings() {
      const set = new Set();
      for (const id of this.researched) {
        const t = TechTree.get(id);
        for (const u of (t.unlocks || [])) {
          if (typeof u === 'string' && u.startsWith('building:')) set.add(u.slice(9));
        }
      }
      return set;
    }

    /** Return list of unlocked ship hulls. */
    ships() {
      const set = new Set();
      for (const id of this.researched) {
        const t = TechTree.get(id);
        for (const u of (t.unlocks || [])) {
          if (typeof u === 'string' && u.startsWith('ship:')) set.add(u.slice(5));
        }
      }
      return set;
    }

    /** Playstyle-aware tech recommendations. */
    recommend(playstyleBias = 'balanced', n = 3) {
      // Compute "affinity" for each path based on bias + recent events.
      const weights = {
        engineering: 1, weapons: 1, defense: 1, science: 1,
        diplomacy: 1, biology: 1, economy: 1, espionage: 1,
      };
      if (playstyleBias === 'warlike') { weights.weapons += 1.5; weights.defense += 1; weights.espionage += 0.5; weights.diplomacy -= 0.5; }
      if (playstyleBias === 'peaceful') { weights.diplomacy += 1.5; weights.economy += 1; weights.biology += 1; weights.weapons -= 0.5; }
      if (playstyleBias === 'science') { weights.science += 2; weights.biology += 0.5; weights.engineering += 0.5; }
      if (playstyleBias === 'economic') { weights.economy += 2; weights.diplomacy += 0.5; }
      // Score every tech.
      const candidates = TechTree.techs.filter(t => !this.researched.has(t.id) && TechTree.canResearch(t.id, this.researched));
      candidates.sort((a, b) => (weights[b.path] - weights[a.path]) || (a.cost - b.cost));
      return candidates.slice(0, n);
    }
  }

  // ===========================================================================
  // TECH DISCOVERY EVENTS
  // ===========================================================================
  /**
   * Hooks for triggering bonus tech discoveries from gameplay events.
   * Each hook returns either null or a tech id to grant for free.
   */
  const TechEventHooks = {
    /** Triggered when player explores a science anomaly. */
    onAnomaly(anomalyType, rng = Math.random) {
      const table = {
        'precursor_ruins':  ['sci_2','sci_10','sci_13'],
        'alien_artifact':   ['sci_4','sci_6','sci_11'],
        'living_planet':    ['bio_5','bio_7','bio_15'],
        'dark_matter_cloud':['sci_12','weap_16'],
        'quantum_vent':     ['sci_6','weap_22'],
        'fossil_cache':     ['bio_2','sci_22'],
        'warp_anomaly':     ['eng_10','eng_14','eng_17'],
      };
      const pool = table[anomalyType] || [];
      return pool.length ? Utils.pick(pool, rng) : null;
    },

    /** Triggered when player captures an enemy scientist. */
    onCaptureScientist(specialty, rng = Math.random) {
      const table = {
        weapons:  ['weap_3','weap_7a','weap_14','weap_18'],
        defense:  ['def_2','def_7a','def_15','def_19'],
        science:  ['sci_3','sci_11','sci_14','sci_18'],
        biology:  ['bio_5','bio_9a','bio_14','bio_18'],
        espionage:['esp_5','esp_8','esp_13','esp_18'],
        engineering:['eng_4','eng_10','eng_16','eng_20'],
      };
      const pool = table[specialty] || [];
      return pool.length ? Utils.pick(pool, rng) : null;
    },

    /** Triggered when a warlike player wins a major battle. */
    onMajorBattleVictory(rng = Math.random) {
      return Utils.pick(['weap_9','weap_15','def_11','def_17','eng_14'], rng);
    },
  };

  // ===========================================================================
  // MODULE EXPORT
  // ===========================================================================
  global.EclipseProtocol = {
    Utils,
    ShipClasses,
    CombatEngine,
    FleetManager,
    WarManager,
    TechTree,
    ResearchManager,
    TechEventHooks,
  };
})(typeof window !== 'undefined' ? window : globalThis);
