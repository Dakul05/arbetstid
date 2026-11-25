# Synk via ditt eget Google-ark (valfritt)

Med synk delar dina enheter samma logg, och du får en extra backup i ett Google-ark
som bara du äger. Utan synk fungerar appen precis som förut.

Det är ett litet skript som körs i **ditt** Google-konto. Ingen annan har
åtkomst till arket, och den som lagt ut appen ser aldrig din tid. Det kostar inget.

## Sätt upp (ca 5 minuter, görs en gång, helst på dator)

1. Öppna mall-länken du fått från den som delat appen och tryck **Gör en kopia**. Kopian hamnar i ditt Google-konto och har skriptet inbyggt.
   (Har du ingen mall: skapa ett nytt ark på [sheets.new](https://sheets.new), välj **Tillägg → Apps Script**, klistra in innehållet i `Code.gs` och spara.)
2. Meny **Tillägg → Apps Script**. Tryck **Distribuera → Ny distribution**, kugghjulet → **Webbapp**.
   - *Kör som:* **Jag**
   - *Vem har åtkomst:* **Alla**
   (Adressen går inte att gissa, och utan nyckeln händer ingenting.)
3. Tryck **Distribuera** och godkänn behörigheterna. Google varnar för att appen
   "inte är verifierad": välj *Avancerat → Gå till … (osäkert)*. Det är ditt eget skript.
4. Ladda om arket. Det kommer en ny meny, **Arbetstid → Koppla telefon**. Välj den, tryck **Mejla länken till mig** och öppna mejlet på telefonen.
5. Tryck på länken. Appen frågar om den ska kopplas till ditt ark. Svara ja. Klart.

Nyckeln skapas automatiskt av skriptet, du behöver aldrig skriva eller se den.
På nästa enhet: gör steg 4–5 igen (mejla länken, öppna på den enheten).

Går länken inte att använda kan du i stället klistra in adressen (webbappens URL, slutar på `/exec`) och nyckeln
(Apps Script → Projektinställningar → Skriptegenskaper → `NYCKEL`) under kugghjulet → *Synk (valfritt)*.

## Mejla rapporter

Kryssa i *Skicka rapporter som mejl via skriptet*. Rapporten går då till ditt eget
Google-konto, eller till `MOTTAGARE` om du fyllt i den i skriptet (t.ex. Anns adress).
Skriptet skickar aldrig till någon annan adress, och går mejlet inte fram
används telefonens vanliga delningsmeny.

## Bra att veta

- **Radera inga rader** i bladet *Händelser*. Raderar du dem hämtas inget tillbaka, men enheterna behåller sin egen logg och skickar inte om den automatiskt. Använd *Hämta om allt* i appen om du vill att enheten skickar allt igen.
- Ändrar du skriptet måste du **Distribuera → Hantera distributioner → Redigera → Ny version**, annars körs den gamla.
- Alla enheter slår ihop sina händelser utan konflikter. Går en enhet offline synkas det vid nästa start eller var femte minut.
- Inställningar (norm, arbetsdagar m.m.) är per enhet och synkas inte. Nyckeln ligger bara på enheten och ingår inte i backupfilen.
- *Radera all data* i appen tömmer bara enheten. Är synken på hämtas allt tillbaka från arket. Vill du börja om: koppla från synken och töm arket.
- Skulle du misstänka att nyckeln läckt: ta bort `NYCKEL` under Skriptegenskaper (en ny skapas direkt), och koppla om enheterna med *Koppla telefon*.
- Länken från *Koppla telefon* innehåller nyckeln. Skicka den bara till dig själv.

## Vad som är testat

Skriptets logik och appens synk är testade mot en låtsas-Google och två webbläsare.
Själva Googles beteende (godkännandeskärmar, omdirigeringar, menyn och att adressen hämtas rätt) går inte att testa utan ett riktigt konto,
så första uppsättningen bör du prova med två enheter.
