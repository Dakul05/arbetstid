/*
 * Arbetstid – synk via eget Google-ark (valfritt)
 * ------------------------------------------------------------------
 * Pratar med skriptet i google-synk/Code.gs. Skickar händelser som skriptet
 * inte sett och hämtar de som den här enheten saknar. Eftersom allt är
 * händelser med eget id slås loggarna ihop utan konflikter.
 *
 * Synkinställningarna ligger i en egen nyckel i lagringen (inte i
 * inställningarna), så att nyckeln inte följer med i en backupfil.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ArbetstidSync = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KEY = "arbetstid.sync";
  const CHUNK = 300; // händelser per anrop

  class SyncError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }

  const FRESH = () => ({ url: "", key: "", cursor: 1, known: [], last: 0, error: null, mail: false });

  class Sync {
    // opts: { eng: LocalHass, storage, fetch?, now?, timeoutMs? }
    constructor(opts) {
      this.eng = opts.eng;
      this.storage = opts.storage;
      this.fetchFn = opts.fetch || ((...a) => fetch(...a));
      this.now = opts.now || (() => Date.now());
      this.timeoutMs = opts.timeoutMs || 25000;
      this.busy = false;
      this.merging = false; // sant medan hämtade händelser läggs in, så att appen inte synkar i onödan
      this._subs = new Set();
      this.state = this._load();
    }

    _load() {
      try {
        const o = JSON.parse(this.storage.getItem(KEY) || "null");
        if (o && typeof o === "object") return { ...FRESH(), ...o };
      } catch (err) { /* börja om */ }
      return FRESH();
    }

    _save() {
      try { this.storage.setItem(KEY, JSON.stringify(this.state)); } catch (err) { /* ignore */ }
    }

    get configured() { return !!(this.state.url && this.state.key); }
    get mailViaScript() { return this.configured && !!this.state.mail; }
    get status() {
      return { configured: this.configured, busy: this.busy, last: this.state.last, error: this.state.error, mail: !!this.state.mail, url: this.state.url, key: this.state.key };
    }

    onChange(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
    _emit() { this._subs.forEach((fn) => { try { fn(this.status); } catch (err) { console.error(err); } }); }

    // Kastar Error med svenskt meddelande vid ogiltig adress eller nyckel.
    configure(url, key, mail) {
      url = String(url || "").trim();
      key = String(key || "").trim();
      let u;
      try { u = new URL(url); } catch (err) { throw new Error("Adressen ser inte ut som en webbadress"); }
      const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
      if (u.protocol !== "https:" && !(local && u.protocol === "http:")) throw new Error("Adressen måste börja med https://");
      if (!key) throw new Error("Skriv in nyckeln");
      const changed = u.href !== this.state.url || key !== this.state.key;
      if (changed) this.state = { ...FRESH(), url: u.href, key };
      this.state.mail = !!mail;
      this.state.error = null;
      this._save();
      this._emit();
    }

    disconnect() {
      this.state = FRESH();
      this._save();
      this._emit();
    }

    // Nästa synk hämtar allt från arket igen (dubbletter filtreras bort på id).
    refetchAll() {
      this.state.cursor = 1;
      this._save();
    }

    async _post(payload) {
      const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), this.timeoutMs) : null;
      let res;
      try {
        // Ingen Content-Type-header: då är det en enkel förfrågan utan CORS-förfrågan i förväg.
        res = await this.fetchFn(this.state.url, { method: "POST", body: JSON.stringify(payload), redirect: "follow", signal: ctl ? ctl.signal : undefined });
      } catch (err) {
        throw new SyncError("offline", err && err.name === "AbortError" ? "Skriptet svarade inte i tid" : "Ingen kontakt med arket (offline?)");
      } finally {
        if (timer) clearTimeout(timer);
      }
      let data;
      try { data = await res.json(); } catch (err) {
        throw new SyncError("format", 'Svaret var inte som väntat. Kontrollera adressen och att skriptet är distribuerat med åtkomst "Alla".');
      }
      if (!data || data.ok !== true) {
        const code = data && data.error;
        if (code === "auth") throw new SyncError("auth", "Fel nyckel");
        if (code === "busy") throw new SyncError("busy", "Arket var upptaget, försöker igen senare");
        if (code === "bad") throw new SyncError("bad", "Skriptet förstod inte anropet");
        throw new SyncError("script", "Fel från skriptet" + (code ? ": " + code : ""));
      }
      return data;
    }

    // Skickar nya lokala händelser och hämtar andras. Returnerar status.
    async run() {
      if (!this.configured || this.busy) return this.status;
      this.busy = true;
      this._emit();
      try {
        const known = new Set(this.state.known);
        let pending = this.eng.store.events.filter((e) => !known.has(e.id));
        let rounds = 0;
        do {
          const chunk = pending.slice(0, CHUNK);
          const res = await this._post({ key: this.state.key, cursor: this.state.cursor, push: chunk });
          const incoming = Array.isArray(res.events) ? res.events : [];
          this.merging = true;
          try { this.eng.mergeEvents(incoming); } finally { this.merging = false; }
          incoming.forEach((e) => e && e.id && known.add(e.id));
          chunk.forEach((e) => known.add(e.id));
          this.state.cursor = Number(res.cursor) || this.state.cursor;
          this.state.known = [...known];
          this._save(); // spara efter varje del, så att en avbruten synk inte börjar om
          pending = pending.slice(CHUNK);
          rounds++;
        } while (pending.length && rounds < 200);
        this.state.last = this.now();
        this.state.error = null;
      } catch (err) {
        this.state.error = err && err.message ? err.message : String(err);
      } finally {
        this.busy = false;
        this._save();
        this._emit();
      }
      return this.status;
    }

    // Skickar rapporten som mail via skriptet (till kontots egen adress). Returnerar adressen.
    async mail(subject, html, text) {
      if (!this.configured) throw new Error("Synk är inte inställd");
      const res = await this._post({ key: this.state.key, action: "mail", subject, html, text });
      return res.to;
    }
  }

  // Läser "synk=<base64>" ur länken som arket ger ("Koppla telefon"). Returnerar {url,key} eller null.
  // Bara Googles skriptadresser (och localhost, för test) godtas, så en främmande länk inte kan peka om synken.
  function parseLink(hash) {
    try {
      const m = /(?:^|[#&])synk=([A-Za-z0-9_\-]+)/.exec(String(hash || ""));
      if (!m) return null;
      let b = m[1].replace(/-/g, "+").replace(/_/g, "/");
      while (b.length % 4) b += "=";
      const bin = typeof atob === "function" ? atob(b) : Buffer.from(b, "base64").toString("binary");
      const o = JSON.parse(decodeURIComponent(escape(bin)));
      if (!o || typeof o.u !== "string" || typeof o.k !== "string" || !o.k) return null;
      const u = new URL(o.u);
      const ok = (u.protocol === "https:" && u.hostname === "script.google.com") || (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"));
      return ok ? { url: o.u, key: o.k } : null;
    } catch (err) { return null; }
  }

  return { KEY, Sync, SyncError, parseLink };
});
