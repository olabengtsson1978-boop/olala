// Kortkoll – delad logik för skanna- och samlingssidan.
//
// Bygger på samma grund som Stash: allt sparas lokalt i webbläsaren
// (localStorage), och den enda servern är din egen Cloudflare Worker
// (worker/worker.js), som skickar bilden vidare till en AI som
// identifierar kortet och söker efter sålda exemplar. Se README.md.

const KK_CARDS_KEY = "kortkollCards";
const KK_WORKER_URL_KEY = "kortkollWorkerUrl";
// Samma Worker som Stash använder som standard. Har du sparat en egen
// Worker-URL i Stash används den också här, om Kortkoll saknar en egen.
const KK_STASH_WORKER_URL_KEY = "stashWorkerUrl";
const KK_DEFAULT_WORKER_URL = "https://olala.olabengtsson1978.workers.dev";

// ---- Lagring ----

function kkRead(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function kkWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    throw new Error(
      err && err.name === "QuotaExceededError"
        ? "Lagringen i webbläsaren är full. Exportera samlingen och ta bort några kort."
        : `Kunde inte spara: ${err.message || err}`
    );
  }
}

function getWorkerUrl() {
  return kkRead(KK_WORKER_URL_KEY, "") || kkRead(KK_STASH_WORKER_URL_KEY, "") || KK_DEFAULT_WORKER_URL;
}

function setWorkerUrl(url) {
  kkWrite(KK_WORKER_URL_KEY, (url || "").trim());
}

function getCards() {
  const cards = kkRead(KK_CARDS_KEY, []);
  return Array.isArray(cards) ? cards : [];
}

function saveCards(cards) {
  kkWrite(KK_CARDS_KEY, cards);
}

function addCard(entry) {
  const cards = getCards();
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const record = {
    id,
    addedAt: new Date().toISOString(),
    ...entry,
    history: entry.valuation ? [{ at: entry.valuation.valuedAt, typical: entry.valuation.typical }] : [],
  };
  cards.unshift(record);
  saveCards(cards);
  return record;
}

function updateCard(id, patch) {
  const cards = getCards();
  const i = cards.findIndex((c) => c.id === id);
  if (i === -1) return null;
  cards[i] = { ...cards[i], ...patch };
  saveCards(cards);
  return cards[i];
}

function deleteCard(id) {
  saveCards(getCards().filter((c) => c.id !== id));
}

// ---- Bilder ----

// Skalar ner fotot innan det skickas: snabbare uppladdning och billigare
// AI-anrop, och 1280 px räcker gott för att läsa text på ett kort.
// createImageBitmap följer EXIF-rotationen, så mobilfoton hamnar rätt.
async function resizeImage(file, maxSide, quality) {
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Kunde inte läsa bilden."));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = source.width || source.naturalWidth;
  const h = source.height || source.naturalHeight;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  if (source.close) source.close();
  return canvas.toDataURL("image/jpeg", quality);
}

// ---- Worker ----

async function callWorker(payload) {
  const base = getWorkerUrl().trim().replace(/\/$/, "");
  const controller = new AbortController();
  // Identifiering + prissökning tar ofta 30 s–2 min.
  const timer = setTimeout(() => controller.abort(), 300000);
  try {
    const res = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.error) {
      throw new Error((data && data.error) || `HTTP ${res.status}`);
    }
    return data;
  } catch (err) {
    throw new Error(err.name === "AbortError" ? "Workern svarade inte i tid." : err.message);
  } finally {
    clearTimeout(timer);
  }
}

function scanCard(images, note) {
  return callWorker({ mode: "cardScan", images, note: note || undefined });
}

function revalue(card) {
  return callWorker({ mode: "cardRevalue", card });
}

// ---- Formatering ----

const KK_SEK = new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 });

function sek(n) {
  return n == null ? "–" : KK_SEK.format(n);
}

function cardTitle(card) {
  return card.player || "Okänt kort";
}

function cardSubtitle(card) {
  return [card.year, card.manufacturer, card.set, card.cardNumber ? `#${card.cardNumber}` : null]
    .filter(Boolean)
    .join(" · ");
}

const PROVIDER_LABEL = { groq: "Groq", mistral: "Mistral", claude: "Claude" };

// Liten hjälpare som bygger DOM-element säkert (textContent, aldrig
// innerHTML), eftersom allt som visas kommer från en AI.
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

