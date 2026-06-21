import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: "4mb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const MODEL = "claude-opus-4-8";

// The palette the AI is allowed to paint with. Kept in sync with public/app.js.
const TILE_TYPES = [
  "grass",
  "water",
  "sand",
  "forest",
  "road",
  "bridge",
  "house",
  "building",
  "tower",
  "farm",
  "park",
  "plaza",
  "wall",
];

const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
const client = hasKey ? new Anthropic() : null;

// Report whether the AI features are wired up, so the UI can adapt.
app.get("/api/status", (_req, res) => {
  res.json({ ai: hasKey, model: MODEL });
});

/**
 * Generate a layout from a natural-language brief. Claude returns a name,
 * a short piece of lore, and a list of tile placements bounded to the grid.
 */
app.post("/api/generate", async (req, res) => {
  if (!client) return res.status(503).json({ error: "no_api_key" });

  const width = clampInt(req.body?.width, 8, 80, 40);
  const height = clampInt(req.body?.height, 8, 60, 28);
  const brief = String(req.body?.prompt || "").slice(0, 2000).trim();
  if (!brief) return res.status(400).json({ error: "empty_prompt" });

  const system = [
    "You are WorldSmith, a cartographer that designs settlements for fictional worlds.",
    `You paint on a ${width}-wide by ${height}-tall tile grid. The origin (0,0) is the top-left corner.`,
    "x ranges from 0 to " + (width - 1) + " and y ranges from 0 to " + (height - 1) + ".",
    "Design like a real planner: lay continuous road networks first, place bridges where roads cross water,",
    "cluster houses and buildings along roads, leave parks and plazas as breathing room, and use forests,",
    "water, sand, and farms to give the land character. Only return tiles you actually want painted —",
    "unlisted tiles stay as background grass. Aim for a coherent, readable place, not random noise.",
  ].join(" ");

  const schema = {
    type: "object",
    properties: {
      name: { type: "string", description: "An evocative name for this place." },
      description: {
        type: "string",
        description: "Two or three sentences of lore describing the place.",
      },
      tiles: {
        type: "array",
        description: "The tiles to paint onto the grid.",
        items: {
          type: "object",
          properties: {
            x: { type: "integer" },
            y: { type: "integer" },
            type: { type: "string", enum: TILE_TYPES },
          },
          required: ["x", "y", "type"],
          additionalProperties: false,
        },
      },
    },
    required: ["name", "description", "tiles"],
    additionalProperties: false,
  };

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system,
      output_config: { format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: brief }],
    });

    const text = message.content.find((b) => b.type === "text")?.text ?? "{}";
    const parsed = JSON.parse(text);
    const tiles = sanitizeTiles(parsed.tiles, width, height);
    res.json({
      name: String(parsed.name || "Untitled"),
      description: String(parsed.description || ""),
      tiles,
    });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * Write lore for whatever the user has already built. The current map is
 * summarized into counts + a compact ascii sketch so Claude can "see" it.
 */
app.post("/api/describe", async (req, res) => {
  if (!client) return res.status(503).json({ error: "no_api_key" });

  const grid = req.body?.grid;
  if (!Array.isArray(grid) || !Array.isArray(grid[0])) {
    return res.status(400).json({ error: "bad_grid" });
  }

  const summary = summarizeGrid(grid);

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system:
        "You are WorldSmith, a worldbuilding companion. Given a summary of a hand-drawn map, " +
        "invent rich, grounded lore: a name, the history, who lives here, and one intriguing secret. " +
        "Be vivid but concise. Respond in markdown with a level-2 heading for the name.",
      messages: [
        {
          role: "user",
          content:
            "Here is my map.\n\n" +
            summary +
            "\n\nName this place and tell me its story.",
        },
      ],
    });

    const text = message.content.find((b) => b.type === "text")?.text ?? "";
    res.json({ description: text });
  } catch (err) {
    handleError(res, err);
  }
});

app.listen(PORT, () => {
  console.log(`WorldSmith running at http://localhost:${PORT}`);
  if (!hasKey) {
    console.log(
      "Note: ANTHROPIC_API_KEY is not set. The editor works fully, but AI " +
        "generation falls back to a built-in procedural generator.",
    );
  }
});

// ---------- helpers ----------

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sanitizeTiles(tiles, width, height) {
  if (!Array.isArray(tiles)) return [];
  const allowed = new Set(TILE_TYPES);
  const seen = new Set();
  const out = [];
  for (const t of tiles) {
    const x = Number.parseInt(t?.x, 10);
    const y = Number.parseInt(t?.y, 10);
    const type = String(t?.type);
    if (Number.isNaN(x) || Number.isNaN(y)) continue;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    if (!allowed.has(type)) continue;
    const key = `${x},${y}`;
    if (seen.has(key)) continue; // last-write-wins would also be fine
    seen.add(key);
    out.push({ x, y, type });
  }
  return out;
}

function summarizeGrid(grid) {
  const counts = {};
  const height = grid.length;
  const width = grid[0].length;
  const glyphs = {
    grass: ".",
    water: "~",
    sand: ":",
    forest: "T",
    road: "+",
    bridge: "=",
    house: "h",
    building: "B",
    tower: "I",
    farm: "f",
    park: "p",
    plaza: "o",
    wall: "#",
  };

  const lines = [];
  // Downsample to keep the sketch compact for large maps.
  const stepX = Math.max(1, Math.ceil(width / 60));
  const stepY = Math.max(1, Math.ceil(height / 40));
  for (let y = 0; y < height; y += stepY) {
    let line = "";
    for (let x = 0; x < width; x += stepX) {
      const type = grid[y][x] || "grass";
      counts[type] = (counts[type] || 0) + 1;
      line += glyphs[type] ?? ".";
    }
    lines.push(line);
  }

  const tally = Object.entries(counts)
    .filter(([k]) => k !== "grass")
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");

  return (
    `Grid size: ${width} x ${height}.\n` +
    `Feature counts (sampled): ${tally || "mostly empty grassland"}.\n\n` +
    "ASCII sketch (top-down):\n```\n" +
    lines.join("\n") +
    "\n```"
  );
}

function handleError(res, err) {
  console.error(err);
  if (err instanceof Anthropic.APIError) {
    return res
      .status(err.status || 500)
      .json({ error: "api_error", message: err.message });
  }
  res.status(500).json({ error: "server_error", message: String(err?.message || err) });
}
