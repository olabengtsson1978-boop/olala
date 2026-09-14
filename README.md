# Stash – en enkel personlig DeepStash-variant

En installerbar webbapp (PWA) för att spara citat/idéer, upptäcka nytt
via egna RSS-flöden och repetera dina bästa fynd med ett enkelt
Leitner-system (spaced repetition). Allt lagras lokalt i webbläsaren
(`localStorage`) – inget skickas till någon server, förutom att
RSS-flödena du väljer hämtas när du ber om nya förslag.

## Funktioner

- **Upptäck** (`index.html`): appen hämtar nya artiklar/inlägg från de
  RSS/Atom-flöden du valt (några exempel är förvalda) och visar dem som
  förslag. Klicka "Spara" för att lägga till som ett kort, eller
  "Hoppa över" – båda döljer förslaget permanent.
- **Manuellt tillägg**: klistra in text direkt på Upptäck-sidan, med
  valfria taggar och stash.
- **Stashes**: namngivna samlingar (som "decks" i DeepStash) för att
  gruppera kort. Kort utan vald stash hamnar i den underförstådda
  Inkorgen.
- **Bibliotek** (`library.html`): sök, filtrera på stash och taggar,
  redigera taggar, flytta kort mellan stashes, ta bort kort.
- **Repetition** (`review.html`): förfallna kort enligt Leitner-schemat
  dyker upp ett i taget. "Kom ihåg" skjuter upp nästa repetition längre
  fram, "Glömde" visar kortet igen snart.
- **Export/import**: säkerhetskopiera kort, stashes och flöden till en
  JSON-fil från biblioteket, eller återställ från en tidigare export.
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

## Flöden

Standardflödena är valda för "spännande fakta"-känsla à la National
Geographic/Illustrerad Vetenskap: Smithsonian (Vetenskap & Natur),
ScienceDaily och NASA. Förslagen visas som magasinkort med bild (hämtad
från flödets `<enclosure>`/`<media:content>` eller en bild i
beskrivningen) och en färgad källbadge.

Lägg till egna RSS/Atom-URL:er under "Flöden som förslagen hämtas från"
på Upptäck-sidan – t.ex. Illustrerad Vetenskap om du hittar deras
feed-URL (den är inte officiellt dokumenterad, så testa `illvet.se/feed`
eller kolla sidkällan efter en `<link rel="alternate" type="application/rss+xml">`).
Om ett flöde blockerar CORS provar appen automatiskt en publik
läsproxy (`api.allorigins.win`) som andrahandsval – fungerar det inte
heller visas en kort varning istället för att krascha.

## Struktur

| Fil | Syfte |
|---|---|
| `index.html/js` | Upptäck: förslag från flöden + manuellt tillägg + flödeshantering |
| `discover.js` | Hämtning och tolkning av RSS/Atom-flöden |
| `storage.js` | Delad lagrings- och repetitionslogik (Leitner), stashes, flöden |
| `library.html/js` | Bibliotek: sök/filter/redigering, stashes, export/import |
| `review.html/js` | Repetitionsflödet |
| `manifest.webmanifest` | PWA-metadata (namn, ikoner, installationsbeteende) |
| `service-worker.js` | Cachar appskalet för offline-bruk |
| `icons/` | Appens ikoner (16–512px) |
