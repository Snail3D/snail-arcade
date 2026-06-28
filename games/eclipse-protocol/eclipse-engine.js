/* =========================================================================
 *  Eclipse Protocol — Core Game Engine
 *  A 4X space empire builder. Self-contained vanilla JavaScript module
 *  designed to be embedded inside an HTML <script> tag.
 *
 *  Public entry point: window.Eclipse = { start(canvasEl, opts) }
 *  -------------------------------------------------------------------------
 *  Architecture
 *    - PRNG             : seeded mulberry32 RNG (deterministic galaxy gen)
 *    - GalaxyGenerator  : spiral-arm procedural galaxy (10k+ systems)
 *    - GateNetwork      : nearest-neighbor jump-gate graph w/ travel cost
 *    - SpatialIndex     : uniform-grid spatial index for fast lookups
 *    - Galaxy           : owns systems + gates; BFS reachability helpers
 *    - Faction          : empire state (resources, tech, color, diplomacy)
 *    - TechTree         : tech definitions and prerequisites
 *    - GameState        : turn, phase, factions, techs, events, save/load
 *    - Renderer         : canvas galaxy map (zoom/pan, gates, terrain)
 *    - InputController  : wheel zoom, drag pan, click select, hover
 *    - UI               : sidebar / topbar / bottom-panel DOM management
 *    - Game             : orchestrator + bootstrap
 * ========================================================================= */

