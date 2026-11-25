// Webbläsartest av synken: två "telefoner" mot en låtsas-Apps Script-server (lokalt).
// Kör: node test/e2e-sync.js  (kräver att appen serveras på :8123, t.ex. npx http-server -p 8123)
const http = require("http");
const assert = require("assert");
const { chromium } = require(process.env.PLAYWRIGHT || "/opt/node22/lib/node_modules/playwright");
const { createScript } = require("./gas-mock.js");

const APP = process.env.APP_URL || "http://localhost:8123/index.html";
const script = createScript({ key: "hemlig123", owner: "agare@example.com" });
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "POST") { res.end(JSON.stringify(script.get())); return; }
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(script.post(b))); });
});

(async () => {
  await new Promise((r) => server.listen(8124, r));
  const URL_ = "http://localhost:8124/exec";
  const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"] });
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "sv-SE", timezoneId: "Europe/Stockholm" });
    const page = await ctx.newPage();
    page.errors = [];
    page.on("pageerror", (e) => page.errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    await page.goto(APP);
    await page.waitForSelector("#settings[open]");
    await page.fill("#s-norm", "40:00");
    await page.click("#s-save");
    await page.waitForFunction(() => !document.getElementById("settings").open);
    return page;
  };
  const connect = async (p, key, mail) => {
    if (!(await p.evaluate(() => document.getElementById("settings").open))) await p.click("#gear");
    await p.waitForSelector("#settings[open]");
    await p.fill("#sy-url", URL_);
    await p.fill("#sy-key", key);
    if (mail) await p.check("#sy-mail");
    await p.click("#sy-go");
    await p.waitForFunction(() => /Ansluten|Fel/.test(document.getElementById("sy-status").textContent));
    return p.textContent("#sy-status");
  };
  const A = await mk(), B = await mk();

  // fel nyckel
  let st = await connect(A, "fel");
  assert(/Fel nyckel/.test(st), "fel nyckel ska synas: " + st);
  // BYT-MIG nekas direkt
  await A.fill("#sy-key", "BYT-MIG"); await A.click("#sy-go");
  await A.waitForTimeout(200);
  // rätt nyckel
  st = await connect(A, "hemlig123", true);
  assert(/Ansluten\. Senast synkad/.test(st), st);
  await A.click("#s-cancel");

  // A stämplar in och ut → hamnar i arket
  await A.click(".go");
  await A.waitForFunction(() => arbetstid.running === true);
  await A.waitForTimeout(100);
  await A.evaluate(() => arbetstid.adjust(new Date().toLocaleDateString("sv-SE"), 45));
  await A.waitForTimeout(300); 
  await A.click(".go"); // stoppa
  await A.waitForFunction(() => arbetstid.running === false);
  await A.waitForFunction(() => arbetstid.store.events.length >= 3);
  // synken är fördröjd ~4 s
  const t0 = Date.now();
  while (script.sheet() === undefined || script.sheet().getLastRow() < 4) { if (Date.now() - t0 > 12000) throw new Error("arket fick aldrig händelserna"); await new Promise((r) => setTimeout(r, 200)); }

  // B ansluter och får samma data
  st = await connect(B, "hemlig123");
  assert(/Ansluten/.test(st), st);
  const aMin = await A.evaluate(() => Object.values(arbetstid.hass.states["sensor.arbetstid"].attributes.days)[0]);
  const bMin = await B.evaluate(() => Object.values(arbetstid.hass.states["sensor.arbetstid"].attributes.days)[0]);
  assert(aMin >= 45 && aMin === bMin, `A=${aMin} B=${bMin}`);
  await B.click("#s-cancel");

  // B lägger till tid, A ser den vid nästa synk (tvingad via synlighet)
  await B.evaluate(() => arbetstid.adjust(new Date().toLocaleDateString("sv-SE"), 30));
  await A.waitForTimeout(100);
  const t1 = Date.now();
  while (true) {
    await A.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    const v = await A.evaluate(() => Object.values(arbetstid.hass.states["sensor.arbetstid"].attributes.days)[0]);
    if (v === aMin + 30) break;
    if (Date.now() - t1 > 15000) throw new Error("A fick aldrig Bs justering, A=" + v);
    await A.waitForTimeout(500);
  }

  // mail via skriptet
  const before = script.mails.length;
  const sent = await A.evaluate(async () => { try { await arbetstid.hass.callService("script", "arbetstid_maila", {}); return "ok"; } catch (e) { return e.message; } });
  console.log("mail-anrop via kortet:", sent, "mail i mocken:", script.mails.length - before);

  // ny enhet kopplas med länk från arket (confirm accepteras av testet)
  const hash = Buffer.from(JSON.stringify({ u: URL_, k: "hemlig123" })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const ctxC = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "sv-SE", timezoneId: "Europe/Stockholm" });
  const C = await ctxC.newPage();
  C.on("dialog", (d) => d.accept());
  await C.goto(APP + "#synk=" + hash);
  await C.waitForFunction(() => document.getElementById("settings").open, null, { timeout: 10000 }); // norm-dialogen efter kopplingen
  await C.waitForFunction(() => /Ansluten/.test(document.getElementById("sy-status")?.textContent || ""), null, { timeout: 10000 });
  const cMin = await C.evaluate(() => Object.values(arbetstid.hass.states["sensor.arbetstid"].attributes.days)[0]);
  assert(cMin >= aMin, "C fick datan via länken: " + cMin);
  assert.equal(await C.evaluate(() => location.hash), "", "länken (med nyckeln) ska bort ur adressfältet");
  // en främmande adress i länken avvisas
  const bad = Buffer.from(JSON.stringify({ u: "https://evil.example/exec", k: "x" })).toString("base64").replace(/=+$/, "");
  const D = await (await browser.newContext()).newPage();
  await D.goto(APP + "#synk=" + bad);
  await D.waitForTimeout(1500);
  assert.equal(await D.evaluate(() => JSON.parse(localStorage.getItem("arbetstid.sync") || "{}").url || null), null);

  // frånkoppling stoppar synk
  await A.click("#gear"); await A.waitForSelector("#settings[open]");
  await A.click("#sy-off");
  await A.waitForFunction(() => /Inte ansluten/.test(document.getElementById("sy-status").textContent));
  const rows = script.sheet().getLastRow();
  await A.evaluate(() => arbetstid.adjust(new Date().toLocaleDateString("sv-SE"), 5));
  await A.waitForTimeout(5500);
  assert.equal(script.sheet().getLastRow(), rows, "inget ska skickas efter frånkoppling");

  // nyckeln finns inte i backupen
  const dump = await A.evaluate(() => JSON.stringify(arbetstid.exportData()));
  assert(!dump.includes("hemlig123"));
  assert.deepEqual([...A.errors, ...B.errors], [], "sidfel: " + [...A.errors, ...B.errors]);
  console.log("E2E SYNK OK");
  await browser.close(); server.close();
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
