(() => {
const UNITS = ["kg","g","L","ml","pcs","pack","bottle","box","can","jar","bag","roll","carton","dozen","tray"];
const HALF = new Set(["kg","L"]), FIFTY = new Set(["g","ml"]);
const CACHE = "purchases-cache-v2", SOUND_KEY = "purchases-sound";
const $ = s => document.querySelector(s);
const fmt = q => Number.isInteger(q) ? String(q) : q.toFixed(2).replace(/0+$/,"").replace(/\.$/,"");
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

const cfg = window.PURCHASES_CONFIG || {};
const sb = window.supabase && cfg.supabaseUrl ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey) : null;

/* stock = today's picks (the draft). sessions = confirmed days, newest first: [{day, items:[{item_id,qty,unit}]}] */
let CATS = [], ITEMS = [], byId = {}, stock = {}, sessions = [];
const openCats = new Set(), openDays = new Set();
let selected = null, built = false, histTab = "dates", saving = false;
const catsEl = $("#cats");

/* ---------- feedback: iOS haptic tick + soft click sound ---------- */
const fb = (() => {
  let sw, ac, noise, lastHaptic = 0;
  let soundOn = true; try { soundOn = localStorage.getItem(SOUND_KEY) !== "off"; } catch(e){}
  // iOS Safari has no vibrate(); toggling a hidden <input switch> fires the system haptic (iOS 18+).
  function haptic(){
    const now = performance.now(); if (now - lastHaptic < 28) return; lastHaptic = now;
    if (navigator.vibrate){ if (!navigator.userActivation || navigator.userActivation.hasBeenActive) try { navigator.vibrate(6); } catch(e){} return; }
    if (!sw){ sw = document.createElement("label"); sw.setAttribute("aria-hidden", "true"); sw.style.display = "none";
      const i = document.createElement("input"); i.type = "checkbox"; i.setAttribute("switch", ""); i.tabIndex = -1; sw.appendChild(i); document.head.appendChild(sw); }
    sw.click();
  }
  function unlock(){
    if (!ac){ try {
      if (navigator.audioSession) navigator.audioSession.type = "ambient";   // respect the silent switch, don't stop music
      ac = new (window.AudioContext || window.webkitAudioContext)();
      noise = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.03), ac.sampleRate);
      const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (d.length / 7));
    } catch(e){ ac = null; } }
    if (ac && ac.state === "suspended") ac.resume();
  }
  function click(freq, vol, delay){
    if (!soundOn || !ac || ac.state !== "running") return;
    const t = ac.currentTime + (delay || 0), src = ac.createBufferSource(), bp = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = noise; bp.type = "bandpass"; bp.frequency.value = freq; bp.Q.value = 1.4; g.gain.setValueAtTime(vol, t);
    src.connect(bp); bp.connect(g); g.connect(ac.destination); src.start(t);
  }
  ["pointerdown", "touchend", "click", "keydown"].forEach(ev => window.addEventListener(ev, unlock, { passive: true, capture: true }));
  const api = {
    tick(){ haptic(); click(3600, 0.22); },           // wheel notch
    tap(){ haptic(); click(2400, 0.35); },            // buttons, rows
    success(){ haptic(); click(2600, 0.4); setTimeout(haptic, 110); click(3800, 0.35, 0.11); },
    error(){ haptic(); setTimeout(haptic, 90); setTimeout(haptic, 180); click(900, 0.4); },
    get sound(){ return soundOn; },
    set sound(v){ soundOn = v; try { localStorage.setItem(SOUND_KEY, v ? "on" : "off"); } catch(e){} }
  };
  return api;
})();

function setSave(state, label){ const el = $("#saveState"); el.className = "save-state " + state; el.querySelector("span").textContent = label; }
let toastT; function toast(m){ const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2800); }
function cache(){ try { localStorage.setItem(CACHE, JSON.stringify({CATS, ITEMS, sessions})); } catch(e){} }
const chev = `<span class="chev" aria-hidden="true"><i></i><i></i></span>`;
const hueOf = id => { const c = CATS.find(c => c.id === id); return c ? c.hue : "#0071E3"; };

