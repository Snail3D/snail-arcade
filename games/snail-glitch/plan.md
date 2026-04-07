# Game Concept: "Snail's Glitchy Odyssey"

## The Surprise
The game starts as a simple, cute 2D platformer/collector. However, as the player collects "Glitch Shells," the game's engine appears to "break" visually and mechanically. 
- **Phase 1: Cute & Cozy.** Smooth physics, bright colors, collecting lettuce.
- **Phase 2: Reality Warp.** Gravity begins to fluctuate. The "canvas" starts to shake and pixelate.
- **Phase 3: The Singularity.** The game shifts into a pseudo-3D or shader-heavy psychedelic trip where the snail must navigate through fractured code fragments and shifting neon geometries.

## Core Mechanics
- **Movement:** Momentum-based sliding (snail slime physics).
- **The Glitch Meter:** Collecting specific items shifts the "Reality State."
- **Dynamic Shaders:** Using HTML5 Canvas `globalCompositeOperation` and pixel manipulation to simulate "breaking" the game.
- **Procedural Fragments:** The level isn't just a flat map; it's a collection of floating, rotating debris that reacts to the snail's slime trail.

## Technical Implementation Plan
- **Engine:** Pure JavaScript + HTML5 Canvas (no external libs to ensure "local AI" portability).
- **Visuals:** Procedural generation of "glitch" overlays using perlin-ish noise and random block offsets.
- **Deployment:** `~/snail-arcade/games/snail-glitch/index.html`
