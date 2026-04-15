// NotBlast (Block Puzzle) — TealClaw Game Mode compatible
// Offline, sandbox-safe, deterministic seed.

const BOARD_N = 10;
const CELL_GAP = 2;

// ---------- Deterministic RNG ----------
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(str) {
  // simple FNV-1a 32-bit
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------- RPC bridge (best-effort) ----------
const rpc = (() => {
  const inflight = new Map();
  let chan = null;
  let nonceCounter = 1;

  function post(msg) {
    window.parent?.postMessage(msg, "*");
  }

  function envBase() {
    return {
      v: 1,
      id: crypto.randomUUID(),
      chan: chan || "standalone",
      src: "game",
      dst: "host",
      ts: Date.now(),
      nonce: `n-${String(nonceCounter++).padStart(5, "0")}`,
    };
  }

  function request(method, params, timeoutMs = 1500) {
    if (!window.parent || window.parent === window) {
      return Promise.reject(new Error("NO_HOST"));
    }
    const id = crypto.randomUUID();
    const msg = {
      v: 1,
      id,
      chan: chan || "unknown",
      src: "game",
      dst: "host",
      type: "request",
      method,
      params,
      ts: Date.now(),
      nonce: `n-${String(nonceCounter++).padStart(5, "0")}`,
    };

    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        inflight.delete(id);
        reject(new Error("TIMEOUT"));
      }, timeoutMs);
      inflight.set(id, { resolve, reject, t });
      post(msg);
    });
  }

  function event(name, payload) {
    post({
      ...envBase(),
      type: "event",
      event: name,
      payload,
    });
  }

  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (!msg || msg.v !== 1) return;
    // Host → game requests
    if (msg.dst === "game" && msg.type === "request" && msg.method === "game.init") {
      chan = msg.chan;
    }

    // Responses
    if (msg.type === "response" && typeof msg.id === "string") {
      const item = inflight.get(msg.id);
      if (!item) return;
      clearTimeout(item.t);
      inflight.delete(msg.id);
      if (msg.ok) item.resolve(msg.result);
      else item.reject(Object.assign(new Error(msg.error?.message || "RPC_ERROR"), { code: msg.error?.code, data: msg.error?.data }));
    }
  });

  return { request, event, setChan: (c) => (chan = c) };
})();

// ---------- Storage (RPC preferred, localStorage fallback) ----------
async function saveState(key, state) {
  try {
    await rpc.request("storage.save", { key, state }, 1200);
  } catch {
    localStorage.setItem(`notblast:${key}`, JSON.stringify(state));
  }
}
async function loadState(key) {
  try {
    const res = await rpc.request("storage.load", { key }, 1200);
    return res?.state ?? null;
  } catch {
    const raw = localStorage.getItem(`notblast:${key}`);
    return raw ? JSON.parse(raw) : null;
  }
}

// ---------- Game logic ----------
const PIECES = [
  // each piece is list of (x,y) cells, normalized to min x/y = 0
  { id: "dot", cells: [[0, 0]] },
  { id: "i2", cells: [[0, 0], [1, 0]] },
  { id: "i3", cells: [[0, 0], [1, 0], [2, 0]] },
  { id: "i4", cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  { id: "i5", cells: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]] },
  { id: "l3", cells: [[0, 0], [0, 1], [1, 1]] },
  { id: "l4", cells: [[0, 0], [0, 1], [0, 2], [1, 2]] },
  { id: "j4", cells: [[1, 0], [1, 1], [1, 2], [0, 2]] },
  { id: "sq2", cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { id: "t5", cells: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]] },
  { id: "z4", cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  { id: "s4", cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  { id: "plus5", cells: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]] },
  { id: "bigL5", cells: [[0,0],[0,1],[0,2],[0,3],[1,3]] },
  { id: "bar3v", cells: [[0,0],[0,1],[0,2]] },
  { id: "bar4v", cells: [[0,0],[0,1],[0,2],[0,3]] },
];

function rotateCells(cells) {
  // rotate 90° clockwise around origin (x,y)->(y,-x), then renormalize
  const rotated = cells.map(([x, y]) => [y, -x]);
  const minX = Math.min(...rotated.map((c) => c[0]));
  const minY = Math.min(...rotated.map((c) => c[1]));
  return rotated.map(([x, y]) => [x - minX, y - minY]);
}

