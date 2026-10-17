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

### Reservläge (Groq/Mistral) om Claude-kontot får slut på kredit

Workern provar upp till tre AI-leverantörer i ordning – **Claude**
(bäst kvalitet, kräver betalkredit) → **Groq** → **Mistral** (sista
utväg) – och faller bara vidare till nästa om den föregående faktiskt
misslyckas (t.ex. slut kredit, nätverksfel). Hittar Claude medvetet
inga passande artiklar (särskilt vanligt i barnläget) räknas det INTE
som ett fel och ingen reservleverantör kontaktas – då visas bara "inga
nya förslag" som vanligt.

**Groq** använder modellen `groq/compound`, som till skillnad från
vanliga Groq-modeller har **riktig webbsökning inbyggd** – precis som
Claude-spåret kan den alltså faktiskt söka efter det du skriver i
"Idag vill jag lära mig om…"-fältet, inte bara välja bland redan
hämtat material. Inget kreditkort krävs för Groq-kontot, och
sökningarna kostar typiskt bråkdelar av en krona per hämtning (se
[groq.com/pricing](https://groq.com/pricing) för aktuellt läge – har
varit gratis under beta, men kontrollera själv).

**Mistral** har ingen inbyggd webbsökning i sin vanliga API, så det
spåret väljer och skriver istället utifrån några handplockade,
trovärdiga RSS-källor (Smithsonian, ScienceDaily, NASA) som Workern
hämtar själv – källan blir artikelns egen länk, redan verifierad per
konstruktion, men en ämnesönskan kan bara uppfyllas om den råkar finnas
i dagens flöden (appen säger det öppet när så är fallet).

Valfritt att sätta upp, men rekommenderat som krockkudde mot precis det
scenariot i skärmdumpen ovan ("Your credit balance is too low"):

1. **Groq**: skapa konto på [console.groq.com](https://console.groq.com/)
   → **API Keys** → **Create API Key**.
2. **Mistral** (gratis, begränsad kvot): skapa konto på
   [console.mistral.ai](https://console.mistral.ai/) → **API Keys** →
   **Create new key**.
3. Lägg till som secrets i din Worker (samma sätt som
   `ANTHROPIC_API_KEY` ovan, eller från terminalen):

   ```
   npx wrangler secret put GROQ_API_KEY
   npx wrangler secret put MISTRAL_API_KEY
   ```

   Du behöver inte ha alla tre – Workern använder bara de secrets som
   faktiskt finns inställda (saknas `ANTHROPIC_API_KEY` helt provas
   Groq direkt, osv.). Saknas samtliga tre visas ett tydligt
   felmeddelande om att ingen leverantör är inställd.

När ett reservspår faktiskt användes visas en liten diskret notis ovanför
förslagen ("Hämtat via gratisläget Groq …"), så du vet att det inte var
Claude som skrev artiklarna den gången.

**Vad som skickas iväg**: varje gång du ber om nya förslag skickar
appen din fritext under "Dina intressen", texten+taggarna från dina
senaste sparade kort, och rubrikerna på artiklar du redan sett eller
hoppat över – till din egen Worker och vidare till Claude, för att
personalisera förslagen och undvika upprepningar. Claude söker sedan
på nätet via Anthropics webbsökning. Inget av detta delas med någon
annan än dig, din Worker och ditt eget Anthropic-konto (eller, om
Claude-anropet misslyckas och ett gratisspår tar över, ditt Groq-
respektive Mistral-konto – se nedan). **Barnversionen skickar inget av
detta** (se nedan).

**Viktigt om du redan har en egen Worker driftsatt**: barnläget (nästa
avsnitt) är en ny del av `worker/worker.js`. Har du redan en Worker
igång måste du driftsätta om den (samma steg som ovan: klistra in den
uppdaterade `worker.js`-koden igen, eller `npx wrangler deploy`) för att
`barn.html` ska fungera – annars saknar din Worker stödet för
`kidMode`.

### Säkerheten i barnversionen

Barnsidornas förslag går genom ett **helt separat, strikt säkerhetsspår**
i Workern (`kidMode: true`), inte samma sökning/prompt som
vuxenversionen med en annan stil på:

- Claude får en egen systemprompt med uttryckliga uteslutningsregler:
  våld, död, krig, brott, olyckor, vuxet/sexuellt innehåll,
  droger/alkohol, politik och skrämmande ämnen söks och skrivs aldrig
  om. Är AI:n det minsta osäker väljer den hellre bort ämnet än tar med
  det – och att lämna få eller inga artiklar är ett uttryckligt
  godkänt, bra resultat, inte ett fel.
- Körs med en billigare, snabbare modell (Claude Haiku) och ungefär
  halva sök-/hämtningsbudgeten jämfört med vuxenversionen – lägre
  kostnad per hämtning, och en mindre yta av webben Claude över huvud
  taget läser under tiden.
- Ingen personalisering skickas med (inga uttalade intressen, inga
  sparade/ogillade exempel) – barnets förslag bygger aldrig på en
  vuxens historik, och ingen beteendeprofil byggs upp kring barnet.
  Det gäller även rent lagringsmässigt: barnets sparade kort, stashes
  och "sedda"-historik ligger i egna `localStorage`-nycklar, skilda
  från vuxenversionens, så de kan aldrig blandas ihop eller läcka in i
  varandra ens av misstag.
- Samma källkontroll som vuxenversionen: en artikel utan en bekräftad
  källa (en URL som faktiskt dök upp i sökningen) tas bort.
- Går något fel (saknad API-nyckel, Claude-fel) visas bara ett
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
| `worker/worker.js` | Cloudflare Worker: Claude söker på nätet och skriver artiklar (med Groq Compound och Mistral som reservspår om Claude strular), källorna kontrolleras, inkl. det separata barnsäkra spåret (se ovan) |
| `worker/wrangler.toml` | Driftsättningsinställningar för Workern (`npx wrangler deploy`) |
| `manifest.webmanifest` | PWA-metadata för vuxenversionen (namn, startsida index.html, ikoner) |
| `manifest-barn.webmanifest` | PWA-metadata för barnversionen (eget namn "Stash för barn", startsida barn.html) – gör den installerbar som en egen app |
| `service-worker.js` | Cachar appskalet för offline-bruk |
| `icons/` | Appens ikoner (16–512px); `icon-kid*.png` är barnversionens egna (en glödlampa/blixt) |
