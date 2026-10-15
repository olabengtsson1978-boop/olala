// Stash – AI-redaktör-Worker
//
// Körs som en Cloudflare Worker (gratisnivå). Låter Claude söka fritt på
// webben efter genuint förvånande "visste du att"-fakta från trovärdiga
// källor, och skriva ihop egna korta artiklar på svenska med källorna
// angivna – ungefär som de kondenserade korten i riktiga DeepStash.
//
// Varje källa som Claude anger kontrolleras mot de URL:er som faktiskt
// kom tillbaka från webbsökningen/hämtningen, så påhittade länkar
// sorteras bort. Artiklar utan någon bekräftad källa tas inte med.
//
// Inget npm-beroende, inget byggsteg. Driftsätts med `npx wrangler deploy`
// från den här mappen (se wrangler.toml), eller klistras in rakt av i
// Cloudflares dashboard ("Create Worker" → "Quick edit").
//
// Krävs: en secret ANTHROPIC_API_KEY (`npx wrangler secret put
// ANTHROPIC_API_KEY`). Den nås ALDRIG av webbappen – bara av den här
// servern.

const CLAUDE_MODEL = "claude-opus-5-5";
const DEFAULT_ARTICLE_COUNT = 5;
const MAX_ARTICLE_COUNT = 8;
const MAX_CONTINUATIONS = 4;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() },
  });
}

// ---- Prompt ----

const SYSTEM_PROMPT = `Du är redaktör för en svensk kunskapsapp i stil med DeepStash. Din uppgift är att använda webbsökning för att hitta genuint förvånande, konkreta "visste du att"-insikter – nya forskningsrön eller tidlösa fakta – och skriva korta, egna artiklar om dem på svenska.

Källkrav:
- Använd bara trovärdiga, verifierbara källor: vetenskapliga tidskrifter, universitet och forskningsinstitut, myndigheter och internationella organisationer, samt etablerade nyhets- och vetenskapsmedier (t.ex. Nature, Science, NASA, SVT, BBC, Forskning & Framsteg, Smithsonian).
- Undvik bloggar, innehållsfarmar, forum, sociala medier, pressmeddelanden utan underlag och sajter som verkar AI-genererade.
- Varje artikel ska helst bygga på minst två oberoende källor. Hämta och läs en källa om sökresultatet inte räcker för att belägga påståendet.
- Ange bara URL:er som faktiskt förekommit i dina sök- eller hämtningsresultat.
- Kan något inte beläggas ordentligt, ta inte med det.

Skrivkrav:
- Variera ämnena (natur, rymd, människokroppen, historia, teknik, språk, psykologi …) inom ramen för användarens intressen.
- Skriv med egna ord. Citera aldrig mer än en kort mening ordagrant.
- Varje artikel har: en rubrik, en "idé" (en fängslande mening på max 160 tecken som bär den mest spännande insikten), en brödtext på 120–220 ord som förklarar vad, hur och varför det är intressant, samt källorna.

Avsluta genom att anropa verktyget return_articles exakt en gång med alla artiklar.`;

// Bygger ett personaliseringsstycke av uttalade intressen plus exempel
// på vad användaren brukar spara (gillar) respektive hoppa över
// (ogillar troligen) – tomt om inget av det finns.
function buildPersonalizationBlock({ preferences, liked, disliked }) {
  const parts = [];

  if (preferences && preferences.trim()) {
    parts.push(`Användarens uttalade intressen: "${preferences.trim()}"`);
  }

  if (Array.isArray(liked) && liked.length > 0) {
    const list = liked
      .slice(0, 15)
      .map((l) => `- ${l.text}${l.tags && l.tags.length ? ` (taggar: ${l.tags.join(", ")})` : ""}`)
      .join("\n");
    parts.push(`Exempel på kort användaren tidigare sparat (visar vad hen brukar gilla):\n${list}`);
  }

  if (Array.isArray(disliked) && disliked.length > 0) {
    const list = disliked
      .slice(0, 15)
      .map((d) => `- ${d.title}`)
      .join("\n");
    parts.push(`Exempel på rubriker användaren hoppat över (troligen mindre intressant för hen):\n${list}`);
  }

  if (parts.length === 0) return "";
  return `\n\nPersonalisering – ta hänsyn till detta, men välj bara sådant som FAKTISKT är intressant i sig:\n${parts.join(
    "\n\n"
  )}`;
}

function buildUserMessage({ count, preferences, liked, disliked, avoid }) {
  const avoidBlock =
    Array.isArray(avoid) && avoid.length > 0
      ? `\n\nSkriv INTE om samma sak som dessa rubriker användaren redan sett:\n${avoid
          .slice(0, 60)
          .map((t) => `- ${t}`)
          .join("\n")}`
      : "";
  return `Hitta och skriv ${count} artiklar.${buildPersonalizationBlock({ preferences, liked, disliked })}${avoidBlock}`;
}

