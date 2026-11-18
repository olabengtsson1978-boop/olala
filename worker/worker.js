// Stash – AI-redaktör-Worker
//
// Körs som en Cloudflare Worker (gratisnivå). Låter en AI söka/hämta
// fram genuint förvånande "visste du att"-fakta från trovärdiga källor,
// och skriva ihop egna korta artiklar på svenska med källorna angivna –
// ungefär som de kondenserade korten i riktiga DeepStash.
//
// TRE leverantörer, provade i ordning. Claude sparas medvetet till sist
// (och används bara om både Groq och Mistral strular) – tanken är att
// hålla Claude-kontots kredit fri för annat, inte att den här appen ska
// vara förstahandsförbrukaren av den:
//   1. Groq (billigt/ev. gratis) – modellen "groq/compound" har EGEN
//      inbyggd webbsökning (till skillnad från vanliga Groq-modeller),
//      så den kan faktiskt söka på det användaren ber om, precis som
//      Claude-spåret. Compound stödjer inte function-calling-verktyg
//      samtidigt som sin egen sökning, så svaret bes komma som ett rått
//      JSON-objekt istället för ett verktygsanrop – källorna kontrolleras
//      ändå mot sökresultaten (samma princip som Claude-spåret).
//   2. Mistral (gratis) – ingen inbyggd webbsökning, så den väljer och
//      skriver istället utifrån riktiga RSS-artiklar som Workern själv
//      hämtat från en liten lista trovärdiga källor. Källan är då
//      artikelns egen länk – redan verifierad per konstruktion.
//   3. Claude (bäst kvalitet, kostar av din Anthropic-kredit) – söker
//      fritt på webben via Anthropics inbyggda web_search/web_fetch-
//      verktyg. Varje källa Claude anger kontrolleras mot det som
//      faktiskt kom tillbaka från sökningen. Sista utväg om både Groq
//      och Mistral strular.
// Groq provas först (och används ensam) om den lyckas – de andra två är
// bara en reserv, inte en permanent nedgradering. Viktigt: ett
// AVSIKTLIGT tomt resultat (Groq/Claude/barnprompten hittade inget
// passande) räknas INTE som ett fel och leder ALDRIG vidare till nästa
// leverantör – bara faktiska fel (nätverksfel, slut kredit, API-fel) gör
// det.
//
// Inget npm-beroende, inget byggsteg. Driftsätts med `npx wrangler deploy`
// från den här mappen (se wrangler.toml), eller klistras in rakt av i
// Cloudflares dashboard ("Create Worker" → "Quick edit").
//
// Secrets (`npx wrangler secret put NAMN`), minst en krävs:
//   GROQ_API_KEY       – console.groq.com (inget kreditkort krävs för kontot;
//                        compound-sökningen kostar typiskt någon cent per
//                        hämtning – se README för aktuellt läge). Provas
//                        FÖRST.
//   MISTRAL_API_KEY    – console.mistral.ai (gratis, begränsad kvot).
//                        Provas näst.
//   ANTHROPIC_API_KEY  – console.anthropic.com (betald, bäst kvalitet).
//                        Sista utväg – sätt den här bara om du vill att
//                        olala ska få använda Claude-kredit när båda de
//                        andra strular. Lämna den osatt om Claude-kontot
//                        helt ska gå till annat.
// Ingen av dem når ALDRIG webbappen – bara den här servern. Se
// README.md för hur du skaffar dem.

const CLAUDE_MODEL = "claude-opus-5-5";
// Barnläget använder en billigare, snabbare modell och färre sökningar
// – dels för kostnad, dels för att hålla sökytan (vad Claude ens läser
// under tiden) mindre för ett barns innehåll.
const KID_CLAUDE_MODEL = "claude-haiku-4-5-20251001";
// Modellnamn hos gratisleverantörerna ändras då och då – kontrollera
// console.groq.com/docs/compound respektive docs.mistral.ai/getting-started/models
// om ett av reservspåren börjar ge "model not found" (Groq har retirerat
// modeller förut, se git-historik). Compound-mini i barnläget: billigare/
// snabbare, samma princip som Claude Haiku för barn.
const GROQ_COMPOUND_MODEL = "groq/compound";
const GROQ_COMPOUND_MODEL_KID = "groq/compound-mini";
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

// topicHint är en engångsönskan för just den här förfrågan (t.ex. skrivs
// in av ett barn på Upptäck-sidan) – INTE sparad personalisering, så den
// byggs in oavsett kidMode, till skillnad från preferences/liked/disliked.
function buildTopicHintBlock(topicHint) {
  if (!topicHint || !topicHint.trim()) return "";
  return `\n\nFör just den här förfrågan: användaren vill särskilt lära sig om "${topicHint.trim()}". Prioritera det ämnet om du hittar något bra och väl belagt om det – annars välj ett annat ämne istället för att tvinga fram en dålig eller osäker träff.`;
}

