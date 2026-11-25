// Kör med: TZ=Europe/Stockholm node --test test/
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../engine.js");

const T = (s) => new Date(s).getTime(); // lokal tid, t.ex. "2026-11-25T08:00"

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
}
function make(startIso, deps) {
  const clock = { t: T(startIso) };
  const storage = (deps && deps.storage) || memStorage();
  const h = new E.LocalHass({ storage, now: () => clock.t, ...(deps || {}) });
  return { h, clock, storage, at: (iso) => { clock.t = T(iso); } };
}
const days = (h) => h.hass.states["sensor.arbetstid"].attributes.days;

test("start och stopp samma dag", () => {
  const { h, at } = make("2026-11-25T08:00");
  h.start();
  assert.equal(h.hass.states["input_boolean.arbetstid"].state, "on");
  assert.equal(h.hass.states["sensor.arbetstid"].state, "pågår");
  at("2026-11-25T16:30");
  h.stop();
  assert.equal(days(h)["2026-11-25"], 510);
  assert.equal(h.hass.states["input_boolean.arbetstid"].state, "off");
  assert.equal(h.hass.states["sensor.arbetstid"].attributes.running_since, null);
});

test("pass över midnatt fördelas per dygn", () => {
  const { h, at } = make("2026-11-25T23:30");
  h.start();
  at("2026-11-26T00:45");
  h.stop();
  assert.equal(days(h)["2026-11-25"], 30);
  assert.equal(days(h)["2026-11-26"], 45);
});

test("pass över flera dygn", () => {
  const { h, at } = make("2026-11-24T22:00");
  h.start();
  at("2026-11-26T02:00");
  h.stop();
  assert.equal(days(h)["2026-11-24"], 120);
  assert.equal(days(h)["2026-11-25"], 1440);
  assert.equal(days(h)["2026-11-26"], 120);
});

test("pass över sommartidsbyte räknas i verklig tid", () => {
  const { h, at } = make("2026-03-28T22:00");
  h.start();
  at("2026-03-29T06:00"); // klockan går fram en timme natten mot 29 mars
  h.stop();
  const d = days(h);
  assert.equal(d["2026-03-28"] + d["2026-03-29"], 420);
});

test("dubbel start och dubbel stopp ignoreras", () => {
  const { h, at } = make("2026-11-25T08:00");
  h.start();
  at("2026-11-25T09:00");
  h.start(); // ska inte nollställa
  at("2026-11-25T10:00");
  h.stop();
  h.stop();
  assert.equal(days(h)["2026-11-25"], 120);
});

test("justering lägger till och drar bort", () => {
  const { h } = make("2026-11-25T12:00");
  h.adjust("2026-11-25", 30);
  h.adjust("2026-11-25", 15);
  h.adjust("2026-11-25", -15);
  assert.equal(days(h)["2026-11-25"], 30);
});

test("justering utanför fönstret eller för stor avvisas", async () => {
  const { h } = make("2026-11-25T12:00");
  assert.throws(() => h.adjust("2026-11-21", 15), /dygnen/); // 4 dygn bakåt
  assert.throws(() => h.adjust("2026-11-26", 15), /dygnen/); // framtid
  assert.throws(() => h.adjust("2026-11-25", 121), /minuter/);
  assert.throws(() => h.adjust("2026-11-25", 0), /minuter/);
  assert.throws(() => h.adjust("nonsens", 15), /datum/);
  h.adjust("2026-11-22", 15); // exakt 3 dygn bakåt går bra
  assert.equal(days(h)["2026-11-22"], 15);
  await assert.rejects(h.callService("script", "arbetstid_justera", { dag: "2026-11-01", minuter: 15 }));
});

test("ett dygn kan inte bli negativt", () => {
  const { h } = make("2026-11-25T12:00");
  h.adjust("2026-11-25", 15);
  h.adjust("2026-11-25", -60);
  assert.equal(days(h)["2026-11-25"], 0);
});

