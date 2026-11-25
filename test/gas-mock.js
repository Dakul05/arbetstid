// En minimal låtsas-Google för att köra google-synk/Code.gs i Node.
// Efterliknar bara det skriptet använder: ett ark med blad, lås, mail, tidsformat.
// Det är INTE Google: det bevisar skriptets logik, inte Googles beteende.
const fs = require("fs");
const path = require("path");

function createScript(opts) {
  opts = opts || {};
  const key = opts.key || "testnyckel";
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
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: { getScriptLock: () => ({ tryLock: () => !state.busy, releaseLock() {} }) },
    Utilities: { formatDate: (d) => new Date(d).toISOString().replace("T", " ").slice(0, 19) },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; }, getContent() { return s; } }),
    },
    MailApp: { sendEmail: (m) => mails.push(m) },
    Session: { getEffectiveUser: () => ({ getEmail: () => owner }) },
  };

  let code = fs.readFileSync(path.join(__dirname, "..", "google-synk", "Code.gs"), "utf8");
  if (!code.includes("const NYCKEL = 'BYT-MIG';")) throw new Error("Code.gs har ändrats: NYCKEL-raden hittades inte");
  code = code.replace("const NYCKEL = 'BYT-MIG';", `const NYCKEL = ${JSON.stringify(key)};`);
  if (opts.mottagare) code = code.replace("const MOTTAGARE = '';", `const MOTTAGARE = ${JSON.stringify(opts.mottagare)};`);
  const api = new Function("SpreadsheetApp", "LockService", "Utilities", "ContentService", "MailApp", "Session", code + "\nreturn { doPost, doGet };")(
    g.SpreadsheetApp, g.LockService, g.Utilities, g.ContentService, g.MailApp, g.Session
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
  return { key, owner, sheets, mails, state, post, get: () => JSON.parse(api.doGet().getContent()), fetch, sheet: () => sheets.get("Händelser") };
}

module.exports = { createScript };
