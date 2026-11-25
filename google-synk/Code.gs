/**
 * Arbetstid – synk via Google-ark
 * ------------------------------------------------------------------
 * Det här skriptet körs i DITT Google-konto och sparar loggen i DITT ark.
 * Ingen annan har åtkomst till datan.
 *
 * Installation: se README.md i den här mappen. Kort version:
 *   1. Skapa ett nytt Google-ark. Tillägg → Apps Script. Klistra in den här filen.
 *   2. Byt NYCKEL nedan till en lång, hemlig text som bara du känner till.
 *   3. Distribuera → Ny distribution → Webbapp. Kör som: Jag. Åtkomst: Alla.
 *   4. Kopiera webbadressen och skriv in den och nyckeln i appen.
 *
 * Händelserna sparas som rader i bladet "Händelser". RADERA INTE RADER där.
 * Du kan titta på dem, men appen räknar ut allt själv.
 */

const NYCKEL = 'BYT-MIG';   // samma text som du skriver in i appen
const MOTTAGARE = '';       // mail från appen går hit. Tomt = ditt eget Google-konto
const BLAD = 'Händelser';
const GILTIGA_TYPER = ['start', 'stop', 'adjust', 'import', 'leave_add', 'leave_del'];

function doPost(e) {
  return svara_(hantera_(e));
}

// Öppnar du adressen i en webbläsare ser du bara att skriptet lever, ingen data.
function doGet() {
  return svara_({ ok: true, app: 'arbetstid', v: 1 });
}

function hantera_(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return { ok: false, error: 'bad' };
  }
  if (!NYCKEL || NYCKEL === 'BYT-MIG' || req.key !== NYCKEL) return { ok: false, error: 'auth' };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try {
    if (req.action === 'mail') return skickaMail_(req);
    return synka_(req);
  } catch (err) {
    return { ok: false, error: 'fel: ' + String(err && err.message ? err.message : err).slice(0, 200) };
  } finally {
    lock.releaseLock();
  }
}

function svara_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function blad_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(BLAD);
  if (!sh) {
    sh = ss.insertSheet(BLAD);
    sh.appendRow(['id', 't', 'typ', 'data', 'tid']);
    sh.setFrozenRows(1);
    // text i alla kolumner utom t, så att Sheets inte "gissar" datum eller tal
    sh.getRange('A:A').setNumberFormat('@');
    sh.getRange('C:E').setNumberFormat('@');
  }
  return sh;
}

function tolka_(s) {
  try { return JSON.parse(s); } catch (err) { return {}; }
}

// req: { key, cursor, push: [händelser] }
// Svar: { ok, cursor, events: [händelser klienten saknar], added }
function synka_(req) {
  const sh = blad_();
  const last = sh.getLastRow(); // inklusive rubrikraden
  const cursor = Math.max(1, Math.floor(Number(req.cursor) || 1));

  // 1. Rader som klienten ännu inte sett (före våra nya rader läggs till)
  let out = [];
  if (last > cursor) {
    const rows = sh.getRange(cursor + 1, 1, last - cursor, 4).getValues();
    out = rows
      .map(function (r) { return { id: String(r[0]), t: Number(r[1]), type: String(r[2]), data: tolka_(r[3]) }; })
      .filter(function (e) { return e.id && isFinite(e.t); });
  }

  // 2. Lägg till klientens nya händelser, utan dubbletter
  const push = Array.isArray(req.push) ? req.push : [];
  let added = 0;
  if (push.length) {
    const ids = {};
    if (last > 1) {
      sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) { ids[String(r[0])] = true; });
    }
    const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    const rows = [];
    push.forEach(function (e) {
      if (!e || typeof e.id !== 'string' || !e.id || ids[e.id]) return;
      if (typeof e.t !== 'number' || !isFinite(e.t) || GILTIGA_TYPER.indexOf(e.type) < 0) return;
      ids[e.id] = true;
      rows.push([e.id, e.t, e.type, JSON.stringify(e.data || {}), Utilities.formatDate(new Date(e.t), tz, 'yyyy-MM-dd HH:mm:ss')]);
    });
    if (rows.length) {
      sh.getRange(last + 1, 1, rows.length, 5).setValues(rows);
      added = rows.length;
    }
  }
  return { ok: true, cursor: sh.getLastRow(), events: out, added: added };
}

// Mail går bara till MOTTAGARE (eller ditt eget konto), aldrig till en adress som skickas in.
function skickaMail_(req) {
  const till = MOTTAGARE || Session.getEffectiveUser().getEmail();
  MailApp.sendEmail({
    to: till,
    subject: String(req.subject || 'Arbetstid').slice(0, 200),
    body: String(req.text || '').slice(0, 20000),
    htmlBody: String(req.html || '').slice(0, 200000),
  });
  return { ok: true, to: till };
}