test("negativ justering under pågående pass räknar in passet", () => {
  const { h, at } = make("2026-11-25T08:00");
  h.start();
  at("2026-11-25T09:00"); // 60 min pågår
  h.adjust("2026-11-25", -60); // dagen är 0 sparat, men 60 min pågår => golv -60
  assert.equal(days(h)["2026-11-25"], -60);
  at("2026-11-25T10:00");
  h.stop();
  assert.equal(days(h)["2026-11-25"], 60 - 0); // -60 + 120 = 60
});

test("todayMinutes inkluderar pågående pass", () => {
  const { h, at } = make("2026-11-25T08:00");
  h.start();
  at("2026-11-25T08:45");
  assert.equal(Math.round(h.todayMinutes()), 45);
});

test("tjänsterna som kortet anropar", async () => {
  const sent = [];
  const { h } = make("2026-11-25T08:00", { shareReport: async (s, html) => { sent.push([s, html]); } });
  await h.hass.callService("input_boolean", "toggle", { entity_id: "input_boolean.arbetstid" });
  assert.equal(h.running, true);
  await h.hass.callService("input_boolean", "toggle", { entity_id: "input_boolean.arbetstid" });
  assert.equal(h.running, false);
  await h.hass.callService("script", "arbetstid_maila", { amne: "Test", html: "<b>x</b>" });
  assert.deepEqual(sent, [["Test", "<b>x</b>"]]);
  await assert.rejects(h.hass.callService("light", "turn_on", {}));
});

test("ledighet: skapa, lista via API och ta bort via WS", async () => {
  const { h } = make("2026-11-25T08:00");
  await h.hass.callService("calendar", "create_event", { summary: "Ledig", start_date: "2026-12-01", end_date: "2026-12-04" }, { entity_id: "calendar.ledighet" });
  await h.hass.callService("calendar", "create_event", { summary: "Halvdag", start_date: "2026-12-10", end_date: "2026-12-11" }, { entity_id: "calendar.ledighet" });
  const q = (a, b) => `calendars/calendar.ledighet?start=${encodeURIComponent(a)}&end=${encodeURIComponent(b)}`;
  let list = await h.hass.callApi("GET", q(new Date(2026, 10, 1).toISOString(), new Date(2027, 0, 1).toISOString()));
  assert.equal(list.length, 2);
  assert.equal(list[0].start.date, "2026-12-01");
  assert.equal(list[0].end.date, "2026-12-04");
  assert.ok(list[0].uid);
  // utanför intervallet
  list = await h.hass.callApi("GET", q(new Date(2027, 0, 1).toISOString(), new Date(2027, 1, 1).toISOString()));
  assert.equal(list.length, 0);
  list = await h.hass.callApi("GET", q(new Date(2026, 10, 1).toISOString(), new Date(2027, 0, 1).toISOString()));
  await h.hass.callWS({ type: "calendar/event/delete", entity_id: "calendar.ledighet", uid: list[0].uid });
  list = await h.hass.callApi("GET", q(new Date(2026, 10, 1).toISOString(), new Date(2027, 0, 1).toISOString()));
  assert.equal(list.length, 1);
  assert.equal(list[0].summary, "Halvdag");
});

test("lagring: tillståndet överlever omstart", () => {
  const storage = memStorage();
  const a = make("2026-11-25T08:00", { storage });
  a.h.start();
  a.at("2026-11-25T10:00");
  a.h.stop();
  a.h.setSettings({ norm_week: "37:30", configured: true });
  const b = make("2026-11-25T11:00", { storage });
  assert.equal(days(b.h)["2026-11-25"], 120);
  assert.equal(b.h.store.settings.norm_week, "37:30");
  assert.equal(b.h.store.settings.configured, true);
});

test("pågående pass överlever omstart", () => {
  const storage = memStorage();
  const a = make("2026-11-25T08:00", { storage });
  a.h.start();
  const b = make("2026-11-25T09:30", { storage });
  assert.equal(b.h.running, true);
  assert.equal(Math.round(b.h.todayMinutes()), 90);
});

