// Hämtar och kuraterar förslag via en egen Cloudflare Worker (löser
// CORS permanent, och låter en AI (Claude) välja ut och destillera de
// intressantaste "visste du att"-korten ur flödena, server-till-server).
// Kräver att du satt upp en Worker och sparat dess URL under
// Upptäck → AI-kuratering. Se README.md för hur du sätter upp den.

async function fetchFromWorker(workerUrl, payload) {
  const base = workerUrl.trim().replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error((data && data.error) || `HTTP ${res.status}`);
    }
    return data || { items: [], failures: [] };
  } catch (err) {
    throw new Error(err.name === "AbortError" ? "timeout (Workern svarade inte i tid)" : err.message);
  } finally {
    clearTimeout(timer);
  }
}

// Hämtar förslag från alla sparade flöden via Workern, personaliserat
// med dina uttalade intressen plus exempel på vad du brukar spara
// respektive hoppa över. Returnerar { items, failures, needsSetup } –
// needsSetup är true om ingen Worker-URL sparats ännu, så UI:t kan visa
// en vänlig förklaring istället för att försöka hämta mot en tom URL.
async function fetchSuggestions() {
  const workerUrl = await getWorkerUrl();
  if (!workerUrl) {
    return { items: [], failures: [], needsSetup: true };
  }

  const feeds = await getFeeds();
  if (feeds.length === 0) {
    return { items: [], failures: [], needsSetup: false };
  }
  const feedNameByUrl = new Map(feeds.map((f) => [f.url, f.name]));

  const [cards, seen, preferences, liked, disliked] = await Promise.all([
    getAllCards(),
    getSeenUrls(),
    getPreferences(),
    getLikedExamples(),
    getDislikedExamples(),
  ]);
  const knownUrls = new Set([...cards.map((c) => c.sourceUrl).filter(Boolean), ...seen]);

  let data;
  try {
    data = await fetchFromWorker(workerUrl, {
      feeds: feeds.map((f) => f.url),
      preferences,
      liked,
      disliked,
    });
  } catch (err) {
    return {
      items: [],
      failures: [{ feed: { name: "Worker" }, message: err.message }],
      needsSetup: false,
    };
  }

  const renamed = (data.items || []).map((it) => ({
    ...it,
    source: feedNameByUrl.get(it.source) || it.source,
  }));
  const failures = (data.failures || []).map((f) => ({
    feed: { name: feedNameByUrl.get(f.feed.name) || f.feed.name },
    message: f.message,
  }));

  const items = renamed.filter((it) => it.link && !knownUrls.has(it.link));

  return { items: items.slice(0, 30), failures, needsSetup: false };
}

// Testar ett enskilt flöde via Workern (används av "Testa"-knappen i
// flödeslistan). Ingen personalisering behövs för ett rent test.
async function testFeedViaWorker(workerUrl, feedUrl) {
  const data = await fetchFromWorker(workerUrl, { feeds: [feedUrl] });
  if ((data.failures || []).length > 0 && (data.items || []).length === 0) {
    throw new Error(data.failures[0].message);
  }
  return data.items || [];
}
