# Stash – en enkel personlig DeepStash-variant

En installerbar webbapp (PWA) för att spara citat/idéer, upptäcka nytt
via en AI-redaktör som söker på nätet, och repetera dina bästa fynd med
ett enkelt Leitner-system (spaced repetition). Korten lagras lokalt i
webbläsaren (`localStorage`) – inget skickas till någon server, förutom
att din egen Cloudflare Worker ber en AI (Groq i första hand – se
"Sätta upp AI-redaktören" nedan) söka och skriva nya artiklar när du
ber om nya förslag.

## Funktioner

- **Upptäck** (`index.html`): en AI (Groq i första hand, Mistral eller
  Claude som reserv – se nedan – via din egen Cloudflare Worker) söker
  fritt på nätet efter förvånande "visste du att"-fakta från trovärdiga
  källor (forskningstidskrifter, universitet, myndigheter, etablerade
  medier) och skriver korta, egna artiklar på svenska om dem – med en
  fängslande kärnmening, en brödtext och källförteckning. Workern
  kontrollerar att varje angiven källa faktiskt kom från sökningen;
  artiklar utan bekräftad källa tas bort. Dra kortet åt höger för att
  spara, vänster för att hoppa över (eller använd knapparna). Hämtade
  förslag sparas tills du tagit ställning till dem, så en ny sökning
  görs bara när de är slut eller när du trycker "Hämta nya artiklar".
- **Personaliserade förslag**: skriv dina intressen i fritext under
  "AI-redaktör" – skickas med varje gång. Dessutom lär sig appen
  automatiskt av dina vanor: vad du sparar räknas som "gillar", vad du
  hoppar över räknas som "ogillar troligen", och exempel på båda skickas
  med som extra kontext.
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
  app, utan att gå via någon app store. Barnsidorna har en egen
  manifest (`manifest-barn.webmanifest`) och en egen ikon (en
  glödlampa med en blixt i – en "snilleblixt", med texten "Olala" på
  de större storlekarna, `icons/icon-kid*.png`) så de går att
  installera som en EGEN app ("Stash för barn") som
  öppnas direkt på Upptäck-sidan för barn – helt egen ikon och namn på
  hemskärmen/i appväxlaren jämfört med vuxnas blå "Stash", även om de
  delar samma kod och körs från samma adress.
- **Barnversion** (`barn.html`, `barn-bibliotek.html`,
  `barn-repetera.html`): en egen uppsättning sidor för åldern 8–12 år,
  med glad/färgglad stil (`kids.css`) och enklare text. Egna kort,
  stashes, intressen och "sedda förslag"-historik i helt separat
  lagring (egna `localStorage`-nycklar, se `storage.js`) – ett barns
  sparade kort och en vuxens blandas aldrig ihop, syns inte för varandra
  i biblioteket/repetitionen, och läcker inte in i varandras
  AI-personalisering. Export/import av säkerhetskopior är också
  separata filer per version (`stash-backup-*.json` respektive
  `stash-kid-backup-*.json`). Enda delade inställningen är Worker-URL:en
  (vilken backend som anropas, inget personligt innehåll) – ställ in
  den en gång på de vanliga sidorna (eller använd standarden), så
  fungerar det automatiskt på barnsidorna också. Sökningen och
  skrivandet körs genom ett helt eget, strikt barnsäkert spår i Workern
  (`kidMode`) – inte bara en annan stil på samma prompt. Se "Säkerheten
  i barnversionen" nedan.

  Till skillnad från vuxnas sparade "Dina intressen" finns det INGEN
  sparad intresseprofil för barnet. Istället finns ett fritextfält
  ("Idag vill jag lära mig om…") på barn.html som bara gäller nästa
  tryck på "Visa fler!" – skickas med en gång och sparas aldrig, så
  ingen profil byggs upp över tid.

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

API-nycklarna får inte ligga i webbappen, så sökandet och skrivandet
sker i en liten gratis **Cloudflare Worker** – en serverfunktion du äger
själv. Appen använder som standard
`https://olala.olabengtsson1978.workers.dev` (se `storage.js`).

Workern provar upp till tre AI-leverantörer **i den här ordningen**:

