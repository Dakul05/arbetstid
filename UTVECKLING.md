# Utveckling och publicering

Det här dokumentet är till för den som lägger ut eller ändrar appen. Vanliga användare
behöver det inte, se [README.md](README.md).

## Publicera

Appen är bara statiska filer och behöver ligga på en **https**-adress för att kunna installeras
och fungera offline. Den som lägger ut den ser aldrig någons tidsdata.

GitHub Pages (gratis): Settings → Pages → *Deploy from a branch* → `main` / `(root)`.
Netlify, Cloudflare Pages eller egen webbserver fungerar lika bra.

## Uppdatera

Ändrar du filerna måste du höja versionen på raden `const CACHE = ...` i `sw.js`, annars visar
telefonerna de gamla filerna från sin cache. Höj gärna `VERSION` i `engine.js` samtidigt.

## Filer

| Fil | Vad |
|---|---|
| `index.html`, `app.js` | Appskalet: inställningar, backup, påminnelse, delning, synk-gränssnitt |
| `engine.js` | Lokal motor: händelselogg, beräkning av dagar, ledighet, backup, import |
| `sync.js` | Synkklient mot Apps Script |
| `arbetstid-card.js` | Kortet som visar allt (samma kort kan även användas i Home Assistant) |
| `google-synk/Code.gs` | Skriptet som körs i användarens Google-ark |
| `sw.js`, `manifest.webmanifest`, `*.png` | Offline, installation och ikoner |
| `test/` | Tester |

## Hur lagringen fungerar

Varje start, stopp, justering och ledighet sparas som en händelse med eget id. Dagssummorna räknas
fram ur händelserna varje gång. Därför kan två loggar slås ihop utan konflikter (union på id), vilket
både backupinläsning och synk bygger på. Importerad tid har ett löpnummer (`rev`), och den senaste
importen per dag gäller.

## Synk: för den som delar ut appen

1. Skapa ett tomt Google-ark, **Tillägg → Apps Script**, klistra in `google-synk/Code.gs`.
2. Ändra `APP_URL` överst till appens adress. Utan det visar menyn *Koppla telefon* ett felmeddelande.
3. Dela arket: *Dela → Alla med länken → Läsare*. Byt slutet på arkets adress från `/edit…` till `/copy`.
   Den adressen är mallens länk: den som öppnar den får en egen kopia med skriptet.
4. Distribuera **inte** mallen själv. Varje användare gör sin egen distribution i sin kopia.

Skriptet slumpar nyckeln själv och sparar den i skriptegenskaper. Mejl från skriptet går bara till
kontoägaren eller `MOTTAGARE`, aldrig till en adress som skickas in i anropet.

## Tester

```
TZ=Europe/Stockholm node --test test/engine.test.js test/sync.test.js
```

`TZ` behövs eftersom testet av sommartidsbyte är specifikt för svensk tid.
Synktesterna kör `Code.gs` mot en låtsas-Google (`test/gas-mock.js`). Det bevisar skriptets logik,
inte Googles beteende (godkännandeskärmar, omdirigeringar, menyn).

Webbläsartester (kräver Playwright och Chrome, appen serverad på port 8123):

```
npx http-server -p 8123 &
node test/e2e-app.js        # hela flödet, offline, backup, rapport
node test/e2e-sync.js       # två enheter mot en lokal låtsasserver, koppling via länk
node test/e2e-rollover.js   # vecko-, månads- och årsskifte med fejkad klocka
```

## Kortet och Home Assistant

`arbetstid-card.js` är samma kort som i Home Assistant-versionen, med en ändring: avsändaren i
rapportens fot går att ställa in (`generated_by`). Ändras kortet där måste filen kopieras hit för hand.
`engine.js` efterliknar de delar av Home Assistants gränssnitt som kortet anropar.
