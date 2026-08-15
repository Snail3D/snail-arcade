// ═══════════════════════════════════════════════════════════════════
// Snail Arcade — hand-crafted SVG game icons
// Each icon is a 24×24 line icon using `currentColor` so it adapts to
// any theme (snail3d.com neon, arcade green, etc.).
// Keyed by game slug. `gameIcon(slug)` returns the SVG markup.
// ═══════════════════════════════════════════════════════════════════

const GAME_ICONS = {
  "arcade": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="3"/><path d="M7 10h2M7 13h2"/><circle cx="15" cy="11" r="1.5"/><path d="M15 13l2 2"/></svg>`,

  "rock-paper-scissors": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="18" r="2.5"/><rect x="16" y="15.5" width="4" height="4" rx="1"/><circle cx="10" cy="8" r="1.5"/><circle cx="14" cy="8" r="1.5"/><path d="M10 8l-2 8M14 8l2 8"/></svg>`,

  "pool-billiards": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><path d="M12 4v-1M12 20v1"/></svg>`,

  "tower-defense": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3h8v18H8z"/><path d="M8 3l-2 2M16 3l2 2"/><circle cx="12" cy="10" r="2"/><path d="M8 15h8"/></svg>`,

  "neon-beats": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="3" height="6" rx="1"/><rect x="9" y="6" width="3" height="12" rx="1"/><rect x="14" y="8" width="3" height="10" rx="1"/><rect x="19" y="12" width="3" height="4" rx="1"/></svg>`,

  "dungeon-crawl": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l2 2-2 2-2-2 2-2z"/><path d="M12 8v8"/><path d="M9 16h6"/><path d="M6 20h12"/></svg>`,

  "farming-sim": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20v-8"/><path d="M12 12c-3 0-4-2-4-4 2 0 4 1 4 4z"/><path d="M12 12c3 0 4-2 4-4-2 0-4 1-4 4z"/></svg>`,

  "neon-pinball": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 18l2-3M18 18l-2-3"/></svg>`,

  "neon-gems": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h12l3 4-9 12L3 8l3-4z"/><path d="M3 8h18"/></svg>`,

  "card-combat": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="4" width="10" height="14" rx="1.5"/><rect x="9" y="6" width="10" height="14" rx="1.5"/><path d="M12 10l1.5 1.5L12 13l-1.5-1.5L12 10z"/></svg>`,

  "stealth-infiltrator": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12c2-4 6-6 9-6s7 2 9 6c-2 4-6 6-9 6s-7-2-9-6z"/><circle cx="12" cy="12" r="2"/></svg>`,

  "terminal-hack": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M7 9l2 2-2 2M12 13h4"/></svg>`,

  "neon-datesim": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20c-4-3-8-5-8-9a4 4 0 018-4 4 4 0 018 4c0 4-4 6-8 9z"/></svg>`,

  "echo-protocol": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="2"/><path d="M8 8a6 6 0 018 0M5 5a10 10 0 0114 0"/></svg>`,

  "snail-racer": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 9a4 4 0 010 8 4 4 0 01-4-4 3 3 0 013-3"/><path d="M11 13H7"/><path d="M7 3v8M7 3l4 2-4 2"/></svg>`,

  "conveyor-crush": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="10" width="18" height="3" rx="1"/><circle cx="6" cy="13" r="1.5"/><circle cx="12" cy="13" r="1.5"/><circle cx="18" cy="13" r="1.5"/><rect x="8" y="4" width="4" height="4" rx="1"/></svg>`,

  "neon-pong": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="2" height="8"/><rect x="19" y="8" width="2" height="8"/><circle cx="12" cy="12" r="2"/><path d="M12 4v2M12 18v2"/></svg>`,

  "bed-blaster": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="16" width="16" height="3" rx="1"/><path d="M12 4v6"/><circle cx="12" cy="11" r="2"/><path d="M8 16h8"/></svg>`,

  "subscriber-surge": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M10 9l5 3-5 3z"/></svg>`,

  "context-collapse": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="6" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="18" cy="12" r="2"/><circle cx="12" cy="18" r="2"/><path d="M12 8v2M6 14v2M18 14v2M12 16v2"/></svg>`,

  "snail-snake": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8c3 0 3 4 6 4s3-4 6-4"/><circle cx="17" cy="8" r="1.5"/><path d="M5 8v8"/></svg>`,

  "space-invaders": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 5h10l2 4-2 4H7L5 9l2-4z"/><path d="M7 13h10M8 15h8"/></svg>`,

  "hang-on": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="16" r="2"/><circle cx="16" cy="16" r="2"/><path d="M6 16h10l2-6H8z"/><path d="M8 10H5"/><path d="M5 4v6"/></svg>`,

  "donkey-kong-mobile": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 8c0-2 2-3 4-3s4 1 4 3v8c0 2-2 3-4 3s-4-1-4-3V8z"/><path d="M8 8h8"/></svg>`,

  "battleship-blitz": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 16l3-4h10l3 4H4z"/><path d="M6 16v2M10 16v2M14 16v2M18 16v2"/><path d="M12 12V8"/></svg>`,

  "tetris": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="5" height="5"/><rect x="9" y="4" width="5" height="5"/><rect x="9" y="9" width="5" height="5"/><rect x="14" y="9" width="5" height="5"/></svg>`,

  "notblast": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="6" height="6"/><rect x="10" y="4" width="6" height="6"/><rect x="4" y="10" width="6" height="6"/><rect x="10" y="10" width="6" height="6"/></svg>`,

  "hot-solder-station": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M12 6v4M12 14v4M6 12h4M14 12h4"/></svg>`,

  "nozzle-nexus": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v6"/><path d="M9 9h6l-2 4H11l-2-4z"/><path d="M11 13v3M13 13v3"/></svg>`,

  "layer-of-faith": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 4-8 4-8-4 8-4z"/><path d="M4 11l8 4 8-4"/><path d="M4 15l8 4 8-4"/></svg>`,

  "gcode-gauntlet": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="16" width="16" height="3" rx="1"/><path d="M12 4v6"/><circle cx="12" cy="11" r="2"/><path d="M6 16v-3M18 16v-3"/></svg>`,

  "entropy-engine": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 5v2M12 17v2M5 12h2M17 12h2M7 7l1.5 1.5M14.5 14.5L16 16M16 8l-1.5 1.5M8 16l1.5-1.5"/></svg>`,

  "filament-of-faith": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12M8 8h8"/><circle cx="18" cy="16" r="2"/></svg>`,

  "token-trek": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="2"/><circle cx="16" cy="8" r="2"/><circle cx="12" cy="14" r="2"/><path d="M8 10v2M16 10v2M12 16v2"/></svg>`,

  "belay-of-faith": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4v16M16 4v16"/><path d="M8 8h8M8 12h8M8 16h8"/><circle cx="12" cy="6" r="1.5"/></svg>`,

  "thermal-runaway": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3c2 3 4 5 4 8a4 4 0 01-8 0c0-3 2-5 4-8z"/><path d="M12 15v2M12 19h.01"/></svg>`,

  "snail-siege": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l6 2v6c0 4-6 8-6 8s-6-4-6-8V5l6-2z"/><circle cx="12" cy="9" r="2"/></svg>`,

  "slime-surge": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 9a4 4 0 010 8 4 4 0 01-4-4 3 3 0 013-3"/><path d="M10 13H6"/><path d="M6 5l2 2-2 2-2-2 2-2z"/></svg>`,

  "spool-surge": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><path d="M12 6v-2M12 18v2"/></svg>`,

  "alien-covenant": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5h6l1 3-1 3H9L8 8l1-3z"/><path d="M9 11h6M10 13h4"/></svg>`,

  "stepper-dash": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>`,

  "comment-cascade": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h10l2 4-2 4H5l-2-4 2-4z"/><path d="M15 12v3M9 16h6"/></svg>`,

  "bible-quiz": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h14v16H5z"/><path d="M12 7v8M9 11h6"/></svg>`,

  "z-hop-dash": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 3L6 13h5l-2 8 7-10h-5l2-8z"/></svg>`,

  "gradient-dash": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 17h16"/><path d="M6 17l3-4 3 3 4-6 2 3"/></svg>`,

  "prompt-dodge": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="8" width="12" height="8" rx="2"/><path d="M9 8V5h6v3"/><circle cx="10" cy="12" r="1"/><circle cx="14" cy="12" r="1"/></svg>`,

  "slicer-sweep": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M6 8l4 4 4-4M6 12l4 4 4-4"/></svg>`,

  "snail-crawl": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 9a4 4 0 010 8 4 4 0 01-4-4 3 3 0 013-3"/><path d="M10 13H6"/><path d="M6 5l2 2-2 2-2-2 2-2z"/></svg>`,

  "resurrection-protocol": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4h6v10l-3 3-3-3V4z"/><path d="M10 8h.01M14 8h.01"/></svg>`,

  "print-jam": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h7v3h3v7h-3v3H5V4z"/><path d="M12 7h7v7h-7"/></svg>`,

  "vibe-check": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="8" width="12" height="8" rx="2"/><path d="M9 8V5h6v3"/><path d="M10 12l2 2 3-3"/></svg>`,

  "hallucination-hunter": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4a3 3 0 013 3 3 3 0 013 3 3 3 0 01-3 3 3 3 0 01-3 3 3 3 0 01-3-3 3 3 0 01-3-3 3 3 0 013-3 3 3 0 013-3z"/><path d="M18 3l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z"/></svg>`,

  "mario-kart-fan": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4v16"/><path d="M5 4h10l-2 3 2 3H5z"/><path d="M5 10h10l-2 3 2 3H5z"/></svg>`,

  "red-baron": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3-7 3-7-3 7-3z"/><path d="M12 9l7 3-7 3-7-3 7-3z"/><path d="M12 12v6"/></svg>`,

  "password-generator": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="10" width="14" height="9" rx="2"/><path d="M9 10V7a3 3 0 016 0v3"/><circle cx="12" cy="14" r="1"/></svg>`,

  "snail-wings": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 9a4 4 0 010 8 4 4 0 01-4-4 3 3 0 013-3"/><path d="M10 13H6"/><path d="M6 5l2 2-2 2-2-2 2-2z"/><path d="M14 6l3-2M14 6l3 2"/></svg>`,

  "flat-earth-sim": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2 3 2 13 0 16M12 4c-2 3-2 13 0 16"/></svg>`,

  "flappy-snail": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 9a4 4 0 010 8 4 4 0 01-4-4 3 3 0 013-3"/><path d="M10 13H6"/><path d="M6 5l2 2-2 2-2-2 2-2z"/><path d="M18 4v6M18 14v6"/></svg>`,

  "galaga": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l4 6-4 6-4-6 4-6z"/><path d="M8 10h8M10 13h4"/></svg>`,

  "spool-spiral": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 12a3 3 0 013 3 5 5 0 01-5 5 7 7 0 01-7-7 9 9 0 019-9"/></svg>`,

  "slugfest-arena": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 9a4 4 0 010 8 4 4 0 01-4-4 3 3 0 013-3"/><path d="M10 13H6"/><path d="M12 3l2 2-2 2-2-2 2-2z"/><path d="M12 7v4"/></svg>`,

  "bed-level-balance": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12"/><path d="M8 4h8"/><path d="M6 16h12"/><path d="M6 16l-2 4M18 16l2 4"/></svg>`,

  "filament-flow": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6c4 0 4 4 8 4s4-4 8-4M4 14c4 0 4 4 8 4s4-4 8-4"/></svg>`,

  "bijan-bowen-sandbox": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M6 14h12l-2 4H8l-2-4z"/></svg>`,

  "chess-vs-ai": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="1.5"/><path d="M10 7h4M9 10h6M8 14h8M7 18h10"/></svg>`,

  "drudge-report": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>`,

  "elpaso-shooter": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 11c0-4 3-6 6-6s6 2 6 6"/><path d="M4 11h16"/><path d="M12 11v3"/><path d="M9 17h6"/></svg>`,

  "elpaso-runway": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="17" cy="7" r="3.2"/><path d="M13.8 7h6.4M14.6 9h4.8"/><path d="M9 20L12 8l3 12"/><path d="M6 20l3-6M18 20l-3-6"/></svg>`,

  "minesweeper-nt-mobile": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2M6 6l1.5 1.5M16.5 16.5L18 18M18 6l-1.5 1.5M6 18l1.5-1.5"/></svg>`,

  "nonogram": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 4v16M12 4v16M16 4v16M4 8h16M4 12h16M4 16h16"/></svg>`,

  "pharmasweep": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="9" width="14" height="6" rx="3"/><path d="M5 12h14"/></svg>`,

  "pirate-waters": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 16l3-4h10l3 4H4z"/><path d="M6 16v2M10 16v2M14 16v2M18 16v2"/><path d="M12 12V8"/><path d="M12 8l2 2-2 2-2-2 2-2z"/></svg>`,

  "pong-bug-snail": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="2" height="8"/><rect x="19" y="8" width="2" height="8"/><circle cx="12" cy="12" r="2"/><path d="M10 10l-2-2M14 10l2-2"/></svg>`,

  "snail-glitch": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 9a4 4 0 010 8 4 4 0 01-4-4 3 3 0 013-3"/><path d="M10 13H6"/><path d="M6 5l2 2-2 2-2-2 2-2z"/><path d="M16 4l1 1M18 6l1 1"/></svg>`,

  "snail-hugger": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 9a4 4 0 010 8 4 4 0 01-4-4 3 3 0 013-3"/><path d="M10 13H6"/><path d="M6 5l2 2-2 2-2-2 2-2z"/><path d="M8 16c2 2 6 2 8 0"/></svg>`,

  "snail-pirate-adventure": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 9a4 4 0 010 8 4 4 0 01-4-4 3 3 0 013-3"/><path d="M10 13H6"/><path d="M6 5l2 2-2 2-2-2 2-2z"/><path d="M12 4l2 2-2 2-2-2 2-2z"/></svg>`,

  "snail-rescue-mission": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="6"/><path d="M12 6v12M6 12h12"/></svg>`,

  "snail-shopping-spree": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="18" r="1.5"/><circle cx="16" cy="18" r="1.5"/><path d="M4 5h3l2 9h8l2-6H7"/></svg>`,

  "snail-vs-salt": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 9a4 4 0 010 8 4 4 0 01-4-4 3 3 0 013-3"/><path d="M10 13H6"/><path d="M6 5l2 2-2 2-2-2 2-2z"/><path d="M18 4v6M15 7h6"/></svg>`,

  "snail-vs-salt-v2": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 9a4 4 0 010 8 4 4 0 01-4-4 3 3 0 013-3"/><path d="M10 13H6"/><path d="M6 5l2 2-2 2-2-2 2-2z"/><path d="M18 4v6M15 7h6"/></svg>`,

  "snailking-brick-breaker": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="7" height="5"/><rect x="11" y="4" width="9" height="5"/><rect x="4" y="9" width="9" height="5"/><rect x="13" y="9" width="7" height="5"/></svg>`,

  "tides-of-war": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 16l3-4h10l3 4H4z"/><path d="M6 16v2M10 16v2M14 16v2M18 16v2"/><path d="M3 20h18"/></svg>`,

  "windows-nt-minesweeper": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 4v2M12 18v2M4 12h2M18 12h2M6 6l1.5 1.5M16.5 16.5L18 18M18 6l-1.5 1.5M6 18l1.5-1.5"/></svg>`,

  "gcode-wars": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l3 3-3 3-3-3 3-3z"/><path d="M6 10l2 2-2 2-2-2 2-2z"/><path d="M18 10l2 2-2 2-2-2 2-2z"/><path d="M12 14l2 2-2 2-2-2 2-2z"/></svg>`,

  "gcode-drop": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="6" rx="1"/><path d="M12 9v6M9 15h6"/><path d="M6 17h12"/></svg>`,

  "spaghetti-defense": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6c4 0 4 4 8 4s4-4 8-4"/><path d="M4 10c4 0 4 4 8 4s4-4 8-4"/><path d="M4 14c4 0 4 4 8 4s4-4 8-4"/><path d="M18 4v6M16 4v6"/></svg>`,

  "circuit-defense": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="8" cy="8" r="1.5"/><circle cx="16" cy="8" r="1.5"/><circle cx="12" cy="16" r="1.5"/><path d="M8 8h8M16 8l-4 8"/></svg>`,

  "agent-ecosystem": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="6" r="2"/><circle cx="6" cy="14" r="2"/><circle cx="18" cy="14" r="2"/><path d="M12 8v4M6 16v2M18 16v2"/><path d="M8 14h8"/></svg>`,

  "gcode-runner": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 9a4 4 0 010 8 4 4 0 01-4-4 3 3 0 013-3"/><path d="M10 13H6"/><path d="M6 5l2 2-2 2-2-2 2-2z"/><path d="M16 4l2 2"/></svg>`,

  "gcode-grab": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v4"/><path d="M9 7h6"/><circle cx="12" cy="9" r="2"/><path d="M9 11h6l-2 4H11l-2-4z"/></svg>`,

  "nozzle-dodge": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v6"/><path d="M9 9h6l-2 4H11l-2-4z"/><path d="M11 13v3M13 13v3"/></svg>`,

  "snail-slide": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 9a4 4 0 010 8 4 4 0 01-4-4 3 3 0 013-3"/><path d="M10 13H6"/><path d="M6 5l2 2-2 2-2-2 2-2z"/><path d="M16 4l3 3-3 3"/></svg>`,

  "cache-miss": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="7" ry="2"/><path d="M5 5v14c0 1 3 2 7 2s7-1 7-2V5"/><path d="M5 12c0 1 3 2 7 2s7-1 7-2"/></svg>`,

  "print-and-sprint": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 9a4 4 0 010 8 4 4 0 01-4-4 3 3 0 013-3"/><path d="M10 13H6"/><path d="M6 5l2 2-2 2-2-2 2-2z"/><path d="M16 4l2 2M18 6l2 2"/></svg>`,

  "gcode-fall": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="6" rx="1"/><path d="M12 9v6M9 15h6"/><path d="M6 17h12"/></svg>`,

  "the-shootist": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="10" height="3" rx="1"/><circle cx="15" cy="11" r="2"/><path d="M4 13v3"/><path d="M18 4v6M15 7h6"/></svg>`,

  "wanted-poster-generator": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 10h8M8 13h5"/></svg>`,

  "creation-days": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M5 19l1.5-1.5"/></svg>`,

  "blackout": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h14l-2 4H7L5 4z"/><path d="M7 8v10h10V8"/><path d="M10 12h4"/></svg>`,

  "neon-dodge": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l6 2v6c0 4-6 8-6 8s-6-4-6-8V5l6-2z"/><path d="M9 12l2 2 4-4"/></svg>`,

  "neon-runner": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="1.5"/><path d="M10 7h4M12 7v4M10 11l-2 4M14 11l2 4"/></svg>`,

  "solitaire": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="4" width="10" height="14" rx="1.5"/><rect x="9" y="6" width="10" height="14" rx="1.5"/><path d="M12 10l1.5 1.5L12 13l-1.5-1.5L12 10z"/></svg>`,
  "block-blast": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5" fill="currentColor"/></svg>`,

};

// Return the SVG markup for a game slug (fallback to a generic arcade icon).
function gameIcon(slug) {
  return GAME_ICONS[slug] || GAME_ICONS["arcade"];
}