/* ---------- dates (device-local calendar day) ---------- */
const pad = n => String(n).padStart(2, "0");
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
function longDate(k){ const d = parseDay(k);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }); }
function dayLabel(k){
  const y = new Date(); y.setDate(y.getDate() - 1);
  return k === dayKey() ? `Today · ${longDate(k)}` : k === dayKey(y) ? `Yesterday · ${longDate(k)}` : longDate(k);
}
const todaySession = () => sessions.find(s => s.day === dayKey());
const picks = () => ITEMS.filter(i => stock[i.id] && stock[i.id].qty > 0).map(i => ({ item_id: i.id, qty: stock[i.id].qty, unit: stock[i.id].unit }));
const sig = list => JSON.stringify((list || []).map(r => [r.item_id, Number(r.qty), r.unit]).sort((a, b) => a[0] < b[0] ? -1 : 1));
const isDirty = () => sig(picks()) !== sig(todaySession() ? todaySession().items : []);
function loadToday(){ stock = {}; const t = todaySession(); if (t) t.items.forEach(r => { stock[r.item_id] = { qty: Number(r.qty), unit: r.unit }; }); }

/* ---------- build ---------- */
function build(){
  catsEl.innerHTML = ""; picker = null;
  byId = Object.fromEntries(ITEMS.map(i => [i.id, i]));
  $("#totalItems").textContent = ITEMS.length; $("#totalCats").textContent = CATS.length;
  CATS.forEach(c => {
    const its = ITEMS.filter(i => i.cat === c.id);
    const sec = document.createElement("section");
    sec.className = "cat"; sec.style.setProperty("--hue", c.hue); sec.dataset.cid = c.id;
    sec.innerHTML = `<button class="cat-head" type="button" aria-expanded="false">
      <i class="dot"></i><span><div class="cat-title">${esc(c.name)}</div><div class="cat-sub"></div></span>
      <span class="cat-count"></span>${chev}
    </button><div class="cat-body"><div><ul class="items">${its.map((it, k) => `
      <li class="item" data-id="${esc(it.id)}" style="--i:${k}">
        <button class="item-row" type="button" aria-expanded="false">
          <span class="num">${String(it.no).padStart(2,"0")}</span><span class="name">${esc(it.name)}</span><span class="badge">—</span>
          <span class="tick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span>
        </button>
        <div class="panel"><div class="picker-slot"></div></div>
      </li>`).join("")}</ul></div></div>`;
    catsEl.appendChild(sec);
  });
  built = true;
}

/* ---------- render ---------- */
function render(changed){
  if (!built) return;
  let filledTotal = 0;
  CATS.forEach(c => {
    const sec = catsEl.querySelector(`.cat[data-cid="${c.id}"]`); if (!sec) return;
    const its = ITEMS.filter(i => i.cat === c.id);
    const f = its.filter(i => stock[i.id] && stock[i.id].qty > 0).length; filledTotal += f;
    const open = openCats.has(c.id);
    sec.classList.toggle("open", open); sec.classList.toggle("has", f > 0);
    sec.querySelector(".cat-head").setAttribute("aria-expanded", open);
    sec.querySelector(".cat-count").textContent = f ? `${f} of ${its.length}` : `${its.length}`;
    sec.querySelector(".cat-sub").textContent = (c.sub ? c.sub + " · " : "") + its.length + (its.length === 1 ? " item" : " items");
  });
  ITEMS.forEach(it => {
    const li = catsEl.querySelector(`.item[data-id="${it.id}"]`); if (!li) return;
    const s = stock[it.id]; const qty = s ? s.qty : 0, unit = (s && s.unit) || it.unit;
    li.classList.toggle("filled", qty > 0); li.classList.toggle("sel", selected === it.id);
    li.querySelector(".item-row").setAttribute("aria-expanded", selected === it.id);
    const b = li.querySelector(".badge"); const txt = qty > 0 ? `${fmt(qty)} ${unit}` : "—";
    if (b.textContent !== txt){ b.textContent = txt; if (changed && changed.has(it.id)){ b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); } }
    b.classList.toggle("has", qty > 0);
  });
  $("#filledCount").textContent = `${filledTotal} of ${ITEMS.length}`;
  $("#todayLbl").textContent = longDate(dayKey());
  renderConfirm(filledTotal);
}

