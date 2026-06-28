/* =====================================================================
 * ECLIPSE PROTOCOL — Diplomacy, Economy & Narrative Engines
 * ---------------------------------------------------------------------
 * Three coupled subsystems for a 4X space empire builder:
 *   • DiplomacyEngine  — AI factions, relations, war/peace/alliance
 *   • EconomyEngine    — Resource production, trade, inflation, stability
 *   • NarrativeEngine  — Consequence-driven events and player choices
 *
 * Vanilla JavaScript, no dependencies. Designed to be embedded in a
 * single <script> tag inside an HTML file. Exposes a global namespace
 * `EclipseProtocol` so the host page can construct and drive it.
 * ===================================================================== */

(function (global) {
  'use strict';

  // ---------------------------------------------------------------------
  // Utility helpers (RNG + clamp)
  // ---------------------------------------------------------------------
  const RNG = {
    // Deterministic-friendly RNG. Pass a seed to make replays reproducible.
    seed: 1,
    next() {
      // Mulberry32 — small, fast, decent distribution for game use.
      let t = (this.seed += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(min, max) {
      return Math.floor(this.next() * (max - min + 1)) + min;
    },
    pick(arr) {
      return arr[Math.floor(this.next() * arr.length)];
    },
    weightedPick(items, weightFn) {
      // `items` is an array, `weightFn` returns a non-negative number.
      let total = 0;
      for (const it of items) total += Math.max(0, weightFn(it));
      if (total <= 0) return items[Math.floor(this.next() * items.length)];
      let r = this.next() * total;
      for (const it of items) {
        const w = Math.max(0, weightFn(it));
        if ((r -= w) <= 0) return it;
      }
      return items[items.length - 1];
    },
    chance(p) {
      return this.next() < p;
    },
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---------------------------------------------------------------------
  // Shared game state. The host page can hydrate this with map data;
  // engines only read what they need.
  // ---------------------------------------------------------------------
  class GameState {
    constructor() {
      this.turn = 1;
      this.playerFactionId = 'player';
      this.factions = {};       // id -> FactionData
      this.systems = {};        // id -> SystemData (owned by a faction)
      this.connections = [];    // [{from, to}] — adjacency / trade lanes
      this.techs = {};          // id -> { owned: Set<factionId> }
      this.eventLog = [];       // [{turn, title, body, choices, picked}]
      this.playerStats = {
        reputation: 0,          // -100 .. +100 galaxy-wide
        warsFought: 0,
        alliancesMade: 0,
        treatiesSigned: 0,
        achievements: [],
      };
    }
  }

  // =====================================================================
  // DIPLOMACY ENGINE
  // =====================================================================
  /*
   * Faction personalities are arrays of weighted trait scores (0..1). The
   * engine uses these to bias decisions. Compatibility between two
   * personalities determines first-contact relations.
   */
  const PERSONALITY_PRESETS = {
    militaristic:   { aggression: 0.9, expansion: 0.8, diplomacy: 0.2, trade: 0.3, tech: 0.4, isolation: 0.1, xenophobia: 0.4, honor: 0.6 },
    diplomatic:     { aggression: 0.2, expansion: 0.4, diplomacy: 0.9, trade: 0.8, tech: 0.5, isolation: 0.1, xenophobia: 0.1, honor: 0.9 },
    isolationist:   { aggression: 0.3, expansion: 0.2, diplomacy: 0.4, trade: 0.4, tech: 0.5, isolation: 0.95, xenophobia: 0.5, honor: 0.7 },
    economic:       { aggression: 0.3, expansion: 0.5, diplomacy: 0.6, trade: 0.95, tech: 0.5, isolation: 0.2, xenophobia: 0.2, honor: 0.8 },
    technological:  { aggression: 0.3, expansion: 0.5, diplomacy: 0.5, trade: 0.5, tech: 0.95, isolation: 0.3, xenophobia: 0.2, honor: 0.7 },
    xenophobic:     { aggression: 0.7, expansion: 0.6, diplomacy: 0.15, trade: 0.2, tech: 0.5, isolation: 0.6, xenophobia: 0.95, honor: 0.5 },
    pirate:         { aggression: 0.8, expansion: 0.4, diplomacy: 0.2, trade: 0.5, tech: 0.3, isolation: 0.4, xenophobia: 0.0, honor: 0.1 },
  };

  const FACTION_DEFS = [
    { id: 'terran',     name: 'Terran Confederacy',      color: '#4aa3ff', personality: 'diplomatic',    capital: 'Sol' },
    { id: 'velothi',    name: 'Velothi Imperium',        color: '#ff5e5e', personality: 'militaristic', capital: 'Veloth' },
    { id: 'kessari',    name: 'Kessari Syndicate',       color: '#ffd24a', personality: 'economic',      capital: 'Kessar' },
    { id: 'myrmidon',   name: 'Myrmidon Collective',     color: '#a070ff', personality: 'technological', capital: 'Myrma' },
    { id: 'auriga',     name: 'Aurigan Enclave',         color: '#5be7a9', personality: 'isolationist',  capital: 'Auriga' },
    { id: 'drakari',    name: 'Drakari Dominion',        color: '#ff8a3d', personality: 'xenophobic',    capital: 'Drakara' },
    { id: 'corsairs',   name: 'The Corsair Pact',        color: '#888888', personality: 'pirate',        capital: 'Reaver\'s Rest' },
  ];

  class Faction {
    constructor(def) {
      this.id = def.id;
      this.name = def.name;
      this.color = def.color;
      this.personality = { ...PERSONALITY_PRESETS[def.personality] };
      this.personalityType = def.personality;
      this.capital = def.capital;
      this.isPlayer = def.id === 'player';

      // Resources the faction currently holds
      this.resources = { minerals: 100, energy: 100, food: 100, tech: 50, credits: 200 };

      // Diplomatic state
      this.relations = {};        // otherId -> int -100..100
      this.treaties = new Set();  // ids of other factions we have a treaty with
      this.alliances = new Set(); // ids of other factions we are allied with
      this.atWarWith = new Set(); // ids we are currently at war with
      this.tradePartners = new Set(); // ids we have active trade with
      this.betrayals = new Set(); // ids of factions we have betrayed (memory)
      this.betrayedBy = new Set();// ids of factions that betrayed us

      // Long-form memory of actions by other factions
      // shape: { otherId: [{turn, kind, delta, note}] }
      this.memory = {};

      // Strategic posture derived from current state
      this.stability = 80;        // 0..100; below 20 = civil war event
      this.militaryStrength = 50; // aggregate
      this.economyStrength = 50;
      this.knownSystems = new Set();
    }

    // ---- relation helpers --------------------------------------------
    getRelation(otherId) {
      return this.relations[otherId] ?? 0;
    }

    setRelation(otherId, value) {
      this.relations[otherId] = clamp(Math.round(value), -100, 100);
    }

    shiftRelation(otherId, delta, reason = '') {
      const before = this.getRelation(otherId);
      this.setRelation(otherId, before + delta);
      this.remember(otherId, 'relation', delta, reason);
      // Reciprocal update so both sides agree on the matrix.
      const back = this._reciprocal(otherId);
      if (back) {
        back.relations[this.id] = this.relations[otherId];
      }
      return this.relations[otherId];
    }

    _reciprocal(otherId) {
      // Resolved by the DiplomacyEngine via a back-reference; placeholder.
      return null;
    }

    remember(otherId, kind, delta, note) {
      if (!this.memory[otherId]) this.memory[otherId] = [];
      this.memory[otherId].push({
        turn: GameState_turnRef,
        kind,
        delta,
        note,
      });
      // cap memory
      if (this.memory[otherId].length > 50) {
        this.memory[otherId] = this.memory[otherId].slice(-50);
      }
    }

    // ---- diplomatic predicates ---------------------------------------
    isAlliedWith(otherId)   { return this.alliances.has(otherId); }
    hasTreatyWith(otherId)   { return this.treaties.has(otherId); }
    isAtWarWith(otherId)     { return this.atWarWith.has(otherId); }
    hasTradeWith(otherId)    { return this.tradePartners.has(otherId); }
  }

  // Module-level turn ref so Faction.remember can stamp events without a
  // hard dependency on the engine. Engine updates it each tick.
  let GameState_turnRef = 0;

  class DiplomacyEngine {
    constructor(state) {
      this.state = state;
      this.factions = {};
      this.pendingEvents = [];   // diplomatic actions to surface this turn

      // Build factions from the catalog. Player slot uses diplomatic
      // personality by default — host page can tweak.
      FACTION_DEFS.forEach(def => this._spawnFaction(def));
      this.state.factions = this.factions;
    }

    _spawnFaction(def) {
      const f = new Faction(def);
      // Wire reciprocal reference so relation updates mirror both ways.
      f._reciprocal = (otherId) => this.factions[otherId] || null;
      this.factions[def.id] = f;
    }

    // Register the player faction (call from host page).
    registerPlayer(playerDef = {}) {
      const def = {
        id: 'player',
        name: playerDef.name || 'Player Empire',
        color: playerDef.color || '#ffffff',
        personality: playerDef.personality || 'diplomatic',
        capital: playerDef.capital || 'Homeworld',
      };
      this._spawnFaction(def);
      // Initialize relations: neutral 0 with everyone
      for (const otherId of Object.keys(this.factions)) {
        if (otherId === 'player') continue;
        this.factions.player.relations[otherId] = 0;
        this.factions[otherId].relations['player'] = 0;
      }
      this.state.playerFactionId = 'player';
    }

    // ---- First contact -------------------------------------------------
    /*
     * When two factions encounter each other for the first time, seed
     * their mutual relations based on personality compatibility.
     * `sharedBorder` adds a small tension bump.
     */
    firstContact(aId, bId, { sharedBorder = false } = {}) {
      const a = this.factions[aId];
      const b = this.factions[bId];
      if (!a || !b) return;

      const compat = this._personalityCompat(a, b);
      const xen = (a.personality.xenophobia + b.personality.xenophobia) / 2;
      const base = (compat * 60) - (xen * 50);
      const noise = (RNG.next() - 0.5) * 20;
      let value = clamp(base + noise + (sharedBorder ? -10 : 0), -100, 100);

      a.relations[bId] = Math.round(value);
      b.relations[aId] = Math.round(value);

      this.pendingEvents.push({
        kind: 'firstContact',
        a: aId, b: bId,
        sharedBorder,
      });
    }

    _personalityCompat(a, b) {
      // 0..1 — high when both are diplomatic/economic/tech, low when one
      // is aggressive or xenophobic.
      const pa = a.personality, pb = b.personality;
      const positive = ['diplomacy', 'trade'];
      const negative = ['aggression', 'xenophobia'];
      let s = 0.5;
      for (const k of positive) s += (pa[k] + pb[k]) * 0.25;
      for (const k of negative) s -= (pa[k] + pb[k]) * 0.25;
      return clamp(s, 0, 1);
    }

    // ---- Relation modifiers ------------------------------------------
    /*
     * Apply situational modifiers (shared border, trade, military
     * actions, tech sharing). These are evaluated each turn.
     */
    applySituationalModifiers() {
      const ids = Object.keys(this.factions);
      for (const aId of ids) {
        const a = this.factions[aId];
        for (const bId of ids) {
          if (aId === bId) continue;
          const b = this.factions[bId];
          const current = a.relations[bId] ?? 0;

          // Build a *target* relation from current treaty/war status and
          // blend the live relation toward it. This prevents runaway drift
          // and keeps relations stable unless something actively changes.
          let target = 0;
          if (a.atWarWith.has(bId)) target = -60;
          if (a.alliances.has(bId)) target = 70;
          else if (a.treaties.has(bId)) target = 40;
          else if (a.tradePartners.has(bId)) target = 25;
          if (this._sharesBorder(aId, bId) && target > 0) target -= 5;
          if (b.betrayals.has(aId)) target = Math.min(target, -40);
          if (a.betrayals.has(bId)) target = Math.min(target, -50);
          if (a.atWarWith.has(bId)) target = Math.min(target, -60);

          // Blend 12% of the way toward target each turn (smoothing)
          const blended = current + (target - current) * 0.12;

          // Mild baseline drift toward 0 only when truly neutral
          let drifted = blended;
          if (!a.atWarWith.has(bId) && !a.alliances.has(bId) &&
              !a.treaties.has(bId) && !a.tradePartners.has(bId)) {
            drifted += -Math.sign(current) * Math.min(1.5, Math.abs(current) * 0.04);
          }

          a.relations[bId] = clamp(Math.round(drifted), -100, 100);
          b.relations[aId] = a.relations[bId];
        }
      }
    }

    _sharesBorder(aId, bId) {
      const a = new Set();
      for (const s of Object.values(this.state.systems)) {
        if (s.ownerId === aId) a.add(s.id);
      }
      for (const conn of this.state.connections) {
        if (a.has(conn.from) || a.has(conn.to)) {
          const otherSys = a.has(conn.from) ? this.state.systems[conn.to] : this.state.systems[conn.from];
          if (otherSys && otherSys.ownerId === bId) return true;
        }
      }
      return false;
    }

    // ---- Direct diplomatic actions -----------------------------------
    declareWar(attackerId, defenderId, reason = 'war') {
      const a = this.factions[attackerId];
      const d = this.factions[defenderId];
      if (!a || !d) return false;
      if (a.atWarWith.has(defenderId)) return false;

      // Honor-bound factions keep treaties; dishonorable ones break them.
      const breaksTreaty = a.treaties.has(defenderId);
      a.atWarWith.add(defenderId);
      d.atWarWith.add(attackerId);

      if (breaksTreaty) {
        this._recordBetrayal(attackerId, defenderId, 'treaty');
      }

      a.shiftRelation(defenderId, -30, `Declared war (${reason})`);
      d.shiftRelation(attackerId, -40, `Was attacked (${reason})`);

      // Third-party reactions: allies of defender get upset with attacker.
      for (const otherId of Object.keys(this.factions)) {
        if (otherId === attackerId || otherId === defenderId) continue;
        const o = this.factions[otherId];
        if (o.alliances.has(defenderId)) {
          o.shiftRelation(attackerId, -15, `Attacked our ally ${defenderId}`);
        }
        if (o.treaties.has(defenderId)) {
          o.shiftRelation(attackerId, -8, `Attacked our treaty partner ${defenderId}`);
        }
      }

      if (attackerId === this.state.playerFactionId) {
        this.state.playerStats.warsFought++;
      }

      this.pendingEvents.push({
        kind: 'war', attacker: attackerId, defender: defenderId, reason,
      });
      return true;
    }

    signTreaty(aId, bId) {
      const a = this.factions[aId];
      const b = this.factions[bId];
      if (!a || !b) return false;
      if (a.atWarWith.has(bId)) return false;
      a.treaties.add(bId); b.treaties.add(aId);
      a.shiftRelation(bId, +8, 'Treaty signed');
      if (aId === this.state.playerFactionId || bId === this.state.playerFactionId) {
        this.state.playerStats.treatiesSigned++;
      }
      this.pendingEvents.push({ kind: 'treaty', a: aId, b: bId });
      return true;
    }

    formAlliance(aId, bId) {
      const a = this.factions[aId];
      const b = this.factions[bId];
      if (!a || !b) return false;
      if (a.atWarWith.has(bId)) return false;
      a.alliances.add(bId); b.alliances.add(aId);
      a.shiftRelation(bId, +15, 'Alliance formed');
      if (aId === this.state.playerFactionId || bId === this.state.playerFactionId) {
        this.state.playerStats.alliancesMade++;
      }
      this.pendingEvents.push({ kind: 'alliance', a: aId, b: bId });
      return true;
    }

    breakTreaty(breakerId, targetId, reason = 'treaty broken') {
      this._recordBetrayal(breakerId, targetId, 'treaty');
      const a = this.factions[breakerId];
      const b = this.factions[targetId];
      if (a) {
        a.treaties.delete(targetId);
        a.alliances.delete(targetId);
        a.shiftRelation(targetId, -10, reason); // guilty conscience
      }
      if (b) {
        b.treaties.delete(breakerId);
        b.alliances.delete(breakerId);
        b.shiftRelation(breakerId, -40, `They broke a treaty with us`);
      }
      this.pendingEvents.push({ kind: 'betrayal', breaker: breakerId, target: targetId, reason });
      return true;
    }

    _recordBetrayal(breakerId, targetId, kind) {
      const breaker = this.factions[breakerId];
      const target = this.factions[targetId];
      if (!breaker) return;
      breaker.betrayals.add(targetId);
      if (target) target.betrayedBy.add(breakerId);

      // Galaxy-wide reputation hit
      for (const id of Object.keys(this.factions)) {
        if (id === breakerId) continue;
        const f = this.factions[id];
        // Honor-bound factions react stronger; pirates shrug.
        const honorBias = (f.personality.honor - breaker.personality.honor + 1) / 2;
        const penalty = Math.round(-20 * (0.4 + honorBias));
        f.shiftRelation(breakerId, penalty, `Betrayal by ${breakerId}`);
        if (f.treaties.has(breakerId)) {
          // Allies/treaty partners drop us cold.
          f.treaties.delete(breakerId);
          f.alliances.delete(breakerId);
        }
      }
      if (breakerId === this.state.playerFactionId) {
        this.state.playerStats.reputation -= 15;
      }
    }

    establishTrade(aId, bId) {
      const a = this.factions[aId];
      const b = this.factions[bId];
      if (!a || !b) return false;
      if (a.atWarWith.has(bId)) return false;
      a.tradePartners.add(bId);
      b.tradePartners.add(aId);
      a.shiftRelation(bId, +3, 'Trade opened');
      this.pendingEvents.push({ kind: 'trade', a: aId, b: bId });
      return true;
    }

    // ---- AI decision turn --------------------------------------------
    /*
     * Drive every non-player faction for one turn. Each faction
     * evaluates its situation against its personality and emits actions.
     */
    aiTurn() {
      const ids = Object.keys(this.factions).filter(id => id !== this.state.playerFactionId);
      for (const id of ids) {
        const f = this.factions[id];
        this._aiExpand(f);
        this._aiResearch(f);
        this._aiTrade(f);
        this._aiWarOrPeace(f);
        this._aiAlliance(f);
      }
      this.applySituationalModifiers();
    }

    _aiExpand(f) {
      // Expansionist factions prioritize; isolationists skip.
      const will = f.personality.expansion * (1 - f.personality.isolation * 0.7);
      if (!RNG.chance(will)) return;
      const candidate = this._findColonizable(f);
      if (!candidate) return;
      candidate.ownerId = f.id;
      f.knownSystems.add(candidate.id);
      this.pendingEvents.push({ kind: 'colonize', faction: f.id, system: candidate.id });
    }

    _findColonizable(f) {
      for (const sys of Object.values(this.state.systems)) {
        if (!sys.ownerId) {
          // Prefer adjacent to known territory.
          const adjacent = this.state.connections.some(c =>
            (c.from === sys.id && f.knownSystems.has(c.to)) ||
            (c.to === sys.id && f.knownSystems.has(c.from))
          );
          if (adjacent || RNG.chance(0.3)) {
            f.knownSystems.add(sys.id);
            return sys;
          }
        }
      }
      return null;
    }

    _aiResearch(f) {
      // Pick a tech weighted by personality.
      const techCatalog = this.state.techs;
      const candidates = Object.entries(techCatalog);
      if (!candidates.length) return;
      const choice = RNG.weightedPick(candidates, ([, t]) => {
        let w = 1;
        if (t.field === 'military') w *= 1 + f.personality.aggression * 2;
        if (t.field === 'economy')  w *= 1 + f.personality.trade * 2;
        if (t.field === 'science')  w *= 1 + f.personality.tech * 2;
        if (t.field === 'expansion')w *= 1 + f.personality.expansion * 2;
        if (t.owned && t.owned.has(f.id)) w *= 0.1;
        return w;
      });
      if (!choice) return;
      const [techId, t] = choice;
      t.owned = t.owned || new Set();
      if (!t.owned.has(f.id) && RNG.chance(0.35 + f.personality.tech * 0.4)) {
        t.owned.add(f.id);
        this.pendingEvents.push({ kind: 'research', faction: f.id, tech: techId });
      }
    }

    _aiTrade(f) {
      if (f.personality.trade < 0.3) return;
      for (const otherId of Object.keys(this.factions)) {
        if (otherId === f.id) continue;
        if (f.atWarWith.has(otherId)) continue;
        const o = this.factions[otherId];
        if (f.tradePartners.has(otherId)) continue;
        const r = f.relations[otherId];
        if (r > 20 && RNG.chance(0.3 * f.personality.trade)) {
          this.establishTrade(f.id, otherId);
        }
      }
    }

    _aiWarOrPeace(f) {
      for (const otherId of Object.keys(this.factions)) {
        if (otherId === f.id) continue;
        const o = this.factions[otherId];
        if (f.atWarWith.has(otherId)) {
          // Offer peace if losing or relations improved.
          if (o.stability < 30 || f.stability < 30 || f.relations[otherId] > 40) {
            if (RNG.chance(0.3)) {
              f.atWarWith.delete(otherId);
              o.atWarWith.delete(f.id);
              this.pendingEvents.push({ kind: 'peace', a: f.id, b: otherId });
            }
          }
          continue;
        }
        // Already allied/treatied: don't randomly attack.
        if (f.alliances.has(otherId) || f.treaties.has(otherId)) continue;
        // War consideration: needs aggressive personality + weakness + opportunity.
        const aggr = f.personality.aggression;
        const weak = o.militaryStrength < f.militaryStrength * 0.8;
        const opp  = o.stability < 50;
        const score = aggr * (weak ? 1.5 : 1.0) * (opp ? 1.2 : 1.0);
        if (RNG.chance(score * 0.25)) {
          this.declareWar(f.id, otherId, 'AI aggression');
        }
      }
    }

    _aiAlliance(f) {
      if (f.personality.diplomacy < 0.5) return;
      // Find a common threat.
      const threats = [...f.atWarWith];
      if (!threats.length) return;
      for (const otherId of Object.keys(this.factions)) {
        if (otherId === f.id) continue;
        if (f.alliances.has(otherId)) continue;
        const o = this.factions[otherId];
        if (o.atWarWith.size === 0) continue;
        const sharedThreat = [...o.atWarWith].some(t => threats.includes(t));
        if (sharedThreat && f.relations[otherId] > 40 && RNG.chance(0.5 * f.personality.diplomacy)) {
          this.formAlliance(f.id, otherId);
        }
      }
    }

    // ---- Player-facing helpers ---------------------------------------
    /*
     * Players may get diplomatic offers from the AI. We queue these so
     * the narrative engine can show them with context.
     */
    flushEvents() {
      const evts = this.pendingEvents;
      this.pendingEvents = [];
      return evts;
    }

    getFaction(id) { return this.factions[id] || null; }
    getAllFactions() { return Object.values(this.factions); }
    getRelation(aId, bId) {
      const f = this.factions[aId];
      return f ? f.getRelation(bId) : 0;
    }
  }

  // =====================================================================
  // ECONOMY ENGINE
  // =====================================================================
  /*
   * Resources: minerals, energy, food, tech, credits.
   *
   * Each controlled system produces a base amount per turn scaled by
   * population and buildings. Supply chains route outputs through
   * connections; blockades sever a link and downstream systems suffer.
   *
   * Inflation: any faction controlling >60% of a resource's total
   * galactic supply drives up its price for everyone, including the
   * controlling faction (it pays inflated input costs on its own
   * expansion projects — modeled as a flat maintenance penalty).
   */
  const SYSTEM_TYPES = {
    habitable:    { production: { food: 4, minerals: 1 }, consumption: { food: 1 } },
    gas_giant:    { production: { energy: 5 }, consumption: {} },
    asteroid:     { production: { minerals: 6 }, consumption: {} },
    desert:       { production: { minerals: 2, energy: 2 }, consumption: { food: 1 } },
    ocean:        { production: { food: 6, energy: 1 }, consumption: { food: 2 } },
    ice:          { production: { energy: 3, food: 1 }, consumption: { food: 1 } },
    barren:       { production: { minerals: 1 }, consumption: {} },
  };

  const BUILDING_COSTS = {
    mine:      { cost: { minerals: 30, energy: 10 }, upkeep: { energy: 1 }, output: { minerals: 4 } },
    farm:      { cost: { minerals: 20, energy: 10 }, upkeep: { energy: 1 }, output: { food: 5 } },
    refinery:  { cost: { minerals: 40, energy: 20 }, upkeep: { energy: 2 }, output: { energy: 5 } },
    lab:       { cost: { minerals: 50, energy: 30 }, upkeep: { energy: 2 }, output: { tech: 3 } },
    trade_hub: { cost: { minerals: 25, energy: 15 }, upkeep: { energy: 1 }, output: { credits: 6 } },
  };

  class EconomyEngine {
    constructor(state) {
      this.state = state;
      this.blockades = new Set(); // edge keys "from|to" that are blockaded
      this.tradeRoutes = [];      // [{aId, bId, resource, amount}]
      this.globalPrices = { minerals: 1, energy: 1, food: 1, tech: 1 };
      this.lastReport = null;
    }

    // ---- System helpers ----------------------------------------------
    registerSystem(sys) {
      // sys: { id, type, ownerId, population, buildings }
      const tmpl = SYSTEM_TYPES[sys.type] || SYSTEM_TYPES.barren;
      this.state.systems[sys.id] = {
        ...sys,
        buildings: sys.buildings || [],
        population: sys.population ?? 5,
        stability: sys.stability ?? 70,
        _blocked: false,
      };
    }

    build(systemId, factionId, buildingType) {
      const sys = this.state.systems[systemId];
      const fac = this.state.factions[factionId];
      const def = BUILDING_COSTS[buildingType];
      if (!sys || !fac || !def) return false;
      if (sys.ownerId !== factionId) return false;
      if (sys.buildings.includes(buildingType)) return false;
      // Pay costs
      for (const [res, amt] of Object.entries(def.cost)) {
        if ((fac.resources[res] || 0) < amt) return false;
        fac.resources[res] -= amt;
      }
      sys.buildings.push(buildingType);
      return true;
    }

    blockadeEdge(fromId, toId) {
      const key = this._edgeKey(fromId, toId);
      this.blockades.add(key);
    }
    liftBlockade(fromId, toId) {
      const key = this._edgeKey(fromId, toId);
      this.blockades.delete(key);
    }
    isEdgeBlockaded(fromId, toId) {
      return this.blockades.has(this._edgeKey(fromId, toId));
    }
    _edgeKey(a, b) {
      return a < b ? `${a}|${b}` : `${b}|${a}`;
    }

    establishTradeRoute(aFaction, bFaction, resource, amountPerTurn = 2) {
      this.tradeRoutes.push({ aId: aFaction, bId: bFaction, resource, amount: amountPerTurn });
    }

    // ---- Per-turn economic tick --------------------------------------
    /*
     * Steps:
     *   1. Each system produces + consumes based on type/pop/buildings
     *   2. Trade routes move goods between connected factions
     *   3. Update global prices based on supply concentration
     *   4. Update stability based on food surplus/deficit
     *   5. Apply upkeep costs; bankrupt factions lose buildings
     */
    tick() {
      const report = { production: {}, consumption: {}, deficit: [] };
      const supplyTotals = { minerals: 0, energy: 0, food: 0, tech: 0 };
      const factionSupply = {}; // factionId -> { minerals: x, ... }

      // Reset system flags
      for (const sys of Object.values(this.state.systems)) {
        sys._blocked = false;
        for (const conn of this.state.connections) {
          const partner = conn.from === sys.id ? conn.to : conn.to === sys.id ? conn.from : null;
          if (!partner) continue;
          if (this.isEdgeBlockaded(sys.id, partner)) {
            sys._blocked = true;
            break;
          }
        }
      }

      for (const sys of Object.values(this.state.systems)) {
        if (!sys.ownerId) continue;
        const fac = this.state.factions[sys.ownerId];
        if (!fac) continue;
        const tmpl = SYSTEM_TYPES[sys.type] || SYSTEM_TYPES.barren;

        // Production scaled by population and tech tier (placeholder tech tier = 1)
        const popScale = 1 + Math.log2(Math.max(1, sys.population)) * 0.5;
        const prod = { ...tmpl.production };
        // Building outputs
        for (const b of sys.buildings) {
          const def = BUILDING_COSTS[b];
          if (!def) continue;
          for (const [r, v] of Object.entries(def.output)) {
            prod[r] = (prod[r] || 0) + v;
          }
        }
        for (const [r, v] of Object.entries(prod)) {
          prod[r] = Math.round(v * popScale);
        }

        // Consumption
        const cons = { ...tmpl.consumption };
        cons.food = (cons.food || 0) + Math.max(0, sys.population - 5);
        for (const b of sys.buildings) {
          const def = BUILDING_COSTS[b];
          if (!def) continue;
          for (const [r, v] of Object.entries(def.upkeep)) {
            cons[r] = (cons[r] || 0) + v;
          }
        }

        // Apply blockades — if the system can't reach the capital, it
        // gets half output and full upkeep pressure.
        const blockedFactor = sys._blocked ? 0.5 : 1.0;
        const upkeepFactor = sys._blocked ? 1.2 : 1.0;

        // Credits from trade hubs
        let creditsGain = 0;
        if (sys.buildings.includes('trade_hub')) {
          creditsGain = (BUILDING_COSTS.trade_hub.output.credits || 0) * popScale;
        }

        // Add to faction
        for (const [r, v] of Object.entries(prod)) {
          const amount = Math.round(v * blockedFactor);
          fac.resources[r] = (fac.resources[r] || 0) + amount;
          supplyTotals[r] = (supplyTotals[r] || 0) + amount;
          factionSupply[fac.id] = factionSupply[fac.id] || { minerals: 0, energy: 0, food: 0, tech: 0 };
          factionSupply[fac.id][r] = (factionSupply[fac.id][r] || 0) + amount;
        }
        // Consumption — clamp at 0 so UI can surface deficit via stability instead
        for (const [r, v] of Object.entries(cons)) {
          const amount = Math.round(v * upkeepFactor);
          fac.resources[r] = Math.max(0, (fac.resources[r] || 0) - amount);
        }
        fac.resources.credits = (fac.resources.credits || 0) + Math.round(creditsGain);

        // Track deficits for stability
        const foodBal = (prod.food || 0) - (cons.food || 0);
        if (foodBal < 0) report.deficit.push({ systemId: sys.id, factionId: fac.id, deficit: -foodBal });

        // Stability: positive if surplus food, drop if deficit
        const delta = clamp(foodBal * 1.5, -10, 5);
        sys.stability = clamp(sys.stability + delta, 0, 100);

        // Population dynamics
        if (foodBal < 0) {
          sys.population = Math.max(1, sys.population - 1);
        } else if (foodBal > 2 && sys.population < 20) {
          sys.population += 1;
        }
      }

      // ---- Trade route exchange --------------------------------------
      for (const route of this.tradeRoutes) {
        const a = this.state.factions[route.aId];
        const b = this.state.factions[route.bId];
        if (!a || !b) continue;
        if (a.atWarWith.has(route.bId) || b.atWarWith.has(route.aId)) continue;
        const sendable = Math.min(route.amount, a.resources[route.resource] || 0);
        if (sendable <= 0) continue;
        a.resources[route.resource] = Math.max(0, a.resources[route.resource] - sendable);
        b.resources[route.resource] = (b.resources[route.resource] || 0) + sendable;
        // Both sides earn credits for the activity.
        const price = this.globalPrices[route.resource] || 1;
        a.resources.credits = (a.resources.credits || 0) + Math.round(sendable * price * 0.5);
        b.resources.credits = (b.resources.credits || 0) + Math.round(sendable * price * 0.3);
      }

      // ---- Global price (inflation) ----------------------------------
      const totalFactions = Object.keys(this.state.factions).length || 1;
      for (const r of Object.keys(supplyTotals)) {
        const total = supplyTotals[r];
        let maxOwner = null, maxAmount = 0;
        for (const [fid, s] of Object.entries(factionSupply)) {
          if ((s[r] || 0) > maxAmount) { maxAmount = s[r]; maxOwner = fid; }
        }
        const concentration = total > 0 ? maxAmount / total : 0;
        // > 60% concentration inflates the price; scarcity also inflates.
        let price = 1;
        if (concentration > 0.6) price += (concentration - 0.6) * 4;
        if (total < 30) price += (30 - total) / 30;
        this.globalPrices[r] = +price.toFixed(2);
      }

      // ---- Apply inflation upkeep penalty ----------------------------
      for (const fac of Object.values(this.state.factions)) {
        const totalPrices = this.globalPrices.minerals + this.globalPrices.energy + this.globalPrices.food;
        const upkeep = Math.round(totalPrices * 2);
        fac.resources.credits = (fac.resources.credits || 0) - upkeep;
        if (fac.resources.credits < 0) {
          // Bankruptcy: lose newest building in oldest system
          const sys = Object.values(this.state.systems).find(s => s.ownerId === fac.id && s.buildings.length);
          if (sys && sys.buildings.length) {
            sys.buildings.pop();
            fac.resources.credits = 50; // bail-out
          }
        }
      }

      // ---- Faction-wide stability ------------------------------------
      for (const fac of Object.values(this.state.factions)) {
        const ownDefs = report.deficit.filter(d => d.factionId === fac.id).reduce((a, b) => a + b.deficit, 0);
        const agg = clamp(ownDefs * -2, -10, 5);
        fac.stability = clamp(fac.stability + agg, 0, 100);
        // Rebellions: low stability systems flip to independence
        for (const sys of Object.values(this.state.systems)) {
          if (sys.ownerId === fac.id && sys.stability < 15) {
            sys.ownerId = null;
            sys.stability = 50;
          }
        }
      }

      this.lastReport = report;
      return report;
    }
  }

  // =====================================================================
  // NARRATIVE ENGINE
  // =====================================================================
  /*
   * Events are consequence-based. Each event has a `check(state)` predicate;
   * when it returns true and the event is not on cooldown, it fires. Each
   * event defines 2-3 choices, each with consequences applied to the
   * relevant engine via the supplied `apply(choice, engines)` callback.
   */
  const NARRATIVE_EVENTS = [
    {
      id: 'rival_independence',
      title: 'Rival Colony Declares Independence',
      description: 'Your refusal to share FTL technology with {faction} has pushed their colonies to revolt and declare independence.',
      cooldown: 30,
      check(state, ctx) {
        const player = state.factions[state.playerFactionId];
        if (!player) return false;
        // Player owns FTL tech
        const hasFTL = Object.entries(state.techs).some(([id, t]) =>
          /ftl|hyperspace|warp/i.test(id) && t.owned && t.owned.has(state.playerFactionId)
        );
        if (!hasFTL) return false;
        // Any bordering faction with low relations
        for (const f of Object.values(state.factions)) {
          if (f.id === state.playerFactionId) continue;
          if (ctx.diplomacy._sharesBorder(state.playerFactionId, f.id) && player.relations[f.id] < 0) {
            this._faction = f.id;
            return true;
          }
        }
        return false;
      },
      choices: [
        {
          label: 'Military response — retake the colonies',
          apply({ state, diplomacy, narrative }) {
            diplomacy.declareWar(state.playerFactionId, narrative._eventCache.rival_independence._faction, 'independence crackdown');
          },
        },
        {
          label: 'Grant autonomy and negotiate',
          apply({ state, diplomacy }) {
            const fid = narrative._eventCache.rival_independence._faction;
            diplomacy.factions[fid].shiftRelation(state.playerFactionId, +20, 'Granted autonomy');
          },
        },
        {
          label: 'Share FTL tech after all',
          apply({ state }) {
            Object.values(state.techs).forEach(t => {
              if (/ftl|hyperspace|warp/i.test(t.id || '')) {
                t.owned = t.owned || new Set();
                t.owned.add(state.playerFactionId);
              }
            });
            const fid = narrative._eventCache.rival_independence._faction;
            state.factions[fid].shiftRelation(state.playerFactionId, +35, 'Tech shared');
          },
        },
      ],
    },

    {
      id: 'pirate_fleet',
      title: 'Pirate Fleet Spotted',
      description: 'A corsair fleet has been detected prowling your trade lanes near {system}. Your patrol coverage in this sector is dangerously thin.',
      cooldown: 20,
      check(state, ctx) {
        // Player has at least one trade route
        const hasTrade = ctx.economy.tradeRoutes.some(r => r.aId === state.playerFactionId || r.bId === state.playerFactionId);
        if (!hasTrade) return false;
        // Find a player system adjacent to a trade lane with no military buildings
        for (const sys of Object.values(state.systems)) {
          if (sys.ownerId !== state.playerFactionId) continue;
          if (sys.buildings.some(b => /fortress|barracks|garrison/i.test(b))) continue;
          if (state.connections.some(c => (c.from === sys.id || c.to === sys.id))) {
            this._system = sys.id;
            return true;
          }
        }
        return false;
      },
      choices: [
        {
          label: 'Deploy a patrol fleet',
          apply({ state, economy }) {
            const sys = state.systems[narrative._eventCache.pirate_fleet._system];
            sys.buildings.push('garrison');
            state.factions[state.playerFactionId].resources.credits -= 50;
          },
        },
        {
          label: 'Pay the corsairs to leave',
          apply({ state }) {
            state.factions[state.playerFactionId].resources.credits -= 150;
            state.playerStats.reputation -= 5;
          },
        },
        {
          label: 'Hire mercenaries',
          apply({ state }) {
            state.factions[state.playerFactionId].resources.credits -= 80;
            state.factions[state.playerFactionId].resources.energy -= 20;
          },
        },
      ],
    },

    {
      id: 'ancient_artifact',
      title: 'Ancient Alien Artifact Discovered',
      description: 'Survey teams in {system} have unearthed a Precursor artifact of unknown purpose.',
      cooldown: 50,
      check(state) {
        // Player system with anomalies flagged
        for (const sys of Object.values(state.systems)) {
          if (sys.ownerId === state.playerFactionId && sys.hasAnomaly) {
            this._system = sys.id;
            return true;
          }
        }
        return false;
      },
      choices: [
        {
          label: 'Study it carefully',
          apply({ state }) {
            state.factions[state.playerFactionId].resources.tech += 25;
          },
        },
        {
          label: 'Sell it to the highest bidder',
          apply({ state }) {
            state.factions[state.playerFactionId].resources.credits += 200;
            state.playerStats.reputation -= 3;
          },
        },
        {
          label: 'Quarantine the site',
          apply({ state, economy }) {
            const sys = state.systems[narrative._eventCache.ancient_artifact._system];
            sys.stability = clamp(sys.stability - 10, 0, 100);
          },
        },
      ],
    },

    {
      id: 'civil_war',
      title: 'Faction Collapsed into Civil War',
      description: '{faction} has fractured as rival warlords contest every world. Refugees flood your borders.',
      cooldown: 999,
      check(state) {
        for (const f of Object.values(state.factions)) {
          if (f.id === state.playerFactionId) continue;
          if (f.stability < 20) {
            this._faction = f.id;
            return true;
          }
        }
        return false;
      },
      choices: [
        {
          label: 'Accept the refugees',
          apply({ state, economy }) {
            state.factions[state.playerFactionId].resources.food -= 30;
            state.playerStats.reputation += 5;
          },
        },
        {
          label: 'Close the borders',
          apply({ state }) {
            state.playerStats.reputation -= 8;
          },
        },
        {
          label: 'Intervene on behalf of a faction',
          apply({ state, diplomacy }) {
            const fid = narrative._eventCache.civil_war._faction;
            diplomacy.declareWar(state.playerFactionId, fid, 'intervention');
          },
        },
      ],
    },

    {
      id: 'first_contact',
      title: 'First Contact!',
      description: 'A previously unknown civilization has been detected on the far side of charted space.',
      cooldown: 1,
      check(state, ctx) {
        // Fire once per "edge" of the map — if player just acquired a system
        // far from any existing faction.
        const playerSys = Object.values(state.systems).filter(s => s.ownerId === state.playerFactionId);
        if (!playerSys.length) return false;
        for (const ps of playerSys) {
          if (ps._announcedContact) continue;
          // No adjacent owned systems of other factions
          const adjacentOther = state.connections.some(c => {
            const other = c.from === ps.id ? c.to : c.from;
            const os = state.systems[other];
            return os && os.ownerId && os.ownerId !== state.playerFactionId;
          });
          if (!adjacentOther && RNG.chance(0.15)) {
            ps._announcedContact = true;
            this._system = ps.id;
            return true;
          }
        }
        return false;
      },
      choices: [
        {
          label: 'Open diplomatic channels',
          apply({ state }) {
            state.playerStats.reputation += 4;
          },
        },
        {
          label: 'Observe covertly',
          apply({ state }) {
            state.playerStats.reputation += 1;
          },
        },
        {
          label: 'Show force',
          apply({ state, diplomacy }) {
            const f = diplomacy.getAllFactions().find(x => x.id !== state.playerFactionId);
            if (f) diplomacy.factions[state.playerFactionId].shiftRelation(f.id, -10, 'Showed force');
          },
        },
      ],
    },

    {
      id: 'economic_crisis',
      title: 'Economic Crisis Across the Galaxy',
      description: 'Resource scarcity has triggered runaway inflation. Trade is grinding to a halt.',
      cooldown: 25,
      check(state, ctx) {
        for (const r of ['minerals', 'energy', 'food']) {
          const total = Object.values(state.factions).reduce((a, f) => a + (f.resources[r] || 0), 0);
          const cap = ctx.economy.globalPrices[r] || 1;
          if (cap > 2.0) {
            this._resource = r;
            return true;
          }
        }
        return false;
      },
      choices: [
        {
          label: 'Subsidize essential goods',
          apply({ state }) {
            state.factions[state.playerFactionId].resources.credits -= 200;
            state.playerStats.reputation += 6;
          },
        },
        {
          label: 'Hoard your own supplies',
          apply({ state, economy }) {
            // Lift any trade routes for 3 turns (modeled as immediate 1-route cut)
            economy.tradeRoutes = economy.tradeRoutes.filter(r => r.aId !== state.playerFactionId && r.bId !== state.playerFactionId);
            state.playerStats.reputation -= 4;
          },
        },
        {
          label: 'Do nothing',
          apply() { /* market corrects */ },
        },
      ],
    },

    {
      id: 'diplomatic_summit',
      title: 'Diplomatic Summit Proposed',
      description: 'Two major factions are seeking neutral ground to formalize relations. You have been invited.',
      cooldown: 30,
      check(state, ctx) {
        const factions = Object.values(state.factions).filter(f => f.id !== state.playerFactionId);
        for (let i = 0; i < factions.length; i++) {
          for (let j = i + 1; j < factions.length; j++) {
            const a = factions[i], b = factions[j];
            if (a.relations[b.id] > 30 && !a.alliances.has(b.id)) {
              this._a = a.id; this._b = b.id;
              return true;
            }
          }
        }
        return false;
      },
      choices: [
        {
          label: 'Mediate and propose a wider pact',
          apply({ state, diplomacy }) {
            const { _a, _b } = narrative._eventCache.diplomatic_summit;
            diplomacy.formAlliance(_a, _b);
            diplomacy.factions[state.playerFactionId].shiftRelation(_a, +5, 'Mediated');
            diplomacy.factions[state.playerFactionId].shiftRelation(_b, +5, 'Mediated');
            state.playerStats.reputation += 6;
          },
        },
        {
          label: 'Attend as observer only',
          apply({ state }) {
            state.playerStats.reputation += 2;
          },
        },
        {
          label: 'Decline the invitation',
          apply({ state }) {
            state.playerStats.reputation -= 1;
          },
        },
      ],
    },
  ];

  class NarrativeEngine {
    constructor(state, economy, diplomacy) {
      this.state = state;
      this.economy = economy;
      this.diplomacy = diplomacy;
      this.cooldowns = {};        // eventId -> turns remaining
      this.activeChoices = [];    // currently presented events
      this.log = state.eventLog;  // alias
      this._eventCache = {};      // shared scratchpad so choices can read context
      this.listeners = [];        // (event) => void
    }

    on(cb) { this.listeners.push(cb); }
    _emit(evt) { this.listeners.forEach(cb => cb(evt)); }

    tick() {
      const fired = [];
      for (const def of NARRATIVE_EVENTS) {
        const cd = this.cooldowns[def.id] || 0;
        if (cd > 0) { this.cooldowns[def.id] = cd - 1; continue; }
        // Reset shared per-event scratch
        this._eventCache[def.id] = {};
        const bound = def.check.bind(this._eventCache[def.id]);
        try {
          if (bound(this.state, { economy: this.economy, diplomacy: this.diplomacy, narrative: this })) {
            fired.push(def);
          }
        } catch (err) {
          console.warn(`Narrative event ${def.id} check threw:`, err);
        }
      }

      const presented = [];
      for (const def of fired) {
        const entry = this._present(def);
        if (entry) presented.push(entry);
        this.cooldowns[def.id] = def.cooldown;
      }
      return presented;
    }

    _present(def) {
      const cache = this._eventCache[def.id];
      const entry = {
        id: def.id,
        title: def.title,
        description: this._fillPlaceholders(def.description, cache),
        choices: def.choices.map(c => ({ label: c.label, apply: c.apply })),
        _raw: def,
      };
      this.log.push({
        turn: this.state.turn,
        title: entry.title,
        description: entry.description,
        choices: entry.choices.map(c => c.label),
        picked: null,
      });
      this._emit({ kind: 'narrative', event: entry });
      return entry;
    }

    _fillPlaceholders(text, cache) {
      return text.replace(/\{(\w+)\}/g, (_, key) => {
        const v = cache[key];
        if (!v) return _;
        if (this.state.factions[v]) return this.state.factions[v].name;
        if (this.state.systems[v]) return this.state.systems[v].name || v;
        return v;
      });
    }

    /*
     * Resolve a player choice. Looks up the event definition and applies
     * the corresponding consequence callback.
     */
    resolveChoice(eventId, choiceIndex) {
      const def = NARRATIVE_EVENTS.find(e => e.id === eventId);
      if (!def) return false;
      const choice = def.choices[choiceIndex];
      if (!choice) return false;
      try {
        choice.apply({
          state: this.state,
          economy: this.economy,
          diplomacy: this.diplomacy,
          narrative: this,
        });
      } catch (err) {
        console.warn(`Choice application for ${eventId} threw:`, err);
      }
      // Mark log entry
      const logEntry = [...this.log].reverse().find(e => e.title === def.title && !e.picked);
      if (logEntry) logEntry.picked = choice.label;
      this._emit({ kind: 'choiceMade', eventId, choiceIndex });
      return true;
    }

    getRecentLog(n = 20) {
      return this.log.slice(-n);
    }
  }

  // =====================================================================
  // TOP-LEVEL ORCHESTRATOR (optional convenience)
  // =====================================================================
  class Game {
    constructor(seed = Date.now()) {
      RNG.seed = seed >>> 0;
      this.state = new GameState();
      this.diplomacy = new DiplomacyEngine(this.state);
      this.economy = new EconomyEngine(this.state);
      // Narrative needs both engines ready
      this.narrative = new NarrativeEngine(this.state, this.economy, this.diplomacy);
    }

    registerPlayer(playerDef) { this.diplomacy.registerPlayer(playerDef); }
    registerSystem(sys) { this.economy.registerSystem(sys); }
    addConnection(from, to) { this.state.connections.push({ from, to }); }
    addTech(tech) {
      // tech: { id, name, field }
      this.state.techs[tech.id] = { ...tech, owned: new Set() };
    }

    advanceTurn() {
      this.state.turn++;
      GameState_turnRef = this.state.turn;
      this.economy.tick();
      this.diplomacy.aiTurn();
      this.narrative.tick();
      return {
        economyReport: this.economy.lastReport,
        prices: this.economy.globalPrices,
        diplomacyEvents: this.diplomacy.flushEvents(),
      };
    }
  }

  // ---------------------------------------------------------------------
  // Expose
  // ---------------------------------------------------------------------
  global.EclipseProtocol = {
    Game,
    DiplomacyEngine,
    EconomyEngine,
    NarrativeEngine,
    Faction,
    GameState,
    PERSONALITY_PRESETS,
    FACTION_DEFS,
    SYSTEM_TYPES,
    BUILDING_COSTS,
    NARRATIVE_EVENTS,
    RNG,
    clamp,
  };

})(typeof window !== 'undefined' ? window : globalThis);