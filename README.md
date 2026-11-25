# Arbetstid – fristående app (utan Home Assistant)

Stämpelklocka och arbetstidsrapport som körs direkt i telefonens webbläsare
och sparar allt på enheten. Inget konto, ingen inloggning, ingen server som
lagrar någons tid.

Samma kort som i Home Assistant-versionen (`arbetstid-card.js`, med en enda ändring: avsändaren i rapportens fot går att ställa in), men
bakom det sitter en lokal motor (`engine.js`) i stället för HA.

## Vad den kan

- Starta och stoppa arbetstid, justera ±15/30/60 min upp till några dygn bakåt
- Redovisning per dag, vecka och månad mot en veckonorm, med svenska röda dagar avräknade
- "Ledig": ½ dag, 1 dag eller en period, som sänker normen
- Rapport via telefonens delningsmeny (mail, meddelanden m.m.)
- Påminnelse efter valfritt antal timmar (visas när appen är öppen)
- Fungerar utan nät när den väl är installerad
- Backup till fil, och inläsning av backup. Tid från Home Assistant kan flyttas in.
- Valfri synk mellan enheter via ditt eget Google-ark, med mejlade rapporter (se `google-synk/README.md`)

## Lägga ut den (ett tillfälle)

Appen är bara statiska filer. Den behöver ligga på en **https**-adress för att
kunna installeras och fungera offline. Den som lägger ut den ser aldrig någons
tidsdata, eftersom den bara finns på respektive telefon.

**GitHub Pages (gratis):**
1. Skapa ett nytt repo på GitHub och ladda upp alla filer i den här mappen
   (utom `test/`, som är valfri).
2. Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)` → Save.
3. Efter någon minut finns appen på `https://<ditt-användarnamn>.github.io/<repo>/`.

Netlify Drop, Cloudflare Pages eller egen webbserver går lika bra. Allt som
serverar filerna över https räcker.

## Installera på telefonen

- **Android (Chrome):** öppna adressen, välj menyn ⋮ → *Installera app* (eller *Lägg till på startskärmen*).
- **iPhone (Safari):** öppna adressen, tryck Dela → *Lägg till på hemskärmen*.

Första gången öppnas inställningarna. Ställ in veckoarbetstid och arbetsdagar.

## Backup och data

Allt sparas i webbläsarens lokala lagring på enheten. Det betyder:

- Byter du telefon eller rensar webbplatsdata försvinner loggen. **Ta en backup**
  (Inställningar → Spara backup) då och då. Appen påminner efter 30 dagar utan backup.
- Utan synk delar två enheter inte logg. Backupfilen kan läsas in på en annan enhet, och
  loggarna slås då ihop utan dubbletter. Med synk (se nedan) sker det automatiskt.
- Appen ber webbläsaren skydda lagringen mot automatisk rensning, men det
  garanteras inte. På iPhone är webbläsarens lagring mer sårbar, och särskilt om
  appen inte installerats på hemskärmen.

### Flytta in tid från Home Assistant

I HA: Utvecklarverktyg → Tillstånd → `sensor.arbetstid` → kopiera värdet under
`days` (raderna som ser ut som `"2026-10-12": 452.5`). Klistra in i
Inställningar → *Flytta in tid från Home Assistant*. Dagar som redan finns ersätts.

## Begränsningar jämfört med Home Assistant

- Ingen startskärmswidget med knapp, bara appikonen.
- Påminnelser i bakgrunden är opålitliga i en webbapp (särskilt på iPhone).
  Påminnelsen visas när appen är öppen eller kommer tillbaka i förgrunden.
- Ingen morgonpåminnelse om att tiden inte är startad.
- Rapporten skickas som delad text och en HTML-fil via delningsmenyn (eller som mejl via synkskriptet). Själva
  mailet skickas av användarens egen mailapp, inte av appen.

## Filer

| Fil | Vad |
|---|---|
| `index.html`, `app.js` | Appskalet: inställningar, backup, påminnelse, delning |
| `engine.js` | Lokal motor: händelselogg, samma regler som HA-paketet |
| `sync.js` | Synkklient (valfri) |
| `google-synk/` | Skriptet för Google-arket och installationsguide |
| `arbetstid-card.js` | Kortet (samma fil som i HA-versionen) |
| `sw.js`, `manifest.webmanifest`, `*.png` | Offline, installation och ikoner |
| `test/` | Enhetstester (motor, synk mot låtsas-Google) och webbläsartester (synk, vecko-/månads-/årsskifte) |

## Uppdatera

Byt ut filerna på webbplatsen och höj versionsnumret på raden `const CACHE = ...`
i `sw.js`, annars visar telefonen de gamla filerna från sin cache. Appen hämtar
de nya filerna i bakgrunden och visar dem vid nästa start.

Om du ändrar kortet i Home Assistant-versionen måste `arbetstid-card.js` kopieras
hit för hand (och raden med `generated_by` läggas tillbaka).

## Tester

```
TZ=Europe/Stockholm node --test test/engine.test.js test/sync.test.js
npx http-server -p 8123 &        # webbläsartesterna behöver Playwright + Chrome
node test/e2e-sync.js
node test/e2e-rollover.js
```

Testen av sommartidsbyte är specifik för svensk tid, därför `TZ`.

## Hur lagringen fungerar

Varje start, stopp, justering och ledighet sparas som en händelse med eget id.
Dagssummorna räknas fram ur händelserna varje gång. Därför kan två loggar slås
ihop utan konflikter, och det är det som synken bygger på.