function buildUserMessage({ count, preferences, liked, disliked, avoid, kidMode, topicHint }) {
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
  return `Hitta och skriv ${count} artiklar.${personalizationBlock}${buildTopicHintBlock(topicHint)}${avoidBlock}`;
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
      // Systemprompten (och därmed verktygslistan ovanför den, eftersom
      // API:et renderar tools → system → messages och en cache_control-
      // brytpunkt cachar allt innan den också) är identisk vid varje
      // anrop – kidMode-varianten likaså, bara en annan fast text. En
      // ephemeral cache_control-brytpunkt här låter Anthropic återanvända
      // den cachade prefixen (tools+system) mellan anrop inom samma
      // ~5-minutersfönster (och mellan varje tur i writeArticles fortsätt-
      // nings-loop nedan) till en bråkdel av priset istället för att
      // betala fullt pris för samma text varje gång. Själva meddelandena
      // (preferences/avoid/topicHint, som varierar per förfrågan) ligger
      // efter brytpunkten och cachas aldrig – precis avsikten.
      system: [
        { type: "text", text: kidMode ? SYSTEM_PROMPT_KIDS : SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
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

// Går rekursivt igenom en godtycklig JSON-struktur och samlar alla
// strängvärden som ligger under en nyckel "url" – oavsett exakt skepnad
// på strukturen. Används för att bygga en lista över URL:er som
// FAKTISKT förekom i en sökresult-struktur (Claudes tool-result-block
// eller Groq Compounds executed_tools), så att en modells angivna
// källor kan kontrolleras mot den – ingen av leverantörerna dokumenterar
// sin interna sökresultat-form i detalj, så en generisk genomsökning är
// robustare än att anta exakta fältnamn.
function collectUrlsDeep(node, into) {
  if (Array.isArray(node)) return node.forEach((n) => collectUrlsDeep(n, into));
  if (!node || typeof node !== "object") return;
  if (typeof node.url === "string") into.add(normalizeUrl(node.url));
  Object.values(node).forEach((v) => collectUrlsDeep(v, into));
}

// Samlar alla URL:er som förekommer i resultaten från webbsökning och
// webbhämtning, så att Claudes angivna källor kan kontrolleras mot dem.
function collectSeenUrls(content, into) {
  content
    .filter((b) => typeof b.type === "string" && b.type.endsWith("_tool_result"))
    .forEach((b) => collectUrlsDeep(b, into));
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

// ---- Groq Compound: riktig webbsökning, utan function-calling ----
//
// "groq/compound" (och "groq/compound-mini") söker på nätet precis som
// Claude, men stödjer INTE egna function-calling-verktyg samtidigt som
// sin inbyggda sökning – så return_articles-verktyget från Claude-spåret
// går inte att återanvända här. Istället instrueras modellen att svara
// med rått JSON i sitt vanliga textsvar, som sedan tolkas och källorna
// kontrolleras mot sökresultaten (executed_tools) precis som Claude-
// spåret kontrollerar mot sina tool-results – samma försiktighetsprincip,
// bara en annan plats att läsa sökresultaten ifrån.

const COMPOUND_SYSTEM_PROMPT = `Du är redaktör för en svensk kunskapsapp i stil med DeepStash. Använd webbsökning för att hitta genuint förvånande, konkreta "visste du att"-insikter – nya forskningsrön eller tidlösa fakta – och skriv korta, egna artiklar om dem på svenska.

Källkrav:
- Använd bara trovärdiga, verifierbara källor: vetenskapliga tidskrifter, universitet och forskningsinstitut, myndigheter och internationella organisationer, samt etablerade nyhets- och vetenskapsmedier.
- Ange bara URL:er som faktiskt kom tillbaka från din webbsökning.
- Kan något inte beläggas ordentligt, ta inte med det.

Skrivkrav:
- Variera ämnena inom ramen för användarens intressen. Skriv med egna ord, citera aldrig mer än en kort mening ordagrant.
- Varje artikel: en rubrik, en "idé" (en fängslande mening, max 160 tecken), en brödtext (120–220 ord), och källorna.

Svara UTESLUTANDE med ett giltigt JSON-objekt av exakt denna form – ingen inledning, ingen förklaring, inga kodblock, ingen text före eller efter:
{"articles":[{"title":"...","idea":"...","body":"...","sources":[{"title":"...","url":"..."}]}]}
Hittar du inget tillräckligt bra belagt: svara {"articles":[]}.`;

const COMPOUND_SYSTEM_PROMPT_KIDS = `Du är redaktör för en svensk kunskapsapp i stil med DeepStash, riktad till BARN i åldern 8–12 år. Använd webbsökning för att hitta genuint förvånande men HELT ÅLDERSANPASSADE "visste du att"-fakta, och skriv korta, egna artiklar om dem på enkel svenska.

VIKTIGASTE REGLERNA – följ dem alltid, före allt annat:
- Sök och skriv ENDAST om ämnen som passar barn 8–12 år rakt igenom: djur och natur, rymden, människokroppen, uppfinningar, vardagsvetenskap, djurrekord, roliga historiska fakta och liknande.
- Sök ALDRIG efter och ta ALDRIG med källor eller fakta som handlar om (eller ens nämner i förbigående): våld, död eller skador, krig, brott, olyckor eller katastrofer, vuxet eller sexuellt innehåll, droger eller alkohol, politik eller val, eller sådant som kan vara läskigt eller oroväckande.
- Är du det minsta osäker på om ett ämne eller en källa passar ett barn – välj ett annat ämne istället. Det är mycket bättre med få artiklar än en olämplig.
- Skriv korta, glada meningar med ett nyfiket, peppigt tonfall. Enkla ord. "Idé"-meningen: max 120 tecken. Brödtexten: 60–120 ord.

Källkrav: ange bara URL:er som faktiskt kom tillbaka från din webbsökning. Kan något inte beläggas ordentligt, ta inte med det.

Hittar du inte tillräckligt många artiklar som är helt lämpliga för ett barn: ta med färre, eller inga alls – det är ett bra och tryggt resultat.

Svara UTESLUTANDE med ett giltigt JSON-objekt av exakt denna form – ingen inledning, ingen förklaring, inga kodblock, ingen text före eller efter:
{"articles":[{"title":"...","idea":"...","body":"...","sources":[{"title":"...","url":"..."}]}]}
Är inget helt lämpligt: svara {"articles":[]}.`;

// Modellen ombeds svara med rent JSON, men följer det inte alltid exakt
// (kodblock, inledande mening m.m.) – prova några rimliga sätt att ändå
// hitta ett giltigt JSON-objekt i svaret innan vi ger upp.
function parseJsonLoose(text) {
  if (!text) throw new Error("Tomt svar.");
  try {
    return JSON.parse(text);
  } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {}
  }
  throw new Error("Kunde inte tolka svaret som JSON.");
}

async function callGroqCompound(apiKey, model, messages) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "Groq-Model-Version": "latest",
    },
    body: JSON.stringify({ model, messages }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error("Inget svar från Groq.");
  return message;
}

async function writeArticlesCompound(apiKey, input) {
  const { kidMode } = input;
  const messages = [
    { role: "system", content: kidMode ? COMPOUND_SYSTEM_PROMPT_KIDS : COMPOUND_SYSTEM_PROMPT },
    { role: "user", content: buildUserMessage(input) },
  ];
  const model = kidMode ? GROQ_COMPOUND_MODEL_KID : GROQ_COMPOUND_MODEL;
  const message = await callGroqCompound(apiKey, model, messages);

  const seenUrls = new Set();
  collectUrlsDeep(message.executed_tools || [], seenUrls);

  const parsed = parseJsonLoose(message.content || "");
  const articles = Array.isArray(parsed.articles) ? parsed.articles : [];
  return { articles, seenUrls };
}

// Samma form som runClaude: kastar vidare (ger orchestratorn chansen att
// falla tillbaka på Mistral) bara vid ett faktiskt fel – ett avsiktligt
// tomt articles-resultat är giltigt och stannar här.
async function runGroqCompound(apiKey, input) {
  const { articles, seenUrls } = await writeArticlesCompound(apiKey, input);
  const items = verifyArticles(articles, seenUrls);
  const dropped = articles.length - items.length;
  const failures =
    dropped > 0
      ? [{ feed: { name: "Källkontroll" }, message: `${dropped} artikel(ar) togs bort eftersom källorna inte kunde bekräftas.` }]
      : [];
  return { items, failures, provider: "groq" };
}

// ---- Mistral: RSS i stället för webbsökning ----
//
// Mistrals vanliga API ger ingen pålitlig, kostnadsfri webbsökning, så
// det här spåret väljer och skriver istället utifrån artiklar Workern
// SJÄLV hämtat från en liten, handplockad lista trovärdiga käll-flöden.
// Det gör källkontrollen trivial (länken är redan den vi själva hämtade
// – ingen risk för påhittade URL:er) men begränsar utbudet till det som
// faktiskt finns i de flödena just nu. Sista utväg om både Claude och
// Groq strular.

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

function buildFreeUserMessage(candidates, { count, avoid, kidMode, topicHint }) {
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
  // Ingen garanti för webbsökning här, bara urval bland artiklarna
  // nedan – hintar modellen att prioritera en träff om det finns en,
  // men kräver det inte (listan kanske inte innehåller något relevant).
  const topicHintBlock =
    topicHint && topicHint.trim()
      ? `\n\nAnvändaren vill särskilt lära sig om "${topicHint.trim()}" just nu – välj gärna en artikel om det ämnet om någon av artiklarna nedan passar, annars välj bara de mest intressanta som vanligt.`
      : "";
  return `Välj högst ${count} av de mest intressanta artiklarna nedan och skriv varsin kort svensk artikel.${topicHintBlock}${avoidBlock}\n\nArtiklar:\n${listing}`;
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
  const { count, avoid, kidMode, topicHint } = input;
  const { items: allCandidates, failures: feedFailures } = await fetchAllFeeds(FREE_PIPELINE_FEEDS);
  if (allCandidates.length === 0) {
    throw new Error(`Inga flöden kunde hämtas (${feedFailures.join("; ") || "okänt fel"}).`);
  }

  const candidates = allCandidates.slice(0, MAX_FREE_CANDIDATES);
  const messages = [
    { role: "system", content: kidMode ? FREE_SYSTEM_PROMPT_KIDS : FREE_SYSTEM_PROMPT },
    { role: "user", content: buildFreeUserMessage(candidates, { count, avoid, kidMode, topicHint }) },
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

  // Gratisspåret har ingen webbsökning – bara det som råkar finnas i
  // dagens tre flöden just nu – så en ämnesönskan kan bara uppfyllas om
  // något av flödena faktiskt handlar om det. Förklara det öppet istället
  // för att tyst strunta i önskan, så det inte ser ut som en bugg.
  const topicFailures =
    topicHint && topicHint.trim()
      ? [
          {
            feed: { name: "Ämnesönskan" },
            message: `Reservläget (${providerLabel}) kan inte söka fritt på nätet – "${topicHint.trim()}" kunde bara matchas mot det som redan fanns i dagens flöden, inte garanterat hittas.`,
          },
        ]
      : [];

  return { items, failures: topicFailures, provider: providerLabel.toLowerCase() };
}

// ---- Orchestrator: Groq → Mistral → Claude ----
//
// Claude ligger sist med flit: olala ska inte vara förstahandsförbrukaren
// av Claude-kredit som används till annat. Den provas bara om både Groq
// och Mistral strular (eller saknar secret).

async function getArticles(env, input) {
  const attempts = [];
  const result = await getArticlesFrom(env, input, attempts);
  // Visa varför tidigare leverantörer hoppades över, så ett tyst byte
  // till reservspåret syns i appen.
  const skipped = attempts.map((a) => ({ feed: { name: "Reserv används" }, message: a }));
  return { ...result, failures: [...skipped, ...(result.failures || [])] };
}

async function getArticlesFrom(env, input, attempts) {

  if (env.GROQ_API_KEY) {
    try {
      return await runGroqCompound(env.GROQ_API_KEY, input);
    } catch (err) {
      attempts.push(`Groq: ${err.message || err}`);
    }
  } else {
    attempts.push("Groq: GROQ_API_KEY saknas.");
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

  if (env.ANTHROPIC_API_KEY) {
    try {
      return await runClaude(env.ANTHROPIC_API_KEY, input);
    } catch (err) {
      attempts.push(`Claude: ${err.message || err}`);
    }
  }

  throw new Error(`Alla AI-leverantörer misslyckades. ${attempts.join(" | ")}`);
}

// ==== Kortkoll: fotografera ett fotbollskort → identifiering + värdering ====
//
// Samma Worker, samma secrets, men ett eget spår som väljs med
// { mode: "cardScan", images: [dataUrl, …], note } (ett nytt foto) eller
// { mode: "cardRevalue", card: {…} } (ny värdering av ett redan
// identifierat kort, utan att skicka bilden igen). Används av webbappen i
// kort/. Samma leverantörsordning som artiklarna (Groq → Mistral →
// Claude) och samma försiktighetsprincip: varje jämförelseförsäljning
// måste ha en URL som faktiskt dök upp i sökningen, annars stryks den och
// värderingen märks som en obekräftad uppskattning.
//
//   Groq:    qwen3.8-27b (bildstöd) identifierar kortet, sedan söker
//            groq/compound efter faktiskt sålda exemplar.
//   Mistral: mistral-medium-3-5 (bildstöd) identifierar och uppskattar
//            värdet utifrån sin egen kunskap – ingen webbsökning, så
//            värderingen märks alltid som obekräftad.
//   Claude:  ser bilden och söker själv på nätet i ett och samma anrop.
//
// Modellnamnen ändras då och då – se console.groq.com/docs/vision och
// docs.mistral.ai om ett spår börjar ge "model not found".

const CARD_GROQ_VISION_MODEL = "qwen/qwen3.8-27b";
const CARD_GROQ_SEARCH_MODEL = "groq/compound";
const CARD_MISTRAL_MODEL = "mistral-medium-3-5";
const MAX_CARD_IMAGES = 2;
// ~2 MB base64 per bild räcker gott – appen skalar ner till ~1280 px.
const MAX_CARD_IMAGE_CHARS = 2_800_000;

const CARD_FIELDS_DOC = `"card": {
  "isCard": true/false (false om bilden inte visar ett samlarkort),
  "player": "spelarens namn" | null,
  "team": "lag på kortet" | null,
  "year": "år eller säsong, t.ex. 2018 eller 2019-20" | null,
  "manufacturer": "t.ex. Panini, Topps, Upper Deck, Futera, Merlin" | null,
  "set": "serie, t.ex. Prizm World Cup, Chrome UEFA Champions League, Adrenalyn XL" | null,
  "cardNumber": "kortnummer, t.ex. 12 eller RC-7" | null,
  "variant": "parallell/variant, t.ex. Silver Prizm, Gold Refractor /50, bas" | null,
  "rookie": true/false,
  "autograph": true/false,
  "memorabilia": true/false (tröjbit/patch),
  "serialNumber": "numrering som syns, t.ex. 23/99" | null,
  "grading": { "company": "PSA/BGS/SGC/CGC", "grade": "t.ex. 9" } | null (bara om kortet ligger i en graderad slab),
  "condition": "kort svensk bedömning av synligt skick: hörn, kanter, yta, centrering",
  "conditionEstimate": "grov uppskattning, t.ex. 'ungefär PSA 7–8' – ett foto räcker aldrig för exakt gradering",
  "facts": "2–4 meningar på svenska om spelaren och kortet: varför det är intressant/eftertraktat, upplaga, rookie-år osv.",
  "searchQuery": "kort engelsk sökfras för att hitta sålda exemplar, t.ex. '2018 Panini Prizm World Cup Mbappe #80 Silver PSA 10'",
  "confidence": "hög" | "medel" | "låg",
  "uncertainties": "vad du är osäker på, eller tom sträng"
}`;

const VALUATION_FIELDS_DOC = `"valuation": {
  "currency": "SEK",
  "low": tal i SEK,
  "typical": tal i SEK,
  "high": tal i SEK,
  "basis": "1–3 meningar på svenska om vad värderingen bygger på, inkl. växelkurs du använt",
  "comparables": [ { "title": "annonsens rubrik", "price": tal, "currency": "originalvaluta, t.ex. USD", "priceSek": tal, "date": "försäljningsdatum om känt", "url": "länk", "sold": true/false } ],
  "marketNote": "kort råd på svenska: t.ex. om det kan löna sig att gradera, var sådana kort brukar säljas, trend"
}`;

const CARD_IDENTIFY_PROMPT = `Du är expert på fotbollskort (samlarkort från Panini, Topps, Upper Deck, Futera, Score, Merlin m.fl., även äldre svenska serier). Du får foto av framsidan och ibland baksidan av ett kort. Identifiera kortet så exakt som möjligt utifrån det som FAKTISKT SYNS: läs namn, logotyper, årtal, kortnummer, copyright-raden på baksidan, numrering (t.ex. 12/99), parallellfärg/refractor-mönster, autograf, tröjbit och graderingsetikett om kortet ligger i en slab.

Hitta aldrig på detaljer: sätt null där du inte kan avgöra och beskriv osäkerheten. Var försiktig med skicket – ett foto räcker inte för en exakt gradering.

Svara ENDAST med ett JSON-objekt, utan annan text:
{ ${CARD_FIELDS_DOC} }`;

const CARD_VALUE_PROMPT = `Du värderar fotbollskort åt en svensk samlare. Använd webbsökning för att hitta FAKTISKT SÅLDA exemplar (helst, inte bara utropspriser) av exakt samma kort – samma år, serie, kortnummer, parallell/numrering och samma gradering eller ett jämförbart skick. Bra källor: eBay (sålda annonser), 130point, Tradera, Cardmarket, PSA Auction Prices, Card Ladder, PWCC/Fanatics Collect, Goldin.

Regler:
- Varje jämförelse ska ha en url som du faktiskt såg i dina sökresultat. Hitta aldrig på länkar eller priser.
- Räkna om till svenska kronor och ange växelkursen i "basis".
- Ett ograderat kort är normalt värt klart mindre än en PSA 10 – justera för skicket som beskrivs.
- Hittar du inga jämförbara försäljningar: säg det öppet i "basis", lämna "comparables" tom och ge en försiktig uppskattning.

Svara ENDAST med ett JSON-objekt, utan annan text:
{ ${VALUATION_FIELDS_DOC} }`;

const CARD_ESTIMATE_PROMPT = `${CARD_IDENTIFY_PROMPT.replace(
  /Svara ENDAST[\s\S]*$/,
  ""
)}Uppskatta sedan kortets ungefärliga marknadsvärde i SEK utifrån din egen kunskap om samlarmarknaden. Du kan INTE söka på nätet, så lämna "comparables" tom och skriv i "basis" att det är en grov uppskattning utan aktuell prisdata.

Svara ENDAST med ett JSON-objekt, utan annan text:
{ ${CARD_FIELDS_DOC},
  ${VALUATION_FIELDS_DOC} }`;

const CARD_CLAUDE_PROMPT = `${CARD_IDENTIFY_PROMPT.replace(/Svara ENDAST[\s\S]*$/, "")}När kortet är identifierat: värdera det.

${CARD_VALUE_PROMPT.replace(/Svara ENDAST[\s\S]*$/, "")}Lämna resultatet genom att anropa verktyget return_card exakt en gång, med fälten:
{ ${CARD_FIELDS_DOC},
  ${VALUATION_FIELDS_DOC} }
 Är bilden inte ett samlarkort: anropa return_card med isCard false och valuation null, utan att söka.`;

const RETURN_CARD_TOOL = {
  name: "return_card",
  description: "Lämna identifieringen och värderingen av kortet.",
  input_schema: {
    type: "object",
    properties: {
      card: { type: "object", description: "Identifieringen, enligt fälten i instruktionen." },
      valuation: { type: ["object", "null"], description: "Värderingen, enligt fälten i instruktionen." },
    },
    required: ["card"],
  },
};

function readCardImages(body) {
  const raw = Array.isArray(body.images) ? body.images.slice(0, MAX_CARD_IMAGES) : [];
  const images = raw
    .map((url) => {
      if (typeof url !== "string" || url.length > MAX_CARD_IMAGE_CHARS) return null;
      const m = url.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
      return m ? { dataUrl: url, mediaType: m[1], data: m[2] } : null;
    })
    .filter(Boolean);
  if (images.length === 0) {
    throw new Error("Ingen giltig bild skickades (JPEG/PNG/WebP som data-URL, max ~2 MB).");
  }
  return images;
}

function cardNoteText(note) {
  const n = typeof note === "string" ? note.trim().slice(0, 200) : "";
  return n ? `\n\nSamlarens egen anteckning om kortet (kan vara fel, men ta hänsyn till den): "${n}"` : "";
}

function stripThinking(text) {
  return String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

const str = (v, max = 400) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const num = (v) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.,-]/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

function shapeCard(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  const grading =
    c.grading && typeof c.grading === "object" && str(c.grading.company)
      ? { company: str(c.grading.company, 20), grade: str(String(c.grading.grade ?? ""), 20) }
      : null;
  return {
    isCard: c.isCard !== false,
    player: str(c.player, 120),
    team: str(c.team, 120),
    year: str(c.year != null ? String(c.year) : null, 20),
    manufacturer: str(c.manufacturer, 80),
    set: str(c.set, 160),
    cardNumber: str(c.cardNumber != null ? String(c.cardNumber) : null, 30),
    variant: str(c.variant, 120),
    rookie: c.rookie === true,
    autograph: c.autograph === true,
    memorabilia: c.memorabilia === true,
    serialNumber: str(c.serialNumber, 30),
    grading,
    condition: str(c.condition, 600),
    conditionEstimate: str(c.conditionEstimate, 120),
    facts: str(c.facts, 1200),
    searchQuery: str(c.searchQuery, 200),
    confidence: ["hög", "medel", "låg"].includes(c.confidence) ? c.confidence : "låg",
    uncertainties: str(c.uncertainties, 600) || "",
  };
}

// seenUrls === null betyder "ingen sökning gjordes" (Mistral): då finns
// inget att kontrollera mot och värderingen märks alltid obekräftad.
function shapeValuation(raw, seenUrls) {
  if (!raw || typeof raw !== "object") return null;
  const all = Array.isArray(raw.comparables) ? raw.comparables : [];
  const comparables = (seenUrls ? all : [])
    .filter((c) => c && typeof c.url === "string" && seenUrls.has(normalizeUrl(c.url)))
    .slice(0, 8)
    .map((c) => ({
      title: str(c.title, 200) || hostLabel(c.url),
      price: num(c.price),
      currency: str(c.currency, 8) || "",
      priceSek: num(c.priceSek),
      date: str(c.date != null ? String(c.date) : null, 40),
      url: c.url,
      source: hostLabel(c.url),
      sold: c.sold !== false,
    }));
  let low = num(raw.low);
  let typical = num(raw.typical);
  let high = num(raw.high);
  if (low == null && high == null && typical == null) return null;
  typical = typical ?? Math.round(((low ?? high) + (high ?? low)) / 2);
  low = low ?? typical;
  high = high ?? typical;
  if (low > high) [low, high] = [high, low];
  return {
    currency: "SEK",
    low,
    typical,
    high,
    basis: str(raw.basis, 800) || "",
    marketNote: str(raw.marketNote, 600) || "",
    comparables,
    droppedComparables: seenUrls ? Math.max(0, all.length - comparables.length) : 0,
    verified: comparables.length > 0,
    valuedAt: new Date().toISOString(),
  };
}

function cardSummaryForSearch(card) {
  return JSON.stringify(
    {
      player: card.player,
      team: card.team,
      year: card.year,
      manufacturer: card.manufacturer,
      set: card.set,
      cardNumber: card.cardNumber,
      variant: card.variant,
      rookie: card.rookie,
      autograph: card.autograph,
      memorabilia: card.memorabilia,
      serialNumber: card.serialNumber,
      grading: card.grading,
      conditionEstimate: card.conditionEstimate,
      searchQuery: card.searchQuery,
    },
    null,
    1
  );
}

// ---- Groq: bildmodell identifierar, compound söker priser ----

async function callGroqChat(apiKey, body) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}`, "Groq-Model-Version": "latest" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const message = data.choices?.[0]?.message;
  if (!message) throw new Error("Inget svar från Groq.");
  return message;
}

async function identifyCardGroq(apiKey, images, note) {
  const message = await callGroqChat(apiKey, {
    model: CARD_GROQ_VISION_MODEL,
    messages: [
      { role: "system", content: CARD_IDENTIFY_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: `Här är kortet (${images.length === 2 ? "framsida och baksida" : "framsida"}).${cardNoteText(note)}` },
          ...images.map((img) => ({ type: "image_url", image_url: { url: img.dataUrl } })),
        ],
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  });
  const parsed = parseJsonLoose(stripThinking(message.content));
  return shapeCard(parsed.card || parsed);
}

async function valueCardGroq(apiKey, card) {
  const message = await callGroqChat(apiKey, {
    model: CARD_GROQ_SEARCH_MODEL,
    messages: [
      { role: "system", content: CARD_VALUE_PROMPT },
      { role: "user", content: `Kortet som ska värderas:\n${cardSummaryForSearch(card)}` },
    ],
  });
  const seenUrls = new Set();
  collectUrlsDeep(message.executed_tools || [], seenUrls);
  const parsed = parseJsonLoose(stripThinking(message.content));
  return shapeValuation(parsed.valuation || parsed, seenUrls);
}

// ---- Mistral: bild + uppskattning utan webbsökning ----

async function scanCardMistral(apiKey, images, note) {
  const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: CARD_MISTRAL_MODEL,
      messages: [
        { role: "system", content: CARD_ESTIMATE_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: `Här är kortet.${cardNoteText(note)}` },
            ...images.map((img) => ({ type: "image_url", image_url: img.dataUrl })),
          ],
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const parsed = parseJsonLoose(data.choices?.[0]?.message?.content || "");
  const card = shapeCard(parsed.card || parsed);
  return { card, valuation: card.isCard ? shapeValuation(parsed.valuation, null) : null };
}

async function revalueCardMistral(apiKey, card) {
  const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: CARD_MISTRAL_MODEL,
      messages: [
        {
          role: "system",
          content: `Du värderar fotbollskort åt en svensk samlare utifrån din egen kunskap om samlarmarknaden. Du kan INTE söka på nätet: lämna "comparables" tom och skriv i "basis" att det är en grov uppskattning utan aktuell prisdata.\n\nSvara ENDAST med JSON: { ${VALUATION_FIELDS_DOC} }`,
        },
        { role: "user", content: `Kortet:\n${cardSummaryForSearch(card)}` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const parsed = parseJsonLoose(data.choices?.[0]?.message?.content || "");
  return shapeValuation(parsed.valuation || parsed, null);
}

// ---- Claude: ser bilden och söker själv ----

async function callClaudeCard(apiKey, messages) {
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
      system: [{ type: "text", text: CARD_CLAUDE_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: 6 },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 },
        RETURN_CARD_TOOL,
      ],
      tool_choice: { type: "auto" },
      messages,
      stream: true,
    }),
  });
  if (!res.ok) throw new Error(`Claude API HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return readMessageStream(res.body);
}

async function runCardClaude(apiKey, firstUserContent) {
  const messages = [{ role: "user", content: firstUserContent }];
  const seenUrls = new Set();
  let nudged = false;
  for (let turn = 0; turn <= MAX_CONTINUATIONS + 1; turn++) {
    const data = await callClaudeCard(apiKey, messages);
    if (data.stop_reason === "refusal") throw new Error("Claude avböjde förfrågan.");
    const content = data.content || [];
    collectSeenUrls(content, seenUrls);
    const call = content.find((b) => b.type === "tool_use" && b.name === "return_card");
    if (call) return { input: call.input || {}, seenUrls };
    messages.push({ role: "assistant", content });
    if (data.stop_reason === "pause_turn") continue;
    if (nudged) break;
    nudged = true;
    messages.push({ role: "user", content: "Anropa return_card nu med det du kommit fram till." });
  }
  throw new Error("Claude lämnade inget resultat.");
}

async function scanCardClaude(apiKey, images, note) {
  const { input, seenUrls } = await runCardClaude(apiKey, [
    ...images.map((img) => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } })),
    { type: "text", text: `Identifiera och värdera kortet på bilden${images.length === 2 ? "erna (framsida och baksida)" : ""}.${cardNoteText(note)}` },
  ]);
  const card = shapeCard(input.card);
  return { card, valuation: card.isCard ? shapeValuation(input.valuation, seenUrls) : null };
}