test("trasig lagring förstörs inte", () => {
  const storage = memStorage();
  storage.setItem(E.STORAGE_KEY, "{trasig json");
  const { h } = make("2026-11-25T08:00", { storage });
  assert.deepEqual(days(h), {});
  assert.equal(storage.getItem(E.STORAGE_KEY + ".corrupt"), "{trasig json");
});

test("export och import slår ihop utan dubbletter", () => {
  const a = make("2026-11-25T08:00");
  a.h.start(); a.at("2026-11-25T10:00"); a.h.stop();
  const dump = a.h.exportData();
  const b = make("2026-11-25T12:00");
  b.h.adjust("2026-11-25", 30);
  let r = b.h.importData(JSON.parse(JSON.stringify(dump)));
  assert.equal(r.added, 2);
  assert.equal(days(b.h)["2026-11-25"], 150);
  r = b.h.importData(JSON.parse(JSON.stringify(dump))); // igen: inget ändras
  assert.equal(r.added, 0);
  assert.equal(r.skipped, 2);
  assert.equal(days(b.h)["2026-11-25"], 150);
  assert.throws(() => b.h.importData({ foo: 1 }), /backup/);
  assert.equal(b.h.importData({ app: "arbetstid", events: [{ id: 1 }, null] }).invalid, 2);
});

test("import av HA-data (days) och omimport ersätter", () => {
  const { h } = make("2026-11-25T12:00");
  let r = h.importDays({ "2026-10-12": 452.5, "2026-10-13": 480, trasig: 5, "2026-10-14": -3 });
  assert.deepEqual(r, { days: 2, invalid: 2 });
  assert.equal(days(h)["2026-10-12"], 452.5);
  h.importDays({ days: { "2026-10-12": 400 } }); // nyckeln days accepteras, värdet ersätts
  assert.equal(days(h)["2026-10-12"], 400);
  assert.equal(days(h)["2026-10-13"], 480);
  h.adjust("2026-11-25", 15);
  assert.equal(days(h)["2026-11-25"], 15);
});

test("clearAll nollställer", () => {
  const { h } = make("2026-11-25T08:00");
  h.start();
  h.clearAll();
  assert.equal(h.running, false);
  assert.deepEqual(days(h), {});
});

test("tillståndsobjekten byts vid varje ändring (kortet jämför på identitet)", () => {
  const { h } = make("2026-11-25T08:00");
  const before = h.hass.states["sensor.arbetstid"];
  h.start();
  assert.notEqual(h.hass.states["sensor.arbetstid"], before);
});

test("backup med trasiga inställningar ger rimliga värden", () => {
  const h = new E.LocalHass({ storage: memStorage(), now: () => Date.UTC(2026, 10, 25, 9) });
  h.importData({ app: "arbetstid", events: [], settings: { norm_week: "abc", work_days: "mån", holidays: "ja", edit_days: 999, reminder_hours: -5, configured: true, skräp: 1 } }, true);
  const s = h.store.settings;
  assert.equal(s.norm_week, "40:00");
  assert.deepEqual(s.work_days, [1, 2, 3, 4, 5]);
  assert.equal(s.holidays, true);
  assert.equal(s.edit_days, 14);
  assert.equal(s.reminder_hours, 0);
  assert.equal(s.configured, true);
  assert.equal("skräp" in s, false);
});

test("lagring som vägrar spara ger saveError men appen fortsätter fungera i minnet", () => {
  let full = false;
  const st = { getItem: () => null, setItem: () => { if (full) throw new Error("QuotaExceededError"); } };
  const h = new E.LocalHass({ storage: st, now: () => Date.UTC(2026, 10, 25, 9) });
  h.start();
  assert.equal(h.store.saveError, null);
  full = true;
  h.stop();
  assert.ok(h.store.saveError);
  assert.equal(h.running, false, "tillståndet följer ändå klicket");
  full = false;
  h.start();
  assert.equal(h.store.saveError, null);
});
