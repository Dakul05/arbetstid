const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const assert = require('assert');
const URL = 'http://localhost:8123/index.html';
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'sv-SE', timezoneId: 'Europe/Stockholm', deviceScaleFactor: 2, acceptDownloads: true, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('dialog', d => d.accept());

  await page.goto(URL);
  await page.waitForSelector('#settings[open]');
  await page.screenshot({ path: '/tmp/shot.png' });

  // ogiltig norm avvisas
  await page.fill('#s-norm', 'abc');
  await page.click('#s-save');
  assert(await page.locator('#settings[open]').count() === 1, 'dialog ska stå kvar vid ogiltig norm');
  await page.fill('#s-norm', '37,5');
  await page.click('#s-save');
  await page.waitForFunction(() => !document.getElementById('settings').open);
  assert.equal(await page.evaluate(() => arbetstid.store.settings.norm_week), '37:30');
  assert.equal(await page.evaluate(() => arbetstid.store.settings.configured), true);
  await page.screenshot({ path: '/tmp/shot.png' });

  // start
  await page.click('.go');
  await page.waitForFunction(() => arbetstid.running === true);
  assert((await page.textContent('.go')).includes('Stoppa'));
  // +15 på idag
  await page.click('.adj.plus[data-adj="15"]');
  await page.waitForFunction(() => Object.values(arbetstid.hass.states['sensor.arbetstid'].attributes.days)[0] >= 15);
  // -15 igen
  await page.click('.adj.minus[data-adj="-15"]');
  await page.waitForTimeout(700);
  await page.screenshot({ path: '/tmp/shot.png', fullPage: true });
  // stopp
  await page.click('.go');
  await page.waitForFunction(() => arbetstid.running === false);
  const days = await page.evaluate(() => arbetstid.hass.states['sensor.arbetstid'].attributes.days);
  console.log('days efter pass:', JSON.stringify(days));

  // justera +60 på igår via chip
  await page.click('.chip:has-text("Igår")');
  await page.click('.adj.plus[data-adj="60"]');
  await page.waitForFunction(() => { const d = arbetstid.hass.states['sensor.arbetstid'].attributes.days; return Object.keys(d).length === 2; });

  // ledighet: öppna popup, lägg in 1 dag imorgon
  await page.click('.lvbtn');
  await page.waitForSelector('.lvpop');
  await page.click('[data-lt="day"]');
  await page.screenshot({ path: '/tmp/shot.png' });
  await page.click('[data-act="leave-save"]');
  await page.waitForFunction(() => arbetstid.derived.leaves.size === 1);
  await page.click('.lvbtn');
  await page.waitForSelector('.lvli'); // listas under "Kommande"
  await page.click('[data-act="leave-close"]');

  // maila rapport: headless saknar share med filer => nedladdning
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.mail')]);
  const mailPath = '/tmp/' + dl.suggestedFilename();
  await dl.saveAs(mailPath);
  const html = fs.readFileSync(mailPath, 'utf8');
  assert(html.includes('Arbetstid –') && html.includes('<table'), 'rapporten ska vara en HTML-tabell');
  console.log('rapportfil:', dl.suggestedFilename(), html.length, 'tecken');
  await page.waitForFunction(() => document.querySelector('arbetstid-card').shadowRoot.textContent.includes('Skickat'));

  // persistens efter omladdning
  const before = await page.evaluate(() => JSON.stringify(arbetstid.hass.states['sensor.arbetstid'].attributes.days));
  await page.reload();
  await page.waitForSelector('.go');
  const after = await page.evaluate(() => JSON.stringify(arbetstid.hass.states['sensor.arbetstid'].attributes.days));
  assert.equal(after, before, 'data ska finnas kvar efter omladdning');
  assert.equal(await page.evaluate(() => arbetstid.derived.leaves.size), 1);

  // service worker + offline
  await page.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.getRegistration().then(r => !!(r && r.active)), null, { timeout: 8000 });
  await page.reload(); // låt SW ta kontroll
  await page.waitForTimeout(800);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForSelector('.go', { timeout: 8000 });
  console.log('offline-start OK');
  await ctx.setOffline(false);

  // inställningar: HA-import, backup-export, import
  await page.click('#gear');
  await page.waitForSelector('#settings[open]');
  await page.fill('#s-ha', '"2026-10-12": 452.5\n2026-10-13: 480\nskräp rad');
  await page.click('#s-ha-go');
  await page.waitForFunction(() => arbetstid.hass.states['sensor.arbetstid'].attributes.days['2026-10-12'] === 452.5);
  assert.equal(await page.evaluate(() => arbetstid.hass.states['sensor.arbetstid'].attributes.days['2026-10-13']), 480);
  await page.screenshot({ path: '/tmp/shot.png', fullPage: false });
  const [bk] = await Promise.all([page.waitForEvent('download'), page.click('#s-export')]);
  await bk.saveAs('/tmp/backup.json');
  const dump = JSON.parse(fs.readFileSync('/tmp/backup.json', 'utf8'));
  assert.equal(dump.app, 'arbetstid');
  console.log('backup:', dump.events.length, 'händelser');

  // radera och läs in igen
  await page.click('#s-clear');
  await page.waitForFunction(() => arbetstid.store.events.length === 0);
  await page.click('#gear');
  await page.waitForSelector('#settings[open]');
  await page.setInputFiles('#s-file', '/tmp/backup.json');
  await page.waitForFunction((n) => arbetstid.store.events.length === n, dump.events.length);
  assert.equal(await page.evaluate(() => arbetstid.hass.states['sensor.arbetstid'].attributes.days['2026-10-12']), 452.5);
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/shot.png' });

  // påminnelse efter 7 h: starta ett pass som började för 7,5 h sedan
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    localStorage.removeItem('arbetstid.reminded');
    arbetstid.clearAll(); arbetstid.setSettings({ configured: true });
    const e = arbetstid.store.events;
    e.push({ id: 'testpass', t: Date.now() - 7.5 * 3600000, type: 'start', data: {} });
    arbetstid.store.save(); arbetstid._changed();
  });
  await page.waitForFunction(() => arbetstid.running);
  // vänta in intervallet (30 s) vore långsamt; trigga via synlighetshändelse
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForSelector('#banner.on', { timeout: 5000 });
  console.log('banner:', await page.textContent('#banner-text'));
  await page.screenshot({ path: '/tmp/shot.png' });
  await page.click('#banner-actions .primary');
  await page.waitForFunction(() => arbetstid.running === false);

  // ljust läge + dator
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'sv-SE', timezoneId: 'Europe/Stockholm', colorScheme: 'light' });
  const p2 = await ctx2.newPage();
  await p2.goto(URL);
  await p2.waitForSelector('#settings[open]');
  await p2.click('#s-save');
  await p2.waitForSelector('.go');
  await p2.screenshot({ path: '/tmp/shot.png' });

  console.log('FEL/VARNINGAR I KONSOLEN:', errors.length ? '\n' + errors.join('\n') : 'inga');
  await browser.close();
  console.log('E2E KLART');
})().catch(e => { console.error('E2E MISSLYCKADES:', e.message); process.exit(1); });
