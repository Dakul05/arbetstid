const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const assert = require('assert');
const URL = 'http://localhost:8123/index.html';
const D = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();

// Pass som går över vecko-, månads- och årsskifte (lokal tid)
const passes = [
  [D(2026, 11, 29, 22), D(2026, 11, 30, 2)],   // sön→mån: 2 h i v48, 2 h i v49
  [D(2026, 11, 30, 22), D(2026, 12, 1, 1)],    // nov→dec: 2 h nov, 1 h dec
  [D(2026, 12, 31, 23), D(2027, 1, 1, 1)],     // 2026→2027: 1 h var, ISO-vecka 53
];
const events = [];
passes.forEach(([a, b], i) => { events.push({ id: 'a' + i, t: a, type: 'start', data: {} }, { id: 'b' + i, t: b, type: 'stop', data: {} }); });

async function open(browser, now, extraInit) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: 'sv-SE', timezoneId: 'Europe/Stockholm' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.clock.install({ time: new Date(now) });
  const seeded = events.filter(e => e.t <= new Date(now).getTime());
  await page.addInitScript(([ev, init]) => {
    localStorage.setItem('arbetstid.v1', JSON.stringify({ v: 1, events: init ? ev : [], settings: { norm_week: '40:00', work_days: [1,2,3,4,5], holidays: true, eves: true, edit_days: 3, reminder_hours: 0, configured: true } }));
  }, [seeded, extraInit !== false]);
  await page.goto(URL);
  await page.waitForSelector('.go');
  return { ctx, page, errors };
}
const buckets = (page, view) => page.evaluate((v) => {
  const c = document.querySelector('arbetstid-card');
  const d = c._data().days;
  return c._buckets(v, d).map(b => ({ key: b.key, min: Math.round(b.min), norm: Math.round(b.norm), long: b.long, ongoing: b.ongoing }));
}, view);
const days = (page) => page.evaluate(() => arbetstid.hass.states['sensor.arbetstid'].attributes.days);

