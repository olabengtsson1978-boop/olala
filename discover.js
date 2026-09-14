// Hämtar och tolkar RSS/Atom-flöden för "Upptäck"-vyn. De flesta
// tidningars flöden blockerar CORS för direkta anrop från webbläsaren,
// så vi provar flera publika läsproxyer i tur och ordning innan vi ger upp.

const PROXY_BUILDERS = [
  (url) => url,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFeedXml(url) {
  const errors = [];
  for (const build of PROXY_BUILDERS) {
    try {
      const res = await fetchWithTimeout(build(url), 8000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.trim()) throw new Error("Tomt svar");
      return text;
    } catch (err) {
      errors.push(err.name === "AbortError" ? "timeout" : err.message);
    }
  }
  throw new Error(errors.join(" / "));
}

function stripHtml(html) {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  return (div.textContent || "").trim();
}

// Många natur-/vetenskapsflöden bäddar in en bild i <enclosure>,
// <media:content>/<media:thumbnail> eller som en <img> i beskrivningen.
function extractImage(el) {
  const enclosure = el.querySelector("enclosure[url]");
  const enclosureType = enclosure?.getAttribute("type") || "";
  if (enclosure && (enclosureType === "" || enclosureType.startsWith("image"))) {
    return enclosure.getAttribute("url");
  }

  const media =
    el.getElementsByTagName("media:content")[0] || el.getElementsByTagName("media:thumbnail")[0];
  if (media?.getAttribute("url")) return media.getAttribute("url");

  const html = el.querySelector("description, summary, content")?.textContent || "";
  const match = html.match(/<img[^>]+src=["']([^"'\s]+)["']/i);
  return match ? match[1] : null;
}

function parseFeedXml(xmlText, feedName) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Kunde inte tolka flödet.");

  const items = [];

  doc.querySelectorAll("item").forEach((item) => {
    items.push({
      title: item.querySelector("title")?.textContent?.trim() || "(Utan titel)",
      link: item.querySelector("link")?.textContent?.trim() || "",
      summary: stripHtml(item.querySelector("description")?.textContent).slice(0, 260),
      image: extractImage(item),
      source: feedName,
    });
  });

  if (items.length === 0) {
    doc.querySelectorAll("entry").forEach((entry) => {
      const linkEl = entry.querySelector("link");
      items.push({
        title: entry.querySelector("title")?.textContent?.trim() || "(Utan titel)",
        link: linkEl?.getAttribute("href") || linkEl?.textContent?.trim() || "",
        summary: stripHtml(
          entry.querySelector("summary")?.textContent || entry.querySelector("content")?.textContent
        ).slice(0, 260),
        image: extractImage(entry),
        source: feedName,
      });
    });
  }

  return items.filter((it) => it.link);
}

// Hämtar förslag från alla sparade flöden. Returnerar { items, failures }
// där failures listar flöden som inte gick att hämta, så UI:t kan visa
// en diskret varning utan att krascha hela vyn.
async function fetchSuggestions() {
  const feeds = await getFeeds();
  const [cards, seen] = [await getAllCards(), await getSeenUrls()];
  const knownUrls = new Set([...cards.map((c) => c.sourceUrl).filter(Boolean), ...seen]);

  const items = [];
  const failures = [];

  await Promise.all(
    feeds.map(async (feed) => {
      try {
        const xml = await fetchFeedXml(feed.url);
        const feedItems = parseFeedXml(xml, feed.name);
        items.push(...feedItems.filter((it) => !knownUrls.has(it.link)));
      } catch (err) {
        failures.push({ feed, message: err.message });
      }
    })
  );

  // Blanda flödena om varandra istället för ett flöde i taget.
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }

  return { items: items.slice(0, 30), failures };
}
