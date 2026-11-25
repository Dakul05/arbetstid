// Kör med: TZ=Europe/Stockholm node --test test/
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../engine.js");
const S = require("../sync.js");
const { createScript } = require("./gas-mock.js");

const T = (s) => new Date(s).getTime();
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

// En "telefon": egen lagring, egen klocka, egen motor och egen synk mot samma skript
function phone(server, startIso, fetchOverride) {
  const clock = { t: T(startIso) };
  const storage = memStorage();
  const eng = new E.LocalHass({ storage, now: () => clock.t });
  const sync = new S.Sync({ eng, storage, now: () => clock.t, fetch: fetchOverride || server.fetch });
  return { eng, sync, clock, storage, at: (iso) => { clock.t = T(iso); }, days: () => eng.hass.states["sensor.arbetstid"].attributes.days };
}
const connect = (p, server) => p.sync.configure("https://script.google.com/macros/s/ABC/exec", server.key);

test("två telefoner delar logg åt båda hållen", async () => {
  const server = createScript();
  const a = phone(server, "2026-11-25T08:00"), b = phone(server, "2026-11-25T09:00");
  connect(a, server); connect(b, server);

  a.eng.start(); a.at("2026-11-25T12:00"); a.eng.stop();
  let st = await a.sync.run();
  assert.equal(st.error, null);
  assert.equal(server.sheet().getLastRow(), 3); // rubrik + start + stopp

  await b.sync.run();
  assert.equal(b.days()["2026-11-25"], 240);

  b.at("2026-11-25T13:00");
  b.eng.adjust("2026-11-25", 30);
  await b.sync.run();
  await a.sync.run();
  assert.equal(a.days()["2026-11-25"], 270);
  assert.equal(b.days()["2026-11-25"], 270);
});

test("en synk utan nyheter skickar och lägger till ingenting", async () => {
  const server = createScript();
  const a = phone(server, "2026-11-25T08:00");
  connect(a, server);
  a.eng.start();
  await a.sync.run();
  const rows = server.sheet().getLastRow();
  await a.sync.run();
  await a.sync.run();
  assert.equal(server.sheet().getLastRow(), rows);
  assert.ok(server.state.lastPayloadBytes < 200, "tom synk ska vara liten: " + server.state.lastPayloadBytes);
});

test("start på en telefon och stopp på en annan ger rätt tid", async () => {
  const server = createScript();
  const a = phone(server, "2026-11-25T08:00"), b = phone(server, "2026-11-25T16:30");
  connect(a, server); connect(b, server);
  a.eng.start();
  await a.sync.run();
  await b.sync.run();
  assert.equal(b.eng.running, true);
  b.eng.stop();
  await b.sync.run();
  await a.sync.run();
  assert.equal(a.eng.running, false);
  assert.equal(a.days()["2026-11-25"], 510);
});

test("ledighet och borttagning synkas", async () => {
  const server = createScript();
  const a = phone(server, "2026-11-25T08:00"), b = phone(server, "2026-11-25T08:00");
  connect(a, server); connect(b, server);
  const id = a.eng.addLeave("Ledig", "2026-12-01", "2026-12-03");
  await a.sync.run(); await b.sync.run();
  assert.equal(b.eng.derived.leaves.size, 1);
  b.eng.removeLeave(id);
  await b.sync.run(); await a.sync.run();
  assert.equal(a.eng.derived.leaves.size, 0);
});

test("förlorat svar ger inga dubbletter vid nästa försök", async () => {
  const server = createScript();
  let drop = true;
  const flaky = async (url, init) => { const out = server.post(init.body); if (drop) { drop = false; throw new TypeError("Failed to fetch"); } return { json: async () => out }; };
  const a = phone(server, "2026-11-25T08:00", flaky);
  connect(a, server);
  a.eng.start(); a.at("2026-11-25T10:00"); a.eng.stop();
  let st = await a.sync.run();
  assert.match(st.error, /Ingen kontakt/);
  assert.equal(server.sheet().getLastRow(), 3, "servern fick händelserna trots att svaret försvann");
  st = await a.sync.run(); // andra försöket
  assert.equal(st.error, null);
  assert.equal(server.sheet().getLastRow(), 3, "inga dubbletter");
  assert.equal(a.days()["2026-11-25"], 120);
  const b = phone(server, "2026-11-25T11:00");
  connect(b, server); await b.sync.run();
  assert.equal(b.days()["2026-11-25"], 120);
});

