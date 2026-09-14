// Delad lagringslogik. Allt sparas lokalt i webbläsaren (localStorage)
// – inget skickas till någon server, förutom att RSS-flöden hämtas
// direkt (eller via en CORS-proxy) när du ber om nya förslag.

const STORAGE_KEY = "stashCards";
const STASHES_KEY = "stashStashes";
const FEEDS_KEY = "stashFeeds";
const SEEN_KEY = "stashSeenSuggestions";

// Leitner-lådor: hur många dagar tills ett kort dyker upp igen
// efter att man svarat "Kom ihåg" i den lådan.
const BOX_INTERVAL_DAYS = [0, 1, 2, 4, 8, 16];
const MAX_BOX = BOX_INTERVAL_DAYS.length - 1;
const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_FEEDS = [
  { name: "Smithsonian", url: "https://www.smithsonianmag.com/rss/science-nature/" },
  { name: "ScienceDaily", url: "https://feeds.sciencedaily.com/sciencedaily/top_news/top_science" },
  { name: "NASA", url: "https://www.nasa.gov/rss/dyn/breaking_news.rss" },
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

async function addCard({ text, sourceTitle, sourceUrl, tags, stashId }) {
  const cards = await getAllCards();
  const now = Date.now();
  const card = {
    id: uid(),
    text: text.trim(),
    sourceTitle: sourceTitle || "",
    sourceUrl: sourceUrl || "",
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

async function getFeeds() {
  const feeds = readJSON(FEEDS_KEY, null);
  if (feeds === null) {
    writeJSON(FEEDS_KEY, DEFAULT_FEEDS);
    return DEFAULT_FEEDS.slice();
  }
  return feeds;
}

async function saveFeeds(feeds) {
  writeJSON(FEEDS_KEY, feeds);
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

// "Sedda" förslag (sparade eller nedtackade) döljs i kommande uppdateringar.

async function getSeenUrls() {
  return readJSON(SEEN_KEY, []);
}

async function markSeen(url) {
  if (!url) return;
  const seen = await getSeenUrls();
  if (!seen.includes(url)) {
    seen.push(url);
    if (seen.length > 1000) seen.splice(0, seen.length - 1000);
    writeJSON(SEEN_KEY, seen);
  }
}

async function exportBackup() {
  return {
    exportedAt: new Date().toISOString(),
    cards: await getAllCards(),
    stashes: await getAllStashes(),
    feeds: await getFeeds(),
  };
}

async function importBackup(data) {
  if (!data || !Array.isArray(data.cards)) {
    throw new Error("Filen innehåller ingen giltig Stash-säkerhetskopia.");
  }
  await saveAllCards(data.cards);
  await saveAllStashes(Array.isArray(data.stashes) ? data.stashes : []);
  if (Array.isArray(data.feeds)) await saveFeeds(data.feeds);
}
