# 🗺️ WorldSmith

An AI-assisted designer for **houses, cities, and roads** in your own fictional
worlds. Paint a tile map by hand, or describe a place in plain language and let
Claude lay out the streets, districts, harbors, and walls for you — then have it
write the lore.

![tiles: grass, water, roads, houses, towers, parks, walls and more](https://img.shields.io/badge/tiles-13-4cc2ff) ![model](https://img.shields.io/badge/AI-claude--opus--4--8-ffb454)

## Features

- **Tile editor** — brush, line/road, rectangle, flood-fill, and erase tools across
  a palette of 13 terrain and structure tiles (grass, water, sand, forest, road,
  bridge, house, building, tower, farm, park, plaza, wall).
- **AI world generation** — type a brief like _"a cliffside fishing village with a
  harbor and a lighthouse"_ and Claude designs a coherent layout, placing roads,
  buildings, bridges, and green space onto the grid.
- **AI lore** — turn whatever you've drawn into a named place with history,
  inhabitants, and a secret. The current map is summarized (counts + an ASCII
  sketch) and sent to Claude.
- **Procedural fallback** — no API key? The app still generates plausible
  settlements with a built-in procedural designer.
- **Save / load / export** — keep worlds in your browser, or export them as JSON
  or PNG.

## Quick start

```bash
npm install

# Option A — no AI: the editor + procedural generator work out of the box
npm start

# Option B — with AI generation and lore:
export ANTHROPIC_API_KEY=sk-ant-...   # or put it in a .env file (see .env.example)
node --env-file=.env server.js        # Node 20.6+ auto-loads the .env file
```

Then open <http://localhost:3000>.

> If `ANTHROPIC_API_KEY` is already exported in your environment, plain
> `npm start` picks it up and the AI features turn on automatically — the badge
> in the top bar shows **AI ready**.

## How it works

```
public/            Static single-page app (no build step)
  index.html       Layout: palette · canvas · AI panel
  styles.css       Dark cartographer theme
  app.js           Canvas tile engine, tools, AI calls, procedural generator
server.js          Express server + Claude API proxy
```

The browser never sees your API key. Two endpoints proxy to Claude:

- `POST /api/generate` — uses **structured outputs** (`output_config.format`) so
  Claude returns a validated JSON layout: `{ name, description, tiles: [{x,y,type}] }`.
  The server clamps every tile to the grid and to the allowed palette.
- `POST /api/describe` — sends a compact summary of your map and gets back
  markdown lore.

Both use `claude-opus-4-8` via the official `@anthropic-ai/sdk`.

## Tips

- Press **B / L / R / F / E** to switch tools; the brush-size slider thickens the
  brush, line, and rect tools (great for wide boulevards).
- The example chips under the prompt box are good starting points.
- "Clear first" controls whether a new generation wipes the canvas or paints on
  top of what you've drawn.
