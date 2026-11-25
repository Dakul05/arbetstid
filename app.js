/*
 * Arbetstid – appskal
 * Kopplar ihop arbetstid-card.js med den lokala motorn (engine.js) och lägger
 * till inställningar, backup, delning av rapport och påminnelse.
 */
(function () {
  "use strict";
  const E = window.ArbetstidEngine;
  const $ = (id) => document.getElementById(id);
  const LS_REMINDED = "arbetstid.reminded";
  const LS_BACKUP = "arbetstid.lastBackup";
  const LS_BACKUP_NAG = "arbetstid.backupNag";

  // ---- ha-card: den enda HA-komponent kortet använder
  if (!customElements.get("ha-card")) {
    customElements.define("ha-card", class extends HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: "open" }).innerHTML =
          "<style>:host{display:block;position:relative;background:var(--card-background-color);color:var(--primary-text-color)}</style><slot></slot>";
      }
    });
  }

  // ---- små hjälpare
  const fmtDur = (min) => {
    const m = Math.max(0, Math.round(min));
    const h = Math.floor(m / 60), r = m % 60;
    return h === 0 ? `${r} min` : r === 0 ? `${h} h` : `${h} h ${r} min`;
  };
  const slug = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "arbetstid";
  const todayStr = () => E.dayKey(new Date());
  let toastTimer;
  function toast(text, ms) {
    const t = $("toast");
    t.textContent = text;
    t.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("on"), ms || 3200);
  }
  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const out = [];
    doc.body.querySelectorAll("h2,p,tr").forEach((n) => {
      if (n.tagName === "TR") out.push([...n.children].map((c) => c.textContent.trim()).filter(Boolean).join("  ·  "));
      else { out.push(n.textContent.trim()); if (n.tagName === "H2") out.push(""); }
    });
    return out.filter((l, i, a) => l || a[i - 1]).join("\n");
  }

  // ---- delning av rapport (ersätter mailtjänsten i HA)
  async function shareReport(subject, html) {
    const text = htmlToText(html);
    if (sync && sync.mailViaScript) {
      try {
        const to = await sync.mail(subject, html, text);
        toast(to ? `Rapporten mejlades till ${to}` : "Rapporten mejlades", 4000);
        return;
      } catch (err) {
        toast("Mejlet gick inte: " + (err && err.message ? err.message : "okänt fel") + ". Delar på vanligt sätt.", 5000);
      }
    }
    const file = new File([html], slug(subject) + ".html", { type: "text/html" });
    if (navigator.share) {
      try {
        const data = { title: subject, text };
        if (navigator.canShare && navigator.canShare({ files: [file] })) data.files = [file];
        await navigator.share(data);
        return;
      } catch (err) {
        if (err && err.name === "AbortError") throw new Error("Avbröts");
        // annars: faller igenom till nedladdning
      }
    }
    download(file, file.name);
    toast("Rapporten sparades som fil i Hämtade filer");
  }

  // ---- motor + kort
  let sync = null; // sätts direkt nedan; shareReport körs först när någon trycker
  const eng = new E.LocalHass({ storage: window.localStorage, shareReport });
  sync = new ArbetstidSync.Sync({ eng, storage: window.localStorage });
  if (eng.store.loadError) toast("Kunde inte läsa sparad data. En kopia har sparats undan.", 6000);

  const card = document.createElement("arbetstid-card");
  $("app").appendChild(card);

  function cardConfig() {
    const s = eng.store.settings;
    return {
      type: "custom:arbetstid-card",
      entity: "sensor.arbetstid",
      title: "Arbetstid",
      leave_calendar: "calendar.ledighet",
      norm_week: s.norm_week,
      work_days: s.work_days,
      holidays: s.holidays,
      eves: s.eves,
      edit_days: s.edit_days,
      default_view: "week",
      generated_by: "Arbetstid-appen",
    };
  }
  card.setConfig(cardConfig());
  card.hass = eng.hass;
  eng.subscribe((h) => { card.hass = h; });
  const refreshLeave = () => { if (card._fetchLeave) card._fetchLeave(); };

  // ---- synk (valfri)
  let syncTimer = null;
  function syncSoon(ms) {
    if (!sync.configured) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(runSync, ms === undefined ? 4000 : ms);
  }
  async function runSync() {
    if (!sync.configured || sync.busy || !navigator.onLine) return;
    const before = eng.store.events.length;
    await sync.run();
    if (eng.store.events.length !== before) refreshLeave();
  }
  eng.subscribe(() => { if (!sync.merging) syncSoon(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) syncSoon(500); });
  window.addEventListener("online", () => syncSoon(500));
  setInterval(() => { if (!document.hidden) syncSoon(0); }, 5 * 60 * 1000);
  setTimeout(() => syncSoon(0), 1200);

  // ---- påminnelse
  function banner(text, buttons) {
    $("banner-text").textContent = text;
    const row = $("banner-actions");
    row.textContent = "";
    buttons.forEach(([label, fn, cls]) => {
      const b = document.createElement("button");
      b.className = "b " + (cls || "");
      b.textContent = label;
      b.addEventListener("click", () => { $("banner").classList.remove("on"); if (fn) fn(); });
      row.appendChild(b);
    });
    $("banner").classList.add("on");
  }

  function notify(title, body) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const opts = { body, tag: "arbetstid", icon: "icon-192.png" };
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then((r) => r.showNotification(title, opts)).catch(() => { try { new Notification(title, opts); } catch (e) { /* ignore */ } });
    } else {
      try { new Notification(title, opts); } catch (e) { /* ignore */ }
    }
  }

  function checkReminders() {
    const s = eng.store.settings;
    if (eng.running && s.reminder_hours > 0 && localStorage.getItem(LS_REMINDED) !== todayStr() && eng.todayMinutes() >= s.reminder_hours * 60) {
      localStorage.setItem(LS_REMINDED, todayStr());
      const msg = `Du har jobbat ${fmtDur(eng.todayMinutes())} idag. Dags att runda av?`;
      banner(msg, [["Senare", null], ["Stoppa nu", () => eng.stop(), "primary"]]);
      if (document.hidden) notify("Arbetstid", msg);
      return;
    }
    // backup-påminnelse, högst en gång i veckan, om det finns data och senaste backup är över 30 dagar
    const now = Date.now();
    const last = Number(localStorage.getItem(LS_BACKUP) || 0);
    const nag = Number(localStorage.getItem(LS_BACKUP_NAG) || 0);
    if (eng.store.events.length > 20 && now - last > 30 * 864e5 && now - nag > 7 * 864e5 && !$("banner").classList.contains("on")) {
      localStorage.setItem(LS_BACKUP_NAG, String(now));
      banner("Dags för en backup? Allt ligger bara på den här enheten.", [["Senare", null], ["Öppna inställningar", () => openSettings(), "primary"]]);
    }
  }
  setInterval(checkReminders, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkReminders(); });

  // ---- inställningar
  const DAY_NAMES = [["1", "mån"], ["2", "tis"], ["3", "ons"], ["4", "tor"], ["5", "fre"], ["6", "lör"], ["0", "sön"]];
  const dlg = $("settings");
  let installEvent = null;

  function parseNorm(txt) {
    const t = String(txt).trim().replace(",", ".");
    let min;
    if (/^\d{1,3}:\d{2}$/.test(t)) { const [h, m] = t.split(":").map(Number); min = h * 60 + m; }
    else if (/^\d{1,3}(\.\d+)?$/.test(t)) min = Math.round(parseFloat(t) * 60);
    else return null;
    if (!(min > 0 && min <= 80 * 60)) return null;
    return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
  }

  function backupInfoText() {
    const last = Number(localStorage.getItem(LS_BACKUP) || 0);
    const when = last ? `Senaste backup: ${new Date(last).toLocaleDateString("sv-SE")}.` : "Ingen backup tagen ännu.";
    return `Allt ligger bara på den här enheten. ${when}`;
  }

  function openSettings() {
    const s = eng.store.settings;
    $("s-norm").value = s.norm_week;
    $("s-days").innerHTML = DAY_NAMES.map(([v, n]) => `<label><input type="checkbox" value="${v}" ${s.work_days.map(String).includes(v) ? "checked" : ""}>${n}</label>`).join("");
    $("s-holidays").checked = !!s.holidays;
    $("s-eves").checked = !!s.eves;
    $("s-edit").value = s.edit_days;
    $("s-rem").value = s.reminder_hours;
    $("welcome").classList.toggle("hide", !!s.configured);
    $("s-adv").classList.toggle("hide", !s.configured); // backup m.m. visas först efter första sparningen
    $("settings-title").textContent = s.configured ? "Inställningar" : "Välkommen till Arbetstid";
    $("backup-info").textContent = backupInfoText();
    $("s-withsettings").checked = !s.configured;
    $("s-share").classList.toggle("hide", !(navigator.canShare && navigator.canShare({ files: [new File(["{}"], "x.json", { type: "application/json" })] })));
    $("s-notif").classList.toggle("hide", !("Notification" in window) || Notification.permission === "granted");
    $("install-row").classList.toggle("hide", !installEvent);
    const persisted = $("about").dataset.persisted;
    $("about").textContent = `Arbetstid ${E.VERSION} · lagring ${persisted === "yes" ? "skyddad av webbläsaren" : "ej särskilt skyddad (ta backup)"} · ${eng.store.events.length} händelser`;
    fillSync();
    if (!dlg.open) dlg.showModal();
  }

  $("gear").addEventListener("click", openSettings);
  $("s-cancel").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });

  $("settings-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const norm = parseNorm($("s-norm").value);
    if (!norm) { toast("Veckoarbetstiden ska skrivas som t.ex. 40:00 eller 37,5"); $("s-norm").focus(); return; }
    const work = [...$("s-days").querySelectorAll("input:checked")].map((i) => Number(i.value));
    if (!work.length) { toast("Välj minst en arbetsdag"); return; }
    const edit = Math.min(14, Math.max(0, Math.round(Number($("s-edit").value) || 0)));
    const rem = Math.min(16, Math.max(0, Number($("s-rem").value) || 0));
    eng.setSettings({ norm_week: norm, work_days: work, holidays: $("s-holidays").checked, eves: $("s-eves").checked, edit_days: edit, reminder_hours: rem, configured: true });
    card.setConfig(cardConfig());
    dlg.close();
    toast("Sparat");
  });

  function syncStatusText() {
    const st = sync.status;
    if (!st.configured) return "Inte ansluten. Allt ligger bara på den här enheten.";
    if (st.busy) return "Synkar…";
    const when = st.last ? `Senast synkad ${new Date(st.last).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })}.` : "Ännu inte synkad.";
    return st.error ? `${when} Fel: ${st.error}` : `Ansluten. ${when}`;
  }
  function fillSync() {
    const st = sync.status;
    $("sy-url").value = st.url || "";
    $("sy-key").value = st.key || "";
    $("sy-mail").checked = !!st.mail;
    $("sy-status").textContent = syncStatusText();
    $("sy-off").classList.toggle("hide", !st.configured);
    $("sy-reset").classList.toggle("hide", !st.configured);
  }
  sync.onChange(() => { if (dlg.open) fillSync(); });
  $("sy-go").addEventListener("click", async () => {
    try { sync.configure($("sy-url").value, $("sy-key").value, $("sy-mail").checked); }
    catch (err) { toast(err.message, 5000); return; }
    fillSync();
    await runSync();
    fillSync();
    toast(sync.status.error ? "Synk: " + sync.status.error : "Synkad", 4000);
  });
  $("sy-reset").addEventListener("click", async () => { sync.refetchAll(); await runSync(); fillSync(); });
  $("sy-off").addEventListener("click", () => {
    if (!confirm("Koppla från synken på den här enheten? Datan finns kvar här och i arket.")) return;
    sync.disconnect();
    fillSync();
    toast("Frånkopplad");
  });

  $("s-notif").addEventListener("click", async () => {
    try {
      const r = await Notification.requestPermission();
      toast(r === "granted" ? "Notiser tillåtna" : "Notiser är inte tillåtna");
      $("s-notif").classList.toggle("hide", r === "granted");
    } catch (err) { toast("Kunde inte be om notistillstånd"); }
  });

  // backup
  const backupName = () => `arbetstid-backup-${todayStr()}.json`;
  const backupBlob = () => new Blob([JSON.stringify(eng.exportData(), null, 1)], { type: "application/json" });
  $("s-export").addEventListener("click", () => {
    download(backupBlob(), backupName());
    localStorage.setItem(LS_BACKUP, String(Date.now()));
    $("backup-info").textContent = backupInfoText();
    toast("Backupen sparades i Hämtade filer");
  });
  $("s-share").addEventListener("click", async () => {
    try {
      await navigator.share({ title: "Arbetstid – backup", files: [new File([backupBlob()], backupName(), { type: "application/json" })] });
      localStorage.setItem(LS_BACKUP, String(Date.now()));
      $("backup-info").textContent = backupInfoText();
    } catch (err) { if (!err || err.name !== "AbortError") toast("Kunde inte dela filen"); }
  });
  $("s-import").addEventListener("click", () => { $("s-file").value = ""; $("s-file").click(); });
  $("s-withsettings-wrap").classList.remove("hide");
  $("s-file").addEventListener("change", async () => {
    const f = $("s-file").files[0];
    if (!f) return;
    try {
      const r = eng.importData(JSON.parse(await f.text()), $("s-withsettings").checked);
      card.setConfig(cardConfig());
      refreshLeave();
      toast(`Läste in ${r.added} nya händelser${r.skipped ? `, ${r.skipped} fanns redan` : ""}${r.invalid ? `, ${r.invalid} ogiltiga hoppades över` : ""}`, 5000);
      $("about").textContent = $("about").textContent.replace(/\d+ händelser/, `${eng.store.events.length} händelser`);
    } catch (err) {
      toast(err && err.message ? err.message : "Kunde inte läsa filen", 5000);
    }
  });

  // import från HA: plocka alla "ÅÅÅÅ-MM-DD": minuter ur texten (JSON eller YAML)
  $("s-ha-go").addEventListener("click", () => {
    const text = $("s-ha").value;
    const map = {};
    for (const m of text.matchAll(/(\d{4}-\d{2}-\d{2})["']?\s*:\s*(-?\d+(?:[.,]\d+)?)/g)) map[m[1]] = Number(m[2].replace(",", "."));
    if (!Object.keys(map).length) { toast("Hittade inga rader som liknar 2026-10-12: 452.5"); return; }
    const r = eng.importDays(map);
    $("s-ha").value = "";
    toast(`Importerade ${r.days} dagar${r.invalid ? `, ${r.invalid} ogiltiga hoppades över` : ""}`, 5000);
  });

  $("s-clear").addEventListener("click", () => {
    if (!confirm("Radera ALL tid och alla inställningar på den här enheten? Det går inte att ångra. Ta en backup först om du är osäker." + (sync.configured ? "\n\nSynken är på: allt som finns i arket hämtas tillbaka vid nästa synk. Koppla från synken först om du vill börja om på riktigt." : ""))) return;
    eng.clearAll();
    localStorage.removeItem(LS_REMINDED);
    card.setConfig(cardConfig());
    refreshLeave();
    dlg.close();
    toast("Allt raderat");
  });

  // installera
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e; });
  window.addEventListener("appinstalled", () => { installEvent = null; });
  $("s-install").addEventListener("click", async () => {
    if (!installEvent) return;
    installEvent.prompt();
    try { await installEvent.userChoice; } catch (e) { /* ignore */ }
    installEvent = null;
    $("install-row").classList.add("hide");
  });

  // ---- lagring som webbläsaren inte rensar av sig själv
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then((ok) => { $("about").dataset.persisted = ok ? "yes" : "no"; }).catch(() => {});
  }

  // ---- offline
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("service worker", err));
  }

  // ---- koppling via länk från arket ("Koppla telefon")
  const linked = ArbetstidSync.parseLink(location.hash);
  if (/synk=/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
  if (linked) {
    setTimeout(async () => {
      const host = new URL(linked.url).host;
      const yes = confirm(`Koppla appen till ditt Google-ark (${host})? Gör det bara om du själv öppnade länken från ditt ark.`);
      if (yes) {
        try {
          sync.configure(linked.url, linked.key, sync.status.mail);
          await runSync();
          toast(sync.status.error ? "Synk: " + sync.status.error : "Kopplad och synkad", 5000);
        } catch (err) { toast(err.message, 5000); }
      }
      if (!eng.store.settings.configured) openSettings(); // ny enhet: ställ in norm och arbetsdagar
    }, 600);
  } else if (/synk=/.test(location.hash)) {
    toast("Länken gick inte att läsa. Hämta en ny i arket.", 5000);
  }

  // ---- första start
  if (!eng.store.settings.configured && !linked) setTimeout(openSettings, 300);
  setTimeout(checkReminders, 1500);

  // för felsökning i konsolen
  window.arbetstid = eng;
})();
