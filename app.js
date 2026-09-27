(() => {
const UNITS = ["kg","g","L","ml","pcs","pack","bottle","box","can","jar","bag","roll","carton","dozen","tray"];
const HALF = new Set(["kg","L"]);
const CACHE = "purchases-cache-v2";
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
const R = 16, C = 2 * Math.PI * R;

function setSave(state, label){ const el = $("#saveState"); el.className = "save-state " + state; el.querySelector("span").textContent = label; }
let toastT; function toast(m){ const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2800); }
function cache(){ try { localStorage.setItem(CACHE, JSON.stringify({CATS, ITEMS, sessions})); } catch(e){} }

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
  catsEl.innerHTML = "";
  byId = Object.fromEntries(ITEMS.map(i => [i.id, i]));
  $("#totalItems").textContent = ITEMS.length; $("#totalCats").textContent = CATS.length;
  CATS.forEach((c, ci) => {
    const its = ITEMS.filter(i => i.cat === c.id);
    const sec = document.createElement("section");
    sec.className = "cat"; sec.style.setProperty("--hue", c.hue); sec.style.animationDelay = (0.15 + ci * 0.05) + "s"; sec.dataset.cid = c.id;
    sec.innerHTML = `<button class="cat-head" type="button" aria-expanded="false">
      <span class="ring"><svg viewBox="0 0 38 38"><circle class="bg" cx="19" cy="19" r="${R}"/><circle class="fg" cx="19" cy="19" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg><span></span></span>
      <span><div class="cat-title">${esc(c.name)}</div><div class="cat-sub"></div></span>
      <span class="cat-count"></span>
      <span class="chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg></span>
    </button><div class="cat-body"><div><ul class="items">${its.map((it, k) => `
      <li class="item" data-id="${esc(it.id)}" style="--i:${k}">
        <button class="item-row" type="button" aria-expanded="false">
          <span class="num">${String(it.no).padStart(2,"0")}</span><span class="name">${esc(it.name)}</span><span class="badge">—</span>
          <span class="tick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4"><path d="m5 12 5 5 9-10"/></svg></span>
        </button>
        <div class="panel"><div><div class="controls">
          <div class="counter"><button class="step" type="button" data-d="-1" aria-label="Decrease">−</button>
          <input class="qty" id="qty-${esc(it.id)}" type="number" min="0" step="any" inputmode="decimal" aria-label="Quantity of ${esc(it.name)}" placeholder="0">
          <button class="step" type="button" data-d="1" aria-label="Increase">+</button></div>
          <select class="unit" id="unit-${esc(it.id)}" aria-label="Unit for ${esc(it.name)}">${UNITS.map(u => `<option>${u}</option>`).join("")}</select>
          <button class="clear" type="button" aria-label="Clear"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        </div></div></div>
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
    sec.classList.toggle("open", open);
    sec.querySelector(".cat-head").setAttribute("aria-expanded", open);
    sec.querySelector(".fg").style.strokeDashoffset = C * (1 - (its.length ? f / its.length : 0));
    sec.querySelector(".ring span").textContent = (its.length ? Math.round(f / its.length * 100) : 0) + "%";
    sec.querySelector(".cat-count").textContent = `${f}/${its.length}`;
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
    const q = li.querySelector(".qty"); if (document.activeElement !== q) q.value = qty ? fmt(qty) : "";
    li.querySelector(".unit").value = unit;
  });
  $("#filledCount").innerHTML = `${filledTotal}<small>/${ITEMS.length}</small>`;
  $("#bar").style.width = (ITEMS.length ? filledTotal / ITEMS.length * 100 : 0) + "%";
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

/* ---------- history: by date + totals ---------- */
function itemRow(id, qtyText){
  const it = byId[id], c = CATS.find(c => c.id === it.cat);
  return `<tr><td><i class="dot" style="--hue:${esc(c ? c.hue : "#E9A93B")}"></i>${esc(it.name)}</td><td>${qtyText}</td></tr>`;
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
  $("#histMeta").textContent = days.length ? `${days.length} ${days.length === 1 ? "day" : "days"} saved` : "Nothing saved yet";
  document.querySelectorAll(".seg button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === histTab));
  if (!days.length){ body.innerHTML = `<p class="hist-empty">Pick items and press <b>Confirm</b>. Each day's list shows up here.</p>`; return; }
  if (histTab === "dates"){
    if (!openDays.size) openDays.add(days[0].day);
    body.innerHTML = days.map(s => { const open = openDays.has(s.day), rows = s.items.filter(r => byId[r.item_id]).sort((a, b) => byId[a.item_id].no - byId[b.item_id].no);
      return `<div class="day${open ? " open" : ""}" data-day="${s.day}">
        <button class="day-head" type="button" aria-expanded="${open}"><span class="day-date">${esc(dayLabel(s.day))}</span><span class="day-n">${rows.length} ${rows.length === 1 ? "item" : "items"}</span>
        <span class="chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg></span></button>
        <div class="day-body"><div><table class="htable"><tbody>${rows.map(r => itemRow(r.item_id, `${fmt(Number(r.qty))} ${esc(r.unit)}`)).join("")}</tbody></table></div></div></div>`; }).join("");
  } else {
    const t = totals();
    body.innerHTML = `<p class="hist-note">All ${days.length} saved ${days.length === 1 ? "day" : "days"} added together.</p>
      <table class="htable totals"><thead><tr><th>Item</th><th>Total</th></tr></thead><tbody>${ITEMS.filter(i => t[i.id]).map(i =>
        itemRow(i.id, Object.entries(t[i.id]).map(([u, q]) => `${fmt(Math.round(q * 100) / 100)} ${esc(u)}`).join(" + "))).join("")}</tbody></table>`;
  }
}
$("#history").addEventListener("click", e => {
  const tab = e.target.closest(".seg button");
  if (tab){ histTab = tab.dataset.tab; renderHistory(); return; }
  const head = e.target.closest(".day-head");
  if (head){ const d = head.parentElement.dataset.day; openDays.has(d) ? openDays.delete(d) : openDays.add(d);
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
  if (!sb){ toast("You're offline. Connect and try again."); return; }
  const day = dayKey(), items = picks();
  saving = true; render(); setSave("saving", "Saving");
  const { error } = await sb.from("purchases_sessions").upsert({ day, items });
  saving = false;
  if (error){ setSave("", "Not saved"); render(); toast("Couldn't save. Check your connection and try again."); return; }
  const i = sessions.findIndex(s => s.day === day);
  if (i >= 0) sessions[i].items = items; else sessions.unshift({ day, items });
  openDays.clear(); openDays.add(day); histTab = "dates";
  cache(); setSave("saved", "Saved"); render(); renderHistory();
  toast(items.length ? `Saved ${items.length} ${items.length === 1 ? "item" : "items"} for today.` : "Today's list cleared.");
  if (navigator.vibrate) navigator.vibrate(12);
};

/* ---------- admin reset (passcode checked in the database) ---------- */
const dlg = $("#resetDlg");
$("#resetBtn").onclick = () => { $("#resetErr").textContent = ""; $("#passcode").value = ""; dlg.showModal(); };
$("#resetCancel").onclick = () => dlg.close();
$("#resetForm").addEventListener("submit", async e => {
  e.preventDefault();
  const code = $("#passcode").value.trim(), go = $("#resetGo");
  if (!code){ $("#resetErr").textContent = "Enter the passcode."; return; }
  if (!sb){ $("#resetErr").textContent = "You're offline."; return; }
  go.disabled = true; $("#resetErr").textContent = "";
  const { data, error } = await sb.rpc("purchases_reset_history", { passcode: code });
  go.disabled = false;
  if (error){ $("#resetErr").textContent = /locked/.test(error.message) ? "Too many wrong tries. Wait 15 minutes." : "Couldn't reset. Check your connection."; return; }
  if (data < 0){ $("#resetErr").textContent = "Wrong passcode."; $("#passcode").select(); return; }
  sessions = []; stock = {}; openDays.clear(); cache(); render(); renderHistory(); dlg.close();
  toast("History reset.");
});

/* ---------- interactions ---------- */
catsEl.addEventListener("click", e => {
  const head = e.target.closest(".cat-head");
  if (head){ const cid = +head.parentElement.dataset.cid; openCats.has(cid) ? openCats.delete(cid) : openCats.add(cid); render(); return; }
  const li = e.target.closest(".item"); if (!li) return; const id = li.dataset.id;
  if (e.target.closest(".item-row")){ selected = selected === id ? null : id; render();
    if (selected && matchMedia("(pointer:fine)").matches) setTimeout(() => li.querySelector(".qty").focus({preventScroll:true}), 250); return; }
  const st = e.target.closest(".step");
  if (st){ const cur = stock[id] || { qty: 0, unit: byId[id].unit }; const inc = HALF.has(cur.unit) ? 0.5 : 1;
    setItem(id, (cur.qty || 0) + inc * (+st.dataset.d), cur.unit);
    const q = li.querySelector(".qty"); q.value = stock[id].qty ? fmt(stock[id].qty) : ""; q.classList.remove("bump"); void q.offsetWidth; q.classList.add("bump");
    if (navigator.vibrate) navigator.vibrate(8); return; }
  if (e.target.closest(".clear")){ setItem(id, 0, byId[id].unit); return; }
});
catsEl.addEventListener("input", e => {
  if (e.target.classList.contains("qty")){ const id = e.target.closest(".item").dataset.id; setItem(id, e.target.value, (stock[id] || {}).unit); }
});
catsEl.addEventListener("change", e => {
  if (e.target.classList.contains("unit")){ const id = e.target.closest(".item").dataset.id; setItem(id, (stock[id] || {}).qty || 0, e.target.value); }
});
catsEl.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.classList.contains("qty")) e.target.blur(); });
$("#toggleAll").onclick = () => {
  const all = openCats.size === CATS.length; openCats.clear(); if (!all) CATS.forEach(c => openCats.add(c.id));
  $("#toggleAll .blbl").textContent = all ? "Open all" : "Close all";
  $("#toggleAll").setAttribute("aria-label", all ? "Open all categories" : "Close all categories"); render();
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
$("#exportBtn").onclick = () => {
  const q = v => `"${String(v).replace(/"/g,'""')}"`;
  const rows = [["Date","No.","Category","Item","Qty","Unit"]];
  sessions.slice().reverse().forEach(s => s.items.filter(r => byId[r.item_id]).sort((a, b) => byId[a.item_id].no - byId[b.item_id].no).forEach(r => {
    const it = byId[r.item_id], c = CATS.find(c => c.id === it.cat); rows.push([s.day, it.no, c ? c.name : "", it.name, fmt(Number(r.qty)), r.unit]); }));
  if (rows.length === 1){ toast("Nothing saved yet to export."); return; }
  const blob = new Blob(["﻿" + rows.map(r => r.map(q).join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "Purchases History.csv";
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast("Exported. Open the CSV in Numbers.");
};

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
  sessions = r.data; if (!wasDirty) loadToday();   // don't wipe picks that aren't confirmed yet
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
  if (!built || prevKey !== JSON.stringify(ITEMS.map(i => [i.id, i.name, i.cat]))) build();
  if (!wasDirty) loadToday();
  render(); renderHistory(); cache(); setSave("saved", "Synced");
  sb.channel("purchases-sessions").on("postgres_changes", { event: "*", schema: "public", table: "purchases_sessions" }, () => { if (!saving) refreshSessions(); }).subscribe();
}
load();
})();
