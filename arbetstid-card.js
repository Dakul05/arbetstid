/*
 * arbetstid-card
 * ------------------------------------------------------------------
 * Start/stopp, justering ±15/30/60 min (upp till 3 dygn bakåt) och
 * redovisning per dag, vecka och månad. Rapporten kan mailas.
 *
 * Kräver paketet arbetstid.yaml (sensor.arbetstid m.fl.). All data
 * ligger lokalt i HA, i attributet "days" på sensor.arbetstid.
 *
 *   type: custom:arbetstid-card
 *   entity: sensor.arbetstid
 *   # valfritt:
 *   switch: input_boolean.arbetstid
 *   adjust_script: script.arbetstid_justera
 *   mail_script: script.arbetstid_maila
 *   title: Arbetstid
 *   default_view: week          # day | week | month
 *   edit_days: 3                # hur många dygn bakåt som går att justera
 *   bars: { day: 14, week: 12, month: 12 }
 *   avg_weeks: 12               # veckor i snittet för "Arbetsvecka"
 *   generated_by: Home Assistant  # avsändare i rapportens fot (ändrat i appversionen)
 *
 * Norm (1.2.0):
 *   norm_week: "39:45"          # veckoarbetstid, "tt:mm" eller timmar (39.75)
 *   work_days: [1, 2, 3, 4, 5]  # mån–fre (0 = sön)
 *   holidays: true              # svenska röda dagar räknas som lediga
 *   eves: true                  # midsommar-, jul- och nyårsafton lediga
 *   free_days: []               # egna lediga dagar, t.ex. ["2027-05-07"]
 *   Dagnormen = veckonormen / antal arbetsdagar. En helgdag på en vardag
 *   tar bort en dagnorm ur veckan. Helgdagarna räknas fram i koden
 *   (påskberäkning m.m.), så de stämmer för alla år.
 *
 * Ledighet (1.3.0):
 *   leave_calendar: calendar.ledighet   # lokal kalender, heldagshändelser
 *   "Ledig" tar bort dagnormen, "Halvdag" halverar den. Knappen "Ledig"
 *   öppnar en popup för ½ dag, 1 dag eller en period, och listar kommande
 *   ledigheter med möjlighet att ta bort dem.
 *
 * Kortet fyller sin ruta (t.ex. i custom:grid-layout); grafen tar
 * den höjd som blir över.
 */

const ATC_VERSION = "1.3.0";

const MONTHS_SHORT = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const MONTHS_LONG = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];
const DAYS_SHORT = ["sön", "mån", "tis", "ons", "tor", "fre", "lör"];
const DAYS_LONG = ["söndag", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag"];

const pad = (n) => String(n).padStart(2, "0");
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDayKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return { year: d.getUTCFullYear(), week: Math.ceil(((d - yearStart) / 86400000 + 1) / 7) };
}

// ---- Svenska helgdagar -------------------------------------------------
// Påskdagen enligt den gregorianska beräkningen (Meeus/Jones/Butcher).
function easterSunday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return new Date(y, Math.floor(n / 31) - 1, (n % 31) + 1);
}
// Första datum från och med (månad, dag) som är veckodagen wd (0 = sön).
function firstWeekday(y, month, day, wd) {
  let d = new Date(y, month, day);
  while (d.getDay() !== wd) d = addDays(d, 1);
  return d;
}
// { "2027-03-26": "Långfredagen", ... } – röda dagar, plus aftnar om eves = true
const _holidayCache = {};
function swedishHolidays(y, eves) {
  const key = `${y}:${eves ? 1 : 0}`;
  if (_holidayCache[key]) return _holidayCache[key];
  const out = {};
  const add = (d, name) => { out[dayKey(d)] = name; };
  const e = easterSunday(y);
  const midsommardagen = firstWeekday(y, 5, 20, 6); // lördag 20–26 juni
  add(new Date(y, 0, 1), "Nyårsdagen");
  add(new Date(y, 0, 6), "Trettondedag jul");
  add(addDays(e, -2), "Långfredagen");
  add(e, "Påskdagen");
  add(addDays(e, 1), "Annandag påsk");
  add(new Date(y, 4, 1), "Första maj");
  add(addDays(e, 39), "Kristi himmelsfärds dag");
  add(addDays(e, 49), "Pingstdagen");
  add(new Date(y, 5, 6), "Nationaldagen");
  add(midsommardagen, "Midsommardagen");
  add(firstWeekday(y, 9, 31, 6), "Alla helgons dag");  // lördag 31 okt–6 nov
  add(new Date(y, 11, 25), "Juldagen");
  add(new Date(y, 11, 26), "Annandag jul");
  if (eves) {
    add(addDays(midsommardagen, -1), "Midsommarafton");
    add(new Date(y, 11, 24), "Julafton");
    add(new Date(y, 11, 31), "Nyårsafton");
  }
  return (_holidayCache[key] = out);
}

function bucketOf(view, date) {
  if (view === "day") {
    return {
      key: dayKey(date),
      start: midnight(date),
      label: `${date.getDate()}`,
      sub: DAYS_SHORT[date.getDay()][0].toUpperCase(),
      long: `${cap(DAYS_LONG[date.getDay()])} ${date.getDate()} ${MONTHS_LONG[date.getMonth()]}`,
    };
  }
  if (view === "week") {
    const w = isoWeek(date);
    return { key: `${w.year}-W${pad(w.week)}`, start: addDays(date, -((date.getDay() + 6) % 7)), label: `v.${w.week}`, sub: "", long: `Vecka ${w.week}, ${w.year}` };
  }
  return {
    key: `${date.getFullYear()}-${pad(date.getMonth() + 1)}`,
    start: new Date(date.getFullYear(), date.getMonth(), 1),
    label: MONTHS_SHORT[date.getMonth()],
    sub: "",
    long: `${cap(MONTHS_LONG[date.getMonth()])} ${date.getFullYear()}`,
  };
}

