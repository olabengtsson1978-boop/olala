// Stash – AI-kurerings-Worker
//
// Körs som en Cloudflare Worker (gratisnivå). Gör två saker:
//   1. Hämtar RSS/Atom-flöden server-till-server, vilket helt löser
//      CORS-problemet webbappen annars har när den försöker hämta
//      flöden direkt från webbläsaren.
//   2. Skickar de hämtade artiklarna till Claude, som väljer ut de mest
//      intressanta/förvånande "visste du att"-fakta och destillerar
//      varje vald artikel till en kort, fängslande svensk mening –
//      ungefär som de kondenserade korten i riktiga DeepStash.
//
// Inget npm-beroende, inget byggsteg – filen är tänkt att klistras in
// rakt av i Cloudflares dashboard ("Create Worker" → "Quick edit").
//
// Krävs: en miljövariabel/secret ANTHROPIC_API_KEY (Settings → Variables
// i Worker-dashboarden, markerad som "Encrypt"). Den nås ALDRIG av
// webbappen – bara av den här servern.

const CLAUDE_MODEL = "claude-haiku-4-5-20251001";
const MAX_ITEMS_TO_MODEL = 25;
const FEED_FETCH_TIMEOUT_MS = 10000;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() },
  });
}

// ---- Minimal RSS/Atom-parsning utan DOM (Workers har ingen DOMParser) ----

function stripCdata(s) {
  const m = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return m ? m[1] : s;
}

function decodeEntitiesAndStripTags(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!m) return "";
  return decodeEntitiesAndStripTags(stripCdata(m[1]));
}

function extractImage(block) {
  const enclosure = block.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*>/i);
  if (enclosure) return enclosure[1];
  const media = block.match(/<media:(?:content|thumbnail)[^>]+url=["']([^"']+)["']/i);
  if (media) return media[1];
  const descBlock = (block.match(/<description[^>]*>([\s\S]*?)<\/description>/i) || [, ""])[1];
  const img = stripCdata(descBlock).match(/<img[^>]+src=["']([^"'\s]+)["']/i);
  return img ? img[1] : null;
}

function extractLink(block) {
  const plain = block.match(/<link[^>]*>([^<]+)<\/link>/i);
  if (plain && plain[1].trim()) return plain[1].trim();
  const atomHref = block.match(/<link[^>]+href=["']([^"']+)["']/i);
  return atomHref ? atomHref[1] : "";
}

function parseFeed(xml, sourceName) {
  const itemRe = /<item\b[\s\S]*?<\/item>/gi;
  let blocks = xml.match(itemRe) || [];
  if (blocks.length === 0) {
    blocks = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  }

  return blocks
    .map((block) => {
      const title = extractTag(block, "title") || "(Utan titel)";
      const link = extractLink(block);
      const summaryRaw =
        (block.match(/<description[^>]*>([\s\S]*?)<\/description>/i) ||
          block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) ||
          block.match(/<content[^>]*>([\s\S]*?)<\/content>/i) || [, ""])[1];
      const summary = decodeEntitiesAndStripTags(stripCdata(summaryRaw || "")).slice(0, 500);
      const image = extractImage(block);
      return { title, link, summary, image, source: sourceName };
    })
    .filter((it) => it.link);
}

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; StashBot/1.0)" },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAllFeeds(feedUrls) {
  const items = [];
  const failures = [];

  await Promise.all(
    feedUrls.map(async (feedUrl) => {
      try {
        const res = await fetchWithTimeout(feedUrl, FEED_FETCH_TIMEOUT_MS);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const xml = await res.text();
        items.push(...parseFeed(xml, feedUrl));
      } catch (err) {
        failures.push({ feed: { name: feedUrl }, message: err.message || String(err) });
      }
    })
  );

  const seenLinks = new Set();
  const deduped = items.filter((it) => {
    if (seenLinks.has(it.link)) return false;
    seenLinks.add(it.link);
    return true;
  });

  return { items: deduped, failures };
}

// ---- AI-kuratering ----

async function curateWithClaude(items, apiKey) {
  const candidates = items.slice(0, MAX_ITEMS_TO_MODEL);
  const listing = candidates
    .map((it, i) => `${i + 1}. [${it.source}] ${it.title}\n${it.summary}`)
    .join("\n\n");

  const body = {
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: `Här är artiklar från populärvetenskapliga källor. Välj ut högst ${Math.min(
          candidates.length,
          15
        )} av de MEST intressanta/förvånande "visste du att"-fakta bland dem – hoppa över tråkiga rena nyhetsnotiser eller sådant utan en konkret wow-fakta. För varje vald artikel: skriv en kort, fängslande svensk mening (max 160 tecken) som destillerar den mest spännande insikten, i stil med ett kunskapskort.\n\nArtiklar:\n${listing}`,
      },
    ],
    tools: [
      {
        name: "return_ideas",
        description: "Returnerar de utvalda och destillerade idé-korten.",
        input_schema: {
          type: "object",
          properties: {
            ideas: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "integer", description: "1-baserat index i artikellistan ovan" },
                  idea: { type: "string", description: "Kort, fängslande svensk mening (max 160 tecken)" },
                },
                required: ["index", "idea"],
              },
            },
          },
          required: ["ideas"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "return_ideas" },
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Claude API HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const data = await res.json();
  const toolUse = (data.content || []).find((c) => c.type === "tool_use");
  if (!toolUse) throw new Error("Inget strukturerat svar från Claude.");

  return toolUse.input.ideas
    .map((sel) => {
      const item = candidates[sel.index - 1];
      return item ? { ...item, idea: sel.idea } : null;
    })
    .filter(Boolean);
}

// Enkel reservlösning om Claude-anropet misslyckas (saknad/ogiltig
// nyckel, rate limit, m.m.) – hellre okurerat innehåll än inget alls.
function fallbackIdea(item) {
  const text = (item.summary || "").trim();
  if (!text) return item.title;
  const sentence = text.split(/(?<=[.!?])\s+/)[0] || text;
  return sentence.length > 160 ? `${sentence.slice(0, 157).trim()}…` : sentence;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const feedsParam = url.searchParams.get("feeds") || "";
    const feedUrls = feedsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (feedUrls.length === 0) {
      return json({ error: "Inga flöden angivna (?feeds=url1,url2,...)" }, 400);
    }

    const { items, failures } = await fetchAllFeeds(feedUrls);

    if (items.length === 0) {
      return json({ items: [], failures });
    }

    if (!env.ANTHROPIC_API_KEY) {
      return json({
        items: items.map((it) => ({ ...it, idea: fallbackIdea(it) })),
        failures: [...failures, { feed: { name: "AI-kuratering" }, message: "ANTHROPIC_API_KEY saknas i Workerns inställningar – visar okurerat innehåll." }],
      });
    }

    try {
      const curated = await curateWithClaude(items, env.ANTHROPIC_API_KEY);
      return json({ items: curated, failures });
    } catch (err) {
      return json({
        items: items.map((it) => ({ ...it, idea: fallbackIdea(it) })),
        failures: [...failures, { feed: { name: "AI-kuratering" }, message: err.message || String(err) }],
      });
    }
  },
};