function renderValuation(valuation) {
  if (!valuation) {
    return h(
      "div",
      { class: "value-box" },
      h("div", { class: "value-label" }, "Värdering"),
      h("div", { class: "para" }, "Ingen värdering kunde tas fram den här gången.")
    );
  }
  const date = valuation.valuedAt ? new Date(valuation.valuedAt).toLocaleDateString("sv-SE") : null;
  return h(
    "div",
    { class: "value-box" },
    h("div", { class: "value-label" }, "Uppskattat värde", date ? ` · ${date}` : ""),
    h("div", { class: "value-main" }, sek(valuation.typical)),
    h("div", { class: "value-range" }, `Spann ${sek(valuation.low)} – ${sek(valuation.high)}`),
    !valuation.verified &&
      h(
        "div",
        { class: "value-flag" },
        "Obekräftad uppskattning – inga sålda exemplar med kontrollerbar länk hittades. Ta siffran med en nypa salt."
      )
  );
}

function renderComparables(valuation) {
  if (!valuation || !valuation.comparables || valuation.comparables.length === 0) return null;
  return [
    h("h2", null, "Jämförbara försäljningar"),
    h(
      "ul",
      { class: "comps" },
      valuation.comparables.map((c) => {
        const href = safeUrl(c.url);
        const price =
          c.priceSek != null
            ? sek(c.priceSek)
            : c.price != null
              ? `${c.price} ${c.currency || ""}`.trim()
              : "–";
        return h(
          "li",
          null,
          h(
            "div",
            null,
            href ? h("a", { href, target: "_blank", rel: "noopener noreferrer" }, c.title) : c.title,
            h("div", { class: "muted" }, [c.source, c.date, c.sold ? "såld" : "annons"].filter(Boolean).join(" · "))
          ),
          h("div", { class: "price" }, price)
        );
      })
    ),
  ];
}

// Ritar upp hela resultatet för ett kort (används både direkt efter en
// skanning och när man öppnar ett kort i samlingen).
function renderResult({ card, valuation, provider, notes, thumb }) {
  if (!card || !card.isCard) {
    return h(
      "div",
      { class: "result" },
      h("p", { class: "result-title" }, "Hittade inget kort"),
      h("p", { class: "para" }, "Bilden ser inte ut att visa ett samlarkort. Prova igen med kortet rakt framifrån, bra ljus och utan reflexer."),
      renderNotes(notes, provider)
    );
  }

  const badges = [
    card.rookie && h("span", { class: "badge rc" }, "Rookie"),
    card.autograph && h("span", { class: "badge gold" }, "Autograf"),
    card.memorabilia && h("span", { class: "badge gold" }, "Tröjbit/patch"),
    card.serialNumber && h("span", { class: "badge gold" }, `Numrerat ${card.serialNumber}`),
    card.grading && h("span", { class: "badge" }, `${card.grading.company} ${card.grading.grade || ""}`.trim()),
    h("span", { class: "badge" }, `Säkerhet: ${card.confidence}`),
  ];

  const rows = [
    ["Lag", card.team],
    ["År", card.year],
    ["Tillverkare", card.manufacturer],
    ["Serie", card.set],
    ["Nummer", card.cardNumber],
    ["Variant", card.variant],
    ["Skick", card.conditionEstimate],
  ].filter(([, v]) => v);

  return h(
    "div",
    { class: "result" },
    h(
      "div",
      { class: "result-head" },
      thumb && h("img", { src: thumb, alt: "" }),
      h(
        "div",
        { style: "min-width:0" },
        h("p", { class: "result-title" }, cardTitle(card)),
        h("p", { class: "result-sub" }, cardSubtitle(card) || "Serie okänd"),
        h("div", { class: "badges" }, badges)
      )
    ),
    renderValuation(valuation),
    valuation && valuation.basis && h("p", { class: "para muted" }, valuation.basis),
    rows.length > 0 && h("dl", { class: "facts" }, rows.map(([k, v]) => [h("dt", null, k), h("dd", null, v)])),
    card.facts && [h("h2", null, "Om kortet"), h("p", { class: "para" }, card.facts)],
    card.condition && [h("h2", null, "Synligt skick"), h("p", { class: "para" }, card.condition)],
    valuation && valuation.marketNote && [h("h2", null, "Tips"), h("p", { class: "para" }, valuation.marketNote)],
    renderComparables(valuation),
    card.uncertainties && h("p", { class: "para muted" }, `Osäkert: ${card.uncertainties}`),
    renderNotes(notes, provider)
  );
}

function renderNotes(notes, provider) {
  const list = (notes || []).map((n) => h("div", null, `${n.name}: ${n.message}`));
  if (provider) list.push(h("div", null, `Analyserat av ${PROVIDER_LABEL[provider] || provider}.`));
  return list.length ? h("div", { class: "notes" }, list) : null;
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

function updateCountBadge() {
  const el = document.getElementById("count");
  if (el) el.textContent = String(getCards().length);
}
