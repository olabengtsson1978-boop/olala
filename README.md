# Stash – en enkel personlig DeepStash-variant

En installerbar webbapp (PWA) för att spara citat/idéer, upptäcka nytt
via en AI-kuraterad flödeskälla och repetera dina bästa fynd med ett
enkelt Leitner-system (spaced repetition). Korten lagras lokalt i
webbläsaren (`localStorage`) – inget skickas till någon server, förutom
att din egen Cloudflare Worker hämtar RSS-flöden och skickar dem till
Claude för kuratering när du ber om nya förslag.

## Funktioner

- **Upptäck** (`index.html`): en AI (Claude, via din egen Cloudflare
  Worker) väljer ut de mest intressanta "visste du att"-fakta ur dina
  RSS/Atom-flöden och destillerar varje vald artikel till en kort,
  fängslande mening – ungefär som de kondenserade korten i riktiga
  DeepStash. Visas som magasinkort med bild, citat-typografi och en
  färgad källbadge. Dra kortet åt höger för att spara, vänster för att
  hoppa över (eller använd knapparna).
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

## Sätta upp AI-kurateringen (Cloudflare Worker)

Upptäck-sidan kan inte hämta RSS-flöden direkt från webbläsaren (de
flesta tidningars flöden blockerar det, s.k. CORS), och vi vill ändå ha
en riktig AI som väljer ut och destillerar de bästa korten istället för
en enkel gissning. Lösningen är en liten gratis **Cloudflare Worker** –
en serverfunktion du äger själv – som gör jobbet. Tar ~5 minuter, en
gång:

1. **Skapa ett gratis Cloudflare-konto**: [dash.cloudflare.com](https://dash.cloudflare.com/sign-up)
   (inget kreditkort krävs för gratisnivån av Workers).
2. I dashboarden: **Workers & Pages** → **Create** → **Create Worker**.
   Ge den valfritt namn (t.ex. `stash-proxy`) → **Deploy**.
3. Klicka **Edit code** (eller "Quick edit"). Markera all exempelkod i
   editorn och ersätt den med hela innehållet i [`worker/worker.js`](worker/worker.js)
   från det här repot. Klicka **Deploy**/**Save and deploy**.
4. Skaffa en Anthropic API-nyckel: [console.anthropic.com](https://console.anthropic.com/)
   → **API Keys** → **Create Key**. (Kräver att du lägger in betalning
   på ditt Anthropic-konto – kostnaden per hämtning är mycket liten
   eftersom Workern använder den billiga Haiku-modellen.)
5. Tillbaka i din Worker: **Settings** → **Variables and Secrets** →
   lägg till en variabel med namnet `ANTHROPIC_API_KEY`, klistra in
   nyckeln som värde, markera den som **Encrypt**/**Secret** → spara.
   Nyckeln når aldrig webbappen eller din webbläsare – bara Workern.
6. Kopiera Workerns URL (visas högst upp i dashboarden, ser ut som
   `https://stash-proxy.ditt-namn.workers.dev`).
7. Klistra in den URL:en under **"AI-kuratering"** på Upptäck-sidan i
   appen → **Spara**.

Fungerar det inte direkt: använd **"Testa"**-knappen bredvid varje
flöde i flödeslistan – den visar exakt felmeddelande från Workern.

### Flöden

Standardflödena är valda för "spännande fakta"-känsla à la National
Geographic/Illustrerad Vetenskap: Forskning & Framsteg, forskning.se,
Illustrerad Vetenskap och SVT Nyheter (fof.se/forskning.se/illvet.se-
URL:erna följer ett vanligt mönster men är inte oberoende bekräftade –
testa dem och byt ut de som inte fungerar). Lägg till egna RSS/Atom-URL:er
under "Flöden som förslagen hämtas från" på Upptäck-sidan.

## Struktur

| Fil | Syfte |
|---|---|
| `index.html/js` | Upptäck: AI-kuraterade förslag + manuellt tillägg + flödes-/Worker-inställningar |
| `discover.js` | Hämtar och kuraterar förslag via Workern |
| `speech.js` | Delad talsyntes-funktion (🔊-knappen) |
| `swipe.js` | Delad svep-gest (spara/hoppa över, kom ihåg/glömde) |
| `storage.js` | Delad lagrings- och repetitionslogik (Leitner), stashes, flöden, Worker-URL |
| `library.html/js` | Bibliotek: sök/filter/redigering, stashes, export/import |
| `review.html/js` | Repetitionsflödet |
| `worker/worker.js` | Cloudflare Worker: hämtar flöden + AI-kuraterar via Claude (se ovan) |
| `manifest.webmanifest` | PWA-metadata (namn, ikoner, installationsbeteende) |
| `service-worker.js` | Cachar appskalet för offline-bruk |
| `icons/` | Appens ikoner (16–512px) |