test("fel nyckel: felmeddelande och ingen data läcker", async () => {
  const server = createScript();
  const a = phone(server, "2026-11-25T08:00");
  a.eng.start(); a.at("2026-11-25T09:00"); a.eng.stop();
  a.sync.configure("https://script.google.com/macros/s/ABC/exec", "fel-nyckel");
  const st = await a.sync.run();
  assert.equal(st.error, "Fel nyckel");
  assert.ok(!server.sheet(), "inget blad skapas utan rätt nyckel");
  assert.deepEqual(server.post({ key: "x", cursor: 1 }), { ok: false, error: "auth" });
  assert.deepEqual(server.post("inte json"), { ok: false, error: "bad" });
});

test("nyckeln slumpas automatiskt, är lång och ändras inte", () => {
  const server = createScript();
  const k1 = server.key;
  assert.match(k1, /^[0-9a-f]{64}$/);
  server.post({ key: "fel", cursor: 1 });
  assert.equal(server.key, k1);
  assert.deepEqual(server.post({ key: "", cursor: 1 }), { ok: false, error: "auth" });
  assert.deepEqual(server.post({ cursor: 1 }), { ok: false, error: "auth" });
  assert.deepEqual(server.post({ key: 123, cursor: 1 }), { ok: false, error: "auth" });
  assert.equal(server.post({ key: k1, cursor: 1 }).ok, true);
});

test("Koppla telefon: länken innehåller adress och nyckel och fungerar i appen", () => {
  const server = createScript();
  server.api.onOpen();
  assert.equal(server.ui.menu, "Arbetstid");
  server.api.kopplaTelefon();
  const html = server.ui.dialogs[0].html;
  const link = html.match(/readonly[^>]*>([^<]+)</)[1];
  assert.ok(link.startsWith("https://exempel.github.io/arbetstid/#synk="));
  const o = S.parseLink(link.split("#")[1]);
  assert.equal(o.url, "https://script.google.com/macros/s/AKtest/exec", "/dev blir /exec");
  assert.equal(o.key, server.key);
  const a = phone(server, "2026-11-25T08:00");
  a.sync.configure(o.url.replace("https://script.google.com", "https://script.google.com"), o.key);
  assert.equal(a.sync.configured, true);
});

test("Koppla telefon utan distribution ger tydligt besked, ingen länk", () => {
  const server = createScript();
  server.state.deployed = false;
  server.api.kopplaTelefon();
  assert.equal(server.ui.dialogs.length, 0);
  assert.match(server.ui.alerts[0][1], /Distribuera/);
});

test("Koppla telefon utan inställd APP_URL förklarar vad som saknas", () => {
  const server = createScript({ appUrl: false });
  server.api.kopplaTelefon();
  assert.equal(server.ui.dialogs.length, 0);
  assert.match(server.ui.alerts[0][1], /APP_URL/);
});