(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const log = (...a) => console.log(...a);

  // ---- A: måndag 30 nov 2026 10:00 – veckoskiftet har passerat
  {
    const { ctx, page, errors } = await open(browser, new Date(2026, 10, 30, 10, 0));
    const d = await days(page);
    assert.equal(d['2026-11-29'], 120); assert.equal(d['2026-11-30'], 120);
    const w = await buckets(page, 'week');
    const v48 = w.find(b => b.key === '2026-W48'), v49 = w.find(b => b.key === '2026-W49');
    assert.equal(v48.min, 120, 'v48 ska ha söndagens 2 h'); assert.equal(v49.min, 120, 'v49 ska ha måndagens 2 h');
    assert.equal(v49.ongoing, true); assert.equal(v48.ongoing, false);
    assert.equal(v48.norm, 2400); assert.equal(v49.norm, 2400);
    log('A veckoskifte OK:', JSON.stringify(w.map(b => [b.key, b.min, b.norm])));
    assert.deepEqual(errors, []);
    await ctx.close();
  }

  // ---- B: tisdag 1 dec 2026 09:00 – månadsskiftet har passerat
  {
    const { ctx, page, errors } = await open(browser, new Date(2026, 11, 1, 9, 0));
    const d = await days(page);
    assert.equal(d['2026-11-30'], 240); assert.equal(d['2026-12-01'], 60);
    const m = await buckets(page, 'month');
    const nov = m.find(b => b.key === '2026-11'), dec = m.find(b => b.key === '2026-12');
    assert.equal(nov.min, 360, 'november: 120 + 240'); assert.equal(dec.min, 60);
    assert.equal(nov.ongoing, false); assert.equal(dec.ongoing, true);
    assert.equal(nov.norm, 21 * 480, 'november 2026 har 21 arbetsdagar'); // 2–30 nov: mån–fre = 21
    const w = await buckets(page, 'week');
    assert.equal(w.find(b => b.key === '2026-W49').min, 300, 'v49 = mån 240 + tis 60 (passet över månadsskiftet hör till samma vecka)');
    log('B månadsskifte OK:', JSON.stringify(m.map(b => [b.key, b.min, b.norm])));
    // vyerna renderas utan fel
    for (const v of ['day', 'week', 'month']) { await page.click(`.tab[data-view="${v}"]`); }
    await page.screenshot({ path: '/tmp/r-B-month.png' });
    assert.deepEqual(errors, []);
    await ctx.close();
  }

  // ---- C: lördag 2 jan 2027 12:00 – årsskiftet och ISO-vecka 53
  {
    const { ctx, page, errors } = await open(browser, new Date(2027, 0, 2, 12, 0));
    const d = await days(page);
    assert.equal(d['2026-12-31'], 60); assert.equal(d['2027-01-01'], 60);
    const w = await buckets(page, 'week');
    const v53 = w.find(b => b.key === '2026-W53');
    assert(v53, 'ISO-vecka 53 för 2026 ska finnas (1 jan 2027 tillhör den)');
    assert.equal(v53.min, 120, 'v53 = 31 dec + 1 jan');
    assert.equal(v53.norm, 3 * 480, 'v53: tre arbetsdagar (nyårsafton och nyårsdagen är lediga)');
    assert(!w.find(b => b.key === '2027-W01' && b.min > 0), 'inget ska hamna i 2027-W01 för 1 jan');
    const w52 = w.find(b => b.key === '2026-W52');
    assert.equal(w52.norm, 3 * 480, 'v52: julafton och juldagen avräknade (mån, tis, ons)');
    const m = await buckets(page, 'month');
    const jan = m.find(b => b.key === '2027-01'), dec = m.find(b => b.key === '2026-12');
    assert.equal(dec.min, 60 + 60, 'dec: 1 dec 60 + 31 dec 60'); assert.equal(jan.min, 60);
    assert.equal(jan.norm, 19 * 480, 'jan 2027: 21 vardagar minus nyårsdagen och trettondedagen');
    log('C årsskifte OK:', JSON.stringify(w.slice(-3).map(b => [b.key, b.min, b.norm])), JSON.stringify(m.slice(-2).map(b => [b.key, b.min, b.norm])));
    // veckovyn och månadsvyn visar siffrorna
    await page.click('.tab[data-view="month"]');
    const txt = await page.evaluate(() => document.querySelector('arbetstid-card').shadowRoot.querySelector('.hero').textContent.replace(/\s+/g, ' '));
    log('månadsvy hero:', txt.trim().slice(0, 120));
    await page.screenshot({ path: '/tmp/r-C-year.png' });
    assert.deepEqual(errors, []);
    await ctx.close();
  }

  // ---- D: live över månadsskiftet: starta 23:50, vänta 30 min i falsk tid, stoppa
  {
    const { ctx, page, errors } = await open(browser, new Date(2026, 10, 30, 23, 50), false);
    await page.click('.go');
    await page.waitForFunction(() => arbetstid.running);
    await page.clock.runFor(30 * 60 * 1000);
    // kortet räknar upp pågående pass: nov ska ha 10 min och dec 20 min medan det pågår
    const live = await page.evaluate(() => { const c = document.querySelector('arbetstid-card'); const d = c._data().days; return { nov: Math.round(d['2026-11-30']), dec: Math.round(d['2026-12-01']) }; });
    assert.deepEqual(live, { nov: 10, dec: 20 }, 'pågående pass ska delas upp live');
    await page.click('.go');
    await page.waitForFunction(() => !arbetstid.running);
    const d = await days(page);
    assert.equal(d['2026-11-30'], 10); assert.equal(d['2026-12-01'], 20);
    const m = await buckets(page, 'month');
    assert.equal(m.find(b => b.key === '2026-11').min, 10); assert.equal(m.find(b => b.key === '2026-12').min, 20);
    log('D live över månadsskifte OK: nov', d['2026-11-30'], 'min, dec', d['2026-12-01'], 'min');
    assert.deepEqual(errors, []);
    await ctx.close();
  }

  await browser.close();
  log('SKIFTEN KLARA');
})().catch(e => { console.error('MISSLYCKADES:', e.message); process.exit(1); });
