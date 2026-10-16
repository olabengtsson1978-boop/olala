// Hämtar nya artiklar via en egen Cloudflare Worker, där en AI (Claude)
// söker fritt på webben efter förvånande fakta från trovärdiga källor och
// skriver korta svenska artiklar med källorna angivna. Workern kontrollerar
// att källorna faktiskt kom från sökningen. Se README.md och worker/.

const SUGGESTION_COUNT = 5;
const KID_SUGGESTION_COUNT = 3;

async function fetchFromWorker(workerUrl, payload) {
  const base = workerUrl.trim().replace(/\/$/, "");
  const controller = new AbortController();
  // Webbsökning + skrivande tar ofta 1–3 minuter.
  const timer = setTimeout(() => controller.abort(), 300000);
  try {
    const res = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || (data && data.error)) {
      throw new Error((data && data.error) || `HTTP ${res.status}`);
    }
    return data || { items: [], failures: [] };
  } catch (err) {
    throw new Error(err.name === "AbortError" ? "timeout (Workern svarade inte i tid)" : err.message);
  } finally {
    clearTimeout(timer);
  }
}

// Ber Workern om nya artiklar, personaliserade med dina uttalade intressen
// plus exempel på vad du brukar spara respektive hoppa över. Rubriker du
// redan sett skickas med så att samma ämne inte kommer tillbaka.
// Returnerar { items, failures, needsSetup }.
async function fetchSuggestions() {
  const workerUrl = await getWorkerUrl();
  if (!workerUrl) {
    return { items: [], failures: [], needsSetup: true };
  }

  const [cards, seenEntries, preferences, liked, disliked] = await Promise.all([
    getAllCards(),
    getSeenEntries(),
    getPreferences(),
    getLikedExamples(),
    getDislikedExamples(),
  ]);
  const knownUrls = new Set([...cards.map((c) => c.sourceUrl).filter(Boolean), ...seenEntries.map((e) => e.link)]);
  const avoid = seenEntries
    .map((e) => e.title)
    .filter(Boolean)
    .slice(-60);

  let data;
  try {
    data = await fetchFromWorker(workerUrl, {
      count: SUGGESTION_COUNT,
      preferences,
      liked,
      disliked,
      avoid,
    });
  } catch (err) {
    return {
      items: [],
      failures: [{ feed: { name: "Worker" }, message: err.message }],
      needsSetup: false,
    };
  }

  const items = (data.items || []).filter((it) => it.link && !knownUrls.has(it.link));
  return { items, failures: data.failures || [], needsSetup: false };
}

// Ber Workern om nya artiklar åt Barn-sidan. Samma Worker-URL, men en
// egen "sedda"-historik (se storage.js: barnsidans kort/stashes/historik
// ligger i egna nycklar, helt skilda från vuxenversionens) och INGEN
// personalisering (intressen/gillar/ogillar) skickas med – kidMode: true
// gör att Workern kör ett helt separat, strikt barnsäkert spår istället
// för den vanliga skrivprocessen. Se worker/worker.js.
async function fetchKidSuggestions() {
  const workerUrl = await getWorkerUrl();
  if (!workerUrl) {
    return { items: [], failures: [], needsSetup: true };
  }

  const [cards, seenEntries] = await Promise.all([getAllCards(), getSeenEntries()]);
  const knownUrls = new Set([...cards.map((c) => c.sourceUrl).filter(Boolean), ...seenEntries.map((e) => e.link)]);
  const avoid = seenEntries
    .map((e) => e.title)
    .filter(Boolean)
    .slice(-60);

  let data;
  try {
    data = await fetchFromWorker(workerUrl, {
      count: KID_SUGGESTION_COUNT,
      avoid,
      kidMode: true,
    });
  } catch (err) {
    return {
      items: [],
      failures: [{ feed: { name: "Worker" }, message: err.message }],
      needsSetup: false,
    };
  }

  const items = (data.items || []).filter((it) => it.link && !knownUrls.has(it.link));
  return { items, failures: data.failures || [], needsSetup: false };
}
