# Synk via ditt eget Google-ark (valfritt)

Med synk delar dina enheter samma logg, och du får en extra backup i ett Google-ark
som bara du äger. Utan synk fungerar appen precis som förut.

Det här är ett litet skript som körs i **ditt** Google-konto. Ingen annan har
åtkomst till arket, och den som lagt ut appen ser aldrig din tid. Det kostar inget.

## Sätt upp (ca 5 minuter, görs en gång, helst på dator)

1. Gå till [sheets.new](https://sheets.new) och skapa ett nytt ark. Döp det till t.ex. *Arbetstid*.
2. Meny **Tillägg → Apps Script**. Radera allt som står där.
3. Öppna `Code.gs` i den här mappen, kopiera allt och klistra in.
4. Byt `BYT-MIG` på raden `const NYCKEL` till en lång, hemlig text (t.ex. 20 slumpade tecken). Spara nyckeln, du ska skriva in samma i appen.
5. Tryck **Distribuera → Ny distribution**. Kugghjulet → **Webbapp**.
   - *Kör som:* **Jag**
   - *Vem har åtkomst:* **Alla**
   (Adressen går inte att gissa, och utan nyckeln händer ingenting. Därför behövs det.)
6. Tryck **Distribuera** och godkänn behörigheterna. Google varnar för att appen
   "inte är verifierad": välj *Avancerat → Gå till … (osäkert)*. Det är ditt eget skript.
7. Kopiera **webbappens URL** (slutar på `/exec`).
8. I appen: kugghjulet → **Synk (valfritt)** → klistra in URL och nyckel → **Spara och synka**.

På nästa enhet: installera appen, gör bara steg 8 med samma URL och nyckel. Då hämtas allt.

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
- Skulle du misstänka att nyckeln läckt: byt `NYCKEL` i skriptet, gör en ny version och skriv in den nya i appen.

## Vad som är testat

Skriptets logik och appens synk är testade mot en låtsas-Google och två webbläsare.
Själva Googles beteende (godkännandeskärmar, omdirigeringar) går inte att testa utan ett riktigt konto,
så första uppsättningen bör du prova med två enheter.
