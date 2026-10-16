// Stash – AI-redaktör-Worker
//
// Körs som en Cloudflare Worker (gratisnivå). Låter en AI söka/hämta
// fram genuint förvånande "visste du att"-fakta från trovärdiga källor,
// och skriva ihop egna korta artiklar på svenska med källorna angivna –
// ungefär som de kondenserade korten i riktiga DeepStash.
//
// TRE leverantörer, provade i ordning, så att appen fortsätter fungera
// även om Claude-kontot får slut på kredit (vilket annars stoppar allt):
//   1. Claude (bäst kvalitet) – söker fritt på webben via Anthropics
//      inbyggda web_search/web_fetch-verktyg. Varje källa Claude anger
//      kontrolleras mot det som faktiskt kom tillbaka från sökningen.
//   2. Groq (gratis) – ingen inbyggd webbsökning i gratisläget, så den
//      väljer och skriver istället utifrån riktiga RSS-artiklar som
//      Workern själv hämtat från en liten lista trovärdiga källor.
//      Källan är då artikelns egen länk – redan verifierad per
//      konstruktion, ingen efterhandskontroll behövs.
//   3. Mistral (gratis) – samma RSS-baserade upplägg som Groq, sista
//      utväg om både Claude och Groq strular.
// Claude provas först (och används ensam) om den lyckas – gratisspåren
// är bara en reserv, inte en permanent nedgradering. Viktigt: ett
// AVSIKTLIGT tomt resultat (Claude/barnprompten hittade inget passande)
// räknas INTE som ett fel och leder ALDRIG vidare till nästa leverantör
// – bara faktiska fel (nätverksfel, slut kredit, API-fel) gör det.
//
// Inget npm-beroende, inget byggsteg. Driftsätts med `npx wrangler deploy`
// från den här mappen (se wrangler.toml), eller klistras in rakt av i
// Cloudflares dashboard ("Create Worker" → "Quick edit").
//
// Secrets (`npx wrangler secret put NAMN`), minst en krävs:
//   ANTHROPIC_API_KEY  – console.anthropic.com (betald, bäst kvalitet)
//   GROQ_API_KEY       – console.groq.com (gratis, inget kreditkort)
//   MISTRAL_API_KEY    – console.mistral.ai (gratis, begränsad kvot)
// Ingen av dem når ALDRIG webbappen – bara den här servern. Se
// README.md för hur du skaffar dem.

const CLAUDE_MODEL = "claude-opus-5-5";
// Barnläget använder en billigare, snabbare modell och färre sökningar
// – dels för kostnad, dels för att hålla sökytan (vad Claude ens läser
// under tiden) mindre för ett barns innehåll.
const KID_CLAUDE_MODEL = "claude-haiku-4-5-20251001";
// Modellnamn hos gratisleverantörerna ändras då och då – kontrollera
// console.groq.com/docs/models respektive docs.mistral.ai/getting-started/models
// om ett av gratisspåren börjar ge "model not found".
const GROQ_MODEL = "llama-3.3-70b-versatile";
const MISTRAL_MODEL = "mistral-small-latest";
const DEFAULT_ARTICLE_COUNT = 5;
const MAX_ARTICLE_COUNT = 8;
const MAX_KID_ARTICLE_COUNT = 5;
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

// ---- Prompt (Claude-spåret) ----

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

