// WorldSmith — client-side tile editor + AI world designer.

const TILES = {
  grass: { label: "Grass", color: "#3f7a43", icon: "🌿" },
  water: { label: "Water", color: "#2f6fb0", icon: "💧" },
  sand: { label: "Sand", color: "#d8c486", icon: "🏖️" },
  forest: { label: "Forest", color: "#2c5733", icon: "🌲" },
  road: { label: "Road", color: "#8a8276", icon: "🛣️" },
  bridge: { label: "Bridge", color: "#a8895f", icon: "🌉" },
  house: { label: "House", color: "#c8643c", icon: "🏠" },
  building: { label: "Building", color: "#9a9aa5", icon: "🏢" },
  tower: { label: "Tower", color: "#6c5ca8", icon: "🗼" },
  farm: { label: "Farm", color: "#b8a23e", icon: "🌾" },
  park: { label: "Park", color: "#4fae62", icon: "🌳" },
  plaza: { label: "Plaza", color: "#c2b7a0", icon: "⛲" },
  wall: { label: "Wall", color: "#5b5b5b", icon: "🧱" },
};
const TILE_KEYS = Object.keys(TILES);
const BG = "grass";

const state = {
  cols: 40,
  rows: 28,
  cell: 22,
  grid: [],
  tile: "road",
  tool: "brush",
  brush: 1,
  painting: false,
  start: null, // for line/rect previews
  preview: null,
  aiEnabled: false,
};

const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");

// ---------- grid model ----------

function makeGrid(cols, rows, fill = BG) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => fill));
}

function resizeGrid(cols, rows) {
  const next = makeGrid(cols, rows);
  for (let y = 0; y < Math.min(rows, state.grid.length); y++) {
    for (let x = 0; x < Math.min(cols, state.grid[0]?.length || 0); x++) {
      next[y][x] = state.grid[y][x];
    }
  }
  state.cols = cols;
  state.rows = rows;
  state.grid = next;
  fitCanvas();
  render();
}

function fitCanvas() {
  // Pick a cell size that fits the available stage area.
  const wrap = canvas.parentElement.getBoundingClientRect();
  const cell = Math.max(
    6,
    Math.floor(Math.min((wrap.width - 8) / state.cols, (wrap.height - 8) / state.rows)),
  );
  state.cell = cell;
  canvas.width = state.cols * cell;
  canvas.height = state.rows * cell;
}

// ---------- rendering ----------

function render() {
  const c = state.cell;
  for (let y = 0; y < state.rows; y++) {
    for (let x = 0; x < state.cols; x++) {
      drawCell(x, y, state.grid[y][x]);
    }
  }
  // Overlay tool preview (line/rect) without mutating the grid.
  if (state.preview) {
    for (const [x, y] of state.preview) {
      ctx.globalAlpha = 0.6;
      drawCell(x, y, state.tool === "erase" ? BG : state.tile, true);
      ctx.globalAlpha = 1;
    }
  }
  drawGridLines();
}