function renderConfirm(n){
  const bar = $("#confirmBar"), btn = $("#confirmBtn"), t = todaySession(), dirty = isDirty();
  $("#confirmCount").textContent = n === 1 ? "1 item picked" : `${n} items picked`;
  $("#confirmHint").textContent = !dirty && t ? "Saved for today" : t ? "Confirm to replace today's list" : `For today · ${longDate(dayKey())}`;
  btn.disabled = saving || !dirty || (!t && n === 0);
  btn.querySelector("span").textContent = saving ? "Saving…" : !dirty && t ? "Saved" : "Confirm";
  bar.classList.toggle("done", !dirty && !!t);
  bar.classList.toggle("show", n > 0 || !!t);
  document.body.classList.toggle("has-bar", n > 0 || !!t);
}

/* ---------- iOS-style wheel picker (quantity + unit) ---------- */
const ROW = 36;
const unitClass = u => HALF.has(u) ? "half" : FIFTY.has(u) ? "fifty" : "one";
function qtyValues(u){ const a = [], c = unitClass(u);
  for (let i = 0; i <= (c === "half" ? 200 : 100); i++) a.push(c === "half" ? i / 2 : c === "fifty" ? i * 50 : i); return a; }
const nearest = (arr, v) => arr.reduce((b, x, i) => Math.abs(x - v) < Math.abs(arr[b] - v) ? i : b, 0);
let picker = null;   // { id, li, qty: wheel, unit: wheel }