const RETURN_ARTICLES_TOOL = {
  name: "return_articles",
  description: "Returnerar de färdiga artiklarna med källor. Anropas en gång, sist.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["articles"],
    properties: {
      articles: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "idea", "body", "sources"],
          properties: {
            title: { type: "string", description: "Kort svensk rubrik" },
            idea: { type: "string", description: "En fängslande svensk mening, max 160 tecken" },
            body: { type: "string", description: "Svensk brödtext, 120–220 ord" },
            sources: {
              type: "array",
              description: "Källorna artikeln bygger på, viktigast först",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["title", "url"],
                properties: {
                  title: { type: "string", description: "Källans namn eller sidans rubrik" },
                  url: { type: "string", description: "Exakt URL från sök-/hämtningsresultaten" },
                },
              },
            },
          },
        },
      },
    },
  },
};

// ---- Claude-anrop ----

async function callClaude(apiKey, messages) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "server-side-fallback-2026-07-01",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: 12 },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6 },
        RETURN_ARTICLES_TOOL,
      ],
      tool_choice: { type: "auto" },
      messages,
    }),
  });

  if (!res.ok) {
    throw new Error(`Claude API HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return res.json();
}

// Samlar alla URL:er som förekommer i resultaten från webbsökning och
// webbhämtning, så att Claudes angivna källor kan kontrolleras mot dem.
function collectSeenUrls(content, into) {
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    if (typeof node.url === "string") into.add(normalizeUrl(node.url));
    Object.values(node).forEach(visit);
  };
  content.filter((b) => typeof b.type === "string" && b.type.endsWith("_tool_result")).forEach(visit);
}

function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = "";
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    return `${host}${path}${u.search}`;
  } catch {
    return String(raw).trim();
  }
}

function hostLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

async function writeArticles(apiKey, input) {
  const messages = [{ role: "user", content: buildUserMessage(input) }];
  const seenUrls = new Set();
  let searches = 0;
  let nudged = false;

  for (let turn = 0; turn <= MAX_CONTINUATIONS + 1; turn++) {
    const data = await callClaude(apiKey, messages);
    if (data.stop_reason === "refusal") {
      throw new Error("Claude avböjde förfrågan.");
    }

    const content = data.content || [];
    collectSeenUrls(content, seenUrls);
    searches += data.usage?.server_tool_use?.web_search_requests || 0;

    const call = content.find((b) => b.type === "tool_use" && b.name === "return_articles");
    if (call) {
      return { articles: call.input.articles || [], seenUrls, searches };
    }

    messages.push({ role: "assistant", content });
    if (data.stop_reason === "pause_turn") continue;

    // Claude slutade utan att lämna artiklarna – be en gång om dem.
    if (nudged) break;
    nudged = true;
    messages.push({ role: "user", content: "Anropa return_articles nu med de artiklar du hittat belägg för." });
  }

  throw new Error("Claude lämnade inga artiklar.");
}

// Behåller bara källor som faktiskt dök upp i sök-/hämtningsresultaten
// och artiklar som har minst en sådan källa.
function verifyArticles(articles, seenUrls) {
  return articles
    .map((a) => {
      const sources = (a.sources || []).filter((s) => s.url && seenUrls.has(normalizeUrl(s.url)));
      return { ...a, sources };
    })
    .filter((a) => a.sources.length > 0 && a.idea && a.body)
    .map((a) => ({
      title: a.title,
      idea: a.idea,
      body: a.body,
      sources: a.sources,
      link: a.sources[0].url,
      source: hostLabel(a.sources[0].url),
    }));
}

async function readInput(request) {
  const body = await request.json().catch(() => ({}));
  const count = Math.min(Math.max(Number(body.count) || DEFAULT_ARTICLE_COUNT, 1), MAX_ARTICLE_COUNT);
  return {
    count,
    preferences: typeof body.preferences === "string" ? body.preferences : "",
    liked: Array.isArray(body.liked) ? body.liked : [],
    disliked: Array.isArray(body.disliked) ? body.disliked : [],
    avoid: Array.isArray(body.avoid) ? body.avoid.map(String) : [],
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== "POST") {
      return json({ error: "Använd POST {preferences, liked, disliked, avoid, count}." }, 405);
    }
    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: "ANTHROPIC_API_KEY saknas i Workerns inställningar." }, 500);
    }

    const input = await readInput(request);

    try {
      const { articles, seenUrls, searches } = await writeArticles(env.ANTHROPIC_API_KEY, input);
      const items = verifyArticles(articles, seenUrls);
      const dropped = articles.length - items.length;
      const failures =
        dropped > 0
          ? [{ feed: { name: "Källkontroll" }, message: `${dropped} artikel(ar) togs bort eftersom källorna inte kunde bekräftas.` }]
          : [];
      return json({ items, failures, searches });
    } catch (err) {
      return json({ error: err.message || String(err) }, 502);
    }
  },
};
