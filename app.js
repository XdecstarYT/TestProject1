// Roomie — AI room glow-up. Calls the Anthropic Messages API (Claude vision)
// directly from the browser and renders a tidiness score + cozy suggestions.

const MODEL = "claude-opus-4-8";
const API_URL = "https://api.anthropic.com/v1/messages";
const RING_CIRCUMFERENCE = 327; // 2 * π * r, r = 52

// ---- element refs ----
const els = {
  apiKey: document.getElementById("apiKey"),
  toggleKey: document.getElementById("toggleKey"),
  rememberKey: document.getElementById("rememberKey"),
  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("fileInput"),
  preview: document.getElementById("preview"),
  dropEmpty: document.getElementById("dropEmpty"),
  analyzeBtn: document.getElementById("analyzeBtn"),
  errorMsg: document.getElementById("errorMsg"),
  loader: document.getElementById("loader"),
  loaderText: document.getElementById("loaderText"),
  results: document.getElementById("results"),
  scoreNum: document.getElementById("scoreNum"),
  ringFg: document.getElementById("ringFg"),
  rankBadge: document.getElementById("rankBadge"),
  vibe: document.getElementById("vibe"),
  categories: document.getElementById("categories"),
  suggestions: document.getElementById("suggestions"),
  againBtn: document.getElementById("againBtn"),
};

// current image as { mediaType, base64 }
let currentImage = null;

// ---- API key persistence (opt-in) ----
const STORAGE_KEY = "roomie_api_key";
const saved = localStorage.getItem(STORAGE_KEY);
if (saved) {
  els.apiKey.value = saved;
  els.rememberKey.checked = true;
}

els.toggleKey.addEventListener("click", () => {
  els.apiKey.type = els.apiKey.type === "password" ? "text" : "password";
});

function persistKey() {
  if (els.rememberKey.checked) {
    localStorage.setItem(STORAGE_KEY, els.apiKey.value.trim());
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}
els.apiKey.addEventListener("input", persistKey);
els.rememberKey.addEventListener("change", persistKey);

// ---- file handling ----
els.dropzone.addEventListener("click", () => els.fileInput.click());
els.dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    els.fileInput.click();
  }
});
els.fileInput.addEventListener("change", (e) => {
  if (e.target.files && e.target.files[0]) loadImage(e.target.files[0]);
});

["dragenter", "dragover"].forEach((evt) =>
  els.dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropzone.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((evt) =>
  els.dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropzone.classList.remove("dragover");
  })
);
els.dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) loadImage(file);
});

function loadImage(file) {
  if (!file.type.startsWith("image/")) {
    showError("That doesn't look like an image 🤔 try a photo instead.");
    return;
  }
  hideError();
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    const [meta, base64] = dataUrl.split(",");
    const mediaType = meta.match(/data:(.*?);/)[1];
    currentImage = { mediaType, base64 };

    els.preview.src = dataUrl;
    els.preview.classList.remove("hidden");
    els.dropEmpty.classList.add("hidden");
    els.analyzeBtn.disabled = false;
  };
  reader.readAsDataURL(file);
}