function drawCell(x, y, type, isPreview = false) {
  const c = state.cell;
  const def = TILES[type] || TILES[BG];
  ctx.fillStyle = def.color;
  ctx.fillRect(x * c, y * c, c, c);

  // Draw an icon glyph when cells are large enough to read.
  if (c >= 16 && type !== BG && def.icon && !isPreview) {
    ctx.font = `${Math.floor(c * 0.62)}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(def.icon, x * c + c / 2, y * c + c / 2 + 1);
  }
}

function drawGridLines() {
  if (state.cell < 10) return;
  const c = state.cell;
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= state.cols; x++) {
    ctx.moveTo(x * c + 0.5, 0);
    ctx.lineTo(x * c + 0.5, state.rows * c);
  }
  for (let y = 0; y <= state.rows; y++) {
    ctx.moveTo(0, y * c + 0.5);
    ctx.lineTo(state.cols * c, y * c + 0.5);
  }
  ctx.stroke();
}

// ---------- painting ----------

function cellFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = Math.floor(((e.clientX - rect.left) * scaleX) / state.cell);
  const y = Math.floor(((e.clientY - rect.top) * scaleY) / state.cell);
  return { x, y };
}

function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < state.cols && y < state.rows;
}

function paintBrush(cx, cy) {
  const r = state.brush - 1;
  const type = state.tool === "erase" ? BG : state.tile;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (inBounds(x, y)) state.grid[y][x] = type;
    }
  }
}

function lineCells(x0, y0, x1, y1) {
  // Bresenham, thickened by brush size.
  const cells = [];
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  const r = state.brush - 1;
  while (true) {
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        if (inBounds(x + ox, y + oy)) cells.push([x + ox, y + oy]);
      }
    }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return cells;
}

function rectCells(x0, y0, x1, y1) {
  const cells = [];
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (inBounds(x, y)) cells.push([x, y]);
    }
  }
  return cells;
}

function floodFill(cx, cy) {
  const target = state.grid[cy][cx];
  const replacement = state.tile;
  if (target === replacement) return;
  const stack = [[cx, cy]];
  while (stack.length) {
    const [x, y] = stack.pop();
    if (!inBounds(x, y) || state.grid[y][x] !== target) continue;
    state.grid[y][x] = replacement;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
}

function commitCells(cells) {
  const type = state.tool === "erase" ? BG : state.tile;
  for (const [x, y] of cells) state.grid[y][x] = type;
}

// pointer handlers
canvas.addEventListener("pointerdown", (e) => {
  const { x, y } = cellFromEvent(e);
  if (!inBounds(x, y)) return;
  canvas.setPointerCapture(e.pointerId);
  state.painting = true;
  state.start = { x, y };

  if (state.tool === "brush" || state.tool === "erase") {
    paintBrush(x, y);
    render();
  } else if (state.tool === "fill") {
    floodFill(x, y);
    render();
    state.painting = false;
  }
});

canvas.addEventListener("pointermove", (e) => {
  const { x, y } = cellFromEvent(e);
  document.getElementById("hover-coords").textContent = inBounds(x, y)
    ? `x ${x}, y ${y} · ${TILES[state.grid[y][x]].label}`
    : "—";

  if (!state.painting) return;

  if (state.tool === "brush" || state.tool === "erase") {
    if (inBounds(x, y)) {
      paintBrush(x, y);
      render();
    }
  } else if (state.tool === "line" && state.start) {
    state.preview = lineCells(state.start.x, state.start.y, clamp(x, 0, state.cols - 1), clamp(y, 0, state.rows - 1));
    render();
  } else if (state.tool === "rect" && state.start) {
    state.preview = rectCells(state.start.x, state.start.y, clamp(x, 0, state.cols - 1), clamp(y, 0, state.rows - 1));
    render();
  }
});

canvas.addEventListener("pointerup", () => {
  if (state.preview) {
    commitCells(state.preview);
    state.preview = null;
  }
  state.painting = false;
  state.start = null;
  render();
});

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ---------- palette + tools UI ----------

function buildPalette() {
  const wrap = document.getElementById("tile-palette");
  wrap.innerHTML = "";
  for (const key of TILE_KEYS) {
    const def = TILES[key];
    const el = document.createElement("button");
    el.className = "tile-swatch" + (key === state.tile ? " active" : "");
    el.dataset.tile = key;
    el.innerHTML = `<span class="dot" style="background:${def.color}"></span><span>${def.icon} ${def.label}</span>`;
    el.addEventListener("click", () => {
      state.tile = key;
      if (state.tool === "erase") setTool("brush");
      refreshActive();
    });
    wrap.appendChild(el);
  }
}

function setTool(tool) {
  state.tool = tool;
  refreshActive();
}

function refreshActive() {
  document.querySelectorAll(".tile-swatch").forEach((el) => {
    el.classList.toggle("active", el.dataset.tile === state.tile);
  });
  document.querySelectorAll(".tool").forEach((el) => {
    el.classList.toggle("active", el.dataset.tool === state.tool);
  });
}

document.querySelectorAll(".tool").forEach((el) => {
  el.addEventListener("click", () => setTool(el.dataset.tool));
});

document.getElementById("brush-size").addEventListener("input", (e) => {
  state.brush = Number(e.target.value);
  document.getElementById("brush-size-val").textContent = state.brush;
});

// keyboard shortcuts
window.addEventListener("keydown", (e) => {
  if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
  const map = { b: "brush", l: "line", r: "rect", f: "fill", e: "erase" };
  if (map[e.key.toLowerCase()]) setTool(map[e.key.toLowerCase()]);
});

// ---------- top bar actions ----------

document.getElementById("btn-clear").addEventListener("click", () => {
  state.grid = makeGrid(state.cols, state.rows);
  render();
  toast("Map cleared");
});

document.getElementById("btn-new").addEventListener("click", () => {
  if (confirm("Start a new, empty world?")) {
    state.grid = makeGrid(state.cols, state.rows);
    document.getElementById("lore").innerHTML = "";
    render();
  }
});

document.getElementById("grid-size").addEventListener("change", (e) => {
  const [cols, rows] = e.target.value.split("x").map(Number);
  resizeGrid(cols, rows);
});

document.getElementById("btn-save").addEventListener("click", () => {
  localStorage.setItem(
    "worldsmith-save",
    JSON.stringify({ cols: state.cols, rows: state.rows, grid: state.grid }),
  );
  toast("Saved to this browser");
});

document.getElementById("btn-load").addEventListener("click", () => {
  const raw = localStorage.getItem("worldsmith-save");
  if (!raw) return toast("No saved world found");
  try {
    const data = JSON.parse(raw);
    state.cols = data.cols;
    state.rows = data.rows;
    state.grid = data.grid;
    syncGridSelect();
    fitCanvas();
    render();
    toast("Loaded");
  } catch {
    toast("Could not load save");
  }
});

document.getElementById("btn-export").addEventListener("click", () => {
  downloadFile(
    "world.json",
    JSON.stringify({ cols: state.cols, rows: state.rows, grid: state.grid }, null, 2),
    "application/json",
  );
});

document.getElementById("btn-png").addEventListener("click", () => {
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "world.png";
    a.click();
    URL.revokeObjectURL(url);
  });
});

function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function syncGridSelect() {
  const val = `${state.cols}x${state.rows}`;
  const sel = document.getElementById("grid-size");
  if ([...sel.options].some((o) => o.value === val)) sel.value = val;
}

// ---------- AI integration ----------

const EXAMPLES = [
  "A walled medieval town with a central market plaza and a castle keep",
  "A cliffside fishing village with a harbor and a lighthouse",
  "A river city split by a wide river with three bridges and riverside parks",
  "A desert oasis settlement ringed by farms and palm groves",
  "A futuristic district of towers connected by elevated roads",
];

function buildChips() {
  const row = document.getElementById("example-chips");
  EXAMPLES.forEach((text) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = text.length > 38 ? text.slice(0, 36) + "…" : text;
    chip.title = text;
    chip.addEventListener("click", () => {
      document.getElementById("ai-prompt").value = text;
    });
    row.appendChild(chip);
  });
}

async function checkStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    state.aiEnabled = data.ai;
    const badge = document.getElementById("ai-status");
    if (data.ai) {
      badge.textContent = "AI ready";
      badge.className = "badge on";
    } else {
      badge.textContent = "AI offline · procedural mode";
      badge.className = "badge off";
    }
  } catch {
    state.aiEnabled = false;
  }
}

document.getElementById("btn-generate").addEventListener("click", async () => {
  const prompt = document.getElementById("ai-prompt").value.trim();
  if (!prompt) return toast("Describe the place you want first");
  const clearFirst = document.getElementById("generate-clear").checked;
  const btn = document.getElementById("btn-generate");
  btn.disabled = true;
  const original = btn.textContent;
  btn.innerHTML = '<span class="spinner"></span>Designing…';

  try {
    if (clearFirst) state.grid = makeGrid(state.cols, state.rows);

    if (state.aiEnabled) {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, width: state.cols, height: state.rows }),
      });
      if (!res.ok) throw new Error((await res.json()).message || "Generation failed");
      const data = await res.json();
      applyTiles(data.tiles);
      if (data.name || data.description) {
        renderLore(`## ${data.name}\n\n${data.description}`);
      }
      toast(`Designed “${data.name}” · ${data.tiles.length} tiles`);
    } else {
      proceduralGenerate(prompt);
      toast("Generated with the built-in procedural designer");
    }
    render();
  } catch (err) {
    toast("Error: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

function applyTiles(tiles) {
  for (const t of tiles) {
    if (inBounds(t.x, t.y) && TILES[t.type]) state.grid[t.y][t.x] = t.type;
  }
}

document.getElementById("btn-describe").addEventListener("click", async () => {
  const lore = document.getElementById("lore");
  if (!state.aiEnabled) {
    return toast("Lore writing needs an ANTHROPIC_API_KEY on the server");
  }
  const btn = document.getElementById("btn-describe");
  btn.disabled = true;
  lore.innerHTML = '<span class="spinner"></span> Consulting the chroniclers…';
  try {
    const res = await fetch("/api/describe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grid: state.grid }),
    });
    if (!res.ok) throw new Error((await res.json()).message || "Request failed");
    const data = await res.json();
    renderLore(data.description);
  } catch (err) {
    lore.innerHTML = "";
    toast("Error: " + err.message);
  } finally {
    btn.disabled = false;
  }
});

function renderLore(markdown) {
  document.getElementById("lore").innerHTML = miniMarkdown(markdown);
}

// Tiny markdown renderer for headings, bold, italics, and paragraphs.
function miniMarkdown(md) {
  const esc = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc(md)
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h2>$1</h2>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .split(/\n{2,}/)
    .map((block) => (block.startsWith("<h2>") ? block : `<p>${block.replace(/\n/g, "<br>")}</p>`))
    .join("");
}

// ---------- procedural fallback (works with no API key) ----------

function proceduralGenerate(prompt) {
  const p = prompt.toLowerCase();
  const { cols, rows, grid } = state;

  const wantWater = /(river|harbor|harbour|coast|sea|lake|ocean|fishing|port|bay)/.test(p);
  const wantDesert = /(desert|oasis|dune|sand)/.test(p);
  const wantForest = /(forest|wood|grove|jungle)/.test(p);
  const wantWall = /(wall|castle|fort|keep|medieval|citadel)/.test(p);
  const wantTowers = /(tower|futuristic|sky|metropolis|high-rise|skyscraper)/.test(p);

  if (wantDesert) fillBase("sand");

  // A river or coast.
  if (wantWater) {
    const vertical = Math.random() > 0.5;
    if (vertical) {
      let x = Math.floor(cols / 2);
      for (let y = 0; y < rows; y++) {
        for (let w = -1; w <= 1; w++) if (inBounds(x + w, y)) grid[y][x + w] = "water";
        x += Math.random() < 0.4 ? (Math.random() < 0.5 ? -1 : 1) : 0;
        x = clamp(x, 2, cols - 3);
      }
    } else {
      let y = Math.floor(rows / 2);
      for (let x = 0; x < cols; x++) {
        for (let w = -1; w <= 1; w++) if (inBounds(x, y + w)) grid[y + w][x] = "water";
        y += Math.random() < 0.4 ? (Math.random() < 0.5 ? -1 : 1) : 0;
        y = clamp(y, 2, rows - 3);
      }
    }
  }

  // Road grid.
  const roadGapX = Math.max(5, Math.floor(cols / 6));
  const roadGapY = Math.max(5, Math.floor(rows / 5));
  for (let x = 3; x < cols; x += roadGapX) drawRoadLine(x, 0, x, rows - 1);
  for (let y = 3; y < rows; y += roadGapY) drawRoadLine(0, y, cols - 1, y);

  // Buildings/houses in blocks between roads.
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (grid[y][x] !== BG && grid[y][x] !== "sand") continue;
      const nearRoad = neighborsAny(x, y, "road");
      if (nearRoad && Math.random() < 0.5) {
        grid[y][x] = wantTowers && Math.random() < 0.3 ? "tower" : Math.random() < 0.5 ? "house" : "building";
      } else if (Math.random() < 0.04) {
        grid[y][x] = "park";
      }
    }
  }

  // Central plaza.
  const cx = Math.floor(cols / 2);
  const cy = Math.floor(rows / 2);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) if (inBounds(cx + dx, cy + dy)) grid[cy + dy][cx + dx] = "plaza";

  if (wantForest) scatter("forest", 0.06);
  if (wantDesert) scatter("farm", 0.02);
  else scatter("farm", 0.015);

  if (wantWall) drawBorder("wall");
  if (wantWall) {
    grid[cy][cx] = "tower"; // a keep at the heart
  }

  // Bridges where roads meet water.
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      if (grid[y][x] === "water" && neighborsAny(x, y, "road")) grid[y][x] = "bridge";
}