// 452 → "7 h 32 min"
function fmtDur(min) {
  if (min === null || min === undefined || !isFinite(min)) return "–";
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60), r = m % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
}
// 452 → "7:32"
const fmtClock = (min) => { const m = Math.max(0, Math.round(min)); return `${Math.floor(m / 60)}:${pad(m % 60)}`; };
// för staplar i vecka/månad: "38 h"
const fmtHours = (min) => `${Math.round(min / 60)} h`;
const fmtDayLong = (d) => `${cap(DAYS_SHORT[d.getDay()])} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;

class ArbetstidCard extends HTMLElement {
  static getStubConfig() { return { entity: "sensor.arbetstid" }; }

  setConfig(config) {
    if (!config.entity) throw new Error("entity måste anges (t.ex. sensor.arbetstid)");
    this._config = {
      title: "Arbetstid",
      switch: "input_boolean.arbetstid",
      adjust_script: "script.arbetstid_justera",
      mail_script: "script.arbetstid_maila",
      leave_calendar: "calendar.ledighet",
      default_view: "week",
      edit_days: 3,
      avg_weeks: 12,
      norm_week: "39:45",
      work_days: [1, 2, 3, 4, 5],
      holidays: true,
      eves: true,
      free_days: [],
      steps: [15, 30, 60],
      ...config,
    };
    this._config.bars = { day: 14, week: 12, month: 12, ...(config.bars || {}) };
    this._view = this._view || this._config.default_view;
    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (e) => this._onClick(e));
      this.shadowRoot.addEventListener("change", (e) => this._onChange(e));
    }
    this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._fetchLeave();
    const st = hass.states[this._config.entity];
    const sw = hass.states[this._config.switch];
    if (st !== this._st || sw !== this._sw) {
      this._st = st; this._sw = sw; this._busy = false;
      this._render();
    }
  }

  connectedCallback() {
    // pågående pass: räkna upp en gång i minuten; ledigheter var tionde minut
    this._timer = setInterval(() => {
      if (Date.now() - (this._leaveAt || 0) > 600000) this._fetchLeave();
      else if (this._isRunning()) this._render();
    }, 60000);
  }
  disconnectedCallback() { clearInterval(this._timer); }

  getCardSize() { return 9; }

  // ----------------------------------------------------------------- data

  _isRunning() {
    if (this._sw) return this._sw.state === "on";
    return !!(this._st && this._st.attributes.running_since);
  }

  // Minuter per dygn, inklusive den del av ett pågående pass som hunnit gå.
  _data() {
    const a = (this._st && this._st.attributes) || {};
    const days = {};
    for (const [k, v] of Object.entries(a.days || {})) days[k] = Number(v) || 0;
    const since = a.running_since ? new Date(a.running_since) : null;
    if (since && !isNaN(since)) {
      const end = Date.now();
      let t = since.getTime();
      while (t < end) {
        const d = new Date(t);
        const next = Math.min(addDays(midnight(d), 1).getTime(), end);
        const k = dayKey(d);
        days[k] = (days[k] || 0) + (next - t) / 60000;
        t = next;
      }
    }
    for (const k of Object.keys(days)) days[k] = Math.max(0, days[k]);
    return { days, since: since && !isNaN(since) ? since : null };
  }

  // Ledigheter ur kalendern: { "2026-11-13": "half" | "full" } + lista för popupen
  async _fetchLeave() {
    if (!this._hass || !this._config.leave_calendar) return;
    this._leaveAt = Date.now();
    try {
      const keys = Object.keys(((this._st && this._st.attributes) || {}).days || {}).sort();
      const today = midnight(new Date());
      let from = keys.length ? parseDayKey(keys[0]) : addDays(today, -60);
      if (from > addDays(today, -60)) from = addDays(today, -60);
      const to = addDays(today, 400);
      const r = await this._hass.callApi("GET", `calendars/${this._config.leave_calendar}?start=${encodeURIComponent(from.toISOString())}&end=${encodeURIComponent(to.toISOString())}`);
      const map = {};
      const list = [];
      (r || []).forEach((ev) => {
        const half = /halv/i.test(ev.summary || "");
        const st = ev.start.date ? parseDayKey(ev.start.date) : midnight(new Date(ev.start.dateTime));
        let en = ev.end.date ? parseDayKey(ev.end.date) : addDays(midnight(new Date(ev.end.dateTime)), 1);
        if (en <= st) en = addDays(st, 1);
        for (let d = st; d < en; d = addDays(d, 1)) {
          const k = dayKey(d);
          if (map[k] !== "full") map[k] = half ? "half" : "full";
        }
        list.push({ uid: ev.uid, half, from: st, to: addDays(en, -1) });
      });
      this._leaveMap = map;
      this._leaveList = list.sort((a, b) => a.from - b.from);
      this._render();
    } catch (err) {
      console.warn("arbetstid-card: ledighet", err);
    }
  }

  // Veckonormen i minuter. "39:45", 39.75 eller (YAML 1.1-tolkat 39:45) 2385.
  _normWeekMin() {
    const v = this._config.norm_week;
    if (typeof v === "string" && v.includes(":")) { const [h, m] = v.split(":").map(Number); return h * 60 + (m || 0); }
    const n = Number(String(v).replace(",", "."));
    if (!isFinite(n) || n <= 0) return 0;
    return n > 168 ? n : n * 60;
  }

  _perDayNorm() {
    const wd = (this._config.work_days || []).map(Number);
    return wd.length ? this._normWeekMin() / wd.length : 0;
  }

  // { norm: minuter, free: "Långfredagen" | "Ledig" | "Halvdag" | null } för ett datum
  _dayInfo(d) {
    const c = this._config;
    const wd = (c.work_days || []).map(Number);
    const k = dayKey(d);
    let free = null;
    if ((c.free_days || []).map(String).includes(k)) free = "Ledig dag";
    else if (c.holidays !== false) free = swedishHolidays(d.getFullYear(), c.eves !== false)[k] || null;
    const isWork = wd.includes(d.getDay());
    const perDay = this._perDayNorm();
    if (isWork && !free && this._leaveMap && this._leaveMap[k]) {
      return this._leaveMap[k] === "half" ? { norm: perDay / 2, free: "Halvdag" } : { norm: 0, free: "Ledig" };
    }
    return { norm: isWork && !free ? perDay : 0, free: isWork ? free : null };
  }

  // Sista dagen i perioden som bucket b täcker
  _bucketEnd(view, b) {
    if (view === "day") return b.start;
    if (view === "week") return addDays(b.start, 6);
    return new Date(b.start.getFullYear(), b.start.getMonth() + 1, 0);
  }

  // Sammanhängande perioder från första loggade dagen fram till idag.
  _buckets(view, days) {
    const today = midnight(new Date());
    const keys = Object.keys(days).sort();
    let first = keys.length ? parseDayKey(keys[0]) : today;
    const minFirst = addDays(today, -(this._config.bars.day - 1));
    if (view === "day" && minFirst < first) first = minFirst;
    if (first > today) first = today;
    const map = new Map();
    for (let d = first; d <= today; d = addDays(d, 1)) {
      const b = bucketOf(view, d);
      if (!map.has(b.key)) map.set(b.key, { ...b, min: 0, workdays: 0, longest: 0, days: [], minPast: 0, normPast: 0 });
      const x = map.get(b.key);
      const m = days[dayKey(d)] || 0;
      const info = this._dayInfo(d);
      x.min += m;
      if (m >= 1) x.workdays += 1;
      if (m > x.longest) { x.longest = m; x.longestDay = d; }
      if (d < today) { x.minPast += m; x.normPast += info.norm; }
      x.days.push({ date: d, key: dayKey(d), min: m, norm: info.norm, free: info.free });
    }
    const nowKey = bucketOf(view, today).key;
    const list = [...map.values()];
    for (const b of list) {
      b.ongoing = b.key === nowKey;
      b.weekend = view === "day" && (b.start.getDay() === 0 || b.start.getDay() === 6);
      // normen för hela perioden, även dagar som inte kommit än
      b.norm = 0;
      b.free = [];
      for (let d = b.start, end = this._bucketEnd(view, b); d <= end; d = addDays(d, 1)) {
        const info = this._dayInfo(d);
        b.norm += info.norm;
        if (info.free) b.free.push({ date: d, name: info.free });
      }
      // dagvy: helg och lediga vardagar tonas ner
      if (view === "day") b.weekend = b.norm === 0;
    }
    return list;
  }

  // ----------------------------------------------------------------- actions

  _onClick(e) {
    const el = e.target.closest("[data-act],[data-view],[data-key],[data-edit],[data-adj],[data-lt],[data-ldel]");
    if (!el) return;
    const d = el.dataset;
    if (d.act === "leave-open") { this._openLeave(); return; }
    if (d.act === "leave-close") { this._lv = null; this._render(); return; }
    if (d.act === "leave-save") { this._saveLeave(); return; }
    if (d.act === "leave-bg") { if (e.target === el) { this._lv = null; this._render(); } return; }
    if (d.lt) { this._lv.type = d.lt; this._lv.msg = null; this._render(); return; }
    if (d.ldel) { this._deleteLeave(d.ldel); return; }
    if (d.view) { this._view = d.view; this._selected = null; this._mailMsg = null; this._render(); return; }
    if (d.key) {
      this._selected = d.key;
      this._mailMsg = null;
      // dagvy: en tryckt dag inom justeringsfönstret blir även justeringsdag
      if (this._view === "day" && this._editKeys().includes(d.key)) this._editDay = d.key;
      this._render();
      return;
    }
    if (d.edit) { this._editDay = d.edit; this._render(); return; }
    if (d.act === "mail") { if (!this._mailing) this._mail(); return; }
    if (el.disabled || this._busy) return;
    if (d.act === "toggle") { this._call(this._config.switch.split(".")[0], "toggle", { entity_id: this._config.switch }); return; }
    if (d.adj) {
      const [dom, svc] = this._config.adjust_script.split(".");
      this._call(dom, svc, { dag: this._currentEditDay(), minuter: Number(d.adj) });
      return;
    }
  }

  _onChange(e) {
    const s = e.target.dataset && e.target.dataset.lsel;
    if (!s || !this._lv) return;
    const [p, f] = s.split(".");
    this._lv[p][f] = Number(e.target.value);
    const max = new Date(this._lv[p].y, this._lv[p].m + 1, 0).getDate();
    if (this._lv[p].d > max) this._lv[p].d = max;
    this._lv.msg = null;
    this._render();
  }

  _call(domain, service, data) {
    if (!this._hass) return;
    this._busy = true;
    this._render();
    clearTimeout(this._busyTimer);
    this._busyTimer = setTimeout(() => { this._busy = false; this._render(); }, 3000);
    this._hass.callService(domain, service, data).catch((err) => {
      this._busy = false;
      this._flash = `Kunde inte utföra: ${err && err.message ? err.message : err}`;
      this._render();
    });
  }

  _editKeys() {
    const today = midnight(new Date());
    const n = Math.max(0, Number(this._config.edit_days) || 0);
    return Array.from({ length: n + 1 }, (_, i) => dayKey(addDays(today, -i)));
  }

  _currentEditDay() {
    const keys = this._editKeys();
    return keys.includes(this._editDay) ? this._editDay : keys[0];
  }

  // ----------------------------------------------------------------- ledighet

  _openLeave() {
    const t = new Date();
    const d = { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
    this._lv = { type: "day", f: { ...d }, t: { ...d }, msg: null };
    this._render();
    this._fetchLeave();
  }

  _lvDate(p) { const x = this._lv[p]; return new Date(x.y, x.m, x.d); }

  async _saveLeave() {
    if (!this._lv || this._lvSaving) return;
    const f = this._lvDate("f");
    const t = this._lv.type === "per" ? this._lvDate("t") : f;
    if (t < f) { this._lv.msg = "Till-datumet ligger före från-datumet"; this._render(); return; }
    this._lvSaving = true;
    try {
      await this._hass.callService("calendar", "create_event", {
        summary: this._lv.type === "half" ? "Halvdag" : "Ledig",
        start_date: dayKey(f), end_date: dayKey(addDays(t, 1)),
      }, { entity_id: this._config.leave_calendar });
      this._lv = null;
      setTimeout(() => this._fetchLeave(), 600);
    } catch (err) {
      this._lv.msg = `Kunde inte spara: ${err && err.message ? err.message : err}`;
    }
    this._lvSaving = false;
    this._render();
  }

  async _deleteLeave(uid) {
    try {
      await this._hass.callWS({ type: "calendar/event/delete", entity_id: this._config.leave_calendar, uid });
      setTimeout(() => this._fetchLeave(), 400);
    } catch (err) {
      if (this._lv) { this._lv.msg = `Kunde inte ta bort: ${err && err.message ? err.message : err}`; this._render(); }
    }
  }

  _leavePopup() {
    const lv = this._lv;
    if (!lv) return "";
    const yNow = new Date().getFullYear();
    const sel = (p) => {
      const x = lv[p];
      const n = new Date(x.y, x.m + 1, 0).getDate();
      const ys = [yNow - 1, yNow, yNow + 1].map((y) => `<option value="${y}" ${y === x.y ? "selected" : ""}>${y}</option>`).join("");
      const ms = MONTHS_LONG.map((m, i) => `<option value="${i}" ${i === x.m ? "selected" : ""}>${m}</option>`).join("");
      const ds = Array.from({ length: n }, (_, i) => `<option value="${i + 1}" ${i + 1 === x.d ? "selected" : ""}>${i + 1}</option>`).join("");
      return `<div class="lvrow"><span>${p === "f" ? "Från" : "Till"}</span><select data-lsel="${p}.y">${ys}</select><select class="m" data-lsel="${p}.m">${ms}</select><select data-lsel="${p}.d">${ds}</select></div>`;
    };
    const f = this._lvDate("f");
    let sum, err = !!lv.msg;
    if (lv.msg) sum = lv.msg;
    else if (lv.type === "per") {
      const t = this._lvDate("t");
      if (t < f) { sum = "Till-datumet ligger före från-datumet"; err = true; }
      else {
        let n = 0, red = 0;
        for (let d = f; d <= t; d = addDays(d, 1)) { const i = this._dayInfo(d); if (i.norm > 0) n++; else if (i.free) red++; }
        sum = `${fmtDayLong(f)} – ${fmtDayLong(t)} · ${n} ${n === 1 ? "arbetsdag" : "arbetsdagar"}${red ? `, ${red} redan lediga` : ""}`;
      }
    } else {
      const i = this._dayInfo(f);
      const per = this._perDayNorm();
      sum = i.norm > 0 ? `${fmtDayLong(f)} · normen minskar med ${fmtDur(lv.type === "half" ? per / 2 : per)}`
        : `${fmtDayLong(f)} · ${i.free ? this._esc(i.free) : "ingen arbetsdag"}, ingen norm att minska`;
    }
    const today = midnight(new Date());
    const up = (this._leaveList || []).filter((l) => l.to >= today);
    const list = up.map((l) => {
      const when = l.to > l.from ? `${fmtDayLong(l.from)} – ${fmtDayLong(l.to)}` : fmtDayLong(l.from);
      return `<div class="lvli"><span>${when} · ${l.half ? "½ dag" : "ledig"}</span>${l.uid ? `<button data-ldel="${this._esc(l.uid)}" aria-label="Ta bort">✕</button>` : ""}</div>`;
    }).join("");
    const seg = [["half", "½ dag"], ["day", "1 dag"], ["per", "Period"]]
      .map(([v, l]) => `<button class="${lv.type === v ? "on" : ""}" data-lt="${v}">${l}</button>`).join("");
    return `
      <div class="lvbg" data-act="leave-bg">
        <div class="lvpop">
          <div class="lvhead">Lägg in ledighet<button data-act="leave-close" aria-label="Stäng">✕</button></div>
          <div class="lvseg">${seg}</div>
          ${sel("f")}
          ${lv.type === "per" ? sel("t") : ""}
          <div class="lvsum ${err ? "err" : ""}">${sum}</div>
          ${up.length ? `<div class="lbl">Kommande</div><div>${list}</div>` : ""}
          <div class="lvbtns"><button data-act="leave-close">Avbryt</button><button class="ok" data-act="leave-save" ${this._lvSaving ? "disabled" : ""}>Lägg in</button></div>
        </div>
      </div>`;
  }

  // ----------------------------------------------------------------- rendering

  _render() {
    if (!this.shadowRoot || !this._config) return;
    const c = this._config;
    let body;
    if (!this._hass) {
      body = `<div class="msg">Laddar…</div>`;
    } else if (!this._st) {
      body = `<div class="msg err">Hittar inte ${this._esc(c.entity)}. Är paketet arbetstid.yaml laddat?</div>`;
    } else {
      const data = this._data();
      const all = this._buckets(this._view, data.days);
      const shown = all.slice(-c.bars[this._view]);
      const sel = shown.find((b) => b.key === this._selected) || shown[shown.length - 1];
      this._sel = sel;
      this._lastData = data;
      const tabs = [["day", "Dag"], ["week", "Vecka"], ["month", "Månad"]]
        .map(([v, l]) => `<button class="tab ${v === this._view ? "on" : ""}" data-view="${v}">${l}</button>`).join("");
      body = this._controls(data)
        + `<div class="head under"><div class="tabs">${tabs}</div></div>`
        + this._hero(sel, all, data) + this._chart(shown, sel) + this._mailRow(sel);
    }
    this.shadowRoot.innerHTML = `
      <style>${this._css()}</style>
      <ha-card>
        <div class="wrap">
          <div class="head"><div class="title">${this._esc(c.title)}</div></div>
          ${body}
        </div>
      </ha-card>
      ${this._hass ? this._leavePopup() : ""}`;
  }

  _controls(data) {
    const on = this._isRunning();
    const todayKey = dayKey(new Date());
    const todayMin = data.days[todayKey] || 0;
    let status;
    if (on) {
      const t = this._sw && this._sw.state === "on" ? new Date(this._sw.last_changed) : data.since;
      const same = t && dayKey(t) === todayKey;
      const when = t ? `${same ? "" : fmtDayLong(t) + " "}${pad(t.getHours())}:${pad(t.getMinutes())}` : "";
      status = `<span class="dot run"></span>Pågår${when ? ` sedan ${when}` : ""}`;
    } else {
      status = `<span class="dot"></span>Inte igång`;
    }
    const editKey = this._currentEditDay();
    const chips = this._editKeys().map((k, i) => {
      const d = parseDayKey(k);
      const lbl = i === 0 ? "Idag" : i === 1 ? "Igår" : `${cap(DAYS_SHORT[d.getDay()])} ${d.getDate()}`;
      return `<button class="chip ${k === editKey ? "on" : ""}" data-edit="${k}">${lbl}<span>${fmtClock(data.days[k] || 0)}</span></button>`;
    }).reverse().join(""); // äldst till vänster, idag längst till höger – som grafen
    const editMin = data.days[editKey] || 0;
    const dis = this._busy ? "disabled" : "";
    const plus = this._config.steps.map((s) => `<button class="adj plus" data-adj="${s}" ${dis}>+${s}<small>min</small></button>`).join("");
    const minus = this._config.steps.map((s) => `<button class="adj minus" data-adj="${-s}" ${dis || (editMin < 1 ? "disabled" : "")}>−${s}<small>min</small></button>`).join("");
    const flash = this._flash ? `<div class="msg err small">${this._esc(this._flash)}</div>` : "";
    this._flash = null;
    const lvBtn = this._config.leave_calendar ? `<button class="lvbtn" data-act="leave-open">Ledig</button>` : "";
    return `
      <div class="ctl">
        <div class="status"><div>${status}</div><div class="today">Idag <b>${fmtDur(todayMin)}</b>${lvBtn}</div></div>
        <button class="go ${on ? "stop" : "start"}" data-act="toggle" ${dis}>${on ? "Stoppa arbetstid" : "Starta arbetstid"}</button>
        <div class="edit">
          <div class="chips">${chips}</div>
          <div class="adjgrid">${plus}${minus}</div>
        </div>
        ${flash}
      </div>`;
  }

  _hero(b, all, data) {
    const v = this._view;
    const tag = b.ongoing ? `<span class="pill">pågår</span>` : "";
    let sub = "";
    let stats = "";
    const avg = b.workdays ? b.min / b.workdays : null;
    if (v === "day") {
      const wk = this._buckets("week", data.days).find((w) => w.key === bucketOf("week", b.start).key);
      sub = wk ? `${wk.ongoing ? "Veckan hittills" : `Vecka ${isoWeek(b.start).week}`}: ${fmtDur(wk.min)}${wk.norm ? ` av ${fmtDur(wk.norm)}` : ""}` : "";
      const lastWeek = all[all.indexOf(b) - 7];
      stats = this._stat("Samma dag förra veckan", lastWeek ? fmtDur(lastWeek.min) : "–")
        + this._stat("Snitt per arbetsdag (veckan)", wk && wk.workdays ? fmtDur(wk.min / wk.workdays) : "–");
    } else {
      stats = this._stat("Snitt per arbetsdag", `${fmtDur(avg)}<div class="delta">${b.workdays} ${b.workdays === 1 ? "arbetsdag" : "arbetsdagar"}</div>`)
        + this._weekStat(b, data);
    }
    const cmp = this._compare(b, all);
    // lediga vardagar i perioden: namnen i vecko-/dagvy, antal i månadsvy
    let freeTag = "";
    if (b.free && b.free.length) {
      freeTag = v === "month"
        ? `<span class="pill dim">${b.free.length} ${b.free.length === 1 ? "ledig vardag" : "lediga vardagar"}</span>`
        : b.free.map((f) => `<span class="pill dim">${v === "day" ? "" : DAYS_SHORT[f.date.getDay()] + " "}${this._esc(f.name)}</span>`).join("");
    }
    return `
      <div class="hero">
        <div class="period">${b.long} ${tag}${freeTag}</div>
        <div class="big">${fmtDur(b.min)}</div>
        ${this._normLine(b)}
        ${sub ? `<div class="sub">${sub}</div>` : ""}
        ${cmp}
      </div>
      <div class="stats">${stats}</div>`;
  }

  // Genomsnittlig arbetsvecka. Räknar bara hela veckor (inte den pågående)
  // och hoppar över veckor helt utan arbete, t.ex. semester.
  //   Veckovy: de senaste `avg_weeks` veckorna fram till och med den valda.
  //   Månadsvy: veckorna som börjar (måndag) i den valda månaden.
  _weekStat(b, data) {
    const weeks = this._buckets("week", data.days).filter((w) => !w.ongoing && w.workdays > 0);
    let pick, scope;
    if (this._view === "week") {
      const n = Math.max(1, Number(this._config.avg_weeks) || 12);
      pick = weeks.filter((w) => w.start <= b.start).slice(-n);
      scope = `senaste ${pick.length} ${pick.length === 1 ? "veckan" : "veckorna"}`;
    } else {
      pick = weeks.filter((w) => w.start.getFullYear() === b.start.getFullYear() && w.start.getMonth() === b.start.getMonth());
      scope = `${pick.length} ${pick.length === 1 ? "hel vecka" : "hela veckor"} i ${MONTHS_SHORT[b.start.getMonth()]}`;
    }
    if (!pick.length) return this._stat("Arbetsvecka, snitt", "–");
    const avg = pick.reduce((s, w) => s + w.min, 0) / pick.length;
    // normen räknas för samma veckor, så helgdagsveckor jämförs rättvist
    const avgNorm = pick.reduce((s, w) => s + w.norm, 0) / pick.length;
    let vs = "";
    if (avgNorm > 0) {
      const d = avg - avgNorm;
      vs = Math.abs(d) < 1 ? "på normen" : d > 0 ? `<span class="over">▲ ${fmtDur(d)} över normen</span>` : `▼ ${fmtDur(-d)} under normen`;
      vs = `<div class="delta">${vs}</div>`;
    }
    return this._stat("Arbetsvecka, snitt", `${fmtDur(avg)}${vs}<div class="delta">${scope}</div>`);
  }

  // Normraden under den stora siffran.
  //   Avslutad period:  ▲ 1 h 30 min över normen (39 h 45 min)
  //   Pågående period:  stapel + "av 31 h 48 min" + läget t.o.m. igår
  _normLine(b) {
    const v = this._view;
    if (!b.norm) {
      if (v !== "day") return "";
      const d = b.days[0];
      const why = d && d.free ? `${d.free} – ingen norm` : "Ingen arbetsdag enligt normen";
      return `<div class="norm"><span class="nt">${this._esc(why)}</span></div>`;
    }
    const diffTxt = (diff, ref) => {
      if (Math.abs(diff) < 1) return `<span class="nt">▬ precis på normen (${fmtDur(ref)})</span>`;
      return diff > 0
        ? `<span class="nt over">▲ ${fmtDur(diff)} över normen</span><span class="nt"> (${fmtDur(ref)})</span>`
        : `<span class="nt">▼ ${fmtDur(-diff)} under normen (${fmtDur(ref)})</span>`;
    };
    if (!b.ongoing) return `<div class="norm">${diffTxt(b.min - b.norm, b.norm)}</div>`;
    const frac = Math.min(1, b.min / b.norm);
    const over = b.min > b.norm;
    let txt;
    if (v === "day") {
      txt = over ? `<span class="nt over">▲ ${fmtDur(b.min - b.norm)} över normen (${fmtDur(b.norm)})</span>`
        : `<span class="nt">${fmtDur(b.norm - b.min)} kvar till normen (${fmtDur(b.norm)})</span>`;
    } else {
      txt = `<span class="nt">av ${fmtDur(b.norm)}</span>`;
      if (b.normPast > 0) {
        const d = b.minPast - b.normPast;
        txt += Math.abs(d) < 1 ? `<span class="nt"> · på normen t.o.m. igår</span>`
          : d > 0 ? `<span class="nt"> · </span><span class="nt over">▲ ${fmtDur(d)} t.o.m. igår</span>`
          : `<span class="nt"> · ▼ ${fmtDur(-d)} t.o.m. igår</span>`;
      }
    }
    return `<div class="norm"><div class="prog"><i class="${over ? "over" : ""}" style="width:${(frac * 100).toFixed(1)}%"></i></div>${txt}</div>`;
  }

  _stat(lbl, val) { return `<div><div class="lbl">${lbl}</div><div class="sv">${val}</div></div>`; }

  // Mot föregående period. Pågående vecka/månad jämförs med samma antal dagar.
  _compare(b, all) {
    if (this._view === "day") return "";
    const i = all.indexOf(b);
    const prev = i > 0 ? all[i - 1] : null;
    if (!prev || prev.min < 1) return "";
    const n = b.ongoing ? b.days.length : prev.days.length;
    const prevMin = prev.days.slice(0, n).reduce((s, d) => s + d.min, 0);
    const diff = b.min - prevMin;
    const arrow = Math.abs(diff) < 1 ? "▬" : diff > 0 ? "▲" : "▼";
    const what = this._view === "week" ? "förra veckan" : "förra månaden";
    const scope = b.ongoing ? `samma dagar ${what}` : what;
    return `<div class="delta">${arrow} ${fmtDur(Math.abs(diff))} mot ${scope} (${fmtDur(prevMin)})</div>`;
  }

  _chart(list, sel) {
    // padR lämnar plats åt timetiketterna längst till höger
    const W = 1000, H = 200, padT = 22, padB = 4, padL = 6, padR = 62;
    const vals = list.flatMap((b) => [b.min, b.norm || 0]);
    const step = this._view === "day" ? 120 : this._view === "week" ? 600 : 2400; // 2 h / 10 h / 40 h
    const top = Math.max(step, ...vals) * 1.12;
    const y = (v) => padT + (H - padT - padB) * (1 - v / top);
    const slots = Math.max(list.length, this._config.bars[this._view]);
    const offset = slots - list.length;
    const slot = (W - padL - padR) / slots;
    const bw = Math.min(58, slot * 0.6);
    const cxOf = (i) => padL + slot * (i + offset + 0.5);
    const pct = (x, tot) => `${(x / tot) * 100}%`;
    let g = "", labels = "", vlabels = "", grid = "";
    for (let v = step; v < top; v += step) {
      g += `<line x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`;
      grid += `<span class="gl" style="top:${pct(y(v), H)}">${Math.round(v / 60)} h</span>`;
    }
    g += `<line x1="${padL}" x2="${W - padR}" y1="${y(0)}" y2="${y(0)}" class="axis"/>`;
    list.forEach((b, i) => {
      const cx = cxOf(i);
      const isSel = b.key === sel.key;
      g += `<g data-key="${b.key}" class="slot">`;
      g += `<rect x="${cx - slot / 2}" y="0" width="${slot}" height="${H}" class="hit ${isSel ? "sel" : ""}"/>`;
      if (b.min >= 1) {
        const t = y(b.min), bot = y(0);
        g += `<rect x="${cx - bw / 2}" y="${t}" width="${bw}" height="${Math.max(2, bot - t)}" rx="4" class="bar ${b.ongoing ? "ongoing" : ""} ${b.weekend ? "we" : ""} ${isSel ? "on" : ""}"/>`;
        const txt = this._view === "day" ? fmtClock(b.min) : fmtHours(b.min);
        // etiketten över stapeln, eller över normstrecket om det ligger högre
        const lt = Math.min(t, b.norm ? y(b.norm) : t);
        vlabels += `<span data-key="${b.key}" class="vl ${isSel ? "on" : ""}" style="left:${pct(cx, W)};top:${pct(lt, H)}">${txt}</span>`;
      } else {
        g += `<path d="M${cx} ${y(0) - 3}h0" class="zero"/>`;
      }
      if (b.norm) {
        const ny = y(b.norm);
        g += `<line x1="${cx - bw / 2 - 5}" x2="${cx + bw / 2 + 5}" y1="${ny}" y2="${ny}" class="nline"/>`;
      }
      g += `</g>`;
      const yearTag = (this._view === "month" && b.start.getMonth() === 0) || (this._view === "week" && i > 0 && list[i - 1].start.getFullYear() !== b.start.getFullYear())
        ? ` ’${String(b.start.getFullYear()).slice(2)}` : "";
      labels += `<span data-key="${b.key}" class="xl ${isSel ? "on" : ""} ${b.weekend ? "we" : ""}" style="left:${pct(cx, W)}">${b.label}${yearTag}${b.sub ? `<small>${b.sub}</small>` : ""}</span>`;
    });
    return `
      <div class="chart">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}</svg>
        ${grid}${vlabels}
      </div>
      <div class="xlabels ${this._view === "day" ? "two" : ""}">${labels}</div>
      <div class="legend"><span><i class="sw bar"></i>Arbetad tid</span><span><i class="sw nl"></i>Norm (helgdagar och ledighet avräknade)</span></div>`;
  }

  // ----------------------------------------------------------------- mail

  _reportPeriod(sel) {
    if (this._view !== "day") return { b: sel, view: this._view };
    const wk = this._buckets("week", this._lastData.days).find((w) => w.key === bucketOf("week", sel.start).key);
    return { b: wk, view: "week" };
  }

  _mailRow(sel) {
    const { b } = this._reportPeriod(sel);
    if (!b) return "";
    const msg = this._mailMsg ? `<span class="mailmsg ${this._mailMsg.ok ? "ok" : "err"}">${this._esc(this._mailMsg.text)}</span>` : "";
    return `<div class="mailrow">${msg}<button class="mail" data-act="mail" ${this._mailing ? "disabled" : ""}>✉ Maila ${b.long.replace(/, \d{4}$/, "").toLowerCase()}</button></div>`;
  }

  _mail() {
    const { b, view } = this._reportPeriod(this._sel);
    if (!b || !this._hass) return;
    const [dom, svc] = this._config.mail_script.split(".");
    const subject = `Arbetstid – ${b.long}${b.ongoing ? " (pågår)" : ""}`;
    this._mailing = true;
    this._render();
    this._hass.callService(dom, svc, { amne: subject, html: this._reportHtml(b, view) })
      .then(() => { this._mailMsg = { ok: true, text: "Skickat" }; })
      .catch((err) => { this._mailMsg = { ok: false, text: `Misslyckades: ${err && err.message ? err.message : err}` }; })
      .finally(() => { this._mailing = false; this._render(); });
  }

  // Tabell för mail: vita och ljusblå radband, inga rutnät.
  _reportHtml(b, view) {
    const accent = "#3b82c4", over = "#d9622b";
    const max = Math.max(60, ...b.days.map((d) => Math.max(d.min, d.norm)));
    const avg = b.workdays ? b.min / b.workdays : null;
    const td = "padding:7px 12px;font-size:14px;";
    const num = `${td}text-align:right;white-space:nowrap;`;
    // "+1:30" / "−0:20", färgad när den går över normen
    const signed = (d) => Math.abs(d) < 1 ? `<span style="color:#888">±0</span>`
      : d > 0 ? `<span style="color:${over}">+${fmtClock(d)}</span>` : `<span style="color:#555">−${fmtClock(-d)}</span>`;
    let rows = "";
    let band = 0;
    let wk = { min: 0, norm: 0 };
    const row = (cells, bold) => {
      const bg = band++ % 2 ? "#ffffff" : "#eef4fb";
      rows += `<tr style="background:${bg};${bold ? "font-weight:bold;" : ""}">${cells}</tr>`;
    };
    const today = dayKey(new Date());
    rows += `<tr style="color:#888;font-size:12px"><td style="${td}font-size:12px">Dag</td><td style="${num}font-size:12px">Tid</td><td style="${num}font-size:12px">Mot norm</td><td style="${td}"></td></tr>`;
    b.days.forEach((d, i) => {
      const w = Math.round((d.min / max) * 150);
      const off = d.norm === 0;
      // dagens avvikelse visas inte förrän dagen är slut
      const dev = d.key === today ? `<span style="color:#888">pågår</span>` : d.norm || d.min >= 1 ? signed(d.min - d.norm) : "";
      row(`<td style="${td}color:${off ? "#888" : "#222"}">${fmtDayLong(d.date)}${d.free ? ` <span style="font-size:12px">· ${this._esc(d.free)}</span>` : ""}</td>`
        + `<td style="${num}">${d.min >= 1 ? fmtDur(d.min) : "–"}</td>`
        + `<td style="${num}">${dev}</td>`
        + `<td style="${td}width:160px">${d.min >= 1 ? `<div style="background:${d.key !== today && d.min > d.norm + 0.5 ? over : accent};height:10px;width:${Math.max(3, w)}px;border-radius:3px"></div>` : ""}</td>`);
      if (d.key !== today) { wk.min += d.min; wk.norm += d.norm; }
      const endOfWeek = d.date.getDay() === 0 || i === b.days.length - 1;
      if (view === "month" && endOfWeek) {
        row(`<td style="${td}">Vecka ${isoWeek(d.date).week}</td><td style="${num}">${fmtDur(wk.min)}</td><td style="${num}">${wk.norm ? signed(wk.min - wk.norm) : ""}</td><td style="${td}font-weight:normal;color:#888;font-size:12px">norm ${fmtDur(wk.norm)}</td>`, true);
        wk = { min: 0, norm: 0 };
      }
    });
    // sammanfattning mot normen; pågående period jämförs t.o.m. igår
    const devTotal = b.ongoing ? b.minPast - b.normPast : b.min - b.norm;
    const devRef = b.ongoing ? "t.o.m. igår" : `normen ${fmtDur(b.norm)}`;
    const normTxt = b.norm ? ` · ${signed(devTotal)} mot ${devRef}` : "";
    const freeTxt = b.free && b.free.length
      ? `<p style="margin:0 0 12px;color:#777;font-size:12px">Lediga vardagar i perioden (avräknade från normen): ${b.free.map((f) => `${fmtDayLong(f.date)} ${this._esc(f.name)}`).join(", ")}</p>` : "";
    const generated = new Date();
    return `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:560px">
<h2 style="margin:0 0 4px;font-size:20px">Arbetstid – ${b.long}</h2>
<p style="margin:0 0 6px;color:#555;font-size:14px"><b style="color:#222;font-size:16px">${fmtDur(b.min)}</b>${normTxt} · ${b.workdays} arbetsdagar${avg !== null ? ` · snitt ${fmtDur(avg)}/dag` : ""}${b.ongoing ? " · perioden pågår" : ""}</p>
${freeTxt}
<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%">${rows}</table>
<p style="margin:12px 0 0;color:#999;font-size:12px">Norm ${fmtDur(this._normWeekMin())} per vecka, halvdagar räknas som halv dagnorm. Skapad ${fmtDayLong(generated)} ${pad(generated.getHours())}:${pad(generated.getMinutes())} av ${this._esc(this._config.generated_by || "Home Assistant")}</p>
</div>`;
  }

  // ----------------------------------------------------------------- misc

  _esc(s) { return String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch])); }

  _css() {
    return `
      :host {
        --atc-text: var(--primary-text-color, #e8ecf1);
        --atc-muted: var(--secondary-text-color, rgba(232,236,241,0.6));
        --atc-line: var(--divider-color, rgba(127,127,127,0.18));
        --atc-soft: rgba(127,127,127,0.10);
        --atc-soft2: rgba(127,127,127,0.18);
        --atc-bar: #5aa9ff;
        --atc-run: #3ecf8e;
        --atc-stop: #ff8a4c;
      }
      ha-card { height: 100%; box-sizing: border-box; border-radius: 14px; overflow: hidden; color: var(--atc-text); }
      .wrap { height: 100%; box-sizing: border-box; padding: 14px 14px 10px; display: flex; flex-direction: column; gap: 10px; font-variant-numeric: tabular-nums; }
      button { font: inherit; color: inherit; }
      .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .head.under { margin-top: 4px; }
      .title { font-size: 15px; font-weight: 600; letter-spacing: 0.02em; color: var(--atc-muted); text-transform: uppercase; }
      .tabs { display: flex; background: var(--atc-soft); border-radius: 10px; padding: 3px; }
      .tab { all: unset; cursor: pointer; padding: 6px 14px; border-radius: 8px; font-size: 14px; color: var(--atc-muted); }
      .tab.on { background: var(--atc-soft2); color: var(--atc-text); font-weight: 600; }

      .ctl { display: flex; flex-direction: column; gap: 10px; }
      .status { display: flex; justify-content: space-between; align-items: center; font-size: 15px; color: var(--atc-muted); gap: 8px; flex-wrap: wrap; }
      .status b { color: var(--atc-text); }
      .today { display: flex; align-items: center; gap: 6px; }
      .lvbtn { all: unset; cursor: pointer; margin-left: 6px; border: 1px solid var(--atc-line); border-radius: 999px; padding: 3px 12px; font-size: 13px; color: var(--atc-text); }
      .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: var(--atc-muted); opacity: .5; margin-right: 8px; vertical-align: 1px; }
      .dot.run { background: var(--atc-run); opacity: 1; box-shadow: 0 0 0 4px rgba(62,207,142,0.2); }
      .go { all: unset; box-sizing: border-box; cursor: pointer; text-align: center; width: 100%; padding: 16px; border-radius: 14px; font-size: 19px; font-weight: 700; color: #0d1117; }
      .go.start { background: var(--atc-run); }
      .go.stop { background: var(--atc-stop); }
      .go:disabled { opacity: .5; cursor: default; }
      .edit { display: flex; flex-direction: column; gap: 8px; background: var(--atc-soft); border-radius: 12px; padding: 10px; }
      .chips { display: grid; grid-template-columns: repeat(auto-fit, minmax(60px, 1fr)); gap: 6px; }
      .chip { all: unset; cursor: pointer; text-align: center; padding: 6px 4px; border-radius: 9px; font-size: 13px; color: var(--atc-muted); line-height: 1.25; }
      .chip span { display: block; font-size: 12px; opacity: .8; }
      .chip.on { background: var(--atc-soft2); color: var(--atc-text); font-weight: 600; }
      .adjgrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
      .adj { all: unset; cursor: pointer; text-align: center; padding: 11px 4px; border-radius: 10px; font-size: 17px; font-weight: 600; background: var(--atc-soft); }
      .adj small { font-size: 12px; font-weight: 500; color: var(--atc-muted); margin-left: 3px; }
      .adj.plus { color: var(--atc-run); }
      .adj.minus { color: var(--atc-stop); }
      .adj:disabled { opacity: .35; cursor: default; }

      .hero { display: flex; flex-direction: column; }
      .period { font-size: 15px; color: var(--atc-muted); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .pill { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 8px; border-radius: 999px; background: var(--atc-soft2); color: var(--atc-text); }
      .big { font-size: 40px; font-weight: 700; line-height: 1.05; margin-top: 4px; }
      .sub { font-size: 15px; color: var(--atc-muted); margin-top: 2px; }
      .delta { font-size: 12px; color: var(--atc-muted); margin-top: 3px; font-weight: 400; }
      .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; border-top: 1px solid var(--atc-line); padding-top: 10px; }
      .lbl { font-size: 12px; color: var(--atc-muted); }
      .sv { font-size: 18px; font-weight: 600; }

      .chart { flex: 1 1 auto; min-height: 110px; position: relative; margin-top: 4px; }
      .chart svg { position: absolute; inset: 0; width: 100%; height: 100%; }
      .hit { fill: transparent; cursor: pointer; }
      .hit.sel { fill: var(--atc-soft); }
      .bar { fill: var(--atc-bar); opacity: .8; }
      .bar.on { opacity: 1; }
      .bar.we { opacity: .5; }
      .bar.ongoing { opacity: .55; }
      .zero { stroke: var(--atc-muted); stroke-width: 5; stroke-linecap: round; opacity: .35; vector-effect: non-scaling-stroke; }
      .axis { stroke: var(--atc-line); stroke-width: 1; vector-effect: non-scaling-stroke; }
      .grid { stroke: var(--atc-line); stroke-width: 1; stroke-dasharray: 3 5; vector-effect: non-scaling-stroke; }
      .gl { position: absolute; right: 2px; transform: translateY(-115%); font-size: 10px; color: var(--atc-muted); pointer-events: none; }
      .vl { position: absolute; transform: translate(-50%, -120%); font-size: 11px; color: var(--atc-muted); white-space: nowrap; cursor: pointer; }
      .vl.on { color: var(--atc-text); font-weight: 600; }
      .slot { cursor: pointer; }
      .nline { stroke: var(--atc-text); stroke-width: 3; stroke-linecap: round; opacity: .85; vector-effect: non-scaling-stroke; }
      .legend { display: flex; gap: 16px; font-size: 12px; color: var(--atc-muted); flex-wrap: wrap; }
      .sw { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
      .sw.bar { background: var(--atc-bar); }
      .sw.nl { background: var(--atc-text); height: 3px; width: 14px; vertical-align: 3px; opacity: .85; }
      .norm { display: flex; flex-wrap: wrap; align-items: center; gap: 0 2px; font-size: 14px; color: var(--atc-muted); margin-top: 4px; }
      .norm .prog { flex: 1 0 100%; height: 6px; border-radius: 3px; background: var(--atc-soft2); overflow: hidden; margin-bottom: 5px; }
      .norm .prog i { display: block; height: 100%; background: var(--atc-bar); border-radius: 3px; }
      .norm .prog i.over { background: var(--atc-stop); }
      .over { color: var(--atc-stop); }
      .pill.dim { background: transparent; border: 1px solid var(--atc-line); color: var(--atc-muted); text-transform: none; letter-spacing: 0; }
      .xlabels { position: relative; height: 18px; }
      .xlabels.two { height: 32px; }
      .xl { position: absolute; top: 0; transform: translateX(-50%); font-size: 12px; color: var(--atc-muted); white-space: nowrap; cursor: pointer; text-align: center; line-height: 1.2; }
      .xl small { display: block; font-size: 10px; opacity: .8; }
      .xl.we { opacity: .6; }
      .xl.on { color: var(--atc-text); font-weight: 600; opacity: 1; }

      .mailrow { display: flex; justify-content: flex-end; align-items: center; gap: 10px; border-top: 1px solid var(--atc-line); padding-top: 10px; }
      .mail { all: unset; cursor: pointer; padding: 8px 14px; border-radius: 10px; background: var(--atc-soft); font-size: 14px; }
      .mail:disabled { opacity: .5; cursor: default; }
      .mailmsg { font-size: 13px; }
      .mailmsg.ok { color: var(--atc-run); }
      .mailmsg.err, .msg.err { color: var(--atc-stop); }
      .msg { padding: 24px 4px; color: var(--atc-muted); font-size: 15px; }
      .msg.small { padding: 0; font-size: 13px; }

      .lvbg { position: fixed; inset: 0; z-index: 10; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; }
      .lvpop { width: min(420px, 100%); max-height: 100%; overflow: auto; box-sizing: border-box; background: var(--card-background-color, var(--ha-card-background, #1c1f24)); color: var(--atc-text); border: 1px solid var(--atc-line); border-radius: 16px; padding: 16px; display: flex; flex-direction: column; gap: 12px; font-size: 14px; }
      .lvhead { display: flex; justify-content: space-between; align-items: center; font-size: 17px; font-weight: 600; }
      .lvhead button, .lvli button { all: unset; cursor: pointer; color: var(--atc-muted); font-size: 18px; padding: 0 6px; }
      .lvseg { display: flex; background: var(--atc-soft); border-radius: 10px; padding: 3px; }
      .lvseg button { all: unset; cursor: pointer; flex: 1; text-align: center; padding: 8px 0; border-radius: 8px; color: var(--atc-muted); }
      .lvseg button.on { background: var(--atc-soft2); color: var(--atc-text); font-weight: 600; }
      .lvrow { display: flex; align-items: center; gap: 6px; }
      .lvrow span { width: 38px; color: var(--atc-muted); }
      .lvrow select { flex: 1; min-width: 0; font: inherit; font-size: 15px; padding: 8px 6px; border-radius: 8px; border: 1px solid var(--atc-line); background: var(--atc-soft); color: var(--atc-text); }
      .lvrow select.m { flex: 1.7; }
      .lvrow select option { color: #000; }
      .lvsum { font-size: 13px; color: var(--atc-run); }
      .lvsum.err { color: var(--atc-stop); }
      .lvli { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--atc-line); padding: 7px 0; }
      .lvbtns { display: flex; gap: 8px; }
      .lvbtns button { all: unset; cursor: pointer; flex: 1; text-align: center; padding: 11px; border-radius: 10px; background: var(--atc-soft); font-weight: 600; }
      .lvbtns button.ok { flex: 1.4; background: var(--atc-run); color: #0d1117; }
      .lvbtns button:disabled { opacity: .5; }
    `;
  }
}

if (!customElements.get("arbetstid-card")) customElements.define("arbetstid-card", ArbetstidCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "arbetstid-card", name: "Arbetstid", description: "Start/stopp, justering och redovisning av arbetstid per dag, vecka och månad." });
console.info(`%c arbetstid-card ${ATC_VERSION} `, "background:#5aa9ff;color:#000");
