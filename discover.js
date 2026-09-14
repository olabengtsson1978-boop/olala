// Hämtar och tolkar RSS/Atom-flöden för "Upptäck"-vyn. Om ett flöde
// blockerar CORS provar vi en publik läsproxy som andra hand.

const CORS_PROXY = "https://api.allorigins.win/raw?url=";

async function fetchFeedXml(url) {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch {
    const res = await fetch(CORS_PROXY + encodeURIComponent(url));
    if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`);
    return await res.text();
  }
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