function variants(piece) {
  // generate unique rotations
  const seen = new Set();
  const out = [];
  let cells = piece.cells;
  for (let i = 0; i < 4; i++) {
    const key = cells
      .slice()
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .map((c) => c.join(","))
      .join(";");
    if (!seen.has(key)) {
      seen.add(key);
      out.push(cells);
    }
    cells = rotateCells(cells);
  }
  return out;
}

const PIECE_VARIANTS = new Map(PIECES.map((p) => [p.id, variants(p)]));

function makeEmptyBoard() {
  return Array.from({ length: BOARD_N }, () => Array.from({ length: BOARD_N }, () => 0));
}

function canPlace(board, cells, ox, oy) {
  for (const [dx, dy] of cells) {
    const x = ox + dx;
    const y = oy + dy;
    if (x < 0 || y < 0 || x >= BOARD_N || y >= BOARD_N) return false;
    if (board[y][x]) return false;
  }
  return true;
}

function place(board, cells, ox, oy, colorId) {
  for (const [dx, dy] of cells) {
    board[oy + dy][ox + dx] = colorId;
  }
}

function clearLines(board) {
  const fullRows = [];
  const fullCols = [];

  for (let y = 0; y < BOARD_N; y++) {
    if (board[y].every((v) => v !== 0)) fullRows.push(y);
  }
  for (let x = 0; x < BOARD_N; x++) {
    let ok = true;
    for (let y = 0; y < BOARD_N; y++) if (board[y][x] === 0) ok = false;
    if (ok) fullCols.push(x);
  }

  for (const y of fullRows) for (let x = 0; x < BOARD_N; x++) board[y][x] = 0;
  for (const x of fullCols) for (let y = 0; y < BOARD_N; y++) board[y][x] = 0;

  return { rows: fullRows.length, cols: fullCols.length };
}

function anyFit(board, pieceId) {
  const vars = PIECE_VARIANTS.get(pieceId) || [];
  for (const cells of vars) {
    // compute bounds
    const w = Math.max(...cells.map((c) => c[0])) + 1;
    const h = Math.max(...cells.map((c) => c[1])) + 1;
    for (let oy = 0; oy <= BOARD_N - h; oy++) {
      for (let ox = 0; ox <= BOARD_N - w; ox++) {
        if (canPlace(board, cells, ox, oy)) return true;
      }
    }
  }
  return false;
}

// ---------- UI + Rendering ----------
const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const trayEl = document.getElementById("tray");
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const statusEl = document.getElementById("status");

const dlgHelp = document.getElementById("dlgHelp");
const dlgNew = document.getElementById("dlgNew");

document.getElementById("btnHelp").addEventListener("click", () => dlgHelp.showModal());
document.getElementById("btnNew").addEventListener("click", () => dlgNew.showModal());
document.getElementById("btnConfirmNew").addEventListener("click", () => {
  dlgNew.close();
  newGame(true);
});

dlgNew.addEventListener("close", () => {
  // no-op
});

let rng = mulberry32(hashSeed("standalone"));
let seed = hashSeed("standalone");

let board = makeEmptyBoard();
let score = 0;
let best = 0;
let tray = []; // [{pieceId, rotIndex, colorId, used:false}]
let selected = 0;
let ghost = { x: 0, y: 0 };
let gameOver = false;

const COLORS = [
  "#0d9488",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#f97316",
  "#eab308",
  "#ef4444",
];

function pickPiece() {
  const p = PIECES[Math.floor(rng() * PIECES.length)];
  const vars = PIECE_VARIANTS.get(p.id);
  const rotIndex = Math.floor(rng() * vars.length);
  const colorId = 1 + Math.floor(rng() * COLORS.length);
  return { pieceId: p.id, rotIndex, colorId, used: false };
}

function refillTray() {
  tray = [pickPiece(), pickPiece(), pickPiece()];
  selected = 0;
  ghost = { x: 0, y: 0 };
  renderTray();
}

function pieceCells(item) {
  const vars = PIECE_VARIANTS.get(item.pieceId);
  return vars[item.rotIndex];
}

function fitsNow(item) {
  return anyFit(board, item.pieceId);
}

function checkGameOver() {
  const any = tray.some((t) => !t.used && fitsNow(t));
  gameOver = !any;
  if (gameOver) {
    statusEl.textContent = "No moves left. Press New to restart.";
  } else {
    statusEl.textContent = "";
  }
}

