/*
 * Arbetstid – lokal motor
 * ------------------------------------------------------------------
 * Ersätter Home Assistant bakom arbetstid-card.js. Kortet pratar med ett
 * "hass"-objekt (states, callService, callApi, callWS); den här filen
 * bygger ett sådant objekt ovanpå en lokal händelselogg.
 *
 * Lagring: varje start, stopp, justering, ledighet osv. sparas som en egen
 * händelse med eget id. Dagssummorna räknas fram ur händelserna. Det gör att
 * två loggar alltid kan slås ihop utan konflikter (union på id), vilket är
 * grunden för export/import och en framtida synk.
 *
 * Reglerna är samma som i HA-paketet arbetstid.yaml:
 *   - ett pass som går över midnatt fördelas per dygn
 *   - justering: högst edit_days dygn bakåt, högst 2 h per tryck
 *   - ett dygn kan aldrig bli negativt (pågående pass räknas in)
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ArbetstidEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const VERSION = "0.2.1";
  const STORAGE_KEY = "arbetstid.v1";
  const EVENT_TYPES = ["start", "stop", "adjust", "import", "leave_add", "leave_del"];

  const DEFAULT_SETTINGS = {
    norm_week: "40:00",
    work_days: [1, 2, 3, 4, 5],
    holidays: true,
    eves: true,
    edit_days: 3,
    reminder_hours: 7, // 0 = av
    configured: false, // sätts när man sparat inställningarna första gången
  };

  // ---------------------------------------------------------------- datum
  const pad = (n) => String(n).padStart(2, "0");
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const isDayKey = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(parseDay(s));
  const parseDay = (k) => { const [y, m, d] = String(k).split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const midnightOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const round1 = (x) => Math.round(x * 10) / 10 + 0; // + 0 gör -0 till 0
  const dayDiff = (a, b) => Math.round((midnightOf(a) - midnightOf(b)) / 86400000); // a - b i dygn

  function uid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  // ---------------------------------------------------------------- replay
  // Fördelar ett pass [t0, t1] (ms) per dygn och lägger till i days.
  function addPass(days, t0, t1) {
    const end = midnightOf(new Date(t1));
    for (let d = midnightOf(new Date(t0)); d <= end; d = addDays(d, 1)) {
      const a0 = Math.max(t0, d.getTime());
      const a1 = Math.min(t1, addDays(d, 1).getTime());
      if (a1 > a0) {
        const k = dayKey(d);
        days[k] = round1((days[k] || 0) + (a1 - a0) / 60000);
      }
    }
  }

  // Ur en lista händelser: { days, since (ms | null), lastToggle (ms | null), leaves: Map(uid → event) }
  function replay(events) {
    const evs = events.slice().sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const days = {};
    const leaves = new Map();
    let since = null;
    let lastToggle = null;
    // Importerad tid: den senaste importen per dag (högst rev) sätter dagens grundvärde.
    // Då går en omimport att ersätta utan att något måste raderas, vilket gör den synkbar.
    const imports = {};
    for (const e of evs) {
      if (e.type !== "import") continue;
      const d = e.data || {};
      const m = Number(d.min);
      if (!isDayKey(d.day) || !isFinite(m) || m < 0) continue;
      const rev = d.rev === undefined ? e.t : Number(d.rev);
      const cur = imports[d.day];
      if (!cur || rev > cur.rev || (rev === cur.rev && e.id > cur.id)) imports[d.day] = { rev, id: e.id, min: m };
    }
    for (const [day, v] of Object.entries(imports)) days[day] = round1(v.min);
    for (const e of evs) {
      const d = e.data || {};
      switch (e.type) {
        case "start":
          if (since === null) { since = e.t; lastToggle = e.t; }
          break;
        case "stop":
          if (since !== null) { addPass(days, since, e.t); since = null; lastToggle = e.t; }
          break;
        case "adjust": {
          const m = Number(d.min) || 0;
          if (!isDayKey(d.day) || !m) break;
          const bak = dayDiff(new Date(e.t), parseDay(d.day));
          let pagar = 0;
          if (since !== null && bak === 0) pagar = (e.t - Math.max(since, midnightOf(new Date(e.t)).getTime())) / 60000;
          days[d.day] = round1(Math.max((days[d.day] || 0) + m, -pagar));
          break;
        }
        case "leave_add":
          if (d.uid && isDayKey(d.start_date) && isDayKey(d.end_date)) leaves.set(d.uid, d);
          break;
        case "leave_del":
          leaves.delete(d.uid);
          break;
      }
    }
    return { days, since, lastToggle, leaves };
  }

  // ---------------------------------------------------------------- lagring
  class Store {
    constructor(storage, now) {
      this.storage = storage;
      this.now = now || (() => Date.now());
      this.events = [];
      this.settings = { ...DEFAULT_SETTINGS };
      this.loadError = null;
      this.load();
    }

    load() {
      let raw = null;
      try { raw = this.storage.getItem(STORAGE_KEY); } catch (err) { this.loadError = err; }
      if (!raw) return;
      try {
        const o = JSON.parse(raw);
        this.events = (o.events || []).filter(validEvent);
        this.settings = { ...DEFAULT_SETTINGS, ...(o.settings || {}) };
      } catch (err) {
        // Förstör inte det som finns: spara undan och börja om
        this.loadError = err;
        try { this.storage.setItem(STORAGE_KEY + ".corrupt", raw); } catch (e) { /* ignore */ }
      }
    }

    save() {
      this.storage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, events: this.events, settings: this.settings }));
    }

    add(type, data, t) {
      if (t === undefined) {
        // Händelser från den här enheten får strikt stigande tid, så att två tryck
        // inom samma millisekund (eller en klocka som hoppar bakåt) ändå hamnar i rätt ordning.
        const now = this.now();
        const last = this.events.reduce((m, e) => Math.max(m, e.t), 0);
        t = now > last || last - now > 86400000 ? now : last + 1;
      }
      const e = { id: uid(), t, type, data: data || {} };
      this.events.push(e);
      this.save();
      return e;
    }

    setSettings(patch) {
      this.settings = { ...this.settings, ...patch };
      this.save();
    }

    clear() {
      this.events = [];
      this.settings = { ...DEFAULT_SETTINGS };
      this.save();
    }
  }

  function validEvent(e) {
    return e && typeof e.id === "string" && e.id && typeof e.t === "number" && isFinite(e.t) && EVENT_TYPES.includes(e.type);
  }

  // ---------------------------------------------------------------- hass
  // deps: { storage, now?, shareReport?(subject, html) → Promise }
  class LocalHass {
    constructor(deps) {
      this.deps = deps || {};
      this.now = this.deps.now || (() => Date.now());
      this.store = new Store(this.deps.storage, this.now);
      this._subs = new Set();
      this._rebuild();
    }

    // ---- tillstånd
    _rebuild() {
      const r = (this.derived = replay(this.store.events));
      const iso = (t) => new Date(t).toISOString();
      const lastChanged = iso(r.lastToggle === null ? 0 : r.lastToggle);
      const states = {
        "sensor.arbetstid": {
          entity_id: "sensor.arbetstid",
          state: r.since !== null ? "pågår" : "stoppad",
          attributes: { days: r.days, running_since: r.since !== null ? iso(r.since) : null, friendly_name: "Arbetstid" },
          last_changed: lastChanged,
        },
        "input_boolean.arbetstid": {
          entity_id: "input_boolean.arbetstid",
          state: r.since !== null ? "on" : "off",
          attributes: { friendly_name: "Arbetstid" },
          last_changed: lastChanged,
        },
      };
      this.hass = {
        states,
        language: "sv",
        callService: (d, s, data, target) => this.callService(d, s, data, target),
        callApi: (method, path) => this.callApi(method, path),
        callWS: (msg) => this.callWS(msg),
      };
      return this.hass;
    }

    _changed() {
      const h = this._rebuild();
      this._subs.forEach((fn) => { try { fn(h); } catch (err) { console.error(err); } });
    }

    subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }

    get running() { return this.derived.since !== null; }

    // Minuter idag inklusive pågående pass (samma beräkning som sensor.arbetstid_idag)
    todayMinutes() {
      const now = this.now();
      const k = dayKey(new Date(now));
      let m = this.derived.days[k] || 0;
      if (this.derived.since !== null) m += (now - Math.max(this.derived.since, midnightOf(new Date(now)).getTime())) / 60000;
      return Math.max(0, m);
    }

    // ---- åtgärder
    start() { if (!this.running) { this.store.add("start"); this._changed(); } }
    stop() { if (this.running) { this.store.add("stop"); this._changed(); } }
    toggle() { this.running ? this.stop() : this.start(); }

    adjust(day, minutes) {
      const m = Math.trunc(Number(minutes) || 0);
      if (!isDayKey(day)) throw new Error("Ogiltigt datum");
      if (!m || Math.abs(m) > 120) throw new Error("Justeringen måste vara 1–120 minuter");
      const bak = dayDiff(new Date(this.now()), parseDay(day));
      if (bak < 0 || bak > this.store.settings.edit_days) throw new Error(`Bara de senaste ${this.store.settings.edit_days} dygnen kan justeras`);
      this.store.add("adjust", { day, min: m });
      this._changed();
    }

    addLeave(summary, startDate, endDate) {
      if (!isDayKey(startDate) || !isDayKey(endDate)) throw new Error("Ogiltigt datum");
      const e = this.store.add("leave_add", { uid: undefined, summary, start_date: startDate, end_date: endDate });
      e.data.uid = e.id;
      this.store.save();
      this._changed();
      return e.id;
    }

    removeLeave(id) {
      if (!this.derived.leaves.has(id)) return;
      this.store.add("leave_del", { uid: id });
      this._changed();
    }

    // ---- det kortet anropar (samma signaturer som HA)
    callService(domain, service, data, target) {
      data = data || {};
      try {
        if (domain === "input_boolean") {
          if (service === "toggle") this.toggle();
          else if (service === "turn_on") this.start();
          else if (service === "turn_off") this.stop();
          else throw new Error(`Okänd tjänst ${domain}.${service}`);
          return Promise.resolve();
        }
        if (domain === "script" && service === "arbetstid_justera") {
          this.adjust(data.dag, data.minuter);
          return Promise.resolve();
        }
        if (domain === "script" && service === "arbetstid_maila") {
          if (!this.deps.shareReport) throw new Error("Delning stöds inte här");
          return Promise.resolve(this.deps.shareReport(String(data.amne || "Arbetstid"), String(data.html || "")));
        }
        if (domain === "calendar" && service === "create_event") {
          this.addLeave(data.summary || "Ledig", data.start_date, data.end_date);
          return Promise.resolve();
        }
        throw new Error(`Okänd tjänst ${domain}.${service}`);
      } catch (err) {
        return Promise.reject(err);
      }
    }

    // GET calendars/<entity>?start=ISO&end=ISO → lista med heldagshändelser
    callApi(method, path) {
      try {
        const m = /^calendars\/([^?]+)\?(.*)$/.exec(path);
        if (method !== "GET" || !m) throw new Error(`Okänt API-anrop ${path}`);
        const q = new URLSearchParams(m[2]);
        const from = new Date(q.get("start")), to = new Date(q.get("end"));
        const out = [];
        for (const l of this.derived.leaves.values()) {
          const s = parseDay(l.start_date), e = parseDay(l.end_date);
          if (e > from && s < to) out.push({ uid: l.uid, summary: l.summary, start: { date: l.start_date }, end: { date: l.end_date } });
        }
        return Promise.resolve(out);
      } catch (err) {
        return Promise.reject(err);
      }
    }

    callWS(msg) {
      try {
        if (msg && msg.type === "calendar/event/delete") { this.removeLeave(msg.uid); return Promise.resolve(); }
        throw new Error(`Okänt WS-anrop ${msg && msg.type}`);
      } catch (err) {
        return Promise.reject(err);
      }
    }

    // ---- inställningar
    setSettings(patch) {
      this.store.setSettings(patch);
      this._changed();
    }

    // ---- backup
    exportData() {
      return { app: "arbetstid", v: 1, exported: new Date(this.now()).toISOString(), settings: this.store.settings, events: this.store.events };
    }

    // Slår ihop med befintlig logg (union på id). Inställningar skrivs bara över om withSettings.
    importData(obj, withSettings) {
      if (!obj || obj.app !== "arbetstid" || !Array.isArray(obj.events)) throw new Error("Filen ser inte ut som en arbetstidsbackup");
      if (withSettings && obj.settings) this.store.settings = { ...DEFAULT_SETTINGS, ...obj.settings };
      return this.mergeEvents(obj.events, true);
    }

    // Slår ihop händelser utifrån (backup, synk) med den lokala loggen. Union på id.
    mergeEvents(list, force) {
      const have = new Set(this.store.events.map((e) => e.id));
      let added = 0, skipped = 0, invalid = 0;
      for (const e of list || []) {
        if (!validEvent(e)) { invalid++; continue; }
        if (have.has(e.id)) { skipped++; continue; }
        this.store.events.push({ id: e.id, t: e.t, type: e.type, data: e.data || {} });
        have.add(e.id);
        added++;
      }
      if (added || force) {
        this.store.save();
        this._changed();
      }
      return { added, skipped, invalid };
    }

    // Läser en dag→minuter-karta, t.ex. attributet "days" från sensor.arbetstid i HA.
    // Tar emot antingen kartan själv eller ett objekt med nyckeln days.
    // En dag som redan importerats ersätts med det nya värdet (senaste importen gäller).
    importDays(obj) {
      const map = obj && typeof obj === "object" && obj.days && typeof obj.days === "object" ? obj.days : obj;
      if (!map || typeof map !== "object") throw new Error("Hittar ingen dagslista");
      let n = 0, bad = 0;
      // alltid högre än tidigare importers, även om klockan står still eller hoppar
      const maxRev = this.store.events.reduce((m, e) => (e.type === "import" ? Math.max(m, Number(e.data && e.data.rev !== undefined ? e.data.rev : e.t) || 0) : m), 0);
      const rev = Math.max(this.now(), maxRev + 1);
      for (const [day, min] of Object.entries(map)) {
        const v = Number(min);
        if (!isDayKey(day) || !isFinite(v) || v < 0) { bad++; continue; }
        this.store.events.push({ id: uid(), t: parseDay(day).getTime() + 12 * 3600000, type: "import", data: { day, min: v, rev } });
        n++;
      }
      this.store.save();
      this._changed();
      return { days: n, invalid: bad };
    }

    clearAll() {
      this.store.clear();
      this._changed();
    }
  }

  return { VERSION, STORAGE_KEY, DEFAULT_SETTINGS, replay, Store, LocalHass, dayKey, parseDay, isDayKey };
});
