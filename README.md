# Roomie ✨ — AI Room Glow-Up

A cute little web app that looks at a photo of your room and gives you:

- 🧮 an overall **tidiness score** out of 100 (with an animated ring)
- 🎖️ a playful **rank** (e.g. *Cozy Haven*, *Getting There*, *Gremlin Den*)
- 🎨 a **category breakdown** (tidiness, cleanliness, cosiness, organization, light…)
- 🌟 a friendly **glow-up plan** — specific things to clean, fix, or improve, tagged
  by effort (`quick` · `medium` · `project`)

It's powered by **Claude Opus 4.8** vision and has a soft, hand-drawn, pastel UI.

![flow: upload a room photo → score + suggestions](https://img.shields.io/badge/snap-→-score%20%2B%20glow--up-ffc2d4)

## Run it

No build step, no dependencies. It's a static site.

```bash
# from the project folder, start any static server, e.g.:
python3 -m http.server 8000
# then open http://localhost:8000
```

Or just open `index.html` directly in your browser.

## Use it

1. Paste your **Anthropic API key** (get one at
   [console.anthropic.com](https://console.anthropic.com/settings/keys)).
   The key stays in your browser — optionally remembered in `localStorage`.
2. Drop or choose a **photo of your room**.
3. Hit **Analyze my room** 🪄 and watch your score appear.

## How it works

The browser sends your photo straight to the Anthropic Messages API using
`fetch` with the `anthropic-dangerous-direct-browser-access` header, and asks
for a **structured JSON** response via `output_config.format` so the UI always
gets clean, predictable data:

```
overall_score · rank · vibe · categories[] · suggestions[]
```

See `app.js` for the request, prompt, and JSON schema.

## Files

| File | What it is |
|------|------------|
| `index.html` | markup / layout |
| `styles.css` | the cozy pastel, hand-drawn styling |
| `app.js` | image handling + Claude vision call + rendering |

## Notes

- This is a **client-side** app: your API key is used directly from the browser,
  which is fine for personal/local use. For a public deployment, put the key
  behind a small backend proxy instead of shipping it to the browser.
- Images are encoded as base64 and sent inline; very large photos are fine but
  smaller ones are faster.
