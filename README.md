# Stash – en enkel personlig DeepStash-variant

Ett litet webbläsartillägg (Manifest V3) för att spara citat/idéer du hittar
när du surfar, bläddra i dem senare och repetera dina bästa fynd med ett
enkelt Leitner-system (spaced repetition). Allt lagras lokalt i webbläsaren
via `chrome.storage.local` – inget skickas till någon server.

## Funktioner

- **Spara**: markera text på valfri sida → högerklick → "Spara till Stash".
  Du kan även skriva in kort manuellt via popupen.
- **Stashes**: samlingar (som "decks" i DeepStash) för att gruppera kort.
  Kort utan vald stash hamnar i den underförstådda Inkorgen. Skapa, byt
  mellan och ta bort stashes i biblioteket.
- **Bibliotek** (`library.html`): sök, filtrera på stash och taggar,
  redigera taggar, flytta kort mellan stashes, ta bort kort.
- **Repetition** (`review.html`): kort som är "förfallna" enligt
  Leitner-schemat dyker upp ett i taget. Klicka "Kom ihåg" för att skjuta
  upp nästa repetition längre fram, eller "Glömde" för att se kortet igen
  snart.
- **Export/import**: säkerhetskopiera alla kort och stashes till en
  JSON-fil från biblioteket, eller återställ från en tidigare export.

## Installera lokalt (utvecklarläge)

1. Öppna `chrome://extensions` (eller `edge://extensions`).
2. Slå på **Utvecklarläge**.
3. Klicka **Läs in okomprimerat** och välj denna mapp (repots rot).
4. Klart – ikonen dyker upp i verktygsfältet.

## Struktur

| Fil | Syfte |
|---|---|
| `manifest.json` | Tilläggets konfiguration (MV3) |
| `background.js` | Service worker: skapar kontextmenyn och sparar markerad text |
| `storage.js` | Delad lagrings- och repetitionslogik (Leitner) |
| `popup.html/js` | Snabbvy i verktygsfältet: manuellt tillägg + senaste korten |
| `library.html/js` | Fullständigt bibliotek med sök/filter/redigering, stashes och export/import |
| `review.html/js` | Repetitionsflödet |
| `icons/` | Tilläggets ikoner (16/32/48/128px) |
