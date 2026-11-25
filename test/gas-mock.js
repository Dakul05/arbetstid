// En minimal låtsas-Google för att köra google-synk/Code.gs i Node.
// Efterliknar bara det skriptet använder: ett ark med blad, lås, mail, tidsformat.
// Det är INTE Google: det bevisar skriptets logik, inte Googles beteende.
const fs = require("fs");
const path = require("path");

function createScript(opts) {
  opts = opts || {};
  const props = new Map();
  if (opts.key) props.set("NYCKEL", opts.key); // annars slumpar skriptet själv
  const ui = { alerts: [], dialogs: [], createMenu: (n) => ({ addItem() { return this; }, addToUi() { ui.menu = n; } }), alert: (...a) => ui.alerts.push(a), showModalDialog: (h, t) => ui.dialogs.push({ html: h.html, title: t }), ButtonSet: { OK: 1 } };
  let uuid = 0;
  const owner = opts.owner || "agare@example.com";
  const sheets = new Map(); // namn → { rows: [[...]], frozen }
  const mails = [];
  const state = { busy: false, posts: 0, lastPayloadBytes: 0 };

  class Range {
    constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
    getValues() {
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = this.sh.rows[this.r - 1 + i] || [];
        const o = [];
        for (let j = 0; j < this.nc; j++) { const v = row[this.c - 1 + j]; o.push(v === undefined ? "" : v); }
        out.push(o);
      }
      return out;
    }
    setValues(vals) {
      vals.forEach((vr, i) => {
        const idx = this.r - 1 + i;
        while (this.sh.rows.length <= idx) this.sh.rows.push([]);
        vr.forEach((v, j) => { this.sh.rows[idx][this.c - 1 + j] = v; });
      });
      return this;
    }
    setNumberFormat() { return this; }
  }
  class Sheet {
    constructor(name) { this.name = name; this.rows = []; this.frozen = 0; }
    appendRow(r) { this.rows.push(r.slice()); }
    setFrozenRows(n) { this.frozen = n; }
    getLastRow() { return this.rows.length; }
    getRange(a, b, c, d) {
      if (typeof a === "string") return new Range(this, 1, 1, 1, 1); // 'A:A' – bara för setNumberFormat
      return new Range(this, a, b, c, d);
    }
  }
  const ss = {
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => { const s = new Sheet(n); sheets.set(n, s); return s; },
    getSpreadsheetTimeZone: () => "Europe/Stockholm",
  };
  const g = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => ui },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, v) }) },
    ScriptApp: { getService: () => ({ getUrl: () => (state.deployed === false ? "" : "https://script.google.com/macros/s/AKtest/dev") }) },
    HtmlService: { createHtmlOutput: (html) => ({ html, setWidth() { return this; }, setHeight() { return this; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => !state.busy, releaseLock() {} }) },
    Utilities: {
      formatDate: (d) => new Date(d).toISOString().replace("T", " ").slice(0, 19),
      getUuid: () => "00000000-0000-4000-8000-" + String(++uuid).padStart(12, "0"),
      base64EncodeWebSafe: (str) => Buffer.from(str, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_"),
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; }, getContent() { return s; } }),
    },
    MailApp: { sendEmail: (m) => mails.push(m) },
    Session: { getEffectiveUser: () => ({ getEmail: () => owner }) },
  };

  let code = fs.readFileSync(path.join(__dirname, "..", "google-synk", "Code.gs"), "utf8");
  if (opts.mottagare) code = code.replace("const MOTTAGARE = '';", `const MOTTAGARE = ${JSON.stringify(opts.mottagare)};`);
  if (opts.appUrl !== false) code = code.replace("https://DITT-ANVANDARNAMN.github.io/arbetstid/", opts.appUrl || "https://exempel.github.io/arbetstid/");
  const api = new Function("SpreadsheetApp", "LockService", "Utilities", "ContentService", "MailApp", "Session", "PropertiesService", "ScriptApp", "HtmlService", code + "\nreturn { doPost, doGet, onOpen, kopplaTelefon, mejlaLank };")(
    g.SpreadsheetApp, g.LockService, g.Utilities, g.ContentService, g.MailApp, g.Session, g.PropertiesService, g.ScriptApp, g.HtmlService
  );

  const post = (body) => {
    state.posts++;
    const text = typeof body === "string" ? body : JSON.stringify(body);
    state.lastPayloadBytes = text.length;
    return JSON.parse(api.doPost({ postData: { contents: text } }).getContent());
  };
  // fetch-lik funktion som Sync kan använda
  const fetch = async (url, init) => {
    const out = post(init.body);
    return { json: async () => out };
  };
  return { get key() { return props.get("NYCKEL") || (post({ key: "x" }), props.get("NYCKEL")); }, api, ui, props, owner, sheets, mails, state, post, get: () => JSON.parse(api.doGet().getContent()), fetch, sheet: () => sheets.get("Händelser") };
}

module.exports = { createScript };