async function revalueCardClaude(apiKey, card) {
  const { input, seenUrls } = await runCardClaude(apiKey, [
    { type: "text", text: `Kortet är redan identifierat – värdera det (ingen bild behövs). Lämna card oförändrat.\n${cardSummaryForSearch(card)}` },
  ]);
  return shapeValuation(input.valuation, seenUrls);
}

// ---- Orkestrering: Groq → Mistral → Claude ----

function withAttempts(result, attempts) {
  const notes = attempts.map((a) => ({ name: "Reserv används", message: a }));
  return { ...result, notes: [...notes, ...(result.notes || [])] };
}

function valuationNotes(valuation) {
  if (!valuation || !valuation.droppedComparables) return [];
  return [
    {
      name: "Källkontroll",
      message: `${valuation.droppedComparables} jämförelse(r) togs bort eftersom länken inte kunde bekräftas i sökresultaten.`,
    },
  ];
}

async function scanCard(env, body) {
  const images = readCardImages(body);
  const note = body.note;
  const attempts = [];

  if (env.GROQ_API_KEY) {
    try {
      const card = await identifyCardGroq(env.GROQ_API_KEY, images, note);
      if (!card.isCard) return withAttempts({ card, valuation: null, provider: "groq" }, attempts);
      const valuation = await valueCardGroq(env.GROQ_API_KEY, card);
      return withAttempts({ card, valuation, provider: "groq", notes: valuationNotes(valuation) }, attempts);
    } catch (err) {
      attempts.push(`Groq: ${err.message || err}`);
    }
  } else {
    attempts.push("Groq: GROQ_API_KEY saknas.");
  }

  if (env.MISTRAL_API_KEY) {
    try {
      const result = await scanCardMistral(env.MISTRAL_API_KEY, images, note);
      return withAttempts({ ...result, provider: "mistral" }, attempts);
    } catch (err) {
      attempts.push(`Mistral: ${err.message || err}`);
    }
  }

  if (env.ANTHROPIC_API_KEY) {
    try {
      const result = await scanCardClaude(env.ANTHROPIC_API_KEY, images, note);
      return withAttempts({ ...result, provider: "claude", notes: valuationNotes(result.valuation) }, attempts);
    } catch (err) {
      attempts.push(`Claude: ${err.message || err}`);
    }
  }

  throw new Error(`Alla AI-leverantörer misslyckades. ${attempts.join(" | ")}`);
}

