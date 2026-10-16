// Delad lagringslogik. Allt sparas lokalt i webbläsaren (localStorage)
// – inget skickas till någon server, förutom att RSS-flöden hämtas och
// AI-kureras via din egen Cloudflare Worker när du ber om nya förslag.
//
// Barnsidorna (barn.html, barn-bibliotek.html, barn-repetera.html) delar
// den här filen och alla dess funktionsnamn med vuxensidorna (så att
// library.js/review.js kan återanvändas rakt av), men de får ALDRIG peka
// på samma data: kort, stashes, "sedda förslag"-historik och intressen
// läses/skrivs till separata nycklar beroende på vilken sida koden körs
// på, avgjort av filnamnet i location.pathname. Det gör att ett barns
// sparade kort, stashes och historik aldrig syns för eller läcker in i
// vuxenversionens AI-personalisering, och tvärtom. Worker-URL:en (vilken
// backend som anropas) och flödeslistan är fortsatt gemensamma – det är
// driftsinställningar, inte personligt innehåll.
const IS_KID_PAGE = (() => {
  const file = location.pathname.split("/").pop() || "";
  return file.startsWith("barn");
})();

const STORAGE_KEY = IS_KID_PAGE ? "stashKidCards" : "stashCards";
const STASHES_KEY = IS_KID_PAGE ? "stashKidStashes" : "stashStashes";
const FEEDS_KEY = "stashFeeds";
const SEEN_KEY = IS_KID_PAGE ? "stashKidSeenSuggestions" : "stashSeenSuggestions";
const WORKER_URL_KEY = "stashWorkerUrl";
const PREFERENCES_KEY = IS_KID_PAGE ? "stashKidPreferences" : "stashPreferences";
const PENDING_SUGGESTIONS_KEY = IS_KID_PAGE ? "stashPendingKidSuggestions" : "stashPendingSuggestions";

// Leitner-lådor: hur många dagar tills ett kort dyker upp igen
// efter att man svarat "Kom ihåg" i den lådan.
const BOX_INTERVAL_DAYS = [0, 1, 2, 4, 8, 16];
const MAX_BOX = BOX_INTERVAL_DAYS.length - 1;
const DAY_MS = 24 * 60 * 60 * 1000;

// OBS: fof.se/forskning.se/illvet.se-URL:erna är rimliga gissningar
// (vanligt WordPress-mönster) som inte gått att bekräfta live – testa
// dem med "Testa"-knappen i appen och ta bort de som inte fungerar.
const DEFAULT_FEEDS = [
  { name: "Forskning & Framsteg", url: "https://fof.se/feed/" },
  { name: "forskning.se", url: "https://forskning.se/feed/" },
  { name: "Illustrerad Vetenskap", url: "https://illvet.se/feed/" },
  { name: "SVT Nyheter", url: "https://www.svt.se/rss.xml" },
];

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

async function getAllCards() {
  return readJSON(STORAGE_KEY, []);
}

async function saveAllCards(cards) {
  writeJSON(STORAGE_KEY, cards);
}

async function addCard({ text, sourceTitle, sourceUrl, tags, stashId, body, sources }) {
  const cards = await getAllCards();
  const now = Date.now();
  const card = {
    id: uid(),
    text: text.trim(),
    sourceTitle: sourceTitle || "",
    sourceUrl: sourceUrl || "",
    body: body || "",
    sources: Array.isArray(sources) ? sources : [],
    tags: (tags || []).map((t) => t.trim().toLowerCase()).filter(Boolean),
    stashId: stashId || null,
    createdAt: now,
    box: 1,
    nextReview: now,
    reviewCount: 0,
  };
  cards.unshift(card);
  await saveAllCards(cards);
  return card;
}

async function deleteCard(id) {
  const cards = await getAllCards();
  await saveAllCards(cards.filter((c) => c.id !== id));
}

async function updateCardTags(id, tags) {
  const cards = await getAllCards();
  const card = cards.find((c) => c.id === id);
  if (!card) return;
  card.tags = tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
  await saveAllCards(cards);
}