// Egen, fristående prompt för barnläget – INTE en variant av
// SYSTEM_PROMPT ovan. Viktigast av allt: strikta uteslutningsregler och
// uttrycklig tillåtelse att hellre lämna få eller inga artiklar än att
// riskera något olämpligt.
const SYSTEM_PROMPT_KIDS = `Du är redaktör för en svensk kunskapsapp i stil med DeepStash, riktad till BARN i åldern 8–12 år. Din uppgift är att använda webbsökning för att hitta genuint förvånande men HELT ÅLDERSANPASSADE "visste du att"-fakta, och skriva korta, egna artiklar om dem på enkel svenska.

VIKTIGASTE REGLERNA – följ dem alltid, före allt annat:
- Sök och skriv ENDAST om ämnen som passar barn 8–12 år rakt igenom: djur och natur, rymden, människokroppen, uppfinningar, vardagsvetenskap, djurrekord, roliga historiska fakta och liknande.
- Sök ALDRIG efter och ta ALDRIG med källor eller fakta som handlar om (eller ens nämner i förbigående): våld, död eller skador, krig, brott, olyckor eller katastrofer, vuxet eller sexuellt innehåll, droger eller alkohol, politik eller val, eller sådant som kan vara läskigt eller oroväckande.
- Är du det minsta osäker på om ett ämne eller en källa passar ett barn – välj ett annat ämne istället. Det är mycket bättre med få artiklar än en olämplig.
- Skriv korta, glada meningar med ett nyfiket, peppigt tonfall – som att berätta något spännande för en kompis. Använd enkla, lättförståeliga ord och förklara svåra ord kort om de behövs.
- "Idé"-meningen: max 120 tecken. Brödtexten: 60–120 ord.

Källkrav: samma försiktighet som alltid – använd bara trovärdiga, verifierbara källor, och ange bara URL:er som faktiskt förekommit i dina sök- eller hämtningsresultat. Kan något inte beläggas ordentligt, ta inte med det.

Hittar du inte tillräckligt många artiklar som är helt lämpliga för ett barn: returnera färre, eller till och med inga alls. Det är ett bra och tryggt resultat, inte ett misslyckande.

Avsluta genom att anropa verktyget return_articles exakt en gång med de artiklar du är helt trygg med (kan vara en tom lista).`;

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