test("Mejla länken går alltid till ägaren, även med MOTTAGARE satt", () => {
  const server = createScript({ owner: "agare@example.com", mottagare: "mottagare@example.com" });
  server.api.mejlaLank();
  assert.equal(server.mails[0].to, "agare@example.com");
  assert.match(server.mails[0].body, /#synk=/);
});

test("parseLink avvisar skräp och osäkra adresser", () => {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.equal(S.parseLink("synk=%%%"), null);
  assert.equal(S.parseLink("annat=1"), null);
  assert.equal(S.parseLink("synk=" + enc({ u: "http://evil.example/exec", k: "abc" })), null);
  assert.equal(S.parseLink("synk=" + enc({ u: "https://script.google.com/macros/s/A/exec" })), null);
  assert.equal(S.parseLink("synk=" + enc({ u: "https://script.google.com/macros/s/A/exec", k: "abc" })).key, "abc");
  assert.equal(S.parseLink("synk=" + enc({ u: "https://evil.example/exec", k: "abc" })), null, "bara Googles adresser");
});

test("configure: ogiltiga adresser och nycklar avvisas", () => {
  const server = createScript();
  const a = phone(server, "2026-11-25T08:00");
  assert.throws(() => a.sync.configure("inte en adress", "k"), /webbadress/);
  assert.throws(() => a.sync.configure("http://example.com/exec", "k"), /https/);
  assert.throws(() => a.sync.configure("https://script.google.com/macros/s/A/exec", ""), /nyckeln/);
  a.sync.configure("http://localhost:8124/exec", "ok"); // lokalt får vara http (för test)
  assert.equal(a.sync.configured, true);
});

test("byte av adress eller nyckel börjar om från noll, annan flagga gör det inte", async () => {
  const server = createScript();
  const a = phone(server, "2026-11-25T08:00");
  connect(a, server);
  a.eng.start();
  await a.sync.run();
  assert.ok(a.sync.state.known.length === 1 && a.sync.state.cursor > 1);
  a.sync.configure("https://script.google.com/macros/s/ABC/exec", server.key, true); // bara mail-flaggan
  assert.ok(a.sync.state.known.length === 1);
  assert.equal(a.sync.mailViaScript, true);
  a.sync.configure("https://script.google.com/macros/s/NY/exec", server.key, true);
  assert.deepEqual(a.sync.state.known, []);
  assert.equal(a.sync.state.cursor, 1);
});

test("stora loggar skickas i delar och kan hämtas av en ny telefon", async () => {
  const server = createScript();
  let calls = 0;
  const counting = async (u, i) => { calls++; return server.fetch(u, i); };
  const a = phone(server, "2026-11-25T08:00", counting);
  connect(a, server);
  for (let i = 0; i < 700; i++) a.eng.store.events.push({ id: "bulk" + i, t: T("2026-01-01T00:00") + i * 60000, type: "import", data: { day: "2026-01-" + String((i % 28) + 1).padStart(2, "0"), min: 1, rev: i } });
  a.eng._changed();
  await a.sync.run();
  assert.equal(calls, 3, "700 händelser i delar om 300");
  assert.equal(server.sheet().getLastRow(), 701);
  const b = phone(server, "2026-11-25T09:00");
  connect(b, server);
  const st = await b.sync.run();
  assert.equal(st.error, null);
  assert.equal(b.eng.store.events.length, 700);
});

test("två telefoner som importerar samma dag: den senaste importen vinner överallt", async () => {
  const server = createScript();
  const a = phone(server, "2026-11-25T08:00"), b = phone(server, "2026-11-25T09:00");
  connect(a, server); connect(b, server);
  a.eng.importDays({ "2026-10-12": 400 });
  b.eng.importDays({ "2026-10-12": 450 }); // senare klocka => högre rev
  await a.sync.run(); await b.sync.run(); await a.sync.run();
  assert.equal(a.days()["2026-10-12"], 450);
  assert.equal(b.days()["2026-10-12"], 450);
});

test("merging-flaggan är sann medan hämtade händelser läggs in", async () => {
  const server = createScript();
  const a = phone(server, "2026-11-25T08:00"), b = phone(server, "2026-11-25T09:00");
  connect(a, server); connect(b, server);
  a.eng.start(); await a.sync.run();
  const seen = [];
  b.eng.subscribe(() => seen.push(b.sync.merging));
  await b.sync.run();
  assert.deepEqual(seen, [true]);
  assert.equal(b.sync.merging, false);
});

test("offline och konstiga svar ger begripliga fel och förstör inget", async () => {
  const server = createScript();
  let mode = "offline";
  const f = async (u, i) => {
    if (mode === "offline") throw new TypeError("Failed to fetch");
    if (mode === "html") return { json: async () => { throw new SyntaxError("Unexpected token <"); } };
    if (mode === "busy") { server.state.busy = true; const r = await server.fetch(u, i); server.state.busy = false; return r; }
    return server.fetch(u, i);
  };
  const a = phone(server, "2026-11-25T08:00", f);
  connect(a, server);
  a.eng.start();
  assert.match((await a.sync.run()).error, /Ingen kontakt/);
  mode = "html";
  assert.match((await a.sync.run()).error, /inte som väntat/);
  mode = "busy";
  assert.match((await a.sync.run()).error, /upptaget/);
  assert.equal(a.eng.running, true, "lokal data orörd");
  mode = "ok";
  const st = await a.sync.run();
  assert.equal(st.error, null);
  assert.ok(st.last > 0);
});

test("manuellt raderade rader i arket får inte klienten att tappa data", async () => {
  const server = createScript();
  const a = phone(server, "2026-11-25T08:00");
  connect(a, server);
  a.eng.start(); a.at("2026-11-25T10:00"); a.eng.stop();
  await a.sync.run();
  server.sheet().rows.length = 1; // användaren raderar alla rader i arket
  const st = await a.sync.run();
  assert.equal(st.error, null);
  assert.equal(a.days()["2026-11-25"], 120, "lokal logg oförändrad");
  assert.equal(a.sync.state.cursor, 1);
});

test("servern avvisar ogiltiga händelser och dubbletter", () => {
  const server = createScript();
  const ok = { id: "e1", t: 1764000000000, type: "start", data: {} };
  server.post({ key: server.key, cursor: 1, push: [ok, ok, { id: "x", t: "nu", type: "start" }, { id: "y", t: 1, type: "hackad" }, null, { t: 1, type: "start" }] });
  assert.equal(server.sheet().getLastRow(), 2, "rubrik + bara den giltiga");
  const res = server.post({ key: server.key, cursor: 1, push: [] });
  assert.equal(res.events.length, 1);
  assert.deepEqual(res.events[0], { id: "e1", t: 1764000000000, type: "start", data: {} });
});

test("webbadressen ger ingen data vid GET", () => {
  const server = createScript();
  server.post({ key: server.key, cursor: 1, push: [{ id: "e1", t: 1764000000000, type: "start", data: {} }] });
  assert.deepEqual(server.get(), { ok: true, app: "arbetstid", v: 1 });
});

test("mail via skriptet går bara till ägaren, aldrig till en adress i anropet", async () => {
  const server = createScript({ owner: "agare@example.com" });
  const a = phone(server, "2026-11-25T08:00");
  connect(a, server);
  const to = await a.sync.mail("Arbetstid – vecka 48", "<b>hej</b>", "hej");
  assert.equal(to, "agare@example.com");
  assert.equal(server.mails.length, 1);
  assert.equal(server.mails[0].to, "agare@example.com");
  assert.equal(server.mails[0].htmlBody, "<b>hej</b>");
  // ett inskickat "to" ignoreras
  server.post({ key: server.key, action: "mail", subject: "x", html: "y", to: "angripare@example.com" });
  assert.equal(server.mails[1].to, "agare@example.com");
  // fel nyckel skickar inget
  assert.deepEqual(server.post({ key: "fel", action: "mail", subject: "x" }), { ok: false, error: "auth" });
  assert.equal(server.mails.length, 2);
  // MOTTAGARE i skriptet styr
  const s2 = createScript({ mottagare: "mottagare@example.com" });
  s2.post({ key: s2.key, action: "mail", subject: "x", html: "y" });
  assert.equal(s2.mails[0].to, "mottagare@example.com");
});

test("synkinställningar ingår inte i en backup", async () => {
  const server = createScript();
  const a = phone(server, "2026-11-25T08:00");
  connect(a, server);
  const dump = JSON.stringify(a.eng.exportData());
  assert.ok(!dump.includes(server.key), "nyckeln får inte läcka i backupfilen");
  assert.ok(!dump.includes("script.google.com"));
});

test("synkinställningar överlever omstart", async () => {
  const server = createScript();
  const a = phone(server, "2026-11-25T08:00");
  connect(a, server);
  a.eng.start();
  await a.sync.run();
  const eng2 = new E.LocalHass({ storage: a.storage, now: () => a.clock.t });
  const sync2 = new S.Sync({ eng: eng2, storage: a.storage, now: () => a.clock.t, fetch: server.fetch });
  assert.equal(sync2.configured, true);
  assert.equal(sync2.state.known.length, 1);
  const rows = server.sheet().getLastRow();
  await sync2.run();
  assert.equal(server.sheet().getLastRow(), rows, "inget skickas om efter omstart");
});