async function updateCardStash(id, stashId) {
  const cards = await getAllCards();
  const card = cards.find((c) => c.id === id);
  if (!card) return;
  card.stashId = stashId || null;
  await saveAllCards(cards);
}

// Stashes = namngivna samlingar (som "decks" i DeepStash). Kort utan
// stashId hör till den underförstådda "Inkorgen".

async function getAllStashes() {
  return readJSON(STASHES_KEY, []);
}

async function saveAllStashes(stashes) {
  writeJSON(STASHES_KEY, stashes);
}

async function createStash(name) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const stashes = await getAllStashes();
  const stash = { id: uid(), name: trimmed };
  stashes.push(stash);
  await saveAllStashes(stashes);
  return stash;
}

async function renameStash(id, name) {
  const stashes = await getAllStashes();
  const stash = stashes.find((s) => s.id === id);
  if (!stash) return;
  stash.name = name.trim();
  await saveAllStashes(stashes);
}

async function deleteStash(id) {
  const stashes = await getAllStashes();
  await saveAllStashes(stashes.filter((s) => s.id !== id));

  const cards = await getAllCards();
  let changed = false;
  cards.forEach((c) => {
    if (c.stashId === id) {
      c.stashId = null;
      changed = true;
    }
  });
  if (changed) await saveAllCards(cards);
}

async function getDueCards() {
  const cards = await getAllCards();
  const now = Date.now();
  return cards
    .filter((c) => c.nextReview <= now)
    .sort((a, b) => a.nextReview - b.nextReview);
}

async function reviewCard(id, remembered) {
  const cards = await getAllCards();
  const card = cards.find((c) => c.id === id);
  if (!card) return;
  card.reviewCount += 1;
  card.box = remembered ? Math.min(card.box + 1, MAX_BOX) : 1;
  const intervalDays = BOX_INTERVAL_DAYS[card.box];
  card.nextReview = Date.now() + intervalDays * DAY_MS;
  await saveAllCards(cards);
}

// Flöden (feeds) – källor som "Upptäck"-vyn hämtar förslag ifrån.

// Tidigare standardflöden (innan de byttes ut). Den som aldrig ändrat
// sina flöden ska tyst uppgraderas till de nya standardflödena istället
// för att sitta fast på gamla listor för alltid, eftersom de bara
// sparades i webbläsaren en gång vid första besöket.
const PAST_DEFAULT_FEED_SETS = [
  ["https://hnrss.org/frontpage", "https://www.svt.se/nyheter/rss.xml", "https://www.nasa.gov/feed/"],
  [
    "https://www.smithsonianmag.com/rss/science-nature/",
    "https://feeds.sciencedaily.com/sciencedaily/top_news/top_science",
    "https://www.nasa.gov/rss/dyn/breaking_news.rss",
  ],
].map((urls) => urls.slice().sort().join("|"));

async function getFeeds() {
  const feeds = readJSON(FEEDS_KEY, null);
  if (feeds === null) {
    writeJSON(FEEDS_KEY, DEFAULT_FEEDS);
    return DEFAULT_FEEDS.slice();
  }

  const currentUrls = feeds
    .map((f) => f.url)
    .sort()
    .join("|");
  if (PAST_DEFAULT_FEED_SETS.includes(currentUrls)) {
    writeJSON(FEEDS_KEY, DEFAULT_FEEDS);
    return DEFAULT_FEEDS.slice();
  }

  return feeds;
}

async function saveFeeds(feeds) {
  writeJSON(FEEDS_KEY, feeds);
}

async function resetFeedsToDefault() {
  writeJSON(FEEDS_KEY, DEFAULT_FEEDS);
  return DEFAULT_FEEDS.slice();
}

async function addFeed(url, name) {
  const trimmed = url.trim();
  if (!trimmed) return;
  const feeds = await getFeeds();
  if (feeds.some((f) => f.url === trimmed)) return;
  feeds.push({ url: trimmed, name: (name || trimmed).trim() });
  await saveFeeds(feeds);
}

async function removeFeed(url) {
  const feeds = await getFeeds();
  await saveFeeds(feeds.filter((f) => f.url !== url));
}