(() => {
  'use strict';

  /* =====================================================================
   *  PRNG  —  Mulberry32. Tiny, fast, well-distributed for this workload.
   * ===================================================================== */
  class PRNG {
    constructor(seed = 1) { this.seed = (seed >>> 0) || 1; this._s = this.seed; }
    reset(seed) { this.seed = (seed >>> 0) || 1; this._s = this.seed; }
    // mulberry32 step
    next() {
      let t = (this._s = (this._s + 0x6D2B79F5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    range(min, max) { return min + (max - min) * this.next(); }
    int(min, max) { return Math.floor(this.range(min, max + 1)); }
    pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
    // Weighted pick: items = [{value, weight}, ...]
    weighted(items) {
      let total = 0;
      for (const it of items) total += it.weight;
      let r = this.next() * total;
      for (const it of items) {
        r -= it.weight;
        if (r <= 0) return it.value;
      }
      return items[items.length - 1].value;
    }
  }

  /* =====================================================================
   *  Constants — system types, factions, tech, phases
   * ===================================================================== */
  const SYSTEM_TYPES = {
    HABITABLE:  { id: 'habitable',   label: 'Habitable Planet',  color: '#6ee7b7' },
    GAS_GIANT:  { id: 'gas_giant',   label: 'Gas Giant',         color: '#fbbf24' },
    ASTEROID:   { id: 'asteroid',    label: 'Asteroid Belt',     color: '#9ca3af' },
    NEBULA:     { id: 'nebula',      label: 'Nebula',            color: '#c084fc' },
    ANOMALY:    { id: 'anomaly',     label: 'Anomaly',           color: '#f472b6' },
    BLACK_HOLE: { id: 'black_hole',  label: 'Black Hole',        color: '#1f2937' },
    STAR:       { id: 'star',        label: 'Sol-type Star',     color: '#fde68a' },
    ICE:        { id: 'ice',         label: 'Ice World',         color: '#7dd3fc' },
    DESERT:     { id: 'desert',      label: 'Desert World',      color: '#fb923c' }
  };

  const PHASES = ['explore', 'expand', 'exploit', 'exterminate'];
  const PHASE_LABEL = {
    explore: 'EXPLORE',
    expand: 'EXPAND',
    exploit: 'EXPLOIT',
    exterminate: 'EXTERMINATE'
  };

  // Faction color palette — distinct, readable on a dark canvas.
  const FACTION_COLORS = [
    '#60a5fa', // blue (player default)
    '#f87171', // red
    '#34d399', // emerald
    '#fbbf24', // amber
    '#a78bfa', // violet
    '#fb7185', // rose
    '#22d3ee', // cyan
    '#facc15'  // yellow
  ];

  /* =====================================================================
   *  GalaxyGenerator  —  procedural spiral galaxy
   * ===================================================================== */
  class GalaxyGenerator {
    /**
     * @param {object} opts
     * @param {number} opts.seed         — RNG seed
     * @param {number} opts.systemCount  — target number of systems (10k+)
     * @param {number} opts.radius       — galaxy radius in arbitrary units
     * @param {number} opts.arms         — number of spiral arms
     * @param {number} opts.armSpread    — how tightly arms wrap (radians)
     * @param {number} opts.armWidth     — perpendicular jitter of arms
     */
    constructor(opts = {}) {
      this.seed = opts.seed ?? 1337;
      this.systemCount = opts.systemCount ?? 10000;
      this.radius = opts.radius ?? 4000;
      this.arms = opts.arms ?? 4;
      this.armSpread = opts.armSpread ?? 0.6;
      this.armWidth = opts.armWidth ?? 0.35;
      this.coreRadius = opts.coreRadius ?? 350;
      this.coreFraction = opts.coreFraction ?? 0.18;
      this.rng = new PRNG(this.seed);
    }

    generate() {
      const systems = [];
      const t = this.rng;

      // Split total count: some inside core, rest in arms.
      const coreCount = Math.floor(this.systemCount * this.coreFraction);
      const armCount = this.systemCount - coreCount;
      const perArm = Math.floor(armCount / this.arms);
      let id = 0;

      // 1) Core systems — distributed in a dense central bulge.
      for (let i = 0; i < coreCount; i++) {
        const r = Math.sqrt(t.next()) * this.coreRadius;
        const theta = t.next() * Math.PI * 2;
        systems.push(this._makeSystem(id++, r * Math.cos(theta), r * Math.sin(theta), true));
      }

      // 2) Spiral arms — logarithmic spiral with jitter.
      for (let a = 0; a < this.arms; a++) {
        const armOffset = (a * Math.PI * 2) / this.arms;
        for (let i = 0; i < perArm; i++) {
          // Distance from center, biased outward (sqrt gives more density inward).
          const distFrac = Math.pow(t.next(), 0.7);
          const dist = this.coreRadius + distFrac * (this.radius - this.coreRadius);
          // Spiral angle: log-spiral, armOffset sets which arm.
          const armTheta = armOffset + dist * this.armSpread / 100 + (t.next() - 0.5) * 0.05;
          // Perpendicular jitter — points cluster near the arm spine.
          const perp = (t.next() + t.next() + t.next() - 1.5) * this.armWidth * dist * 0.05;
          const dx = Math.cos(armTheta) * dist - Math.sin(armTheta) * perp;
          const dy = Math.sin(armTheta) * dist + Math.cos(armTheta) * perp;
          systems.push(this._makeSystem(id++, dx, dy, false));
        }
      }

      // 3) Tag nebulae and black holes — these are terrain anchors and
      //    influence resource yields and exploration.
      this._decorateTerrain(systems);

      // 4) Choose a player home near the galactic core.
      const homeIds = this._pickPlayerHome(systems);

      return { systems, homeIds };
    }

    _makeSystem(id, x, y, isCore) {
      const t = this.rng;
      // Type weights — core skews toward stars/anomalies; arms have more habitable worlds.
      let type;
      if (isCore) {
        type = t.weighted([
          { value: SYSTEM_TYPES.STAR,      weight: 5 },
          { value: SYSTEM_TYPES.ANOMALY,   weight: 2 },
          { value: SYSTEM_TYPES.BLACK_HOLE, weight: 1 },
          { value: SYSTEM_TYPES.HABITABLE,  weight: 2 },
          { value: SYSTEM_TYPES.GAS_GIANT,  weight: 2 }
        ]);
      } else {
        type = t.weighted([
          { value: SYSTEM_TYPES.HABITABLE, weight: 5 },
          { value: SYSTEM_TYPES.GAS_GIANT, weight: 3 },
          { value: SYSTEM_TYPES.ASTEROID,  weight: 3 },
          { value: SYSTEM_TYPES.NEBULA,    weight: 1.5 },
          { value: SYSTEM_TYPES.ICE,       weight: 2 },
          { value: SYSTEM_TYPES.DESERT,    weight: 2 },
          { value: SYSTEM_TYPES.STAR,      weight: 1 },
          { value: SYSTEM_TYPES.ANOMALY,   weight: 0.5 },
          { value: SYSTEM_TYPES.BLACK_HOLE, weight: 0.2 }
        ]);
      }

      // Resource generation per type — biased so anomalies/black holes
      // yield energy/tech but are dangerous; hab worlds yield food/pop.
      const r = (lo, hi) => Math.round(t.range(lo, hi));
      let resources = { minerals: r(1, 10), energy: r(1, 10), food: r(1, 10), tech: r(0, 5) };
      let population = 0;
      switch (type.id) {
        case 'habitable':
          resources = { minerals: r(2, 8), energy: r(2, 8), food: r(8, 18), tech: r(2, 6) };
          population = r(3, 8) * 100;
          break;
        case 'gas_giant':
          resources = { minerals: r(2, 8), energy: r(8, 18), food: r(0, 2), tech: r(2, 6) };
          population = 0;
          break;
        case 'asteroid':
          resources = { minerals: r(10, 22), energy: r(1, 5), food: r(0, 1), tech: r(2, 8) };
          population = 0;
          break;
        case 'nebula':
          resources = { minerals: r(1, 4), energy: r(4, 12), food: r(0, 2), tech: r(6, 14) };
          population = 0;
          break;
        case 'anomaly':
          resources = { minerals: r(2, 6), energy: r(8, 14), food: r(0, 2), tech: r(10, 22) };
          population = 0;
          break;
        case 'black_hole':
          resources = { minerals: r(0, 3), energy: r(15, 30), food: r(0, 1), tech: r(8, 18) };
          population = 0;
          break;
        case 'ice':
          resources = { minerals: r(3, 8), energy: r(2, 6), food: r(1, 4), tech: r(2, 6) };
          population = r(0, 3) * 50;
          break;
        case 'desert':
          resources = { minerals: r(5, 12), energy: r(6, 12), food: r(0, 2), tech: r(1, 5) };
          population = r(0, 3) * 50;
          break;
        case 'star':
          resources = { minerals: r(1, 4), energy: r(12, 24), food: r(0, 1), tech: r(3, 8) };
          population = 0;
          break;
      }

      return {
        id,
        name: NameGen.generate(this.rng),
        x, y,
        type: type.id,
        typeMeta: SYSTEM_TYPES[type.id.toUpperCase()] ? type : SYSTEM_TYPES.STAR,
        resources,
        population,
        basePopulation: population,
        owner: null,         // factionId once claimed
        gates: [],           // ids of directly-connected systems
        discovered: false,   // becomes true on first sight
        explored: false,     // player has fully scanned it
        stationLevel: 0      // 0=none, 1=outpost, 2=colony, 3=citadel
      };
    }

    _decorateTerrain(systems) {
      // Optional: nebulae and black holes can be clustered; we already
      // generated them by weight, so no further action needed here. Hook
      // left for future placement of "lone" features like pulsars.
    }

    _pickPlayerHome(systems) {
      // Find systems closest to (0,0) that are habitable or star.
      const candidates = systems
        .filter(s => s.type === 'habitable' || s.type === 'star')
        .sort((a, b) => (a.x * a.x + a.y * a.y) - (b.x * b.x + b.y * b.y))
        .slice(0, 12);
      // Pick 1-2 distinct ones near the core, connected by a gate later.
      const home1 = this.rng.pick(candidates.slice(0, 4));
      let home2 = null;
      if (candidates.length > 4 && this.rng.next() < 0.7) {
        const others = candidates.filter(c => c.id !== home1.id).slice(0, 4);
        home2 = this.rng.pick(others);
      }
      return home2 ? [home1.id, home2.id] : [home1.id];
    }
  }

  /* =====================================================================
   *  NameGen  —  procedural star name generator (deterministic w/ RNG)
   * ===================================================================== */
  const NameGen = (() => {
    const PREFIX = [
      'Al', 'Bel', 'Cor', 'Del', 'Eld', 'Far', 'Gor', 'Hel', 'Il', 'Jor',
      'Kal', 'Lor', 'Mor', 'Nor', 'Ol', 'Pri', 'Quor', 'Ras', 'Sol', 'Tor',
      'Ul', 'Vel', 'Wor', 'Xan', 'Yor', 'Zan', 'Eth', 'Vex', 'Kry', 'Zen',
      'Aur', 'Bor', 'Cy', 'Dra', 'Eri', 'Fen', 'Gal', 'Hes', 'Ix', 'Jyn',
      'Kor', 'Lux', 'Myr', 'Nyx', 'Ob', 'Pyr', 'Rho', 'Syr', 'Thal', 'Und'
    ];
    const MID = [
      'an', 'ar', 'el', 'en', 'ia', 'is', 'on', 'or', 'us', 'ax',
      'ex', 'ix', 'om', 'um', 'yr', 'ath', 'ern', 'iel', 'ond', 'uth'
    ];
    const SUFFIX = [
      'Prime', 'Major', 'Minor', 'I', 'II', 'III', 'IV', 'V',
      '', '', '', '', // many short names
      'Station', 'Reach', 'Shores', 'Gate', 'Crossing', 'Hollow',
      'Nebula', 'Drift', 'Cluster', 'Haze', 'Veil', 'Wake'
    ];

    return {
      generate(rng) {
        const a = rng.pick(PREFIX);
        const m = rng.next() < 0.7 ? rng.pick(MID) : '';
        const b = rng.next() < 0.55 ? rng.pick(SUFFIX) : '';
        let name = a + m;
        // Sometimes inject a numeric catalog id.
        if (rng.next() < 0.25) name += '-' + rng.int(10, 9999);
        return name + (b ? ' ' + b : '');
      }
    };
  })();

  /* =====================================================================
   *  SpatialIndex  —  uniform grid for fast neighbor lookup
   * ===================================================================== */
  class SpatialIndex {
    constructor(cellSize = 200) {
      this.cellSize = cellSize;
      this.cells = new Map();
    }
    _key(cx, cy) { return cx + ',' + cy; }
    insert(sys) {
      const cx = Math.floor(sys.x / this.cellSize);
      const cy = Math.floor(sys.y / this.cellSize);
      const k = this._key(cx, cy);
      let bucket = this.cells.get(k);
      if (!bucket) { bucket = []; this.cells.set(k, bucket); }
      bucket.push(sys);
    }
    *neighbors(x, y, radius) {
      const cellRadius = Math.ceil(radius / this.cellSize);
      const cx = Math.floor(x / this.cellSize);
      const cy = Math.floor(y / this.cellSize);
      const r2 = radius * radius;
      for (let dx = -cellRadius; dx <= cellRadius; dx++) {
        for (let dy = -cellRadius; dy <= cellRadius; dy++) {
          const bucket = this.cells.get(this._key(cx + dx, cy + dy));
          if (!bucket) continue;
          for (const s of bucket) {
            const ddx = s.x - x, ddy = s.y - y;
            if (ddx * ddx + ddy * ddy <= r2) yield s;
          }
        }
      }
    }
  }

  /* =====================================================================
   *  GateNetwork  —  connect nearby systems with jump gates
   * ===================================================================== */
  class GateNetwork {
    /**
     * @param {Galaxy} galaxy
     * @param {object} opts
     * @param {number} opts.maxLinksPerSystem — cap outgoing gates per system
     * @param {number} opts.maxLinkDistance   — gate length cap (galaxy units)
     * @param {number} opts.baseCost          — base fuel/turn cost per gate
     * @param {number} opts.distanceFactor    — multiplier for distance
     */
    constructor(galaxy, opts = {}) {
      this.galaxy = galaxy;
      // Defaults chosen so the resulting gate graph is a single connected
      // component spanning the vast majority of the galaxy while still
      // preserving locality: most gates are short, only a handful of long
      // "bridge" links stitch distant clusters together.
      this.maxLinksPerSystem = opts.maxLinksPerSystem ?? 5;
      this.maxLinkDistance = opts.maxLinkDistance ?? 380;
      this.baseCost = opts.baseCost ?? 1;
      this.distanceFactor = opts.distanceFactor ?? 0.004;
    }

    build() {
      const sys = this.galaxy.systems;
      const idx = this.galaxy.spatialIndex;
      const linksPerSystem = new Array(sys.length).fill(0);
      const edgeSet = new Set();

      // --- Phase 1: KNN — connect each system to its K nearest within range.
      // We deliberately do NOT cap based on the neighbor's saturation here;
      // saturation is checked symmetrically only AFTER the candidate pair is
      // chosen. This ensures short bridges aren't starved by greedy local
      // choices.
      for (const s of sys) {
        const candidates = [];
        for (const n of idx.neighbors(s.x, s.y, this.maxLinkDistance)) {
          if (n.id === s.id) continue;
          const dx = n.x - s.x, dy = n.y - s.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          candidates.push({ n, d });
        }
        candidates.sort((a, b) => a.d - b.d);

        let added = 0;
        for (const c of candidates) {
          if (added >= this.maxLinksPerSystem) break;
          if (linksPerSystem[s.id] >= this.maxLinksPerSystem) break;
          if (linksPerSystem[c.n.id] >= this.maxLinksPerSystem) continue;
          const key = s.id < c.n.id ? `${s.id}|${c.n.id}` : `${c.n.id}|${s.id}`;
          if (edgeSet.has(key)) continue;
          edgeSet.add(key);
          this._connect(s, c.n, c.d);
          linksPerSystem[s.id]++;
          linksPerSystem[c.n.id]++;
          added++;
        }
      }

      // --- Phase 2: isolated systems — link each to its single nearest
      // reachable neighbor regardless of saturation.
      for (const s of sys) {
        if (s.gates.length > 0) continue;
        let best = null, bestD = Infinity;
        for (const n of idx.neighbors(s.x, s.y, this.maxLinkDistance * 1.5)) {
          if (n.id === s.id) continue;
          const dx = n.x - s.x, dy = n.y - s.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < bestD) { bestD = d; best = n; }
        }
        if (best) this._connect(s, best, bestD);
      }

      // --- Phase 3: stitch disconnected components together. A purely local
      // KNN pass leaves clusters separated by density gaps; we walk the
      // components and draw short bridges between nearest pairs.
      this._stitchComponents(linksPerSystem);
    }

    _connect(a, b, distance) {
      const cost = this.baseCost + distance * this.distanceFactor;
      const c = Math.round(cost * 10) / 10;
      a.gates.push({ to: b.id, cost: c });
      b.gates.push({ to: a.id, cost: c });
    }

    /** Find connected components and bridge them. */
    _stitchComponents(linksPerSystem) {
      const sys = this.galaxy.systems;
      const idx = this.galaxy.spatialIndex;
      const compOf = new Array(sys.length).fill(-1);
      const components = [];
      for (const s of sys) {
        if (compOf[s.id] !== -1) continue;
        const cid = components.length;
        const queue = [s.id];
        compOf[s.id] = cid;
        const members = [];
        while (queue.length) {
          const id = queue.shift();
          members.push(id);
          const ss = this.galaxy.get(id);
          for (const g of ss.gates) {
            if (compOf[g.to] !== -1) continue;
            compOf[g.to] = cid;
            queue.push(g.to);
          }
        }
        components.push(members);
      }
      if (components.length <= 1) return;

      // Bridge components greedily by repeatedly joining the closest pair.
      // Use centroid-to-centroid distance as a cheap estimate.
      const centroids = components.map(members => {
        let cx = 0, cy = 0;
        for (const id of members) {
          const s = this.galaxy.get(id);
          cx += s.x; cy += s.y;
        }
        return { x: cx / members.length, y: cy / members.length };
      });
      while (true) {
        let bestPair = null, bestDist = Infinity;
        for (let i = 0; i < components.length; i++) {
          for (let j = i + 1; j < components.length; j++) {
            const a = centroids[i], b = centroids[j];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d < bestDist) { bestDist = d; bestPair = [i, j]; }
          }
        }
        if (!bestPair) break;
        const [ci, cj] = bestPair;

        // Find the actual nearest pair between the two components.
        // To avoid O(N*M), sample: pick the system in `cj` closest to
        // `centroids[ci]`, then find its nearest neighbor in `ci`.
        let seed = null, seedD = Infinity;
        for (const id of components[cj]) {
          const s = this.galaxy.get(id);
          const d = Math.hypot(s.x - centroids[ci].x, s.y - centroids[ci].y);
          if (d < seedD) { seedD = d; seed = s; }
        }
        let bridge = null, bridgeD = Infinity;
        // Look around `seed` for nearest member of component `ci`.
        for (const n of idx.neighbors(seed.x, seed.y, this.maxLinkDistance * 2)) {
          if (compOf[n.id] !== ci) continue;
          const d = Math.hypot(n.x - seed.x, n.y - seed.y);
          if (d < bridgeD) { bridgeD = d; bridge = n; }
        }
        if (!bridge) {
          // Components are farther apart than maxLinkDistance — give up.
          // (Shouldn't happen in practice with our default galaxy settings.)
          break;
        }
        this._connect(seed, bridge, bridgeD);

        // Merge components: move `cj` into `ci`, update compOf + centroids.
        const mergedMembers = components[ci].concat(components[cj]);
        components[ci] = mergedMembers;
        for (const id of components[cj]) compOf[id] = ci;
        components.splice(cj, 1);
        centroids.splice(cj, 1);
        const cx = centroids[ci].x, cy = centroids[ci].y;
        let nx = 0, ny = 0;
        for (const id of mergedMembers) { const s = this.galaxy.get(id); nx += s.x; ny += s.y; }
        centroids[ci] = { x: nx / mergedMembers.length, y: ny / mergedMembers.length };
        if (components.length <= 1) break;
      }
    }
  }

  /* =====================================================================
   *  Galaxy  —  container + spatial helpers + BFS reachability
   * ===================================================================== */
  class Galaxy {
    constructor(systems, homeIds, opts = {}) {
      this.systems = systems;
      this.homeIds = homeIds;
      this.spatialIndex = new SpatialIndex(opts.spatialCellSize ?? 220);
      for (const s of systems) this.spatialIndex.insert(s);
      // Quick lookup map.
      this.byId = new Map();
      for (const s of systems) this.byId.set(s.id, s);
      this.bounds = this._computeBounds();
    }

    _computeBounds() {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const s of this.systems) {
        if (s.x < minX) minX = s.x;
        if (s.y < minY) minY = s.y;
        if (s.x > maxX) maxX = s.x;
        if (s.y > maxY) maxY = s.y;
      }
      return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
    }

    get(id) { return this.byId.get(id); }

    /**
     * BFS over the undirected gate graph. Returns Map<id, hop-count> from start.
     * Optional filters:
     *   maxHops: cap on distance
     *   ownedOnly: when true, only expand through systems owned by the calling
     *              faction (passed as `faction`). Used for travel-cost checks
     *              where going through enemy-owned systems isn't allowed.
     */
    bfs(startId, opts = {}) {
      const maxHops = opts.maxHops ?? Infinity;
      const faction = opts.faction ?? null;
      const ownedOnly = !!opts.ownedOnly;
      const dist = new Map();
      if (!this.byId.has(startId)) return dist;
      const q = [startId];
      dist.set(startId, 0);
      while (q.length) {
        const id = q.shift();
        const d = dist.get(id);
        if (d >= maxHops) continue;
        const s = this.byId.get(id);
        // When `ownedOnly` is true, we may traverse gates FROM this node only
        // if we own it. The destination still gets discovered (you can see it)
        // but you cannot walk further through it.
        if (ownedOnly && faction != null && s.owner !== faction && d > 0) continue;
        for (const g of s.gates) {
          if (dist.has(g.to)) continue;
          dist.set(g.to, d + 1);
          q.push(g.to);
        }
      }
      return dist;
    }
  }

  /* =====================================================================
   *  TechTree  —  tech definitions and unlock checks
   * ===================================================================== */
  class TechTree {
    constructor() {
      this.techs = [
        { id: 'basic_propulsion',  name: 'Basic Propulsion',   cost: 20,  era: 1, desc: 'Faster jump-gate travel.' },
        { id: 'mining_drones',     name: 'Mining Drones',      cost: 30,  era: 1, desc: '+25% mineral output.' },
        { id: 'hydroponics',       name: 'Hydroponics',        cost: 30,  era: 1, desc: '+25% food output.' },
        { id: 'fusion_reactors',   name: 'Fusion Reactors',    cost: 35,  era: 1, desc: '+25% energy output.' },
        { id: 'cybernetics',       name: 'Cybernetics',        cost: 40,  era: 1, desc: '+1 population cap on colonies.' },
        { id: 'jump_dynamics',     name: 'Jump Dynamics',      cost: 50,  era: 2, prereq: ['basic_propulsion'], desc: 'Unlock long-range gates.' },
        { id: 'exo_mining',        name: 'Exo-Mining',         cost: 60,  era: 2, prereq: ['mining_drones'], desc: 'Mine asteroid belts at full yield.' },
        { id: 'terraforming',      name: 'Terraforming',       cost: 80,  era: 2, prereq: ['hydroponics'], desc: 'Colonize ice & desert worlds.' },
        { id: 'singularity_core',  name: 'Singularity Core',   cost: 100, era: 2, prereq: ['fusion_reactors'], desc: 'Harness black-hole energy.' },
        { id: 'xenobiology',       name: 'Xenobiology',        cost: 90,  era: 2, prereq: ['cybernetics'], desc: 'Unlock anomaly research.' },
        { id: 'warp_drive',        name: 'Warp Drive',         cost: 150, era: 3, prereq: ['jump_dynamics'], desc: 'Warp speed; new gates per turn.' },
        { id: 'dyson_swarm',       name: 'Dyson Swarm',        cost: 200, era: 3, prereq: ['singularity_core'], desc: 'Star-system energy cap +50%.' },
        { id: 'nanite_swarm',      name: 'Nanite Swarm',       cost: 200, era: 3, prereq: ['exo_mining', 'cybernetics'], desc: '+50% mineral output.' },
        { id: 'ascension_protocol',name: 'Ascension Protocol', cost: 500, era: 4, prereq: ['warp_drive', 'xenobiology'], desc: 'Win the game: achieve transcendence.' }
      ];
    }

    get(id) { return this.techs.find(t => t.id === id); }
    byEra(era) { return this.techs.filter(t => t.era === era); }

    /** Returns true if every prereq id is in `unlocked` set. */
    canUnlock(techId, unlocked) {
      const t = this.get(techId);
      if (!t || unlocked.has(techId)) return false;
      if (!t.prereq) return true;
      return t.prereq.every(p => unlocked.has(p));
    }
  }

  /* =====================================================================
   *  Faction  —  empire state
   * ===================================================================== */
  class Faction {
    constructor(opts = {}) {
      this.id = opts.id;
      this.name = opts.name ?? 'Unnamed';
      this.color = opts.color ?? '#888';
      this.isPlayer = !!opts.isPlayer;
      this.personality = opts.personality ?? 'balanced'; // balanced | aggressive | scientist | expansionist
      this.resources = {
        minerals: opts.minerals ?? 100,
        energy:   opts.energy   ?? 100,
        food:     opts.food     ?? 50,
        tech:     opts.tech     ?? 0,
        credits:  opts.credits  ?? 0
      };
      this.ownedSystems = new Set(opts.ownedSystems ?? []);
      this.unlockedTechs = new Set(opts.unlockedTechs ?? []);
      this.activeResearch = null;        // { techId, progress }
      this.diplomacy = opts.diplomacy ?? {}; // factionId -> 'neutral'|'war'|'ally'
      this.alive = true;
    }

    toJSON() {
      return {
        id: this.id,
        name: this.name,
        color: this.color,
        isPlayer: this.isPlayer,
        personality: this.personality,
        resources: { ...this.resources },
        ownedSystems: Array.from(this.ownedSystems),
        unlockedTechs: Array.from(this.unlockedTechs),
        activeResearch: this.activeResearch,
        diplomacy: this.diplomacy,
        alive: this.alive
      };
    }
    static fromJSON(o) {
      const f = new Faction({
        id: o.id, name: o.name, color: o.color, isPlayer: o.isPlayer,
        personality: o.personality, minerals: o.resources.minerals,
        energy: o.resources.energy, food: o.resources.food,
        tech: o.resources.tech, credits: o.resources.credits,
        ownedSystems: o.ownedSystems, unlockedTechs: o.unlockedTechs,
        diplomacy: o.diplomacy
      });
      f.activeResearch = o.activeResearch;
      f.alive = o.alive;
      return f;
    }
  }

  /* =====================================================================
   *  GameState  —  top-level state + save/load + turn cycle
   * ===================================================================== */
  const SAVE_KEY = 'eclipse_protocol_save_v1';

  class GameState {
    constructor() {
      this.turn = 1;
      this.phase = 'explore';
      this.factions = [];          // Faction instances
      this.playerFactionId = null;
      this.techTree = new TechTree();
      this.events = [];            // [{ turn, type, message }]
      this.selectedSystemId = null;
      this.galaxy = null;
      this.gateNetwork = null;
      this.seed = null;
      this.gameOver = false;
      this.gameWon = false;
    }

    player() { return this.factions.find(f => f.id === this.playerFactionId); }

    addEvent(type, message) {
      this.events.push({ turn: this.turn, type, message, t: Date.now() });
      if (this.events.length > 200) this.events.shift();
    }

    save() {
      const data = {
        turn: this.turn,
        phase: this.phase,
        factions: this.factions.map(f => f.toJSON()),
        playerFactionId: this.playerFactionId,
        events: this.events.slice(-100),
        selectedSystemId: this.selectedSystemId,
        seed: this.seed,
        gameOver: this.gameOver,
        gameWon: this.gameWon,
        // Galaxy is large; store compact form.
        galaxy: this.galaxy && {
          systems: this.galaxy.systems.map(s => ({
            id: s.id, name: s.name, x: s.x, y: s.y, type: s.type,
            resources: s.resources, population: s.population,
            basePopulation: s.basePopulation, owner: s.owner,
            gates: s.gates, discovered: s.discovered, explored: s.explored,
            stationLevel: s.stationLevel
          })),
          homeIds: this.galaxy.homeIds,
          bounds: this.galaxy.bounds
        }
      };
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
        return true;
      } catch (e) {
        console.warn('Save failed:', e);
        return false;
      }
    }

    static load() {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      try {
        const o = JSON.parse(raw);
        const gs = new GameState();
        gs.turn = o.turn;
        gs.phase = o.phase;
        gs.factions = o.factions.map(Faction.fromJSON);
        gs.playerFactionId = o.playerFactionId;
        gs.events = o.events || [];
        gs.selectedSystemId = o.selectedSystemId;
        gs.seed = o.seed;
        gs.gameOver = o.gameOver;
        gs.gameWon = o.gameWon;
        if (o.galaxy) {
          const systems = o.galaxy.systems.map(s => ({
            ...s,
            typeMeta: SYSTEM_TYPES[s.type.toUpperCase()] || SYSTEM_TYPES.STAR
          }));
          const gal = new Galaxy(systems, o.galaxy.homeIds);
          gal.bounds = o.galaxy.bounds || gal.bounds;
          gs.galaxy = gal;
          gs.gateNetwork = new GateNetwork(gal);
        }
        return gs;
      } catch (e) {
        console.warn('Load failed:', e);
        return null;
      }
    }

    static clearSave() {
      try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
    }

    /** Advance one turn. Handles research + per-faction economics + AI moves. */
    advanceTurn() {
      if (this.gameOver) return;
      this.turn++;
      // Research: progress = tech + 5 base per turn (tunable).
      for (const f of this.factions) {
        if (!f.activeResearch) continue;
        f.activeResearch.progress += (f.resources.tech + 5);
        const t = this.techTree.get(f.activeResearch.techId);
        if (t && f.activeResearch.progress >= t.cost) {
          f.unlockedTechs.add(f.activeResearch.techId);
          f.activeResearch = null;
          this.addEvent('tech', `${f.name} completed research: ${t ? t.name : f.activeResearch.techId}`);
        }
      }
      // Upkeep — every owned system contributes resources.
      this._collectIncome();
      // Player phase advances in classic 4X cycle.
      this.phase = PHASES[(PHASES.indexOf(this.phase) + 1) % PHASES.length];
    }

    _collectIncome() {
      for (const f of this.factions) {
        let minerals = 0, energy = 0, food = 0, tech = 0;
        for (const sid of f.ownedSystems) {
          const s = this.galaxy.get(sid);
          if (!s) continue;
          // Station level multiplier
          const mult = [1.0, 1.25, 1.6, 2.0][s.stationLevel] || 1;
          minerals += Math.round(s.resources.minerals * mult);
          energy   += Math.round(s.resources.energy * mult);
          food     += Math.round(s.resources.food * mult);
          tech     += Math.round(s.resources.tech * mult);
        }
        // Tech bonuses (simple flat boosts)
        if (f.unlockedTechs.has('mining_drones')) minerals = Math.round(minerals * 1.25);
        if (f.unlockedTechs.has('hydroponics'))   food     = Math.round(food * 1.25);
        if (f.unlockedTechs.has('fusion_reactors')) energy = Math.round(energy * 1.25);
        if (f.unlockedTechs.has('exo_mining'))    minerals = Math.round(minerals * 1.4);
        if (f.unlockedTechs.has('nanite_swarm'))  minerals = Math.round(minerals * 1.5);
        if (f.unlockedTechs.has('dyson_swarm'))   energy   = Math.round(energy * 1.5);
        f.resources.minerals += minerals;
        f.resources.energy   += energy;
        f.resources.food     += food;
        f.resources.tech     += tech;
      }
    }

    /** Begin researching a tech — deducts cost upfront if `spend` is true. */
    startResearch(factionId, techId, spend = false) {
      const f = this.factions.find(x => x.id === factionId);
      const t = this.techTree.get(techId);
      if (!f || !t) return false;
      if (!this.techTree.canUnlock(techId, f.unlockedTechs)) return false;
      if (f.activeResearch) return false;
      f.activeResearch = { techId, progress: 0 };
      if (spend) {
        f.resources.tech = Math.max(0, f.resources.tech - t.cost);
        // Forcing completion at spend time:
        if (f.resources.tech <= 0) f.activeResearch.progress = t.cost;
      }
      this.addEvent('research', `${f.name} began researching ${t.name}`);
      return true;
    }
  }

  /* =====================================================================
   *  Renderer  —  canvas galaxy map
   * ===================================================================== */
  class Renderer {
    constructor(canvas, state, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.state = state;
      this.view = {
        x: 0,         // galaxy-space coord at screen center
        y: 0,
        zoom: 1.0     // pixels per galaxy unit; >1 = zoomed in
      };
      this.dpr = window.devicePixelRatio || 1;
      this.width = 0;
      this.height = 0;
      this.hoverId = null;
      this._resize();
      window.addEventListener('resize', () => this._resize());
    }

    _resize() {
      const r = this.canvas.getBoundingClientRect();
      this.width = Math.max(1, Math.floor(r.width));
      this.height = Math.max(1, Math.floor(r.height));
      this.canvas.width = this.width * this.dpr;
      this.canvas.height = this.height * this.dpr;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    /** Convert galaxy coords -> screen px. */
    g2s(gx, gy) {
      return [
        this.width / 2 + (gx - this.view.x) * this.view.zoom,
        this.height / 2 + (gy - this.view.y) * this.view.zoom
      ];
    }
    /** Screen px -> galaxy coords. */
    s2g(sx, sy) {
      return [
        (sx - this.width / 2) / this.view.zoom + this.view.x,
        (sy - this.height / 2) / this.view.zoom + this.view.y
      ];
    }

    centerOnGalaxy() {
      const b = this.state.galaxy.bounds;
      this.view.x = (b.minX + b.maxX) / 2;
      this.view.y = (b.minY + b.maxY) / 2;
      this.view.zoom = Math.min(
        (this.width - 80) / Math.max(1, b.w),
        (this.height - 80) / Math.max(1, b.h)
      );
    }
    centerOnSystem(id) {
      const s = this.state.galaxy.get(id);
      if (!s) return;
      this.view.x = s.x;
      this.view.y = s.y;
    }

    /** Find the topmost system within `tol` screen pixels of (sx, sy). */
    pickSystem(sx, sy, tol = 12) {
      // Convert tolerance to galaxy distance at current zoom.
      const tolG = tol / this.view.zoom;
      const [gx, gy] = this.s2g(sx, sy);
      let best = null, bestD = tolG * tolG;
      // Use spatial index to test only nearby systems.
      for (const s of this.state.galaxy.spatialIndex.neighbors(gx, gy, tolG)) {
        const dx = s.x - gx, dy = s.y - gy;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD) { bestD = d2; best = s; }
      }
      return best;
    }

    render() {
      const ctx = this.ctx;
      // Clear with deep space gradient.
      const grd = ctx.createRadialGradient(
        this.width / 2, this.height / 2, 0,
        this.width / 2, this.height / 2, Math.max(this.width, this.height) / 1.5
      );
      grd.addColorStop(0, '#0a0e1a');
      grd.addColorStop(0.6, '#05070f');
      grd.addColorStop(1, '#000');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, this.width, this.height);

      this._drawStarfield();
      this._drawNebulaOverlays();
      this._drawGates();
      this._drawSystems();
      this._drawHoverLabel();
      this._drawSelectionReticle();
    }

    _drawStarfield() {
      // Cheap procedural background stars based on view rect in galaxy coords.
      const ctx = this.ctx;
      const [minGx, minGy] = this.s2g(0, 0);
      const [maxGx, maxGy] = this.s2g(this.width, this.height);
      // Density drops with zoom (fewer visible at high zoom)
      const count = Math.floor((this.width * this.height) / 9000);
      // Seeded by viewport so stars don't shimmer every frame.
      const seed = (Math.floor(minGx / 50) * 73856093) ^ (Math.floor(minGy / 50) * 19349663);
      const rng = new PRNG(seed >>> 0);
      ctx.fillStyle = '#9aa3b2';
      for (let i = 0; i < count; i++) {
        const x = rng.range(0, this.width);
        const y = rng.range(0, this.height);
        const a = rng.range(0.2, 1.0);
        ctx.globalAlpha = a * 0.6;
        const r = rng.next() < 0.95 ? 0.5 : 1.2;
        ctx.fillRect(x, y, r, r);
      }
      ctx.globalAlpha = 1;
    }

    _drawNebulaOverlays() {
      const ctx = this.ctx;
      const z = this.view.zoom;
      if (z < 0.05) return; // too zoomed out — skip for perf
      const sys = this.state.galaxy.systems;
      const fadeStart = 0.06;
      const fadeEnd = 0.4;
      if (z < fadeStart) return;
      const alpha = Math.min(1, (z - fadeStart) / (fadeEnd - fadeStart)) * 0.45;

      // Group nebulae + black holes for batched radial gradients.
      const [minGx, minGy] = this.s2g(0, 0);
      const [maxGx, maxGy] = this.s2g(this.width, this.height);
      const pad = 200 / z;

      for (const s of sys) {
        if (s.type !== 'nebula' && s.type !== 'black_hole') continue;
        if (s.x < minGx - pad || s.x > maxGx + pad) continue;
        if (s.y < minGy - pad || s.y > maxGy + pad) continue;
        const [sx, sy] = this.g2s(s.x, s.y);
        const radius = (s.type === 'nebula' ? 80 : 55) * z * 1.3;
        if (radius < 1) continue;
        const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius);
        if (s.type === 'nebula') {
          grd.addColorStop(0, `rgba(192,132,252,${alpha})`);
          grd.addColorStop(0.6, `rgba(99,102,241,${alpha * 0.5})`);
          grd.addColorStop(1, 'rgba(0,0,0,0)');
        } else {
          grd.addColorStop(0, `rgba(0,0,0,${alpha})`);
          grd.addColorStop(0.4, `rgba(75,0,130,${alpha * 0.6})`);
          grd.addColorStop(1, 'rgba(0,0,0,0)');
        }
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    _drawGates() {
      const ctx = this.ctx;
      const z = this.view.zoom;
      if (z < 0.04) return;
      // Draw as additive lines for that "energy conduit" feel.
      const sys = this.state.galaxy.systems;
      // Culling: only draw edges with at least one endpoint on-screen (cheap test).
      const [minGx, minGy] = this.s2g(0, 0);
      const [maxGx, maxGy] = this.s2g(this.width, this.height);
      ctx.lineWidth = Math.max(0.4, Math.min(2.0, z * 0.6));
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = '#3b82f6';

      // Build set of rendered edges to avoid double-drawing.
      const seen = new Set();
      for (const s of sys) {
        if (s.x < minGx - 5 && s.x > maxGx + 5 && s.y < minGy - 5 && s.y > maxGy + 5) {
          // Quick rough reject
        }
        for (const g of s.gates) {
          if (g.to <= s.id) continue; // each edge once
          const n = this.state.galaxy.get(g.to);
          if (!n) continue;
          // Cull if both endpoints off-screen (with margin)
          const m = 50 / z;
          const aOff = (s.x < minGx - m || s.x > maxGx + m || s.y < minGy - m || s.y > maxGy + m);
          const bOff = (n.x < minGx - m || n.x > maxGx + m || n.y < minGy - m || n.y > maxGy + m);
          if (aOff && bOff) continue;
          const [ax, ay] = this.g2s(s.x, s.y);
          const [bx, by] = this.g2s(n.x, n.y);
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    _drawSystems() {
      const ctx = this.ctx;
      const z = this.view.zoom;
      const sys = this.state.galaxy.systems;
      const [minGx, minGy] = this.s2g(0, 0);
      const [maxGx, maxGy] = this.s2g(this.width, this.height);
      const pad = 20 / z;

      // Two passes: faint undiscovered dots first, then discovered w/ halos.
      for (const s of sys) {
        if (s.x < minGx - pad || s.x > maxGx + pad) continue;
        if (s.y < minGy - pad || s.y > maxGy + pad) continue;
        const [sx, sy] = this.g2s(s.x, s.y);
        if (!s.discovered) {
          ctx.fillStyle = '#374151';
          ctx.globalAlpha = 0.7;
          ctx.fillRect(sx - 0.6, sy - 0.6, 1.3, 1.3);
          continue;
        }
        const faction = s.owner != null ? this.state.factions.find(f => f.id === s.owner) : null;
        const baseColor = faction ? faction.color : (SYSTEM_TYPES[s.type.toUpperCase()] || SYSTEM_TYPES.STAR).color;
        // Halo for colonized systems
        if (faction) {
          const haloR = 5 * z;
          if (haloR > 0.5) {
            const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, haloR * 2.5);
            grd.addColorStop(0, baseColor + 'cc');
            grd.addColorStop(1, baseColor + '00');
            ctx.fillStyle = grd;
            ctx.beginPath();
            ctx.arc(sx, sy, haloR * 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        // Core dot
        ctx.fillStyle = baseColor;
        const r = Math.max(1.2, Math.min(6, 2 + z * 0.7));
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
        if (s.owner != null) {
          ctx.strokeStyle = '#fff';
          ctx.globalAlpha = 0.4;
          ctx.lineWidth = 0.6;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        // Station ring for player-owned systems with structures
        if (s.owner === this.state.playerFactionId && s.stationLevel > 0) {
          ctx.strokeStyle = '#fff';
          ctx.globalAlpha = 0.7;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(sx, sy, r + 3, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      ctx.globalAlpha = 1;

      // Labels: visible when zoomed in enough and system is discovered
      if (z > 0.18) {
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        for (const s of sys) {
          if (!s.discovered) continue;
          if (s.x < minGx - pad || s.x > maxGx + pad) continue;
          if (s.y < minGy - pad || s.y > maxGy + pad) continue;
          const [sx, sy] = this.g2s(s.x, s.y);
          ctx.fillStyle = s.owner === this.state.playerFactionId ? '#fff' : '#cbd5e1';
          ctx.fillText(s.name, sx + 6, sy);
        }
      }
    }

    _drawHoverLabel() {
      if (!this.hoverId) return;
      const s = this.state.galaxy.get(this.hoverId);
      if (!s) return;
      const [sx, sy] = this.g2s(s.x, s.y);
      const ctx = this.ctx;
      ctx.font = 'bold 12px system-ui, sans-serif';
      const label = s.name + (s.discovered ? '' : ' [unexplored]');
      const w = ctx.measureText(label).width + 12;
      ctx.fillStyle = 'rgba(15,23,42,0.92)';
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 1;
      const x = sx + 10, y = sy - 18;
      ctx.beginPath();
      ctx.rect(x, y, w, 20);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e2e8f0';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + 6, y + 10);
    }

    _drawSelectionReticle() {
      if (this.state.selectedSystemId == null) return;
      const s = this.state.galaxy.get(this.state.selectedSystemId);
      if (!s) return;
      const [sx, sy] = this.g2s(s.x, s.y);
      const ctx = this.ctx;
      ctx.strokeStyle = '#fde68a';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(sx, sy, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /* =====================================================================
   *  InputController  —  wheel zoom, drag pan, click/hover
   * ===================================================================== */
  class InputController {
    constructor(canvas, renderer, state, onSelect) {
      this.canvas = canvas;
      this.r = renderer;
      this.state = state;
      this.onSelect = onSelect;
      this._dragging = false;
      this._dragStart = null;
      this._viewStart = null;
      this._moved = false;

      canvas.addEventListener('mousedown', e => this._onDown(e));
      window.addEventListener('mousemove', e => this._onMove(e));
      window.addEventListener('mouseup',   e => this._onUp(e));
      canvas.addEventListener('wheel',     e => this._onWheel(e), { passive: false });
      canvas.addEventListener('click',     e => this._onClick(e));
      canvas.addEventListener('mouseleave',() => { this.r.hoverId = null; });

      // Touch support
      canvas.addEventListener('touchstart', e => this._onTouchStart(e), { passive: false });
      canvas.addEventListener('touchmove',  e => this._onTouchMove(e),  { passive: false });
      canvas.addEventListener('touchend',   e => this._onTouchEnd(e));
    }

    _localXY(e) {
      const r = this.canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    }
    _onDown(e) {
      const [x, y] = this._localXY(e);
      this._dragging = true;
      this._dragStart = [x, y];
      this._viewStart = [this.r.view.x, this.r.view.y];
      this._moved = false;
    }
    _onMove(e) {
      const [x, y] = this._localXY(e);
      if (this._dragging) {
        const dx = x - this._dragStart[0];
        const dy = y - this._dragStart[1];
        if (Math.abs(dx) + Math.abs(dy) > 3) this._moved = true;
        this.r.view.x = this._viewStart[0] - dx / this.r.view.zoom;
        this.r.view.y = this._viewStart[1] - dy / this.r.view.zoom;
      } else {
        // Hover
        const s = this.r.pickSystem(x, y, 10);
        this.r.hoverId = s ? s.id : null;
        this.canvas.style.cursor = s ? 'pointer' : 'grab';
      }
    }
    _onUp(e) {
      this._dragging = false;
    }
    _onWheel(e) {
      e.preventDefault();
      const [x, y] = this._localXY(e);
      // Anchor zoom at cursor position
      const [gx, gy] = this.r.s2g(x, y);
      const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
      const newZoom = Math.max(0.01, Math.min(20, this.r.view.zoom * factor));
      this.r.view.zoom = newZoom;
      // Adjust view so the galaxy point under the cursor stays put.
      const [nx, ny] = this.r.g2s(gx, gy);
      this.r.view.x += (nx - x) / newZoom;
      this.r.view.y += (ny - y) / newZoom;
    }
    _onClick(e) {
      if (this._moved) return; // ignore clicks at end of drag
      const [x, y] = this._localXY(e);
      const s = this.r.pickSystem(x, y, 12);
      if (s) this.onSelect(s.id);
    }

    // Touch: single-finger pan, two-finger pinch zoom.
    _onTouchStart(e) {
      e.preventDefault();
      if (e.touches.length === 1) {
        const t = e.touches[0];
        this._dragging = true;
        this._dragStart = this._localXY(t);
        this._viewStart = [this.r.view.x, this.r.view.y];
        this._moved = false;
      } else if (e.touches.length === 2) {
        this._dragging = false;
        this._pinchStart = this._pinchDist(e.touches);
        this._pinchZoom = this.r.view.zoom;
      }
    }
    _onTouchMove(e) {
      e.preventDefault();
      if (e.touches.length === 1 && this._dragging) {
        const t = e.touches[0];
        const [x, y] = this._localXY(t);
        const dx = x - this._dragStart[0];
        const dy = y - this._dragStart[1];
        if (Math.abs(dx) + Math.abs(dy) > 3) this._moved = true;
        this.r.view.x = this._viewStart[0] - dx / this.r.view.zoom;
        this.r.view.y = this._viewStart[1] - dy / this.r.view.zoom;
      } else if (e.touches.length === 2 && this._pinchStart) {
        const d = this._pinchDist(e.touches);
        this.r.view.zoom = Math.max(0.01, Math.min(20, this._pinchZoom * (d / this._pinchStart)));
      }
    }
    _onTouchEnd(e) {
      if (e.touches.length === 0) {
        // Synthesize click if no drag
        if (!this._moved && this._dragStart) {
          const s = this.r.pickSystem(this._dragStart[0], this._dragStart[1], 16);
          if (s) this.onSelect(s.id);
        }
        this._dragging = false;
        this._pinchStart = null;
      }
    }
    _pinchDist(touches) {
      const a = touches[0], b = touches[1];
      const dx = a.clientX - b.clientX;
      const dy = a.clientY - b.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }
  }

  /* =====================================================================
   *  UI  —  DOM panels (top bar, sidebar, bottom panel)
   * ===================================================================== */
  class UI {
    constructor(root, state, game) {
      this.root = root;          // container element
      this.state = state;
      this.game = game;
      this._build();
    }

    _build() {
      this.root.innerHTML = `
        <div class="ep-root">
          <header class="ep-topbar">
            <div class="ep-brand">⚡ ECLIPSE PROTOCOL</div>
            <div class="ep-turn-block">
              <div class="ep-turn-label">TURN</div>
              <div class="ep-turn-num" id="ep-turn-num">1</div>
            </div>
            <div class="ep-phase-block">
              <div class="ep-phase-label">PHASE</div>
              <div class="ep-phase-pills" id="ep-phase-pills"></div>
            </div>
            <div class="ep-controls">
              <button class="ep-btn" id="ep-btn-end-turn">End Turn ▶</button>
              <button class="ep-btn" id="ep-btn-save">Save</button>
              <button class="ep-btn" id="ep-btn-load">Load</button>
              <button class="ep-btn ep-danger" id="ep-btn-new">New</button>
            </div>
          </header>

          <div class="ep-main">
            <aside class="ep-sidebar" id="ep-sidebar"></aside>
            <div class="ep-canvas-wrap">
              <canvas id="ep-canvas"></canvas>
              <div class="ep-zoom-controls">
                <button class="ep-zbtn" id="ep-zin" title="Zoom in">+</button>
                <button class="ep-zbtn" id="ep-zout" title="Zoom out">−</button>
                <button class="ep-zbtn" id="ep-zfit" title="Fit galaxy">⌂</button>
              </div>
              <div class="ep-toast" id="ep-toast"></div>
            </div>
          </div>

          <footer class="ep-bottom" id="ep-bottom">
            <div class="ep-empty">Select a star system to inspect.</div>
          </footer>

          <div class="ep-eventlog" id="ep-eventlog"></div>
        </div>
      `;

      // Inject CSS.
      this._injectStyles();

      // Cache elements.
      this.elTurnNum    = this.root.querySelector('#ep-turn-num');
      this.elPhasePills = this.root.querySelector('#ep-phase-pills');
      this.elSidebar    = this.root.querySelector('#ep-sidebar');
      this.elBottom     = this.root.querySelector('#ep-bottom');
      this.elCanvas     = this.root.querySelector('#ep-canvas');
      this.elEventLog   = this.root.querySelector('#ep-eventlog');
      this.elToast      = this.root.querySelector('#ep-toast');

      // Wire buttons.
      this.root.querySelector('#ep-btn-end-turn').addEventListener('click', () => this.game.endTurn());
      this.root.querySelector('#ep-btn-save').addEventListener('click',     () => this.game.save());
      this.root.querySelector('#ep-btn-load').addEventListener('click',     () => this.game.load());
      this.root.querySelector('#ep-btn-new').addEventListener('click',      () => this.game.newGame());
      this.root.querySelector('#ep-zin').addEventListener('click',          () => this.game.zoomBy(1.3));
      this.root.querySelector('#ep-zout').addEventListener('click',         () => this.game.zoomBy(1 / 1.3));
      this.root.querySelector('#ep-zfit').addEventListener('click',         () => this.game.fitGalaxy());

      this._buildPhasePills();
    }

    _buildPhasePills() {
      this.elPhasePills.innerHTML = '';
      for (const p of PHASES) {
        const d = document.createElement('div');
        d.className = 'ep-pill';
        d.textContent = PHASE_LABEL[p];
        d.dataset.phase = p;
        d.addEventListener('click', () => { this.state.phase = p; this.update(); });
        this.elPhasePills.appendChild(d);
      }
    }

    _injectStyles() {
      if (document.getElementById('ep-styles')) return;
      const style = document.createElement('style');
      style.id = 'ep-styles';
      style.textContent = `
        .ep-root {
          position: fixed; inset: 0;
          display: grid;
          grid-template-rows: 56px 1fr 180px;
          grid-template-columns: 1fr;
          background: #05070f;
          color: #e2e8f0;
          font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
          overflow: hidden;
        }
        .ep-topbar {
          display: grid;
          grid-template-columns: auto auto 1fr auto;
          align-items: center;
          gap: 16px;
          padding: 0 16px;
          background: linear-gradient(90deg, #0b1220 0%, #111827 100%);
          border-bottom: 1px solid #1f2937;
          z-index: 5;
        }
        .ep-brand {
          font-weight: 700;
          letter-spacing: 2px;
          color: #fde68a;
          text-shadow: 0 0 8px rgba(253,230,138,0.4);
          font-size: 14px;
        }
        .ep-turn-block { display: flex; align-items: baseline; gap: 6px; }
        .ep-turn-label { font-size: 10px; color: #94a3b8; letter-spacing: 1px; }
        .ep-turn-num   { font-size: 20px; font-weight: 700; color: #fff; }
        .ep-phase-block { display: flex; align-items: center; gap: 8px; }
        .ep-phase-label { font-size: 10px; color: #94a3b8; letter-spacing: 1px; }
        .ep-phase-pills { display: flex; gap: 4px; }
        .ep-pill {
          padding: 3px 10px;
          border-radius: 10px;
          font-size: 10px;
          letter-spacing: 1px;
          background: #1e293b;
          color: #94a3b8;
          cursor: pointer;
          user-select: none;
          transition: all 0.15s;
        }
        .ep-pill.active {
          background: #fde68a;
          color: #0b1220;
          font-weight: 700;
          box-shadow: 0 0 12px rgba(253,230,138,0.5);
        }
        .ep-controls { display: flex; gap: 6px; }
        .ep-btn {
          padding: 6px 12px;
          background: #1e293b;
          color: #e2e8f0;
          border: 1px solid #334155;
          border-radius: 6px;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.15s;
          font-family: inherit;
        }
        .ep-btn:hover  { background: #334155; border-color: #475569; }
        .ep-btn:active { transform: translateY(1px); }
        .ep-btn.ep-danger { border-color: #7f1d1d; color: #fca5a5; }
        .ep-btn.ep-danger:hover { background: #7f1d1d; color: #fff; }

        .ep-main {
          display: grid;
          grid-template-columns: 280px 1fr;
          min-height: 0;
          position: relative;
        }
        .ep-sidebar {
          background: #0b1220;
          border-right: 1px solid #1f2937;
          padding: 12px;
          overflow-y: auto;
        }
        .ep-canvas-wrap {
          position: relative;
          overflow: hidden;
          background: #05070f;
        }
        #ep-canvas { display: block; width: 100%; height: 100%; cursor: grab; }
        #ep-canvas:active { cursor: grabbing; }

        .ep-zoom-controls {
          position: absolute;
          top: 12px;
          right: 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .ep-zbtn {
          width: 32px; height: 32px;
          background: rgba(15,23,42,0.85);
          border: 1px solid #334155;
          color: #e2e8f0;
          border-radius: 6px;
          cursor: pointer;
          font-size: 16px;
          line-height: 1;
        }
        .ep-zbtn:hover { background: #1e293b; }

        .ep-toast {
          position: absolute;
          bottom: 12px; left: 50%;
          transform: translateX(-50%) translateY(20px);
          background: rgba(15,23,42,0.92);
          border: 1px solid #60a5fa;
          color: #fff;
          padding: 8px 16px;
          border-radius: 6px;
          font-size: 13px;
          opacity: 0;
          pointer-events: none;
          transition: all 0.25s;
        }
        .ep-toast.show {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }

        .ep-bottom {
          background: #0b1220;
          border-top: 1px solid #1f2937;
          padding: 12px 16px;
          overflow-y: auto;
        }
        .ep-empty { color: #64748b; font-style: italic; }

        .ep-eventlog {
          position: absolute;
          left: 296px;
          bottom: 196px;
          width: 320px;
          max-height: 240px;
          background: rgba(11,18,32,0.88);
          border: 1px solid #1f2937;
          border-radius: 6px;
          padding: 8px;
          font-size: 11px;
          color: #94a3b8;
          overflow-y: auto;
          pointer-events: none;
        }
        .ep-eventlog .ep-evt {
          padding: 2px 0;
          border-bottom: 1px dashed #1f2937;
        }
        .ep-eventlog .ep-evt:last-child { border-bottom: none; }
        .ep-eventlog .ep-evt .ep-evt-turn {
          color: #fde68a; font-weight: 700; margin-right: 6px;
        }

        /* Sidebar content */
        .ep-sec { margin-bottom: 14px; }
        .ep-sec h3 {
          font-size: 11px;
          letter-spacing: 1.5px;
          color: #94a3b8;
          margin-bottom: 6px;
          text-transform: uppercase;
        }
        .ep-res-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }
        .ep-res {
          background: #111827;
          border: 1px solid #1f2937;
          border-radius: 6px;
          padding: 8px;
          display: flex;
          flex-direction: column;
        }
        .ep-res .ep-res-label {
          font-size: 10px;
          color: #94a3b8;
          letter-spacing: 1px;
        }
        .ep-res .ep-res-val {
          font-size: 16px;
          font-weight: 700;
          color: #fff;
          margin-top: 2px;
        }
        .ep-res.minerals .ep-res-val { color: #fbbf24; }
        .ep-res.energy   .ep-res-val { color: #60a5fa; }
        .ep-res.food     .ep-res-val { color: #6ee7b7; }
        .ep-res.tech     .ep-res-val { color: #c084fc; }
        .ep-res.credits  .ep-res-val { color: #fde68a; }

        .ep-tech-list { display: flex; flex-direction: column; gap: 4px; }
        .ep-tech {
          display: flex; justify-content: space-between; align-items: center;
          background: #111827; border: 1px solid #1f2937; border-radius: 6px;
          padding: 6px 8px; font-size: 11px;
        }
        .ep-tech.unlocked { border-color: #22c55e; }
        .ep-tech.active { border-color: #fde68a; }
        .ep-tech button {
          background: #1e3a8a; color: #dbeafe; border: none;
          padding: 3px 8px; border-radius: 4px; cursor: pointer;
          font-size: 10px;
        }
        .ep-tech button:hover { background: #2563eb; }
        .ep-tech button:disabled { background: #1f2937; color: #64748b; cursor: not-allowed; }

        /* Bottom panel */
        .ep-sys-detail {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 16px;
          height: 100%;
        }
        .ep-sys-info h2 {
          font-size: 18px;
          color: #fff;
          margin-bottom: 4px;
        }
        .ep-sys-meta {
          font-size: 12px;
          color: #94a3b8;
          margin-bottom: 8px;
        }
        .ep-sys-meta .ep-tag {
          display: inline-block;
          padding: 2px 8px;
          background: #1e293b;
          border-radius: 10px;
          margin-right: 4px;
          font-size: 10px;
          letter-spacing: 1px;
        }
        .ep-sys-resources {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 6px;
          margin-top: 8px;
        }
        .ep-sys-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 8px;
        }
        .ep-sys-actions .ep-btn { font-size: 11px; padding: 5px 10px; }
        .ep-sys-actions .ep-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .ep-gate-list {
          max-height: 110px;
          overflow-y: auto;
          background: #111827;
          border: 1px solid #1f2937;
          border-radius: 6px;
          padding: 6px;
          font-size: 11px;
        }
        .ep-gate {
          display: flex; justify-content: space-between;
          padding: 3px 6px;
          border-bottom: 1px dashed #1f2937;
          cursor: pointer;
        }
        .ep-gate:hover { background: #1e293b; }
        .ep-gate:last-child { border-bottom: none; }

        /* Responsive: tablet & narrow viewports */
        @media (max-width: 900px) {
          .ep-root { grid-template-rows: 56px 1fr 220px; }
          .ep-main { grid-template-columns: 220px 1fr; }
          .ep-brand { font-size: 12px; }
          .ep-controls .ep-btn { padding: 5px 8px; font-size: 11px; }
          .ep-eventlog { left: 236px; width: 240px; bottom: 236px; max-height: 200px; }
          .ep-sidebar { padding: 8px; }
          .ep-sys-detail { grid-template-columns: 1fr; }
        }
        @media (max-width: 600px) {
          .ep-main { grid-template-columns: 1fr; }
          .ep-sidebar { display: none; }
        }
      `;
      document.head.appendChild(style);
    }

    toast(msg, duration = 2200) {
      this.elToast.textContent = msg;
      this.elToast.classList.add('show');
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => this.elToast.classList.remove('show'), duration);
    }

    update() {
      this._renderTopbar();
      this._renderSidebar();
      this._renderBottom();
      this._renderEventLog();
    }

    _renderTopbar() {
      this.elTurnNum.textContent = this.state.turn;
      const pills = this.elPhasePills.children;
      for (let i = 0; i < pills.length; i++) {
        pills[i].classList.toggle('active', pills[i].dataset.phase === this.state.phase);
      }
    }

    _renderSidebar() {
      const f = this.state.player();
      if (!f) { this.elSidebar.innerHTML = ''; return; }
      const tt = this.state.techTree;
      const unlockedCount = f.unlockedTechs.size;
      const ownedCount = f.ownedSystems.size;

      const html = `
        <div class="ep-sec">
          <h3>Empire</h3>
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
            <div style="width:14px; height:14px; border-radius:50%; background:${f.color}; box-shadow:0 0 8px ${f.color};"></div>
            <div style="font-weight:700; color:#fff;">${f.name}</div>
          </div>
          <div style="font-size:11px; color:#94a3b8;">
            Systems owned: <span style="color:#fff;">${ownedCount}</span><br>
            Techs unlocked: <span style="color:#fff;">${unlockedCount}</span>
          </div>
        </div>

        <div class="ep-sec">
          <h3>Resources</h3>
          <div class="ep-res-grid">
            <div class="ep-res minerals"><div class="ep-res-label">MINERALS</div><div class="ep-res-val">${f.resources.minerals}</div></div>
            <div class="ep-res energy"><div class="ep-res-label">ENERGY</div><div class="ep-res-val">${f.resources.energy}</div></div>
            <div class="ep-res food"><div class="ep-res-label">FOOD</div><div class="ep-res-val">${f.resources.food}</div></div>
            <div class="ep-res tech"><div class="ep-res-label">TECH</div><div class="ep-res-val">${f.resources.tech}</div></div>
          </div>
        </div>

        <div class="ep-sec">
          <h3>Research</h3>
          ${f.activeResearch ? `
            <div style="font-size:11px; color:#fde68a; margin-bottom:6px;">
              Studying: ${tt.get(f.activeResearch.techId)?.name || '—'}
              <div style="background:#1e293b; height:6px; border-radius:3px; margin-top:3px; overflow:hidden;">
                <div style="background:#fde68a; height:100%; width:${Math.min(100, (f.activeResearch.progress / tt.get(f.activeResearch.techId)?.cost) * 100).toFixed(1)}%;"></div>
              </div>
            </div>
          ` : '<div style="font-size:11px; color:#94a3b8; margin-bottom:6px;">No active research.</div>'}
          <div class="ep-tech-list" id="ep-tech-list"></div>
        </div>

        <div class="ep-sec">
          <h3>Other Factions</h3>
          ${this.state.factions.filter(x => x.id !== f.id).map(x => `
            <div style="display:flex; align-items:center; gap:6px; padding:4px 0; font-size:11px;">
              <div style="width:10px; height:10px; border-radius:50%; background:${x.color};"></div>
              <div style="flex:1; color:${x.alive ? '#e2e8f0' : '#64748b'};">${x.name}${x.alive ? '' : ' (defeated)'}</div>
              <div style="color:#94a3b8;">${x.ownedSystems.size}</div>
            </div>
          `).join('')}
        </div>
      `;
      this.elSidebar.innerHTML = html;
      // Wire tech buttons
      const techListEl = this.elSidebar.querySelector('#ep-tech-list');
      const renderable = tt.techs.filter(t =>
        t.era <= 2 || f.unlockedTechs.has(t.prereq?.[0] || '')
      ).slice(0, 10);
      for (const t of renderable) {
        const row = document.createElement('div');
        const isUnlocked = f.unlockedTechs.has(t.id);
        const isActive = f.activeResearch?.techId === t.id;
        const canStart = !isUnlocked && !f.activeResearch && tt.canUnlock(t.id, f.unlockedTechs);
        row.className = 'ep-tech' + (isUnlocked ? ' unlocked' : '') + (isActive ? ' active' : '');
        row.innerHTML = `
          <div>
            <div style="color:#fff; font-weight:600;">${t.name}</div>
            <div style="color:#64748b; font-size:10px;">Era ${t.era} · Cost ${t.cost}</div>
          </div>
          <div>
            ${isUnlocked ? '<span style="color:#22c55e; font-size:10px;">✓ DONE</span>'
              : isActive ? '<span style="color:#fde68a; font-size:10px;">···</span>'
              : `<button ${canStart ? '' : 'disabled'} data-tech="${t.id}">Research</button>`}
          </div>
        `;
        const btn = row.querySelector('button');
        if (btn) btn.addEventListener('click', () => {
          if (this.state.startResearch(f.id, t.id)) {
            this.game.update();
            this.toast(`Researching ${t.name}`);
          }
        });
        techListEl.appendChild(row);
      }
    }

    _renderBottom() {
      if (this.state.selectedSystemId == null) {
        this.elBottom.innerHTML = '<div class="ep-empty">Select a star system to inspect.</div>';
        return;
      }
      const s = this.state.galaxy.get(this.state.selectedSystemId);
      if (!s) {
        this.elBottom.innerHTML = '<div class="ep-empty">System not found.</div>';
        return;
      }
      const owner = s.owner != null ? this.state.factions.find(f => f.id === s.owner) : null;
      const isPlayer = s.owner === this.state.playerFactionId;
      const reachable = this._reachableFromPlayer();
      const ownedReachable = this._ownedReachableFromPlayer();
      const isReachable = reachable.has(s.id);
      const canClaim = ownedReachable.has(s.id);

      // Cost to travel here = BFS cost
      let travelCost = 0;
      if (isReachable) {
        const costMap = this._travelCostFromPlayer();
        travelCost = costMap.get(s.id) || 0;
      }

      const stationLabel = ['None', 'Outpost', 'Colony', 'Citadel'][s.stationLevel] || 'None';
      const actions = [];
      if (isPlayer) {
        if (s.stationLevel < 3) {
          const cost = 50 * (s.stationLevel + 1);
          actions.push(`<button class="ep-btn" data-act="upgrade" ${this.state.player().resources.credits >= cost ? '' : 'disabled'}>Upgrade (${cost}cr)</button>`);
        }
        actions.push(`<button class="ep-btn ep-danger" data-act="abandon">Abandon</button>`);
      } else if (!owner && s.discovered && s.type !== 'black_hole' && s.type !== 'anomaly' && canClaim) {
        const canColonize = s.type === 'habitable' || s.type === 'desert' || s.type === 'ice' || s.type === 'asteroid';
        const playerHasTerraforming = this.state.player().unlockedTechs.has('terraforming');
        const tfOk = (s.type !== 'desert' && s.type !== 'ice') || playerHasTerraforming;
        actions.push(`<button class="ep-btn" data-act="colonize" ${(canColonize && tfOk) ? '' : 'disabled'}>Colonize</button>`);
      }

      // Show exploration action for undiscovered player-reachable systems.
      if (!s.discovered && isReachable) {
        actions.unshift(`<button class="ep-btn" data-act="explore">Send Probe</button>`);
      }

      const gates = s.gates.map(g => {
        const n = this.state.galaxy.get(g.to);
        if (!n) return '';
        const ownerTag = n.owner != null ? ` <span style="color:${this.state.factions.find(f=>f.id===n.owner)?.color};">●</span>` : '';
        return `<div class="ep-gate" data-gate="${n.id}">
          <span>${ownerTag} ${n.name}</span>
          <span style="color:#94a3b8;">${g.cost}cr</span>
        </div>`;
      }).join('');

      const typeMeta = SYSTEM_TYPES[s.type.toUpperCase()] || SYSTEM_TYPES.STAR;

      this.elBottom.innerHTML = `
        <div class="ep-sys-detail">
          <div class="ep-sys-info">
            <h2>${s.name}</h2>
            <div class="ep-sys-meta">
              <span class="ep-tag" style="background:${typeMeta.color}22; color:${typeMeta.color};">${typeMeta.label}</span>
              <span class="ep-tag">Station: ${stationLabel}</span>
              ${owner ? `<span class="ep-tag" style="background:${owner.color}22; color:${owner.color};">${owner.name}</span>` : '<span class="ep-tag">Factionless</span>'}
              ${s.discovered ? '' : '<span class="ep-tag" style="background:#7f1d1d22; color:#fca5a5;">Unexplored</span>'}
            </div>
            <div style="font-size:11px; color:#94a3b8;">
              Population: <span style="color:#fff;">${s.population}</span> /
              <span style="color:#fff;">${s.basePopulation + this._popCapBonus(s)}</span>
              <br>Coords: (${s.x.toFixed(1)}, ${s.y.toFixed(1)})
              ${isReachable ? `<br>Travel cost from home: <span style="color:#fde68a;">${travelCost}cr</span>` : '<br><span style="color:#fca5a5;">Unreachable</span>'}
            </div>
            <div class="ep-sys-resources">
              <div class="ep-res minerals"><div class="ep-res-label">MIN</div><div class="ep-res-val">${s.resources.minerals}</div></div>
              <div class="ep-res energy"><div class="ep-res-label">EN</div><div class="ep-res-val">${s.resources.energy}</div></div>
              <div class="ep-res food"><div class="ep-res-label">FD</div><div class="ep-res-val">${s.resources.food}</div></div>
              <div class="ep-res tech"><div class="ep-res-label">TC</div><div class="ep-res-val">${s.resources.tech}</div></div>
            </div>
            <div class="ep-sys-actions">
              ${actions.join('')}
            </div>
          </div>

          <div>
            <h3 style="font-size:11px; letter-spacing:1.5px; color:#94a3b8; margin-bottom:6px;">JUMP GATES (${s.gates.length})</h3>
            <div class="ep-gate-list">${gates || '<div style="color:#64748b; font-style:italic; padding:8px;">No gates — isolated.</div>'}</div>
          </div>

          <div>
            <h3 style="font-size:11px; letter-spacing:1.5px; color:#94a3b8; margin-bottom:6px;">QUICK INFO</h3>
            <div style="font-size:11px; line-height:1.7; color:#cbd5e1;">
              ${s.discovered
                ? `Survey data on file. Resource yield × ${[1, 1.25, 1.6, 2.0][s.stationLevel] || 1} at current tier.`
                : 'No survey data. Send a probe to reveal this system.'}
              <br><br>
              <span style="color:#94a3b8;">Tips:</span><br>
              • Colonize habitable worlds early for food.<br>
              • Asteroid belts = minerals.<br>
              • Anomalies & black holes = tech/energy but no population.
            </div>
          </div>
        </div>
      `;

      // Wire actions.
      this.elBottom.querySelectorAll('[data-act]').forEach(b => {
        b.addEventListener('click', () => this.game.systemAction(s.id, b.dataset.act));
      });
      this.elBottom.querySelectorAll('[data-gate]').forEach(g => {
        g.addEventListener('click', () => {
          this.state.selectedSystemId = parseInt(g.dataset.gate, 10);
          this.game.update();
          this.game.centerOnSelected();
        });
      });
    }

    _popCapBonus(sys) {
      let bonus = 0;
      const f = this.state.player();
      if (f && f.unlockedTechs.has('cybernetics')) bonus += 100;
      return bonus;
    }

    _reachableFromPlayer() {
      const f = this.state.player();
      if (!f) return new Set();
      // Walk through any system — the player can SEE neighboring systems,
      // even enemy ones, but the colonize action will re-validate reachability
      // via owned-only BFS before allowing it.
      const seen = new Set();
      for (const id of f.ownedSystems) seen.add(id);
      const queue = Array.from(f.ownedSystems);
      while (queue.length) {
        const id = queue.shift();
        const s = this.state.galaxy.get(id);
        if (!s) continue;
        for (const g of s.gates) {
          if (seen.has(g.to)) continue;
          seen.add(g.to);
          queue.push(g.to);
        }
      }
      return seen;
    }

    /** Owned-only BFS — returns ids reachable via your own empire's gates. */
    _ownedReachableFromPlayer() {
      const f = this.state.player();
      const seen = new Set();
      if (!f) return seen;
      for (const id of f.ownedSystems) seen.add(id);
      const queue = Array.from(f.ownedSystems);
      while (queue.length) {
        const id = queue.shift();
        const s = this.state.galaxy.get(id);
        if (!s || s.owner !== f.id) continue;
        for (const g of s.gates) {
          if (seen.has(g.to)) continue;
          const n = this.state.galaxy.get(g.to);
          if (!n) continue;
          seen.add(g.to);
          // Continue expanding only through systems we own
          if (n.owner === f.id) queue.push(g.to);
        }
      }
      return seen;
    }

    _travelCostFromPlayer() {
      const f = this.state.player();
      const costs = new Map();
      if (!f) return costs;
      // Dijkstra on player-owned + connected nodes
      const dist = new Map();
      for (const id of f.ownedSystems) dist.set(id, 0);
      const queue = Array.from(f.ownedSystems).map(id => ({ id, cost: 0 }));
      while (queue.length) {
        const { id, cost } = queue.shift();
        const s = this.state.galaxy.get(id);
        if (!s) continue;
        for (const g of s.gates) {
          const newCost = cost + g.cost;
          if (newCost < (dist.get(g.to) ?? Infinity)) {
            dist.set(g.to, newCost);
            queue.push({ id: g.to, cost: newCost });
          }
        }
      }
      return dist;
    }

    _renderEventLog() {
      const last = this.state.events.slice(-12).reverse();
      this.elEventLog.innerHTML = last.map(e =>
        `<div class="ep-evt"><span class="ep-evt-turn">T${e.turn}</span>${e.message}</div>`
      ).join('') || '<div style="color:#64748b;">No events yet.</div>';
    }
  }

  /* =====================================================================
   *  Game  —  orchestrator
   * ===================================================================== */
  class Game {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.opts = Object.assign({
        seed: Math.floor(Math.random() * 1e9),
        systemCount: 10000,
        factionCount: 4
      }, opts);
      this.state = null;
      this.renderer = null;
      this.input = null;
      this.ui = null;
      this.rafId = null;
    }

    newGame(opts = {}) {
      const o = Object.assign({}, this.opts, opts);
      const gen = new GalaxyGenerator({
        seed: o.seed,
        systemCount: o.systemCount
      });
      const { systems, homeIds } = gen.generate();
      const galaxy = new Galaxy(systems, homeIds);
      const gates = new GateNetwork(galaxy);
      gates.build();

      const state = new GameState();
      state.seed = o.seed;
      state.galaxy = galaxy;
      state.gateNetwork = gates;

      // Faction creation: 1 player + N AI.
      const factions = [];
      const player = new Faction({
        id: 'player',
        name: 'Terran Confederacy',
        color: FACTION_COLORS[0],
        isPlayer: true,
        personality: 'balanced',
        ownedSystems: [...homeIds],
        minerals: 200, energy: 200, food: 100, tech: 50, credits: 100
      });
      factions.push(player);
      const personalities = ['aggressive', 'scientist', 'expansionist', 'balanced'];
      const names = ['Vorlax Imperium', 'Aurelian Concord', 'Drakari Syndicate', 'Helion Republic'];
      for (let i = 0; i < o.factionCount - 1; i++) {
        // AI home: pick a random habitable system far from player.
        const far = systems
          .filter(s => s.type === 'habitable' && !homeIds.includes(s.id))
          .map(s => ({ s, d: Math.hypot(s.x, s.y) }))
          .sort((a, b) => b.d - a.d);
        const homePool = far.slice(0, 60);
        const home = (homePool.length ? gen.rng.pick(homePool) : far[0]).s;
        factions.push(new Faction({
          id: 'ai_' + i,
          name: names[i] || `AI Faction ${i + 1}`,
          color: FACTION_COLORS[(i + 1) % FACTION_COLORS.length],
          isPlayer: false,
          personality: personalities[i % personalities.length],
          ownedSystems: [home.id],
          minerals: 150, energy: 150, food: 80, tech: 30, credits: 60
        }));
        home.owner = 'ai_' + i;
        home.discovered = true;
        home.stationLevel = 1;
      }
      // Mark player home as discovered & starter colony.
      for (const id of homeIds) {
        const s = galaxy.get(id);
        s.discovered = true;
        s.explored = true;
        s.stationLevel = Math.max(s.stationLevel, 2);
      }
      // Guarantee the player starts with a contiguous empire: if the home
      // systems aren't already connected via a path of player-owned gates,
      // claim the best bridge system(s) between them so the player can move
      // and colonize from day 1.
      this._ensurePlayerConnectivity(player, galaxy);
      state.factions = factions;
      state.playerFactionId = 'player';
      state.addEvent('intro', `Welcome, Commander. The ${factions[0].name} controls ${homeIds.length} system(s).`);
      state.addEvent('intro', `${factions.length - 1} rival empire(s) detected across the galaxy.`);

      this.state = state;
      this._wire();
      this.renderer.centerOnGalaxy();
      // Center on player home at start.
      if (homeIds.length) this.renderer.centerOnSystem(homeIds[0]);
      this.update();
      this._loop();
    }

    /** Ensure all player-owned homes are mutually reachable through the
     *  player's own gate network. If not, claim a small chain of bridge
     *  systems so the empire is contiguous from turn 1. */
    _ensurePlayerConnectivity(player, galaxy) {
      const owned = Array.from(player.ownedSystems);
      if (owned.length < 2) return;
      // Dijkstra over owned + unowned (treat unowned as traversable but
      // stop expanding at them). Returns Map<id, prevId> for the shortest
      // owned-rooted path.
      const prev = new Map();
      const dist = new Map();
      for (const id of owned) { prev.set(id, null); dist.set(id, 0); }
      // Multi-source BFS
      const queue = [...owned];
      while (queue.length) {
        const id = queue.shift();
        const s = galaxy.get(id);
        if (!s) continue;
        const d = dist.get(id);
        // Expand only through player-owned systems
        if (s.owner !== player.id) continue;
        for (const g of s.gates) {
          if (dist.has(g.to)) continue;
          dist.set(g.to, d + 1);
          prev.set(g.to, id);
          queue.push(g.to);
        }
      }
      // For each pair of owned homes, check if they're connected through
      // owned nodes already. If any are not, claim the bridge nodes along
      // the BFS shortest path between the closest pair.
      const reachable = (id) => {
        const seen = new Set([id]);
        const q = [id];
        while (q.length) {
          const cur = q.shift();
          const ss = galaxy.get(cur);
          if (!ss || ss.owner !== player.id) continue;
          for (const g of ss.gates) {
            if (seen.has(g.to)) continue;
            seen.add(g.to);
            q.push(g.to);
          }
        }
        return seen;
      };
      for (const id of owned) {
        const r = reachable(id);
        for (const other of owned) {
          if (other === id) continue;
          if (r.has(other)) continue;
          // Not connected. Find shortest path between them through ANY gates,
          // then claim intermediate nodes for the player.
          const path = this._bfsShortestPath(galaxy, id, other);
          if (!path) continue;
          for (const pid of path.slice(1, -1)) { // exclude endpoints
            const ps = galaxy.get(pid);
            if (ps.owner === null) {
              ps.owner = player.id;
              ps.discovered = true;
              ps.stationLevel = 1;
              player.ownedSystems.add(pid);
            }
          }
          break; // re-evaluate connectivity on next outer loop
        }
      }
    }

    /** BFS returning the shortest gate-path from start to goal (any nodes). */
    _bfsShortestPath(galaxy, startId, goalId) {
      if (startId === goalId) return [startId];
      const prev = new Map();
      const seen = new Set([startId]);
      const queue = [startId];
      while (queue.length) {
        const id = queue.shift();
        if (id === goalId) {
          const path = [id];
          let cur = id;
          while (prev.has(cur)) { cur = prev.get(cur); path.push(cur); }
          return path.reverse();
        }
        const s = galaxy.get(id);
        if (!s) continue;
        for (const g of s.gates) {
          if (seen.has(g.to)) continue;
          seen.add(g.to);
          prev.set(g.to, id);
          queue.push(g.to);
        }
      }
      return null;
    }
    load() {
      const gs = GameState.load();
      if (!gs) { this.ui && this.ui.toast('No saved game.'); return false; }
      this.state = gs;
      // Rebuild runtime-only objects.
      this.state.gateNetwork = new GateNetwork(gs.galaxy);
      this._wire();
      this.update();
      this._loop();
      this.ui && this.ui.toast('Game loaded.');
      return true;
    }

    save() {
      if (!this.state) return;
      const ok = this.state.save();
      this.ui && this.ui.toast(ok ? 'Game saved.' : 'Save failed.');
    }

    /** Hook up renderer + UI + input. Called after state is set. */
    _wire() {
      if (!this.renderer) {
        this.renderer = new Renderer(this.canvas, this.state);
      } else {
        this.renderer.state = this.state;
      }
      // Ensure canvas fills its container.
      this._fitCanvas();
      if (!this.ui) {
        // Build UI overlay into the canvas's parent.
        const parent = this.canvas.parentElement;
        this.ui = new UI(parent, this.state, this);
      } else {
        this.ui.state = this.state;
        this.ui.game = this;
        this.ui.update();
      }
      if (!this.input) {
        this.input = new InputController(this.canvas, this.renderer, this.state, (id) => this.selectSystem(id));
      } else {
        this.input.state = this.state;
      }
      // Bind UI buttons (they reference game)
      this._bindUI();
    }

    _fitCanvas() {
      // Make canvas fill its wrapper.
      const wrap = this.canvas.parentElement;
      if (wrap) {
        const r = wrap.getBoundingClientRect();
        this.canvas.style.width = r.width + 'px';
        this.canvas.style.height = r.height + 'px';
      }
      this.renderer._resize();
    }

    _bindUI() {
      // UI buttons were wired in UI._build, but they reference this.game,
      // which is set during _wire. Confirm phase pills re-bind:
      const pills = this.ui.elPhasePills.children;
      for (let i = 0; i < pills.length; i++) {
        const p = pills[i].dataset.phase;
        pills[i].onclick = () => { this.state.phase = p; this.update(); };
      }
    }

    _loop = () => {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      const tick = () => {
        if (!this.state || this.state.gameOver) return;
        this.renderer.render();
        this.rafId = requestAnimationFrame(tick);
      };
      tick();
    }

    update() {
      if (this.ui) this.ui.update();
      if (this.renderer) this.renderer.render();
    }

    selectSystem(id) {
      this.state.selectedSystemId = id;
      this.update();
    }
    centerOnSelected() {
      if (this.state.selectedSystemId != null && this.renderer) {
        this.renderer.centerOnSystem(this.state.selectedSystemId);
        this.renderer.render();
      }
    }
    zoomBy(f) {
      this.renderer.view.zoom = Math.max(0.01, Math.min(20, this.renderer.view.zoom * f));
      this.renderer.render();
    }
    fitGalaxy() {
      this.renderer.centerOnGalaxy();
      this.renderer.render();
    }

    endTurn() {
      this.state.advanceTurn();
      // AI moves: simple — each AI colonizes a reachable uninhabited system
      // if it has resources, and starts research.
      this._aiTurn();
      this.state.addEvent('turn', `— Turn ${this.state.turn} begins —`);
      // Win check
      if (this._checkWin()) return;
      this.update();
    }

    _checkWin() {
      const f = this.state.player();
      if (f.unlockedTechs.has('ascension_protocol')) {
        this.state.gameOver = true;
        this.state.gameWon = true;
        this.state.addEvent('win', '✦ ASCENSION PROTOCOL complete. Your civilization transcends.');
        this.update();
        this._showWinModal();
        return true;
      }
      // Defeat check — no systems left.
      if (f.ownedSystems.size === 0) {
        this.state.gameOver = true;
        this.state.addEvent('lose', 'Your last colony has fallen. The galaxy moves on.');
        this.update();
        return true;
      }
      return false;
    }

    _showWinModal() {
      const div = document.createElement('div');
      div.style.cssText = `
        position: fixed; inset: 0; background: rgba(0,0,0,0.85);
        display: flex; align-items: center; justify-content: center;
        z-index: 1000; color: #fde68a; font-family: system-ui, sans-serif;
      `;
      div.innerHTML = `
        <div style="background:#0b1220; border:1px solid #fde68a; border-radius:12px; padding:32px; text-align:center; max-width:480px;">
          <div style="font-size:48px;">✦</div>
          <h1 style="font-size:28px; margin:12px 0; color:#fde68a;">ECLIPSE PROTOCOL</h1>
          <p style="color:#cbd5e1; margin-bottom:16px;">Your civilization has ascended. The stars belong to you.</p>
          <p style="color:#94a3b8; font-size:13px;">Final turn: ${this.state.turn} · Systems: ${f.ownedSystems.size} · Techs: ${f.unlockedTechs.size}</p>
          <button id="ep-win-new" style="margin-top:20px; padding:10px 24px; background:#fde68a; color:#0b1220; border:none; border-radius:6px; cursor:pointer; font-weight:700;">New Game</button>
        </div>
      `;
      document.body.appendChild(div);
      div.querySelector('#ep-win-new').addEventListener('click', () => {
        div.remove();
        this.newGame();
      });
    }

    _aiTurn() {
      const player = this.state.player();
      for (const f of this.state.factions) {
        if (f.isPlayer || !f.alive) continue;
        // Start research if idle and can afford an era-1 tech.
        if (!f.activeResearch) {
          const candidates = this.state.techTree.techs
            .filter(t => this.state.techTree.canUnlock(t.id, f.unlockedTechs));
          if (candidates.length) {
            const pick = candidates[Math.floor(Math.random() * candidates.length)];
            this.state.startResearch(f.id, pick.id);
          }
        }
        // Expansion: if has spare resources, colonize a reachable uninhabited system.
        if (f.resources.energy > 20 && f.resources.food > 10) {
          const reachable = this.state.galaxy.bfs(
            Array.from(f.ownedSystems)[0],
            { faction: f.id, ownedOnly: true }
          );
          const targets = [];
          for (const [id, hops] of reachable) {
            if (hops === 0 || hops > 3) continue;
            const s = this.state.galaxy.get(id);
            if (!s || s.owner != null) continue;
            if (s.type === 'habitable' || s.type === 'asteroid') {
              targets.push(s);
            }
          }
          if (targets.length) {
            const choice = targets[Math.floor(Math.random() * targets.length)];
            choice.owner = f.id;
            choice.stationLevel = 1;
            choice.discovered = true;
            f.ownedSystems.add(choice.id);
            f.resources.energy -= 20;
            f.resources.food -= 10;
            this.state.addEvent('ai', `${f.name} colonized ${choice.name}`);
          }
        }
        // Aggressive personalities may claim a system adjacent to the player.
        if (f.personality === 'aggressive' && Math.random() < 0.15) {
          const playerSys = Array.from(player.ownedSystems);
          if (playerSys.length) {
            const seed = playerSys[Math.floor(Math.random() * playerSys.length)];
            const neighbors = (this.state.galaxy.get(seed)?.gates || [])
              .map(g => this.state.galaxy.get(g.to))
              .filter(n => n && n.owner === null);
            if (neighbors.length) {
              const target = neighbors[Math.floor(Math.random() * neighbors.length)];
              target.owner = f.id;
              target.stationLevel = 1;
              target.discovered = true;
              f.ownedSystems.add(target.id);
              this.state.addEvent('ai', `${f.name} established a foothold at ${target.name}`);
            }
          }
        }
      }
    }

    /** Handle system-action buttons (colonize / abandon / upgrade / explore). */
    systemAction(systemId, act) {
      const s = this.state.galaxy.get(systemId);
      if (!s) return;
      const f = this.state.player();
      switch (act) {
        case 'explore': {
          // Cost: 10 energy, 5 credits. Reveals system fully.
          if (f.resources.energy < 10) { this.ui.toast('Not enough energy.'); return; }
          f.resources.energy -= 10;
          s.discovered = true;
          s.explored = true;
          this.state.addEvent('explore', `Probe survey of ${s.name} complete.`);
          this.ui.toast(`Surveyed ${s.name}.`);
          this.update();
          break;
        }
        case 'colonize': {
          if (s.owner != null) return;
          if (f.resources.energy < 30 || f.resources.food < 20) {
            this.ui.toast('Need 30 energy + 20 food to colonize.'); return;
          }
          f.resources.energy -= 30;
          f.resources.food -= 20;
          s.owner = f.id;
          s.stationLevel = 1;
          s.discovered = true;
          f.ownedSystems.add(s.id);
          this.state.addEvent('colonize', `${f.name} established ${s.name} Colony.`);
          this.ui.toast(`Colonized ${s.name}!`);
          this.update();
          break;
        }
        case 'upgrade': {
          const cost = 50 * (s.stationLevel + 1);
          if (f.resources.credits < cost) { this.ui.toast('Not enough credits.'); return; }
          f.resources.credits -= cost;
          s.stationLevel++;
          this.state.addEvent('build', `${s.name} upgraded to tier ${s.stationLevel}.`);
          this.ui.toast(`Upgraded ${s.name}!`);
          this.update();
          break;
        }
        case 'abandon': {
          if (s.owner !== f.id) return;
          s.owner = null;
          s.stationLevel = 0;
          f.ownedSystems.delete(s.id);
          this.state.addEvent('abandon', `${f.name} abandoned ${s.name}.`);
          this.ui.toast(`Abandoned ${s.name}.`);
          this.update();
          break;
        }
      }
    }
  }

  /* =====================================================================
   *  Public bootstrap
   * ===================================================================== */
  function start(canvasOrSelector, opts) {
    const canvas = typeof canvasOrSelector === 'string'
      ? document.querySelector(canvasOrSelector)
      : canvasOrSelector;
    if (!canvas) throw new Error('Eclipse Protocol: canvas not found.');

    // The host page must provide a sized parent for the canvas.
    // We'll create our own overlay UI inside that parent.
    let parent = canvas.parentElement;
    if (!parent) throw new Error('Canvas must be attached to the DOM first.');
    // Ensure parent is positioned.
    if (getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }
    parent.style.width = parent.style.width || '100%';
    parent.style.height = parent.style.height || '100%';

    const game = new Game(canvas, opts);
    // Try to load a save; otherwise start fresh.
    if (!game.load()) game.newGame();
    return game;
  }

  // Expose
  window.Eclipse = {
    start,
    // Submodules exposed for advanced users / unit tests
    PRNG, GalaxyGenerator, GateNetwork, Galaxy, SpatialIndex,
    TechTree, Faction, GameState, Renderer, InputController, UI, Game
  };
})();