// ---- the prompt + schema ----
const PROMPT = `You are Roomie, a warm, encouraging room-organization coach with great taste.
Look at this photo of a room and analyze how tidy, clean, and pleasant it is.

Rate it fairly but kindly. Then give specific, doable suggestions to clean, fix, or improve the space.
Be concrete (reference what you actually see), upbeat, and never mean. Use a cozy, friendly tone.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overall_score", "rank", "vibe", "categories", "suggestions"],
  properties: {
    overall_score: {
      type: "integer",
      description: "Overall tidiness/cosiness score from 0 to 100",
    },
    rank: {
      type: "string",
      description: "A short, fun rank/grade label, e.g. 'Cozy Haven', 'Getting There', 'Gremlin Den'",
    },
    vibe: {
      type: "string",
      description: "One warm sentence summarizing the room's current vibe",
    },
    categories: {
      type: "array",
      description: "3 to 5 scored categories",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "emoji", "score"],
        properties: {
          name: { type: "string", description: "e.g. Tidiness, Cleanliness, Cosiness, Organization, Light" },
          emoji: { type: "string", description: "one fitting emoji" },
          score: { type: "integer", description: "0 to 100" },
        },
      },
    },
    suggestions: {
      type: "array",
      description: "4 to 6 specific improvement suggestions",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["emoji", "title", "description", "effort"],
        properties: {
          emoji: { type: "string" },
          title: { type: "string", description: "short action title" },
          description: { type: "string", description: "one or two friendly sentences explaining what to do" },
          effort: { type: "string", enum: ["quick", "medium", "project"] },
        },
      },
    },
  },
};

// ---- analyze ----
els.analyzeBtn.addEventListener("click", analyze);
els.againBtn.addEventListener("click", reset);

const LOADING_LINES = [
  "Peeking into your room…",
  "Counting the cozy corners…",
  "Spotting the clutter gremlins…",
  "Sketching your glow-up plan…",
  "Adding a sprinkle of sparkle…",
];

async function analyze() {
  const key = els.apiKey.value.trim();
  if (!key) {
    showError("Pop in your Anthropic API key first 🔑");
    return;
  }
  if (!currentImage) {
    showError("Add a room photo to analyze 📸");
    return;
  }

  hideError();
  els.analyzeBtn.disabled = true;
  els.results.classList.add("hidden");
  els.loader.classList.remove("hidden");
  const stopLoader = cycleLoaderText();

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: currentImage.mediaType,
                  data: currentImage.base64,
                },
              },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const detail = await safeError(res);
      throw new Error(detail);
    }

    const data = await res.json();

    if (data.stop_reason === "refusal") {
      throw new Error("The model declined to analyze this image. Try a different photo.");
    }

    const textBlock = (data.content || []).find((b) => b.type === "text");
    if (!textBlock) throw new Error("No analysis came back. Try again in a moment.");

    const result = JSON.parse(textBlock.text);
    renderResults(result);
  } catch (err) {
    showError(prettyError(err));
  } finally {
    stopLoader();
    els.loader.classList.add("hidden");
    els.analyzeBtn.disabled = false;
  }
}

function cycleLoaderText() {
  let i = 0;
  els.loaderText.textContent = LOADING_LINES[0];
  const id = setInterval(() => {
    i = (i + 1) % LOADING_LINES.length;
    els.loaderText.textContent = LOADING_LINES[i];
  }, 2200);
  return () => clearInterval(id);
}

// ---- rendering ----
function renderResults(r) {
  // score ring + count-up
  const score = clamp(r.overall_score, 0, 100);
  els.ringFg.style.stroke = scoreColor(score);
  els.ringFg.style.strokeDashoffset = RING_CIRCUMFERENCE;
  countUp(els.scoreNum, score, 1300);
  // trigger ring animation on next frame
  requestAnimationFrame(() => {
    els.ringFg.style.strokeDashoffset =
      RING_CIRCUMFERENCE - (RING_CIRCUMFERENCE * score) / 100;
  });

  els.rankBadge.textContent = r.rank || "—";
  els.vibe.textContent = r.vibe || "";

  // categories
  els.categories.innerHTML = "";
  (r.categories || []).forEach((c) => {
    const cs = clamp(c.score, 0, 100);
    const row = document.createElement("div");
    row.className = "cat-row";
    row.innerHTML = `
      <span class="cat-emoji">${escapeHtml(c.emoji || "🏠")}</span>
      <span class="cat-name">${escapeHtml(c.name || "")}</span>
      <span class="cat-score">${cs}</span>
      <div class="cat-bar-wrap"><div class="cat-bar"></div></div>`;
    els.categories.appendChild(row);
    const bar = row.querySelector(".cat-bar");
    bar.style.background = scoreColor(cs);
    requestAnimationFrame(() => (bar.style.width = cs + "%"));
  });

  // suggestions
  els.suggestions.innerHTML = "";
  (r.suggestions || []).forEach((s) => {
    const effort = ["quick", "medium", "project"].includes(s.effort) ? s.effort : "medium";
    const card = document.createElement("div");
    card.className = "sug";
    card.innerHTML = `
      <span class="sug-emoji">${escapeHtml(s.emoji || "✨")}</span>
      <div class="sug-body">
        <p class="sug-title">${escapeHtml(s.title || "")}</p>
        <p class="sug-desc">${escapeHtml(s.description || "")}</p>
        <span class="effort ${effort}">${effort}</span>
      </div>`;
    els.suggestions.appendChild(card);
  });

  els.results.classList.remove("hidden");
  els.results.scrollIntoView({ behavior: "smooth", block: "start" });
}

function reset() {
  currentImage = null;
  els.fileInput.value = "";
  els.preview.src = "";
  els.preview.classList.add("hidden");
  els.dropEmpty.classList.remove("hidden");
  els.results.classList.add("hidden");
  els.analyzeBtn.disabled = true;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---- helpers ----
function scoreColor(s) {
  if (s >= 75) return "#7ed9a0"; // mint
  if (s >= 50) return "#ffd36b"; // butter
  if (s >= 25) return "#ffb07c"; // peach
  return "#ff9ec2"; // pink
}

function countUp(el, target, duration) {
  const start = performance.now();
  function frame(now) {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(eased * target);
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function clamp(n, lo, hi) {
  n = Number(n);
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function safeError(res) {
  try {
    const body = await res.json();
    if (body && body.error && body.error.message) return body.error.message;
  } catch (_) {}
  return `Request failed (HTTP ${res.status})`;
}

function prettyError(err) {
  const msg = err && err.message ? err.message : String(err);
  if (/Failed to fetch|NetworkError/i.test(msg)) {
    return "Couldn't reach the API. Check your connection and try again.";
  }
  if (/authentication|invalid x-api-key|401/i.test(msg)) {
    return "That API key didn't work 🔑 double-check it and try again.";
  }
  if (/credit|billing|quota|429/i.test(msg)) {
    return "Rate limit or billing issue on your account. Try again shortly.";
  }
  return msg;
}

function showError(msg) {
  els.errorMsg.textContent = msg;
  els.errorMsg.classList.remove("hidden");
}
function hideError() {
  els.errorMsg.classList.add("hidden");
}