function fillWheel(w, values, labels, idx){
  w.values = values; w.idx = idx; w.painted = [];
  w.el.innerHTML = `<div class="wheel-pad"></div>${labels.map((l, i) => `<div class="opt" role="option" data-i="${i}">${esc(l)}</div>`).join("")}<div class="wheel-pad"></div>`;
  w.el.scrollTop = idx * ROW; paint(w);
}
function paint(w){
  const c = w.el.scrollTop / ROW, from = Math.max(0, Math.floor(c) - 3), to = Math.min(w.values.length - 1, Math.ceil(c) + 3);
  w.painted.forEach(o => { const i = +o.dataset.i; if (i < from || i > to){ o.style.transform = ""; o.style.opacity = ""; o.classList.remove("on"); } });
  w.painted = [];
  for (let i = from; i <= to; i++){
    const o = w.el.children[i + 1], d = i - c;
    o.style.transform = `rotateX(${(-d * 20).toFixed(2)}deg)`; o.style.opacity = (1 - Math.min(Math.abs(d), 3) * 0.28).toFixed(2);
    o.classList.toggle("on", Math.round(c) === i); o.setAttribute("aria-selected", Math.round(c) === i); w.painted.push(o);
  }
}
function onWheel(w){
  if (w.raf) return;
  w.raf = requestAnimationFrame(() => {
    w.raf = 0; if (!picker || (w !== picker.qty && w !== picker.unit)) return; paint(w);
    const idx = Math.max(0, Math.min(w.values.length - 1, Math.round(w.el.scrollTop / ROW)));
    if (idx === w.idx) return;
    w.idx = idx; fb.tick();
    if (w === picker.qty) setItem(picker.id, w.values[idx], picker.unit.values[picker.unit.idx]);
    else changeUnit(w.values[idx]);
  });
}
function changeUnit(u){
  const id = picker.id, cur = stock[id] || { qty: 0, unit: byId[id].unit };
  let q = cur.qty;
  if (unitClass(u) !== unitClass(cur.unit)){
    const vals = qtyValues(u); let i = vals.indexOf(q); if (i < 0) i = q > 0 ? 1 : 0;
    q = vals[i]; fillWheel(picker.qty, vals, vals.map(fmt), i);
  }
  setItem(id, q, u);
}
function mountPicker(li){
  const id = li.dataset.id, s = stock[id] || { qty: 0, unit: byId[id].unit };
  if (picker && picker.li !== li){ const old = picker.li.querySelector(".picker-slot"); setTimeout(() => { if (!picker || picker.li !== old.closest(".item")) old.innerHTML = ""; }, 500); }
  const slot = li.querySelector(".picker-slot");
  slot.innerHTML = `<div class="picker"><div class="band"></div><div class="wheel" role="listbox" aria-label="Quantity"></div><div class="wheel" role="listbox" aria-label="Unit"></div></div>
    <div class="picker-foot"><button class="linkbtn clear" type="button">Clear</button><button class="linkbtn done" type="button">Done</button></div>`;
  const [qEl, uEl] = slot.querySelectorAll(".wheel");
  picker = { id, li, qty: { el: qEl }, unit: { el: uEl } };
  const vals = qtyValues(s.unit);
  fillWheel(picker.unit, UNITS, UNITS, Math.max(0, UNITS.indexOf(s.unit)));
  fillWheel(picker.qty, vals, vals.map(fmt), nearest(vals, s.qty));
  [picker.qty, picker.unit].forEach(w => {
    w.el.addEventListener("scroll", () => onWheel(w), { passive: true });
    w.el.addEventListener("click", e => { const o = e.target.closest(".opt"); if (o) w.el.scrollTo({ top: +o.dataset.i * ROW, behavior: "smooth" }); });
  });
}
function selectItem(id){
  selected = selected === id ? null : id;
  const li = id && catsEl.querySelector(`.item[data-id="${id}"]`);
  if (selected) mountPicker(li); else picker = null;
  render();
  if (selected) setTimeout(() => { const r = li.getBoundingClientRect(); if (r.bottom + 260 > innerHeight) li.scrollIntoView({ block: "center", behavior: "smooth" }); }, 120);
}