function scoreAdd(n) {
  score += n;
  if (score > best) best = score;
  scoreEl.textContent = String(score);
  bestEl.textContent = String(best);
  rpc.event("telemetry.emit", { name: "score", payload: { score, best } });
}

function newGame(resetBest = false) {
  board = makeEmptyBoard();
  score = 0;
  if (resetBest) best = 0;
  scoreEl.textContent = "0";
  bestEl.textContent = String(best);
  gameOver = false;
  refillTray();
  render();
  persist();
}

async function persist() {
  await saveState("session", { seed, board, score, best, tray, selected, ghost, gameOver });
}

async function restore() {
  const s = await loadState("session");
  if (!s) return false;
  seed = s.seed ?? seed;
  rng = mulberry32(seed);
  board = s.board ?? board;
  score = s.score ?? score;
  best = s.best ?? best;
  tray = s.tray ?? tray;
  selected = s.selected ?? 0;
  ghost = s.ghost ?? ghost;
  gameOver = s.gameOver ?? false;
  scoreEl.textContent = String(score);
  bestEl.textContent = String(best);
  renderTray();
  render();
  checkGameOver();
  return true;
}

function requestImmersiveChrome() {
  // best-effort request; host can deny.
  rpc.request("chrome.request", { layout: { mode: "full" }, chat: { visible: "hide" } }, 800).catch(() => {});
}

function resizeCanvasToDevice() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const size = Math.floor(Math.min(rect.width, rect.height) * dpr);
  if (size > 0) {
    canvas.width = size;
    canvas.height = size;
  }
}

function drawRoundedRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function render() {
  resizeCanvasToDevice();
  const W = canvas.width;
  const cell = Math.floor((W - (BOARD_N + 1) * CELL_GAP) / BOARD_N);
  const boardPx = BOARD_N * cell + (BOARD_N + 1) * CELL_GAP;
  const ox = Math.floor((W - boardPx) / 2);
  const oy = ox;

  // background
  ctx.clearRect(0, 0, W, W);
  ctx.fillStyle = "#0b1220";
  drawRoundedRect(0, 0, W, W, Math.floor(W * 0.04));
  ctx.fill();

  // grid
  for (let y = 0; y < BOARD_N; y++) {
    for (let x = 0; x < BOARD_N; x++) {
      const px = ox + CELL_GAP + x * (cell + CELL_GAP);
      const py = oy + CELL_GAP + y * (cell + CELL_GAP);
      ctx.fillStyle = board[y][x] ? COLORS[(board[y][x] - 1) % COLORS.length] : "#111a2b";
      drawRoundedRect(px, py, cell, cell, Math.max(6, Math.floor(cell * 0.18)));
      ctx.fill();

      // subtle stroke
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = Math.max(1, Math.floor(cell * 0.04));
      ctx.stroke();
    }
  }

  // ghost preview
  const item = tray[selected];
  if (item && !item.used && !gameOver) {
    const cells = pieceCells(item);
    const ok = canPlace(board, cells, ghost.x, ghost.y);
    ctx.globalAlpha = ok ? 0.35 : 0.18;
    ctx.fillStyle = ok ? "#e7eefc" : "#ef4444";
    for (const [dx, dy] of cells) {
      const x = ghost.x + dx;
      const y = ghost.y + dy;
      if (x < 0 || y < 0 || x >= BOARD_N || y >= BOARD_N) continue;
      const px = ox + CELL_GAP + x * (cell + CELL_GAP);
      const py = oy + CELL_GAP + y * (cell + CELL_GAP);
      drawRoundedRect(px, py, cell, cell, Math.max(6, Math.floor(cell * 0.18)));
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // game over banner
  if (gameOver) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, W, W);
    ctx.fillStyle = "#e7eefc";
    ctx.font = `bold ${Math.floor(W * 0.05)}px ui-sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("Game Over", W / 2, W / 2 - 10);
    ctx.font = `${Math.floor(W * 0.03)}px ui-sans-serif`;
    ctx.fillStyle = "rgba(231,238,252,0.85)";
    ctx.fillText("Press New to restart", W / 2, W / 2 + 24);
  }
}

function renderPiecePreview(canvasEl, item) {
  const pctx = canvasEl.getContext("2d");
  const W = canvasEl.width;
  const H = canvasEl.height;
  pctx.clearRect(0, 0, W, H);

  const cells = pieceCells(item);
  const maxX = Math.max(...cells.map((c) => c[0]));
  const maxY = Math.max(...cells.map((c) => c[1]));
  const w = maxX + 1;
  const h = maxY + 1;
  const gap = 3;
  const cell = Math.floor(Math.min((W - (w + 1) * gap) / w, (H - (h + 1) * gap) / h));
  const pxW = w * cell + (w + 1) * gap;
  const pxH = h * cell + (h + 1) * gap;
  const ox = Math.floor((W - pxW) / 2);
  const oy = Math.floor((H - pxH) / 2);

  pctx.fillStyle = "rgba(255,255,255,0.06)";
  pctx.strokeStyle = "rgba(255,255,255,0.10)";

  for (const [dx, dy] of cells) {
    const x = ox + gap + dx * (cell + gap);
    const y = oy + gap + dy * (cell + gap);
    pctx.fillStyle = COLORS[(item.colorId - 1) % COLORS.length];
    pctx.beginPath();
    const r = Math.max(6, Math.floor(cell * 0.22));
    pctx.moveTo(x + r, y);
    pctx.arcTo(x + cell, y, x + cell, y + cell, r);
    pctx.arcTo(x + cell, y + cell, x, y + cell, r);
    pctx.arcTo(x, y + cell, x, y, r);
    pctx.arcTo(x, y, x + cell, y, r);
    pctx.closePath();
    pctx.fill();
    pctx.stroke();
  }

  // dim if unusable
  if (!item.used && !fitsNow(item)) {
    pctx.fillStyle = "rgba(0,0,0,0.45)";
    pctx.fillRect(0, 0, W, H);
  }

  if (item.used) {
    pctx.fillStyle = "rgba(0,0,0,0.55)";
    pctx.fillRect(0, 0, W, H);
  }
}

function renderTray() {
  trayEl.innerHTML = "";
  tray.forEach((item, idx) => {
    const btn = document.createElement("button");
    btn.className = "pieceBtn" + (idx === selected ? " selected" : "");
    btn.disabled = item.used;

    const mini = document.createElement("canvas");
    mini.width = 140;
    mini.height = 110;
    renderPiecePreview(mini, item);

    btn.appendChild(mini);
    btn.addEventListener("click", () => {
      if (item.used) return;
      selected = idx;
      // snap ghost to first fit if possible
      const snap = findFirstFit(item);
      if (snap) ghost = snap;
      renderTray();
      render();
      persist();
    });
    trayEl.appendChild(btn);
  });

  // status
  const usable = tray.some((t) => !t.used && fitsNow(t));
  if (!usable) {
    statusEl.textContent = "No moves left. Press New to restart.";
  }
}

function findFirstFit(item) {
  const vars = PIECE_VARIANTS.get(item.pieceId) || [];
  // prefer item's current rotation
  const order = [item.rotIndex, ...vars.map((_, i) => i).filter((i) => i !== item.rotIndex)];
  for (const ri of order) {
    const cells = vars[ri];
    const w = Math.max(...cells.map((c) => c[0])) + 1;
    const h = Math.max(...cells.map((c) => c[1])) + 1;
    for (let oy = 0; oy <= BOARD_N - h; oy++) {
      for (let ox = 0; ox <= BOARD_N - w; ox++) {
        if (canPlace(board, cells, ox, oy)) {
          item.rotIndex = ri;
          return { x: ox, y: oy };
        }
      }
    }
  }
  return null;
}

function tryPlaceAt(x, y) {
  const item = tray[selected];
  if (!item || item.used || gameOver) return false;
  const cells = pieceCells(item);
  if (!canPlace(board, cells, x, y)) return false;

  place(board, cells, x, y, item.colorId);
  item.used = true;

  // score: base points per block
  scoreAdd(cells.length);

  const cleared = clearLines(board);
  if (cleared.rows || cleared.cols) {
    // bonus scoring
    const lines = cleared.rows + cleared.cols;
    scoreAdd(lines * lines * 5);
  }

  // if all used, refill
  if (tray.every((t) => t.used)) {
    refillTray();
  } else {
    renderTray();
  }

  // if selected is used, pick next available
  if (tray[selected]?.used) {
    const next = tray.findIndex((t) => !t.used);
    selected = next >= 0 ? next : 0;
  }

  // snap ghost
  const snap = findFirstFit(tray[selected]);
  if (snap) ghost = snap;

  checkGameOver();
  render();
  persist();
  return true;
}

function pointerToCell(evt) {
  const rect = canvas.getBoundingClientRect();
  const x = (evt.clientX - rect.left) / rect.width;
  const y = (evt.clientY - rect.top) / rect.height;
  // in [0,1]
  const gx = Math.floor(x * BOARD_N);
  const gy = Math.floor(y * BOARD_N);
  return { gx: clamp(gx, 0, BOARD_N - 1), gy: clamp(gy, 0, BOARD_N - 1) };
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

canvas.addEventListener("pointermove", (evt) => {
  if (gameOver) return;
  const { gx, gy } = pointerToCell(evt);
  ghost.x = gx;
  ghost.y = gy;
  render();
});

canvas.addEventListener("pointerdown", (evt) => {
  evt.preventDefault();
  if (gameOver) return;
  const { gx, gy } = pointerToCell(evt);
  ghost.x = gx;
  ghost.y = gy;
  if (!tryPlaceAt(gx, gy)) {
    // if doesn't place, try snapping to nearest fit by scanning around
    // (lightweight heuristic)
  }
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    // cancel selection (show chat in TealClaw, but here just no-op)
    return;
  }
  if (e.key === "1" || e.key === "2" || e.key === "3") {
    const idx = Number(e.key) - 1;
    if (tray[idx] && !tray[idx].used) {
      selected = idx;
      const snap = findFirstFit(tray[selected]);
      if (snap) ghost = snap;
      renderTray();
      render();
      persist();
    }
    return;
  }

  if (e.key === "ArrowLeft") ghost.x = clamp(ghost.x - 1, 0, BOARD_N - 1);
  if (e.key === "ArrowRight") ghost.x = clamp(ghost.x + 1, 0, BOARD_N - 1);
  if (e.key === "ArrowUp") ghost.y = clamp(ghost.y - 1, 0, BOARD_N - 1);
  if (e.key === "ArrowDown") ghost.y = clamp(ghost.y + 1, 0, BOARD_N - 1);

  if (e.key === "Enter") {
    tryPlaceAt(ghost.x, ghost.y);
  }

  // rotate piece with R
  if (e.key.toLowerCase() === "r") {
    const item = tray[selected];
    if (!item || item.used) return;
    const vars = PIECE_VARIANTS.get(item.pieceId) || [];
    item.rotIndex = (item.rotIndex + 1) % vars.length;
    renderTray();
    render();
    persist();
  }

  render();
});

// ---------- Host init handling ----------
window.addEventListener("message", async (event) => {
  const msg = event.data;
  if (!msg || msg.v !== 1 || msg.dst !== "game") return;

  if (msg.type === "request" && msg.method === "game.init") {
    rpc.setChan(msg.chan);
    const initSeed = msg.params?.seed;
    seed = typeof initSeed === "number" ? (initSeed >>> 0) : hashSeed(String(initSeed ?? msg.params?.sessionId ?? "seed"));
    rng = mulberry32(seed);

    // try restore
    await restore();
    if (tray.length === 0) {
      refillTray();
    }

    requestImmersiveChrome();

    // respond (best-effort)
    window.parent?.postMessage(
      {
        v: 1,
        id: msg.id,
        chan: msg.chan,
        src: "game",
        dst: "host",
        type: "response",
        ok: true,
        result: { ready: true },
        ts: Date.now(),
        nonce: `n-00000`,
      },
      "*"
    );

    rpc.event("game.ready", { sdkVersion: "0.1.0" });

    renderTray();
    render();
    checkGameOver();
    persist();
  }

  if (msg.type === "request" && msg.method === "game.setChrome") {
    // host is informing us about effective chrome; we can ignore for now.
    window.parent?.postMessage(
      {
        v: 1,
        id: msg.id,
        chan: msg.chan,
        src: "game",
        dst: "host",
        type: "response",
        ok: true,
        result: { ok: true },
        ts: Date.now(),
        nonce: `n-00000`,
      },
      "*"
    );
  }
});

// ---------- Boot (standalone mode) ----------
(async function boot() {
  // In TealClaw, host will call game.init.
  // Standalone: restore or start new.
  await restore();
  if (tray.length === 0) refillTray();
  renderTray();
  render();
  checkGameOver();
  requestImmersiveChrome();
})();
