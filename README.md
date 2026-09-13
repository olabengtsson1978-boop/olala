# Stash – en enkel personlig DeepStash-variant

Ett litet webbläsartillägg (Manifest V3) för att spara citat/idéer du hittar
när du surfar, bläddra i dem senare och repetera dina bästa fynd med ett
enkelt Leitner-system (spaced repetition). Allt lagras lokalt i webbläsaren
via `chrome.storage.local` – inget skickas till någon server.

## Funktioner

- **Spara**: markera text på valfri sida → högerklick → "Spara till Stash".
  Du kan även skriva in kort manuellt via popupen.
- **Bibliotek** (`library.html`): sök, filtrera på taggar, redigera taggar,
  ta bort kort.
- **Repetition** (`review.html`): kort som är "förfallna" enligt
  Leitner-schemat dyker upp ett i taget. Klicka "Kom ihåg" för att skjuta
  upp nästa repetition längre fram, eller "Glömde" för att se kortet igen
  snart.

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
| `library.html/js` | Fullständigt bibliotek med sök/filter/redigering |
| `review.html/js` | Repetitionsflödet |