1. **Groq** (`groq/compound`) – förstahandsvalet. Till skillnad från
   vanliga Groq-modeller har compound **riktig webbsökning inbyggd**,
   så den kan faktiskt söka efter det du skriver i "Idag vill jag lära
   mig om…"-fältet. Inget kreditkort krävs för kontot, och sökningarna
   kostar typiskt bråkdelar av en krona per hämtning (se
   [groq.com/pricing](https://groq.com/pricing) för aktuellt läge – har
   varit gratis under beta, kontrollera själv).
2. **Mistral** – andrahandsvalet om Groq strular. Ingen inbyggd
   webbsökning i Mistrals vanliga API, så det här spåret väljer och
   skriver istället utifrån några handplockade, trovärdiga RSS-källor
   (Smithsonian, ScienceDaily, NASA) som Workern hämtar själv – källan
   blir artikelns egen länk, redan verifierad per konstruktion, men en
   ämnesönskan kan bara uppfyllas om den råkar finnas i dagens flöden
   (appen säger det öppet när så är fallet). Gratis, begränsad kvot.
3. **Claude** – valfri sista utväg, bara om du vill. Bäst kvalitet och
   riktig webbsökning, men kostar Anthropic-kredit – sätt bara upp den
   här om du är okej med att olala ibland får använda den (bara när
   både Groq och Mistral strular). Varje hämtning med 5 artiklar
   använder Claude Opus 5.5 plus ett tiotal webbsökningar och kostar
   grovt uppskattat 5–10 kr – byt `CLAUDE_MODEL` i `worker/worker.js`
   till `claude-sonnet-5-5` för ungefär halva kostnaden.

Du behöver inte ha alla tre – Workern använder bara de secrets som
faktiskt finns inställda, i ordningen ovan. Saknas samtliga tre visas
ett tydligt felmeddelande om att ingen leverantör är inställd. Hittar
en leverantör medvetet inga passande artiklar (särskilt vanligt i
barnläget) räknas det INTE som ett fel och ingen annan leverantör
kontaktas – då visas bara "inga nya förslag" som vanligt.

Snabbast från terminalen (kräver Node) – lägg till de secrets du vill
ha, minst en:

```
cd worker
npx wrangler login
npx wrangler deploy
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put MISTRAL_API_KEY
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
4. Skaffa API-nyckel(ar) för den/de leverantörer du vill använda:
   - **Groq**: [console.groq.com](https://console.groq.com/) →
     **API Keys** → **Create API Key**.
   - **Mistral**: [console.mistral.ai](https://console.mistral.ai/) →
     **API Keys** → **Create new key**.
   - **Claude** (valfritt): [console.anthropic.com](https://console.anthropic.com/)
     → **API Keys** → **Create Key**. Kräver att du lägger in betalning
     på ditt Anthropic-konto.
5. Tillbaka i din Worker: **Settings** → **Variables and Secrets** →
   lägg till en variabel per nyckel (`GROQ_API_KEY`, `MISTRAL_API_KEY`,
   `ANTHROPIC_API_KEY` – bara de du faktiskt skaffat), klistra in
   nyckeln som värde, markera den som **Encrypt**/**Secret** → spara.
   Ingen av nycklarna når någonsin webbappen eller din webbläsare –
   bara Workern.
6. Kopiera Workerns URL (visas högst upp i dashboarden, ser ut som
   `https://stash-proxy.ditt-namn.workers.dev`).
7. Använder du en annan Worker än standarden: klistra in URL:en under
   **"AI-redaktör"** på Upptäck-sidan i appen → **Spara**.

Fungerar det inte: felmeddelandet från Workern visas ovanför förslagen.
När ett reservspår faktiskt användes visas en liten diskret notis
ovanför förslagen, så du vet vilken leverantör som skrev artiklarna den
gången – och om det kostade Claude-kredit.

**Prompt-cachning**: systemprompten och verktygslistan till Claude är
identiska vid varje anrop (bara den lilla frågan om antal/intressen/
ämnesönskan varierar), så de skickas med en `cache_control`-brytpunkt –
Anthropic kan då återanvända den delen av prompten till en bråkdel av
priset istället för att debitera den på nytt varje gång, så länge två
anrop sker inom cache-fönstret (~5 min). Systempromptarna är dock i underkant av gränsen för vad som ens går
att cacha (uppskattningsvis ~350–450 token, plus verktygslistan) –
effekten kan alltså utebli i praktiken, särskilt i barnläget (Haiku).
Kostar aldrig mer än innan, bara ibland lite mindre. Berör bara Claude
– som nu är ett valfritt sista-utväg-spår, se ovan.

**Vad som skickas iväg**: varje gång du ber om nya förslag skickar
appen din fritext under "Dina intressen", texten+taggarna från dina
senaste sparade kort, och rubrikerna på artiklar du redan sett eller
hoppat över – till din egen Worker och vidare till den leverantör som
faktiskt används (Groq i första hand, se ovan), för att personalisera
förslagen och undvika upprepningar. Inget av detta delas med någon
annan än dig, din Worker och det kontot (Groq/Mistral/Anthropic) som
faktiskt används just då. **Barnversionen skickar inget av detta** (se
nedan).

**Viktigt om du redan har en egen Worker driftsatt**: om du satte upp
din Worker innan reservlägena (Groq/Mistral) eller barnläget fanns
måste du driftsätta om den (samma steg som ovan: klistra in den
uppdaterade `worker.js`-koden igen, eller `npx wrangler deploy`) för
att få med dem.

### Säkerheten i barnversionen

Barnsidornas förslag går genom ett **helt separat, strikt säkerhetsspår**
i Workern (`kidMode: true`) – oavsett vilken av de tre leverantörerna
(Groq/Mistral/Claude) som faktiskt används just då, inte samma
sökning/prompt som vuxenversionen med en annan stil på:

- Varje leverantör har sin egen separata systemprompt för barnläget
  (inte en variant av vuxenversionens), med uttryckliga
  uteslutningsregler: våld, död, krig, brott, olyckor, vuxet/sexuellt
  innehåll, droger/alkohol, politik och skrämmande ämnen söks och
  skrivs aldrig om. Är AI:n det minsta osäker väljer den hellre bort
  ämnet än tar med det – och att lämna få eller inga artiklar är ett
  uttryckligt godkänt, bra resultat, inte ett fel, och leder ALDRIG
  vidare till nästa leverantör (det vore att låta ett mindre granskat
  spår ersätta ett säkert "nej").
- Körs med en billigare, snabbare modell i barnläget hos varje
  leverantör (Claude Haiku respektive Groq compound-mini) och ungefär
  halva sök-/hämtningsbudgeten jämfört med vuxenversionen – lägre
  kostnad per hämtning, och en mindre yta av webben som läses under
  tiden.
- Ingen personalisering skickas med (inga uttalade intressen, inga
  sparade/ogillade exempel) – barnets förslag bygger aldrig på en
  vuxens historik, och ingen beteendeprofil byggs upp kring barnet.
  Det gäller även rent lagringsmässigt: barnets sparade kort, stashes
  och "sedda"-historik ligger i egna `localStorage`-nycklar, skilda
  från vuxenversionens, så de kan aldrig blandas ihop eller läcka in i
  varandra ens av misstag.
- Samma källkontroll oavsett leverantör: en artikel utan en bekräftad
  källa (en URL som faktiskt dök upp i sökningen/flödet) tas bort.
- Går något fel (saknade API-nycklar, leverantörsfel) visas bara ett
  felmeddelande, aldrig något ogranskat innehåll.

Det här är ett rimligt försvar men ingen garanti – en AI kan missbedöma
enstaka källor eller ämnen. Fortsätt använda ditt omdöme som vuxen.

## Struktur

| Fil | Syfte |
|---|---|
| `index.html/js` | Upptäck: AI-skrivna artiklar + manuellt tillägg + Worker-/intresseinställningar |
| `discover.js` | Hämtar nya artiklar via Workern |
| `speech.js` | Delad talsyntes-funktion (🔊-knappen) |
| `swipe.js` | Delad svep-gest (spara/hoppa över, kom ihåg/glömde) |
| `storage.js` | Lagrings- och repetitionslogik (Leitner), stashes, flöden, Worker-URL – samma funktionsnamn för vuxen/barn, men kort/stashes/intressen/historik pekar på separata `localStorage`-nycklar beroende på sida (se kommentaren i filen) |
| `library.html/js` | Bibliotek: sök/filter/redigering, stashes, export/import |
| `review.html/js` | Repetitionsflödet |
| `barn.html/js` | Barnversionens Upptäck-sida (egen stil/text, egen lagring, kidMode-granskning) |
| `barn-bibliotek.html` | Barnversionens bibliotek (återanvänder `library.js`, men mot barnets egen lagring) |
| `barn-repetera.html` | Barnversionens repetition (återanvänder `review.js`, men mot barnets egen lagring) |
| `kids.css` | Lekfull stil för barnsidorna, läses utöver `styles.css` |
| `worker/worker.js` | Cloudflare Worker: Groq (compound) söker på nätet och skriver artiklar i första hand, med Mistral och Claude som reservspår i tur och ordning, källorna kontrolleras, inkl. det separata barnsäkra spåret (se ovan) |
| `worker/wrangler.toml` | Driftsättningsinställningar för Workern (`npx wrangler deploy`) |
| `manifest.webmanifest` | PWA-metadata för vuxenversionen (namn, startsida index.html, ikoner) |
| `manifest-barn.webmanifest` | PWA-metadata för barnversionen (eget namn "Stash för barn", startsida barn.html) – gör den installerbar som en egen app |
| `service-worker.js` | Cachar appskalet för offline-bruk |
| `icons/` | Appens ikoner (16–512px); `icon-kid*.png` är barnversionens egna (en glödlampa/blixt) |