/* ---------- history: by date + totals ---------- */
function itemRow(id, qtyText){
  return `<tr><td><i class="dot" style="--hue:${esc(hueOf(byId[id].cat))}"></i>${esc(byId[id].name)}</td><td>${qtyText}</td></tr>`;
}
function totals(){
  // item_id -> unit -> sum. Different units for the same item stay separate (2 kg + 500 g).
  const t = {};
  sessions.forEach(s => s.items.forEach(r => { if (!byId[r.item_id]) return; const u = (t[r.item_id] = t[r.item_id] || {}); u[r.unit] = (u[r.unit] || 0) + Number(r.qty); }));
  return t;
}
function renderHistory(){
  if (!built) return;
  const body = $("#histBody"), days = sessions.filter(s => s.items.length);
  $("#histMeta").textContent = days.length ? `${days.length} ${days.length === 1 ? "day" : "days"} saved.` : "Nothing saved yet.";
  $(".seg").dataset.sel = histTab;
  document.querySelectorAll(".seg button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === histTab));
  if (!days.length){ body.innerHTML = `<p class="hist-empty">Pick items and press <b>Confirm</b>.<br>Each day's list shows up here.</p>`; return; }
  if (histTab === "dates"){
    if (!openDays.size) openDays.add(days[0].day);
    body.innerHTML = days.map(s => { const open = openDays.has(s.day), rows = s.items.filter(r => byId[r.item_id]).sort((a, b) => byId[a.item_id].no - byId[b.item_id].no);
      return `<div class="day${open ? " open" : ""}" data-day="${s.day}">
        <button class="day-head" type="button" aria-expanded="${open}"><span class="day-date">${esc(dayLabel(s.day))}</span><span class="day-n">${rows.length} ${rows.length === 1 ? "item" : "items"}</span>${chev}</button>
        <div class="day-body"><div><table class="htable"><tbody>${rows.map(r => itemRow(r.item_id, `${fmt(Number(r.qty))} ${esc(r.unit)}`)).join("")}</tbody></table></div></div></div>`; }).join("");
  } else {
    const t = totals();
    body.innerHTML = `<p class="hist-note">All ${days.length} saved ${days.length === 1 ? "day" : "days"} added together.</p>
      <table class="htable totals"><thead><tr><th>Item</th><th>Total</th></tr></thead><tbody>${ITEMS.filter(i => t[i.id]).map(i =>
        itemRow(i.id, Object.entries(t[i.id]).map(([u, q]) => `${fmt(Math.round(q * 100) / 100)} ${esc(u)}`).join(" + "))).join("")}</tbody></table>`;
  }
}
function setTab(tab){ if (histTab === tab) return; histTab = tab; renderHistory(); }
$("#history").addEventListener("click", e => {
  const tab = e.target.closest(".seg button");
  if (tab){ if (tab.dataset.tab !== histTab) fb.tap(); setTab(tab.dataset.tab); return; }
  const head = e.target.closest(".day-head");
  if (head){ const d = head.parentElement.dataset.day; openDays.has(d) ? openDays.delete(d) : openDays.add(d); fb.tap();
    head.parentElement.classList.toggle("open", openDays.has(d)); head.setAttribute("aria-expanded", openDays.has(d)); }
});

/* ---------- editing today's picks ---------- */
function setItem(id, qty, unit){
  qty = Math.max(0, Math.min(100000, Math.round((Number(qty) || 0) * 100) / 100));
  const cur = stock[id] || {}; unit = unit || cur.unit || byId[id].unit;
  stock[id] = { qty, unit };
  render(new Set([id]));
}

/* ---------- confirm: save today's list (replaces today's row) ---------- */
$("#confirmBtn").onclick = async () => {
  if (!sb){ fb.error(); toast("You're offline. Connect and try again."); return; }
  fb.tap();
  const day = dayKey(), items = picks();
  saving = true; render(); setSave("saving", "Saving");
  const { error } = await sb.from("purchases_sessions").upsert({ day, items });
  saving = false;
  if (error){ setSave("", "Not saved"); render(); fb.error(); toast("Couldn't save. Check your connection and try again."); return; }
  const i = sessions.findIndex(s => s.day === day);
  if (i >= 0) sessions[i].items = items; else sessions.unshift({ day, items });
  openDays.clear(); openDays.add(day); histTab = "dates";
  cache(); setSave("saved", "Saved"); render(); renderHistory(); fb.success();
  toast(items.length ? `Saved ${items.length} ${items.length === 1 ? "item" : "items"} for today.` : "Today's list cleared.");
};

/* ---------- admin reset (passcode checked in the database) ---------- */
const dlg = $("#resetDlg");
function openReset(){ $("#resetErr").textContent = ""; $("#passcode").value = ""; dlg.showModal(); }
$("#resetBtn").onclick = () => { fb.tap(); openReset(); };
$("#resetCancel").onclick = () => { fb.tap(); dlg.close(); };
$("#resetForm").addEventListener("submit", async e => {
  e.preventDefault();
  const code = $("#passcode").value.trim(), go = $("#resetGo");
  if (!code){ fb.error(); $("#resetErr").textContent = "Enter the passcode."; return; }
  if (!sb){ fb.error(); $("#resetErr").textContent = "You're offline."; return; }
  fb.tap(); go.disabled = true; $("#resetErr").textContent = "";
  const { data, error } = await sb.rpc("purchases_reset_history", { passcode: code });
  go.disabled = false;
  if (error){ fb.error(); $("#resetErr").textContent = /locked/.test(error.message) ? "Too many wrong tries. Wait 15 minutes." : "Couldn't reset. Check your connection."; return; }
  if (data < 0){ fb.error(); $("#resetErr").textContent = "Wrong passcode."; $("#passcode").select(); return; }
  sessions = []; stock = {}; openDays.clear(); if (selected) selectItem(selected); cache(); render(); renderHistory(); dlg.close();
  fb.success(); toast("History reset.");
});

/* ---------- menu (drops from the nav bar) ---------- */
const menu = $("#menu");
menu.querySelectorAll("li").forEach((li, k) => li.style.setProperty("--k", k));
function setMenu(open){
  document.body.classList.toggle("menu-open", open); document.body.classList.toggle("lock", open);
  $("#menuBtn").setAttribute("aria-expanded", open); $("#menuBtn").setAttribute("aria-label", open ? "Close menu" : "Open menu");
  menu.setAttribute("aria-hidden", !open); menu.inert = !open;
}
const menuOpen = () => document.body.classList.contains("menu-open");
function soundLabel(){ $("#soundLbl").textContent = `Sound: ${fb.sound ? "On" : "Off"}`; $('[data-go="sound"]').classList.toggle("muted", !fb.sound); }
soundLabel();
$("#menuBtn").onclick = () => { fb.tap(); setMenu(!menuOpen()); };
document.addEventListener("keydown", e => { if (e.key === "Escape" && menuOpen()) setMenu(false); });
const go = id => document.getElementById(id).scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
menu.addEventListener("click", e => {
  const b = e.target.closest("[data-go]"); if (!b) return; const g = b.dataset.go;
  if (g === "sound"){ fb.sound = !fb.sound; soundLabel(); fb.tap(); return; }
  fb.tap(); setMenu(false);
  setTimeout(() => {
    if (g === "history" || g === "totals"){ setTab(g === "totals" ? "totals" : "dates"); go("history"); }
    else if (g === "cats") go("catsBlock");
    else if (g === "export") exportCsv();
    else if (g === "reset") openReset();
  }, 280);
});
$("#searchBtn").onclick = () => { fb.tap(); go("catsBlock"); setTimeout(() => $("#search").focus({ preventScroll: true }), 350); };
$("#startBtn").onclick = () => { fb.tap(); go("catsBlock"); };
$("#histBtn").onclick = () => { fb.tap(); go("history"); };

/* ---------- interactions ---------- */
catsEl.addEventListener("click", e => {
  const head = e.target.closest(".cat-head");
  if (head){ const cid = +head.parentElement.dataset.cid; openCats.has(cid) ? openCats.delete(cid) : openCats.add(cid); fb.tap(); render(); return; }
  const li = e.target.closest(".item"); if (!li) return; const id = li.dataset.id;
  if (e.target.closest(".item-row")){ fb.tap(); selectItem(id); return; }
  if (e.target.closest(".clear") && picker){
    fb.tap(); setItem(id, 0, byId[id].unit);
    const vals = qtyValues(byId[id].unit);
    fillWheel(picker.unit, UNITS, UNITS, Math.max(0, UNITS.indexOf(byId[id].unit))); fillWheel(picker.qty, vals, vals.map(fmt), 0); return; }
  if (e.target.closest(".done")){ fb.tap(); selectItem(id); return; }
});
$("#toggleAll").onclick = () => {
  const all = openCats.size === CATS.length; openCats.clear(); if (!all) CATS.forEach(c => openCats.add(c.id));
  $("#toggleAll").textContent = all ? "Open all" : "Close all";
  $("#toggleAll").setAttribute("aria-label", all ? "Open all categories" : "Close all categories"); fb.tap(); render();
};
$("#search").addEventListener("input", e => {
  const q = e.target.value.trim().toLowerCase(); let any = false;
  CATS.forEach(c => {
    const sec = catsEl.querySelector(`.cat[data-cid="${c.id}"]`); let hits = 0;
    sec.querySelectorAll(".item").forEach(li => { const m = !q || byId[li.dataset.id].name.toLowerCase().includes(q); li.hidden = !m; if (m) hits++; });
    sec.hidden = !!q && hits === 0 && !c.name.toLowerCase().includes(q);
    if (q && hits) openCats.add(c.id); if (!sec.hidden) any = true;
  });
  let em = $("#emptyMsg");
  if (!any){ if (!em){ em = document.createElement("div"); em.id = "emptyMsg"; em.className = "empty"; catsEl.appendChild(em); } em.textContent = `No item matches "${e.target.value}".`; }
  else if (em) em.remove();
  render();
});
function exportCsv(){
  const q = v => `"${String(v).replace(/"/g,'""')}"`;
  const rows = [["Date","No.","Category","Item","Qty","Unit"]];
  sessions.slice().reverse().forEach(s => s.items.filter(r => byId[r.item_id]).sort((a, b) => byId[a.item_id].no - byId[b.item_id].no).forEach(r => {
    const it = byId[r.item_id], c = CATS.find(c => c.id === it.cat); rows.push([s.day, it.no, c ? c.name : "", it.name, fmt(Number(r.qty)), r.unit]); }));
  if (rows.length === 1){ toast("Nothing saved yet to export."); return; }
  const blob = new Blob(["﻿" + rows.map(r => r.map(q).join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "Purchases History.csv";
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast("Exported. Open the CSV in Numbers.");
}

/* ---------- load ---------- */
function apply(cats, items){
  CATS = cats.map(c => ({ id: c.id, name: c.name, sub: c.sub, hue: c.hue }));
  let n = 0; ITEMS = [];
  CATS.forEach(c => items.filter(i => i.category_id === c.id).sort((a, b) => a.sort - b.sort)
    .forEach(i => ITEMS.push({ id: i.id, name: i.name, unit: i.default_unit, cat: c.id, no: ++n })));
}
const fetchSessions = () => sb.from("purchases_sessions").select("day,items").order("day", { ascending: false });
async function refreshSessions(){
  const wasDirty = isDirty(), r = await fetchSessions(); if (r.error) return;
  sessions = r.data;
  if (!wasDirty){ loadToday(); if (selected) mountPicker(catsEl.querySelector(`.item[data-id="${selected}"]`)); }   // don't wipe picks that aren't confirmed yet
  cache(); render(); renderHistory();
}
async function load(){
  try { const c = JSON.parse(localStorage.getItem(CACHE) || "null");
    if (c && c.CATS && c.CATS.length){ CATS = c.CATS; ITEMS = c.ITEMS; sessions = c.sessions || []; build(); loadToday(); render(); renderHistory(); } } catch(e){}
  if (!sb){ setSave("", "Offline"); return; }
  const [cr, ir, hr] = await Promise.all([
    sb.from("purchases_categories").select("id,name,sub,hue,sort").order("sort"),
    sb.from("purchases_items").select("id,name,category_id,default_unit,sort").order("sort"),
    fetchSessions()
  ]);
  if (cr.error || ir.error || hr.error){ setSave("", "Offline"); if (!built) catsEl.innerHTML = `<div class="empty">Couldn't load your list. Check your connection and reload.</div>`; return; }
  const prevKey = JSON.stringify(ITEMS.map(i => [i.id, i.name, i.cat])), wasDirty = built && isDirty();
  apply(cr.data, ir.data); sessions = hr.data;
  if (!built || prevKey !== JSON.stringify(ITEMS.map(i => [i.id, i.name, i.cat]))){ build(); selected = null; }
  if (!wasDirty) loadToday();
  render(); renderHistory(); cache(); setSave("saved", "Synced");
  sb.channel("purchases-sessions").on("postgres_changes", { event: "*", schema: "public", table: "purchases_sessions" }, () => { if (!saving) refreshSessions(); }).subscribe();
}
load();
})();