// Ny värdering av ett sparat kort: bara pris-steget, ingen bild. Mistral
// provas sist här, eftersom den inte kan söka efter aktuella priser –
// poängen med att värdera om är just färska priser.
async function revalueCard(env, body) {
  const card = shapeCard(body.card);
  if (!card.isCard || (!card.player && !card.searchQuery)) {
    throw new Error("Kortet saknar uppgifter att värdera (spelare eller sökfras).");
  }
  const attempts = [];

  if (env.GROQ_API_KEY) {
    try {
      const valuation = await valueCardGroq(env.GROQ_API_KEY, card);
      return withAttempts({ valuation, provider: "groq", notes: valuationNotes(valuation) }, attempts);
    } catch (err) {
      attempts.push(`Groq: ${err.message || err}`);
    }
  }
  if (env.ANTHROPIC_API_KEY) {
    try {
      const valuation = await revalueCardClaude(env.ANTHROPIC_API_KEY, card);
      return withAttempts({ valuation, provider: "claude", notes: valuationNotes(valuation) }, attempts);
    } catch (err) {
      attempts.push(`Claude: ${err.message || err}`);
    }
  }
  if (env.MISTRAL_API_KEY) {
    try {
      const valuation = await revalueCardMistral(env.MISTRAL_API_KEY, card);
      return withAttempts({ valuation, provider: "mistral" }, attempts);
    } catch (err) {
      attempts.push(`Mistral: ${err.message || err}`);
    }
  }
  throw new Error(`Alla AI-leverantörer misslyckades. ${attempts.join(" | ")}`);
}

function readInput(body) {
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
    // Engångsönskan för just den här förfrågan (se buildTopicHintBlock),
    // inte sparad personalisering – gäller i både vuxen- och barnläget.
    topicHint: typeof body.topicHint === "string" ? body.topicHint.trim().slice(0, 80) : "",
  };
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== "POST") {
      return json({ error: "Använd POST {preferences, liked, disliked, avoid, count, topicHint, kidMode}." }, 405);
    }
    if (!env.ANTHROPIC_API_KEY && !env.GROQ_API_KEY && !env.MISTRAL_API_KEY) {
      return json(
        { error: "Ingen AI-leverantör är inställd. Lägg till minst en secret: ANTHROPIC_API_KEY, GROQ_API_KEY eller MISTRAL_API_KEY." },
        500
      );
    }

    const body = await request.json().catch(() => ({}));
    // Kortkoll (kort/): eget spår, se "Kortkoll" ovan.
    const job =
      body.mode === "cardScan"
        ? () => scanCard(env, body)
        : body.mode === "cardRevalue"
          ? () => revalueCard(env, body)
          : () => getArticles(env, readInput(body));

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
        result = await job();
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