// URL till din egen Cloudflare Worker som hämtar och AI-kuraterar
// förslagen (löser CORS och gör den faktiska destilleringen). Se
// README.md för hur du sätter upp en. Används DEFAULT_WORKER_URL om
// ingen egen URL sparats.

const DEFAULT_WORKER_URL = "https://olala.olabengtsson1978.workers.dev";

async function getWorkerUrl() {
  return readJSON(WORKER_URL_KEY, "") || DEFAULT_WORKER_URL;
}

async function setWorkerUrl(url) {
  writeJSON(WORKER_URL_KEY, (url || "").trim());
}

// Dina uttalade intressen – skickas med som kontext till AI-kurateringen.

async function getPreferences() {
  return readJSON(PREFERENCES_KEY, "");
}

async function setPreferences(text) {
  writeJSON(PREFERENCES_KEY, (text || "").trim());
}

// Förslag som hämtats men inte sparats eller hoppats över än. Sparas så
// att varje sidladdning inte kostar en ny (betald) webbsökning.

async function getPendingSuggestions() {
  return readJSON(PENDING_SUGGESTIONS_KEY, []);
}

async function savePendingSuggestions(items) {
  writeJSON(PENDING_SUGGESTIONS_KEY, items);
}

async function removePendingSuggestion(link) {
  const items = await getPendingSuggestions();
  await savePendingSuggestions(items.filter((it) => it.link !== link));
}

// "Sedda" förslag (sparade eller nedtackade) döljs i kommande
// uppdateringar. Utfallet (sparad/nedtackad) sparas också, så Workern
// kan lära sig vad du brukar gilla respektive hoppa över.

async function getSeenEntries() {
  const raw = readJSON(SEEN_KEY, []);
  // Migrerar från det äldre formatet (en ren lista av URL-strängar).
  return raw.map((entry) =>
    typeof entry === "string" ? { link: entry, title: "", outcome: "unknown", at: 0 } : entry
  );
}

async function getSeenUrls() {
  const entries = await getSeenEntries();
  return entries.map((e) => e.link);
}

async function markSeen(item, outcome) {
  const link = typeof item === "string" ? item : item?.link;
  if (!link) return;
  const entries = await getSeenEntries();
  if (entries.some((e) => e.link === link)) return;
  entries.push({
    link,
    title: (typeof item === "object" && item && item.title) || "",
    outcome: outcome || "unknown",
    at: Date.now(),
  });
  if (entries.length > 1000) entries.splice(0, entries.length - 1000);
  writeJSON(SEEN_KEY, entries);
}

// Senaste "gillade" (sparade) och "ogillade" (nedtackade) exempel, för
// att ge Workern en känsla för din smak. Gillade exempel är dina
// faktiska sparade kort (text + taggar); ogillade är bara titlar på
// sådant du hoppat över – ingen fullständig artikeltext sparas för dem.

async function getLikedExamples(limit = 15) {
  const cards = await getAllCards();
  return cards.slice(0, limit).map((c) => ({ text: c.text, tags: c.tags }));
}

async function getDislikedExamples(limit = 15) {
  const entries = await getSeenEntries();
  return entries
    .filter((e) => e.outcome === "skipped" && e.title)
    .slice(-limit)
    .map((e) => ({ title: e.title }));
}

async function exportBackup() {
  return {
    exportedAt: new Date().toISOString(),
    cards: await getAllCards(),
    stashes: await getAllStashes(),
    feeds: await getFeeds(),
    workerUrl: await getWorkerUrl(),
    preferences: await getPreferences(),
  };
}

async function importBackup(data) {
  if (!data || !Array.isArray(data.cards)) {
    throw new Error("Filen innehåller ingen giltig Stash-säkerhetskopia.");
  }
  await saveAllCards(data.cards);
  await saveAllStashes(Array.isArray(data.stashes) ? data.stashes : []);
  if (Array.isArray(data.feeds)) await saveFeeds(data.feeds);
  if (typeof data.workerUrl === "string") await setWorkerUrl(data.workerUrl);
  if (typeof data.preferences === "string") await setPreferences(data.preferences);
}
