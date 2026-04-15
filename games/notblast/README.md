# NotBlast (Block Puzzle) — TealClaw Game Mode package

This folder is a TealClaw Game Mode package (offline, sandbox-friendly) inspired by Block Blast.

## Files
- `game.json` — manifest (schemaVersion 1)
- `index.html` / `main.js` / `style.css`

## Running (dev)
Open `index.html` in a browser to test standalone.

## Running in TealClaw Game Mode
Once TealClaw supports local package loading, point it at this folder/package and start it.

Notes:
- The game listens for a host `postMessage` request: `method="game.init"`.
- If no host exists, it runs in standalone mode and uses `localStorage` for saves.

## Host integration expectations
- Host provides a session `chan` and calls `game.init({seed, sessionId, ...})` via postMessage.
- Host may provide `storage.save/load` (the game falls back to localStorage if absent).
