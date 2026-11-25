# Arbetstid

En stämpelklocka och arbetstidsrapport som körs direkt i telefonens webbläsare.
Ingen inloggning, inget konto och ingen server som lagrar din tid. Allt sparas
på din egen telefon, och du kan om du vill även synka till ditt eget Google-ark.

## Det här kan du göra

- Starta och stoppa arbetstiden med en knapp
- Justera tiden med ±15, 30 eller 60 minuter, några dygn bakåt
- Se dag, vecka och månad mot din veckoarbetstid. Svenska röda dagar räknas som lediga
- Lägga in ledighet (halv dag, hel dag eller en period), som sänker normen
- Skicka en rapport via telefonens delningsmeny (mejl, meddelanden m.m.)
- Få en påminnelse efter ett antal timmar, så du inte glömmer att stämpla ut
- Använda appen utan internet, när den väl är installerad
- Ta backup till en fil, och läsa in den igen
- Synka mellan flera enheter via ditt eget Google-ark (valfritt, se [google-synk/README.md](google-synk/README.md))

## Komma igång

1. Öppna appens adress i telefonens webbläsare.
2. Installera den så den får en egen ikon och fungerar utan nät:
   - **Android (Chrome):** meny ⋮ → *Installera app*
   - **iPhone (Safari):** Dela → *Lägg till på hemskärmen*
3. Första gången öppnas inställningarna. Skriv in din veckoarbetstid (till exempel `40:00` eller `37,5`) och välj arbetsdagar. Tryck *Spara*.

Sedan är det bara att trycka på knappen när du börjar och slutar.

## Din data och backup

- Allt sparas i webbläsaren på din enhet. Den som tillhandahåller appen ser aldrig din tid.
- Byter du telefon eller rensar du webbplatsdata utan backup försvinner tiden.
  **Ta en backup** då och då: kugghjulet → *Spara backup*. Appen påminner om det efter 30 dagar.
- Backupfilen kan läsas in på en annan enhet. Loggarna slås då ihop utan dubbletter.
- Med synk till ditt Google-ark får du en backup automatiskt.
- På iPhone är webbläsarens lagring känsligare för rensning, särskilt om appen inte lagts på hemskärmen.

## Påminnelser och begränsningar

- Påminnelsen visas när appen är öppen eller kommer tillbaka i förgrunden. Webbappar kan inte garantera notiser i bakgrunden, särskilt inte på iPhone.
- Det finns ingen startskärmswidget med knapp, bara appikonen.
- Rapporten skickas via telefonens delningsmeny, eller som mejl till dig själv om du kopplat synken.

## Vanliga frågor

**Min tid försvann.** Har du en backup eller synk kan du läsa in den. Annars finns den bara kvar om webbplatsdata inte rensats: öppna appen i samma webbläsare som du använde förut.

**Jag ser inte den nya versionen.** Stäng appen helt och öppna den igen. Nya filer hämtas i bakgrunden och visas vid nästa start.

**Fel dag eller tid?** Kontrollera att telefonens datum och tid är inställda automatiskt.

**Jag använde Home Assistant-versionen.** Kopiera värdet under `days` på `sensor.arbetstid` och klistra in det under kugghjulet → *Flytta in tid från Home Assistant*. Dagar som redan finns ersätts.

---

Information för den som vill lägga ut eller ändra appen finns i [UTVECKLING.md](UTVECKLING.md).