function buildUserMessage({ count, preferences, liked, disliked, avoid, kidMode }) {
  const avoidBlock =
    Array.isArray(avoid) && avoid.length > 0
      ? `\n\nSkriv INTE om samma sak som dessa rubriker användaren redan sett:\n${avoid
          .slice(0, 60)
          .map((t) => `- ${t}`)
          .join("\n")}`
      : "";
  // Ingen personalisering i barnläget, även om klienten skulle råka
  // skicka med den – barnets förslag ska inte byggas på en vuxens
  // sparade/ogillade historik.
  const personalizationBlock = kidMode ? "" : buildPersonalizationBlock({ preferences, liked, disliked });
  return `Hitta och skriv ${count} artiklar.${personalizationBlock}${avoidBlock}`;
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

async function callClaude(apiKey, messages, { kidMode } = {}) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "server-side-fallback-2026-07-01",
    },
    body: JSON.stringify({
      model: kidMode ? KID_CLAUDE_MODEL : CLAUDE_MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      fallbacks: "default",
      system: kidMode ? SYSTEM_PROMPT_KIDS : SYSTEM_PROMPT,
      tools: [
        // Färre sökningar/hämtningar i barnläget: lägre kostnad och en
        // mindre yta av webben Claude ens läser under tiden.
        { type: "web_search_20260209", name: "web_search", max_uses: kidMode ? 6 : 12 },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: kidMode ? 3 : 6 },
        RETURN_ARTICLES_TOOL,
      ],
      tool_choice: { type: "auto" },
      messages,
      // Strömmat, annars bryts långa svar med 524 efter ~100 s.
      stream: true,
    }),
  });

  if (!res.ok) {
    throw new Error(`Claude API HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return readMessageStream(res.body);
}

// Bygger ihop ett färdigt meddelande (samma form som ett icke-strömmat
// svar) av Messages API:ets server-sent events.
async function readMessageStream(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let message = null;
  const blocks = [];

  const handle = (event) => {
    switch (event.type) {
      case "message_start":
        message = event.message;
        break;
      case "content_block_start": {
        const block = { ...event.content_block };
        if ("input" in block) block._json = "";
        blocks[event.index] = block;
        break;
      }
      case "content_block_delta": {
        const block = blocks[event.index];
        const d = event.delta;
        if (d.type === "text_delta") block.text = (block.text || "") + d.text;
        else if (d.type === "input_json_delta") block._json += d.partial_json;
        else if (d.type === "thinking_delta") block.thinking = (block.thinking || "") + d.thinking;
        else if (d.type === "signature_delta") block.signature = d.signature;
        else if (d.type === "citations_delta") block.citations = [...(block.citations || []), d.citation];
        break;
      }
      case "content_block_stop": {
        const block = blocks[event.index];
        if (block && block._json !== undefined) {
          block.input = block._json ? JSON.parse(block._json) : block.input || {};
          delete block._json;
        }
        break;
      }
      case "message_delta":
        Object.assign(message, event.delta);
        message.usage = { ...message.usage, ...event.usage };
        break;
      case "error":
        throw new Error(`Claude API: ${event.error?.message || "okänt fel i strömmen"}`);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const data = raw
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (data) handle(JSON.parse(data));
    }
  }

  if (!message) throw new Error("Tomt svar från Claude API.");
  message.content = blocks.filter(Boolean);
  return message;
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
  const { kidMode } = input;
  const messages = [{ role: "user", content: buildUserMessage(input) }];
  const seenUrls = new Set();
  let searches = 0;
  let nudged = false;

  for (let turn = 0; turn <= MAX_CONTINUATIONS + 1; turn++) {
    const data = await callClaude(apiKey, messages, { kidMode });
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
    messages.push({
      role: "user",
      content: kidMode
        ? "Anropa return_articles nu med de artiklar du hittat belägg för, eller en tom lista om inget passade ett barn."
        : "Anropa return_articles nu med de artiklar du hittat belägg för.",
    });
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

// Kör Claude-spåret och formar resultatet. Kastar vidare (ger
// orchestratorn nedan chansen att falla tillbaka på gratisspåren) om
// själva anropet misslyckas – men INTE om Claude medvetet lämnade färre
// eller inga artiklar, vilket är ett giltigt, avsiktligt utfall.
async function runClaude(apiKey, input) {
  const { articles, seenUrls } = await writeArticles(apiKey, input);
  const items = verifyArticles(articles, seenUrls);
  const dropped = articles.length - items.length;
  const failures =
    dropped > 0
      ? [{ feed: { name: "Källkontroll" }, message: `${dropped} artikel(ar) togs bort eftersom källorna inte kunde bekräftas.` }]
      : [];
  return { items, failures, provider: "claude" };
}

// ---- Gratisspåren (Groq/Mistral): RSS i stället för webbsökning ----
//
// Ingen av gratisnivåerna ger pålitlig, kostnadsfri webbsökning, så de
// här spåren väljer och skriver istället utifrån artiklar Workern SJÄLV
// hämtat från en liten, handplockad lista trovärdiga käll-flöden. Det
// gör källkontrollen trivial (länken är redan den vi själva hämtade –
// ingen risk för påhittade URL:er) men begränsar utbudet till det som
// faktiskt finns i de flödena just nu.

const FREE_PIPELINE_FEEDS = [
  { name: "Smithsonian Magazine – Science & Nature", url: "https://www.smithsonianmag.com/rss/science-nature/" },
  { name: "ScienceDaily – Top Science", url: "https://feeds.sciencedaily.com/sciencedaily/top_news/top_science" },
  { name: "NASA", url: "https://www.nasa.gov/feed/" },
];
const MAX_FREE_CANDIDATES = 20;
const FREE_FEED_FETCH_TIMEOUT_MS = 10000;

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
      const summary = decodeEntitiesAndStripTags(stripCdata(summaryRaw || "")).slice(0, 600);
      return { title, link, summary, source: sourceName };
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

async function fetchAllFeeds(feeds) {
  const items = [];
  const failures = [];

  await Promise.all(
    feeds.map(async (feed) => {
      try {
        const res = await fetchWithTimeout(feed.url, FREE_FEED_FETCH_TIMEOUT_MS);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const xml = await res.text();
        items.push(...parseFeed(xml, feed.name));
      } catch (err) {
        failures.push(`${feed.name}: ${err.message || String(err)}`);
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

// Egna, kortare prompts för gratisspåret: modellen får INGEN
// webbsökning här, bara de redan hämtade RSS-sammanfattningarna – den
// får uttryckligen inte hitta på fakta utöver det som faktiskt står i
// dem. Barnreglerna är lika strikta som i Claude-spåret.
const FREE_SYSTEM_PROMPT = `Du är redaktör för en svensk kunskapsapp i stil med DeepStash. Du får en numrerad lista med redan hämtade artikelsammanfattningar från trovärdiga källor. Välj ut de mest intressanta/förvånande och skriv en kort, egen svensk artikel om var och en – UTIFRÅN ENDAST det som faktiskt står i sammanfattningen, hitta aldrig på fakta som inte finns där.

Varje vald artikel: en "idé" (en fängslande mening, max 160 tecken) och en brödtext (120–220 ord) på svenska, med egna ord.

Avsluta genom att anropa verktyget return_articles exakt en gång med dina val (index från listan, idé, brödtext). Är inget av det tillräckligt intressant: returnera en tom lista.`;

const FREE_SYSTEM_PROMPT_KIDS = `Du är redaktör för en svensk kunskapsapp i stil med DeepStash, riktad till BARN i åldern 8–12 år. Du får en numrerad lista med redan hämtade artikelsammanfattningar. Välj ENDAST sådant som passar barn 8–12 år rakt igenom, och skriv en kort, egen, glad svensk artikel om varje val – UTIFRÅN ENDAST det som faktiskt står i sammanfattningen, hitta aldrig på fakta som inte finns där.

VIKTIGASTE REGLERNA:
- Välj ALDRIG något som handlar om (eller ens nämner) våld, död eller skador, krig, brott, olyckor eller katastrofer, vuxet/sexuellt innehåll, droger/alkohol, politik, eller sådant som kan vara läskigt.
- Är du det minsta osäker på om en sammanfattning passar ett barn – hoppa över den.
- "Idé"-meningen: max 120 tecken, glatt och nyfiket tonfall. Brödtexten: 60–120 ord, enkla ord.

Hittar du inget som passar helt och hållet: returnera en tom lista – det är ett bra, tryggt resultat.

Avsluta genom att anropa verktyget return_articles exakt en gång med dina val (index från listan, idé, brödtext).`;

function buildFreeUserMessage(candidates, { count, avoid, kidMode }) {
  const listing = candidates
    .map((it, i) => `${i + 1}. [${it.source}] ${it.title}\n${it.summary}`)
    .join("\n\n");
  const avoidBlock =
    Array.isArray(avoid) && avoid.length > 0
      ? `\n\nHoppa över dessa – användaren har redan sett dem:\n${avoid
          .slice(0, 60)
          .map((t) => `- ${t}`)
          .join("\n")}`
      : "";
  return `Välj högst ${count} av de mest intressanta artiklarna nedan och skriv varsin kort svensk artikel.${avoidBlock}\n\nArtiklar:\n${listing}`;
}

// OpenAI-kompatibelt function-calling-schema (Groq och Mistral delar
// detta API-format, till skillnad från Claudes egen tools-form ovan).
const FREE_RETURN_IDEAS_TOOL = {
  type: "function",
  function: {
    name: "return_articles",
    description: "Returnerar de valda och skrivna artiklarna.",
    parameters: {
      type: "object",
      required: ["articles"],
      properties: {
        articles: {
          type: "array",
          items: {
            type: "object",
            required: ["index", "idea", "body"],
            properties: {
              index: { type: "integer", description: "1-baserat index i artikellistan" },
              idea: { type: "string", description: "Fängslande svensk mening" },
              body: { type: "string", description: "Svensk brödtext" },
            },
          },
        },
      },
    },
  },
};

async function callOpenAICompatible(baseUrl, apiKey, model, messages) {
  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      tools: [FREE_RETURN_IDEAS_TOOL],
      tool_choice: { type: "function", function: { name: "return_articles" } },
    }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) throw new Error("Inget strukturerat svar.");
  return JSON.parse(toolCall.function.arguments);
}

async function writeArticlesFree(providerLabel, { baseUrl, model }, apiKey, input) {
  const { count, avoid, kidMode } = input;
  const { items: allCandidates, failures: feedFailures } = await fetchAllFeeds(FREE_PIPELINE_FEEDS);
  if (allCandidates.length === 0) {
    throw new Error(`Inga flöden kunde hämtas (${feedFailures.join("; ") || "okänt fel"}).`);
  }

  const candidates = allCandidates.slice(0, MAX_FREE_CANDIDATES);
  const messages = [
    { role: "system", content: kidMode ? FREE_SYSTEM_PROMPT_KIDS : FREE_SYSTEM_PROMPT },
    { role: "user", content: buildFreeUserMessage(candidates, { count, avoid, kidMode }) },
  ];

  const { articles } = await callOpenAICompatible(baseUrl, apiKey, model, messages);
  const items = (Array.isArray(articles) ? articles : [])
    .map((sel) => {
      const candidate = candidates[Number(sel.index) - 1];
      if (!candidate || !sel.idea || !sel.body) return null;
      return {
        title: candidate.title,
        idea: sel.idea,
        body: sel.body,
        link: candidate.link,
        source: candidate.source,
        sources: [{ title: candidate.source, url: candidate.link }],
      };
    })
    .filter(Boolean);

  return { items, failures: [], provider: providerLabel.toLowerCase() };
}

// ---- Orchestrator: Claude → Groq → Mistral ----

async function getArticles(env, input) {
  const attempts = [];

  if (env.ANTHROPIC_API_KEY) {
    try {
      return await runClaude(env.ANTHROPIC_API_KEY, input);
    } catch (err) {
      attempts.push(`Claude: ${err.message || err}`);
    }
  } else {
    attempts.push("Claude: ANTHROPIC_API_KEY saknas.");
  }

  if (env.GROQ_API_KEY) {
    try {
      return await writeArticlesFree(
        "Groq",
        { baseUrl: "https://api.groq.com/openai/v1/chat/completions", model: GROQ_MODEL },
        env.GROQ_API_KEY,
        input
      );
    } catch (err) {
      attempts.push(`Groq: ${err.message || err}`);
    }
  }

  if (env.MISTRAL_API_KEY) {
    try {
      return await writeArticlesFree(
        "Mistral",
        { baseUrl: "https://api.mistral.ai/v1/chat/completions", model: MISTRAL_MODEL },
        env.MISTRAL_API_KEY,
        input
      );
    } catch (err) {
      attempts.push(`Mistral: ${err.message || err}`);
    }
  }

  throw new Error(`Alla AI-leverantörer misslyckades. ${attempts.join(" | ")}`);
}

async function readInput(request) {
  const body = await request.json().catch(() => ({}));
  const kidMode = body.kidMode === true;
  const count = Math.min(
    Math.max(Number(body.count) || DEFAULT_ARTICLE_COUNT, 1),
    kidMode ? MAX_KID_ARTICLE_COUNT : MAX_ARTICLE_COUNT
  );
  return {
    count,
    kidMode,
    // Personalisering ignoreras helt i barnläget (se buildUserMessage),
    // men läses ändå in här bara för att inte krascha på oväntad input.
    preferences: typeof body.preferences === "string" ? body.preferences : "",
    liked: Array.isArray(body.liked) ? body.liked : [],
    disliked: Array.isArray(body.disliked) ? body.disliked : [],
    avoid: Array.isArray(body.avoid) ? body.avoid.map(String) : [],
  };
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== "POST") {
      return json({ error: "Använd POST {preferences, liked, disliked, avoid, count}." }, 405);
    }
    if (!env.ANTHROPIC_API_KEY && !env.GROQ_API_KEY && !env.MISTRAL_API_KEY) {
      return json(
        { error: "Ingen AI-leverantör är inställd. Lägg till minst en secret: ANTHROPIC_API_KEY, GROQ_API_KEY eller MISTRAL_API_KEY." },
        500
      );
    }

    const input = await readInput(request);

    // Sökandet tar ofta mer än 100 s, då Cloudflare annars avbryter med
    // 524. Svaret börjar därför direkt och hålls vid liv med blanksteg
    // (giltigt före JSON) tills artiklarna är klara. Fel skickas som
    // { error } i samma ström, eftersom statuskoden redan är 200.
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const heartbeat = setInterval(() => writer.write(encoder.encode(" ")).catch(() => {}), 10000);

    const work = (async () => {
      let result;
      try {
        result = await getArticles(env, input);
      } catch (err) {
        result = { error: err.message || String(err) };
      }
      clearInterval(heartbeat);
      await writer.write(encoder.encode(JSON.stringify(result)));
      await writer.close();
    })();
    ctx.waitUntil(work);

    return new Response(readable, {
      headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders() },
    });
  },
};