function fillBase(type) {
  for (let y = 0; y < state.rows; y++)
    for (let x = 0; x < state.cols; x++) state.grid[y][x] = type;
}

function drawRoadLine(x0, y0, x1, y1) {
  for (const [x, y] of lineCells(x0, y0, x1, y1)) {
    if (state.grid[y][x] === "water") state.grid[y][x] = "bridge";
    else state.grid[y][x] = "road";
  }
}

function neighborsAny(x, y, type) {
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (inBounds(x + dx, y + dy) && state.grid[y + dy][x + dx] === type) return true;
    }
  return false;
}

function scatter(type, density) {
  for (let y = 0; y < state.rows; y++)
    for (let x = 0; x < state.cols; x++)
      if ((state.grid[y][x] === BG || state.grid[y][x] === "sand") && Math.random() < density)
        state.grid[y][x] = type;
}

function drawBorder(type) {
  for (let x = 0; x < state.cols; x++) {
    state.grid[0][x] = type;
    state.grid[state.rows - 1][x] = type;
  }
  for (let y = 0; y < state.rows; y++) {
    state.grid[y][0] = type;
    state.grid[y][state.cols - 1] = type;
  }
}

// ---------- toast ----------

let toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

// ---------- boot ----------

window.addEventListener("resize", () => {
  fitCanvas();
  render();
});

function init() {
  state.grid = makeGrid(state.cols, state.rows);
  buildPalette();
  buildChips();
  setTool("brush");
  refreshActive();
  fitCanvas();
  render();
  checkStatus();
}

init();
