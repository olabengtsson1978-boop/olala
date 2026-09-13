// Delad lagringslogik för korten. Allt sparas lokalt i webbläsaren
// (chrome.storage.local) – inget skickas till någon server.

const STORAGE_KEY = "stashCards";
const STASHES_KEY = "stashStashes";

// Leitner-lådor: hur många dagar tills ett kort dyker upp igen
// efter att man svarat "Kom ihåg" i den lådan.
const BOX_INTERVAL_DAYS = [0, 1, 2, 4, 8, 16];
const MAX_BOX = BOX_INTERVAL_DAYS.length - 1;
const DAY_MS = 24 * 60 * 60 * 1000;

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function getAllCards() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || [];
}

async function saveAllCards(cards) {
  await chrome.storage.local.set({ [STORAGE_KEY]: cards });
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
  const data = await chrome.storage.local.get(STASHES_KEY);
  return data[STASHES_KEY] || [];
}

async function saveAllStashes(stashes) {
  await chrome.storage.local.set({ [STASHES_KEY]: stashes });
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

async function exportBackup() {
  return {
    exportedAt: new Date().toISOString(),
    cards: await getAllCards(),
    stashes: await getAllStashes(),
  };
}

async function importBackup(data) {
  if (!data || !Array.isArray(data.cards)) {
    throw new Error("Filen innehåller ingen giltig Stash-säkerhetskopia.");
  }
  await saveAllCards(data.cards);
  await saveAllStashes(Array.isArray(data.stashes) ? data.stashes : []);
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
