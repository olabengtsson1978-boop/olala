# Stash – en enkel personlig DeepStash-variant

En installerbar webbapp (PWA) för att spara citat/idéer, upptäcka nytt
via en AI-redaktör som söker på nätet, och repetera dina bästa fynd med
ett enkelt Leitner-system (spaced repetition). Korten lagras lokalt i
webbläsaren (`localStorage`) – inget skickas till någon server, förutom
att din egen Cloudflare Worker ber Claude söka och skriva nya artiklar
när du ber om nya förslag.

## Funktioner

- **Upptäck** (`index.html`): en AI (Claude, via din egen Cloudflare
  Worker) söker fritt på nätet efter förvånande "visste du att"-fakta
  från trovärdiga källor (forskningstidskrifter, universitet,
  myndigheter, etablerade medier) och skriver korta, egna artiklar på
  svenska om dem – med en fängslande kärnmening, en brödtext och
  källförteckning. Workern kontrollerar att varje angiven källa faktiskt
  kom från sökningen; artiklar utan bekräftad källa tas bort. Dra kortet
  åt höger för att spara, vänster för att hoppa över (eller använd
  knapparna). Hämtade förslag sparas tills du tagit ställning till dem,
  så en ny (betald) sökning görs bara när de är slut eller när du trycker
  "Hämta nya artiklar".
- **Personaliserade förslag**: skriv dina intressen i fritext under
  "AI-redaktör" – skickas med varje gång. Dessutom lär sig appen
  automatiskt av dina vanor: vad du sparar räknas som "gillar", vad du
  hoppar över räknas som "ogillar troligen", och exempel på båda skickas
  med till Claude som extra kontext.
- **Talsyntes**: en 🔊-knapp på varje kort (Upptäck, Bibliotek,
  Repetition) läser upp texten högt med webbläsarens inbyggda
  talsyntes. Helt lokalt, ingen server inblandad.
- **Manuellt tillägg**: klistra in text direkt på Upptäck-sidan, med
  valfria taggar och stash.
- **Stashes**: namngivna samlingar (som "decks" i DeepStash) för att
  gruppera kort. Kort utan vald stash hamnar i den underförstådda
  Inkorgen.
- **Bibliotek** (`library.html`): sök, filtrera på stash och taggar,
  redigera taggar, flytta kort mellan stashes, ta bort kort.
- **Repetition** (`review.html`): förfallna kort enligt Leitner-schemat
  dyker upp ett i taget. Dra åt höger ("Kom ihåg") skjuter upp nästa
  repetition längre fram, åt vänster ("Glömde") visar kortet igen snart.
- **Export/import**: säkerhetskopiera kort, stashes, flöden och
  Worker-URL till en JSON-fil från biblioteket, eller återställ från en
  tidigare export.
- **Installerbar (PWA)**: lägg till på hemskärmen/skrivbordet via
  webbläsarens installationsknapp – fungerar sedan som en fristående
  app, utan att gå via någon app store.

## Köra lokalt

En service worker kräver `http(s)`/`localhost` (inte `file://`), så
starta en enkel lokal server i mappen, t.ex.:

```
npx serve .
# eller
python3 -m http.server 8080
```

Öppna sedan adressen som skrivs ut (t.ex. `http://localhost:8080`).
Webbläsaren visar en installationsikon i adressfältet om du vill lägga
till appen som en egen app.

## Sätta upp AI-redaktören (Cloudflare Worker)

API-nyckeln till Claude får inte ligga i webbappen, så sökandet och
skrivandet sker i en liten gratis **Cloudflare Worker** – en
serverfunktion du äger själv. Appen använder som standard
`https://olala.olabengtsson1978.workers.dev` (se `storage.js`).

Snabbast från terminalen (kräver Node):

```
cd worker
npx wrangler login
npx wrangler deploy
npx wrangler secret put ANTHROPIC_API_KEY
```

Eller via Cloudflares dashboard, ~5 minuter, en gång:

1. **Skapa ett gratis Cloudflare-konto**: [dash.cloudflare.com](https://dash.cloudflare.com/sign-up)
   (inget kreditkort krävs för gratisnivån av Workers).
2. I dashboarden: **Workers & Pages** → **Create** → **Create Worker**.
   Ge den valfritt namn (t.ex. `stash-proxy`) → **Deploy**.
3. Klicka **Edit code** (eller "Quick edit"). Markera all exempelkod i
   editorn och ersätt den med hela innehållet i [`worker/worker.js`](worker/worker.js)
   från det här repot. Klicka **Deploy**/**Save and deploy**.
4. Skaffa en Anthropic API-nyckel: [console.anthropic.com](https://console.anthropic.com/)
   → **API Keys** → **Create Key**. (Kräver att du lägger in betalning
   på ditt Anthropic-konto. Varje hämtning med 5 artiklar använder
   Claude Opus 5.5 plus ett tiotal webbsökningar och kostar grovt
   uppskattat 5–10 kr – byt `CLAUDE_MODEL` i
   `worker/worker.js` till `claude-sonnet-5-5` för ungefär halva
   kostnaden.)
5. Tillbaka i din Worker: **Settings** → **Variables and Secrets** →
   lägg till en variabel med namnet `ANTHROPIC_API_KEY`, klistra in
   nyckeln som värde, markera den som **Encrypt**/**Secret** → spara.
   Nyckeln når aldrig webbappen eller din webbläsare – bara Workern.
6. Kopiera Workerns URL (visas högst upp i dashboarden, ser ut som
   `https://stash-proxy.ditt-namn.workers.dev`).
7. Använder du en annan Worker än standarden: klistra in URL:en under
   **"AI-redaktör"** på Upptäck-sidan i appen → **Spara**.

Fungerar det inte: felmeddelandet från Workern visas ovanför förslagen.

**Vad som skickas iväg**: varje gång du ber om nya förslag skickar
appen din fritext under "Dina intressen", texten+taggarna från dina
senaste sparade kort, och rubrikerna på artiklar du redan sett eller
hoppat över – till din egen Worker och vidare till Claude, för att
personalisera förslagen och undvika upprepningar. Claude söker sedan
på nätet via Anthropics webbsökning. Inget av detta delas med någon
annan än dig, din Worker och ditt eget Anthropic-konto.

## Struktur

| Fil | Syfte |
|---|---|
| `index.html/js` | Upptäck: AI-skrivna artiklar + manuellt tillägg + Worker-/intresseinställningar |
| `discover.js` | Hämtar nya artiklar via Workern |
| `speech.js` | Delad talsyntes-funktion (🔊-knappen) |
| `swipe.js` | Delad svep-gest (spara/hoppa över, kom ihåg/glömde) |
| `storage.js` | Delad lagrings- och repetitionslogik (Leitner), stashes, flöden, Worker-URL |
| `library.html/js` | Bibliotek: sök/filter/redigering, stashes, export/import |
| `review.html/js` | Repetitionsflödet |
| `worker/worker.js` | Cloudflare Worker: Claude söker på nätet, skriver artiklar, källorna kontrolleras (se ovan) |
| `worker/wrangler.toml` | Driftsättningsinställningar för Workern (`npx wrangler deploy`) |
| `manifest.webmanifest` | PWA-metadata (namn, ikoner, installationsbeteende) |
| `service-worker.js` | Cachar appskalet för offline-bruk |
| `icons/` | Appens ikoner (16–512px) |
