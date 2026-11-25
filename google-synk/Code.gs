/**
 * Arbetstid – synk via Google-ark
 * ------------------------------------------------------------------
 * Det här skriptet körs i DITT Google-konto och sparar loggen i DITT ark.
 * Ingen annan har åtkomst till datan. Nyckeln skapas automatiskt och
 * finns bara i skriptets egna inställningar.
 *
 * Installation: se README.md i den här mappen. Kort version:
 *   1. Gör en kopia av mallen (eller klistra in den här filen under Tillägg → Apps Script).
 *   2. Distribuera → Ny distribution → Webbapp. Kör som: Jag. Åtkomst: Alla.
 *   3. Ladda om arket och välj menyn Arbetstid → Koppla telefon.
 *
 * Händelserna sparas som rader i bladet "Händelser". RADERA INTE RADER där.
 */

const APP_URL = 'https://DITT-ANVANDARNAMN.github.io/arbetstid/'; // appens adress (ändras en gång i mallen)
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
  if (typeof req.key !== 'string' || req.key !== nyckel_()) return { ok: false, error: 'auth' };

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


// ---- nyckel och koppling av telefon ---------------------------------------

// Slumpas första gången och sparas i skriptets egna inställningar.
function nyckel_() {
  const p = PropertiesService.getScriptProperties();
  let k = p.getProperty('NYCKEL');
  if (!k) {
    k = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    p.setProperty('NYCKEL', k);
  }
  return k;
}

// Länk som fyller i adress och nyckel i appen. Innehåller nyckeln: dela den inte.
function lank_() {
  const url = String(ScriptApp.getService().getUrl() || '').replace(/\/dev$/, '/exec');
  if (!/\/exec$/.test(url)) throw new Error('Skriptet är inte distribuerat som webbapp ännu');
  const nyttolast = Utilities.base64EncodeWebSafe(JSON.stringify({ u: url, k: nyckel_() }));
  return APP_URL + '#synk=' + nyttolast;
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Arbetstid').addItem('Koppla telefon…', 'kopplaTelefon').addToUi();
}

function kopplaTelefon() {
  const ui = SpreadsheetApp.getUi();
  if (APP_URL.indexOf('DITT-') >= 0) {
    ui.alert('Arbetstid', 'Appens adress är inte inställd i skriptet (raden APP_URL överst). Be den som delat arket om hjälp.', ui.ButtonSet.OK);
    return;
  }
  let lank;
  try {
    lank = lank_();
  } catch (err) {
    ui.alert('Arbetstid', String(err.message) + '.\nGör först: Distribuera → Ny distribution → Webbapp (Kör som: Jag, Åtkomst: Alla).', ui.ButtonSet.OK);
    return;
  }
  const html = HtmlService.createHtmlOutput(
    '<div style="font:14px sans-serif">' +
    '<p>Öppna länken på telefonen så kopplas appen till det här arket.</p>' +
    '<p><button onclick="google.script.run.withSuccessHandler(function(){document.getElementById(\'m\').textContent=\'Skickat till din mejl.\'}).mejlaLank()">Mejla länken till mig</button></p>' +
    '<p id="m"></p>' +
    '<p>Eller kopiera:</p><textarea id="l" rows="6" style="width:100%" readonly onclick="this.select()">' + lank.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</textarea>' +
    '<p style="color:#a00">Länken innehåller din nyckel. Dela den inte med andra.</p></div>'
  ).setWidth(420).setHeight(380);
  ui.showModalDialog(html, 'Koppla telefon');
}

// Alltid till ägaren, aldrig till MOTTAGARE: länken innehåller nyckeln.
function mejlaLank() {
  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: 'Arbetstid: koppla telefonen',
    body: 'Öppna länken på telefonen så kopplas appen till ditt ark:\n\n' + lank_() + '\n\nLänken innehåller din nyckel. Dela den inte.',
  });
}
