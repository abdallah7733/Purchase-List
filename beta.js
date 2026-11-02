/* Buying guide (Beta): usual monthly amount from supermarket receipts, compared with what's at home.
   Usual = everything bought of an item on the receipts / number of months the receipts cover (or a hand-set amount).
   Have  = the item's latest count in the main list (Beta-only items keep their own count).
   Buy   = Usual - Have, never below 0.
   Only shown on the Beta profile (name "Abdallah"), or on a device opened once with ?beta=1 (?beta=0 hides it). */
(() => {
const A = window.PurchasesApp; if (!A) return;
const { esc, fmt, fb, toast } = A;
const $ = s => document.querySelector(s);
const FLAG = "purchases-beta", TICKS = "purchases-beta-ticks";

/* ---------- who sees it ---------- */
try {
  const p = new URLSearchParams(location.search), v = p.get("beta");
  if (v === "1" || v === "0"){ localStorage.setItem(FLAG, v); p.delete("beta"); history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : "") + location.hash); }
} catch(e){}
const flag = () => { try { return localStorage.getItem(FLAG); } catch(e){ return null; } };
const allowed = () => { const f = flag(); if (f === "1") return true; if (f === "0") return false; const p = A.myProfile(); return !!(p && /^\s*abdallah\s*$/i.test(p.name)); };
const menuLi = $("#betaMenu");
const gate = () => { if (menuLi) menuLi.hidden = !allowed(); };
document.addEventListener("purchases:me", gate); gate();

/* ---------- sheet ---------- */
const dlg = document.createElement("dialog");
dlg.className = "dlg sheet shop bg"; dlg.id = "betaDlg"; dlg.setAttribute("aria-labelledby", "bgTitle");
dlg.innerHTML = `<div class="shop-head">
    <button class="linkbtn arch-back" id="bgBack" type="button" hidden><span aria-hidden="true">‹</span>All receipts</button>
    <p class="eyebrow">Buying guide <em class="tag">Beta</em></p>
    <h2 id="bgTitle">What to buy.</h2>
    <p class="shop-meta" id="bgMeta"></p>
    <div class="seg bg-seg" role="tablist" aria-label="Buying guide view" data-sel="guide">
      <button type="button" role="tab" data-tab="guide" aria-selected="true">Guide</button>
      <button type="button" role="tab" data-tab="receipts" aria-selected="false">Receipts</button>
    </div>
  </div>
  <div class="shop-body" id="bgBody"></div>
  <div class="shop-foot">
    <button class="linkbtn shop-clear" id="bgClear" type="button" hidden>Clear ticks</button>
    <div class="dlg-btns"><button class="pill primary" id="bgDone" type="button">Done</button></div>
  </div>`;
document.body.appendChild(dlg);

let ok = null, receipts = [], lines = [], betaItems = [], usualSet = {}, betaStock = {};
let tab = "guide", receiptView = null, openRow = null, showOther = false, busy = false;

async function fetchAllRows(make){   // page past the API's 1000-row cap
  const out = []; for (let from = 0; ; from += 1000){
    const r = await make().range(from, from + 999); if (r.error) return r;
    out.push(...r.data); if (r.data.length < 1000) return { data: out };
  }
}
async function refresh(){
  if (!A.sb){ ok = false; if (dlg.open) render(); return; }
  const sb = A.sb;
  const [r, l, b, u, s] = await Promise.all([
    sb.from("purchases_receipts").select("id,store,branch,bought_on,bought_time,total,paid,pieces").order("bought_on", { ascending: false }).order("id", { ascending: false }),
    fetchAllRows(() => sb.from("purchases_receipt_lines").select("receipt_id,line_no,name_ar,name_en,qty,qty_unit,line_total,discount,item_key,app_qty,app_unit,status,note").order("receipt_id").order("line_no")),
    sb.from("purchases_beta_items").select("id,name,category_id,unit,sort").order("sort"),
    sb.from("purchases_usual").select("item_key,qty,unit,updated_at"),
    sb.from("purchases_beta_stock").select("item_key,qty,unit,counted_at")]);
  ok = !(r.error || l.error || b.error || u.error || s.error);
  if (ok){
    receipts = r.data; lines = l.data; betaItems = b.data;
    usualSet = Object.fromEntries(u.data.map(x => [x.item_key, { qty: Number(x.qty), unit: x.unit }]));
    betaStock = Object.fromEntries(s.data.map(x => [x.item_key, { qty: Number(x.qty), unit: x.unit, day: A.dayKey(new Date(x.counted_at)) }]));
    if (receiptView) receiptView = receipts.find(x => x.id === receiptView.id) || null;
  }
  if (dlg.open) keepScroll(render);
}

/* ---------- maths ---------- */
const conv = (q, from, to) => from === to ? q : from === "kg" && to === "g" || from === "L" && to === "ml" ? q * 1000
  : from === "g" && to === "kg" || from === "ml" && to === "L" ? q / 1000 : null;
const monthOf = d => String(d).slice(0, 7);
const showQty = (q, u) => u === "kg" || u === "L" ? fmt(Math.round(q * 100) / 100) : u === "g" || u === "ml" ? fmt(Math.round(q / 10) * 10) : fmt(Math.round(q * 10) / 10);
const qty = (q, u) => q == null ? "–" : `${showQty(q, u)} ${u}`;
function roundBuy(q, u){   // round up to something you can pick off a shelf
  if (q <= 1e-9) return 0;
  if (u === "kg" || u === "L") return Math.ceil(q * 10 - 1e-6) / 10;
  if (u === "g" || u === "ml") return Math.ceil(q / 10 - 1e-6) * 10;
  return Math.round(q);   // packs, cans…: nearest whole one (1.3 cans = 1, 1.7 = 2)
}
const niceDate = d => A.parseDay(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const monthName = m => A.parseDay(m + "-01").toLocaleDateString("en-GB", { month: "short", year: "numeric" });
const money = n => Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function allItems(){   // main list + Beta-only items
  const main = A.ITEMS.map(i => ({ id: i.id, name: i.name, unit: i.unit, cat: i.cat, no: i.no, beta: false }));
  const extra = betaItems.map((b, k) => ({ id: b.id, name: b.name, unit: b.unit, cat: b.category_id, no: 1e5 + k, beta: true }));
  return main.concat(extra);
}
function model(){
  const rById = Object.fromEntries(receipts.map(r => [r.id, r]));
  const months = [...new Set(receipts.map(r => monthOf(r.bought_on)))].sort(), nMonths = months.length;
  const latest = A.latest(), byItem = {};
  lines.forEach(l => { if (!l.item_key || l.app_qty == null || !rById[l.receipt_id]) return;
    (byItem[l.item_key] = byItem[l.item_key] || []).push({ r: rById[l.receipt_id], qty: Number(l.app_qty), unit: l.app_unit }); });
  const rows = allItems().map(it => {
    const buys = [];   // one entry per receipt (a receipt can print the same item on several lines), newest first
    (byItem[it.id] || []).forEach(b => { const same = buys.find(x => x.r === b.r && x.unit === b.unit); if (same) same.qty += b.qty; else buys.push({ ...b }); });
    buys.sort((a, b) => a.r.bought_on < b.r.bought_on ? 1 : a.r.bought_on > b.r.bought_on ? -1 : b.r.id - a.r.id);
    let sum = 0, bad = 0; buys.forEach(b => { const q = conv(b.qty, b.unit, it.unit); if (q == null) bad++; else sum += q; });
    const avg = nMonths ? sum / nMonths : 0, monthsBought = new Set(buys.map(b => monthOf(b.r.bought_on))).size;
    const set = usualSet[it.id], usual = set ? conv(set.qty, set.unit, it.unit) : avg;
    let have = null, haveDay = null, haveRaw = null;
    const h = it.beta ? betaStock[it.id] : latest[it.id] && latest[it.id][0];
    if (h){ haveRaw = h; haveDay = h.day; have = conv(Number(h.qty), h.unit, it.unit); }
    const regular = !!set || monthsBought >= 2;
    const buy = usual == null ? null : have == null ? (h ? null : roundBuy(usual, it.unit)) : roundBuy(usual - have, it.unit);
    return { ...it, buys, avg, monthsBought, set: !!set, usual, have, haveDay, haveRaw, regular, buy, bad };
  });
  return { rows, months, nMonths };
}

/* ---------- ticks (this device only, start fresh each month) ---------- */
function getTicks(){ try { const t = JSON.parse(localStorage.getItem(TICKS) || "null"); if (t && t.month === monthOf(A.dayKey())) return new Set(t.ids); } catch(e){} return new Set(); }
let ticks = getTicks();
function saveTicks(){ try { localStorage.setItem(TICKS, JSON.stringify({ month: monthOf(A.dayKey()), ids: [...ticks] })); } catch(e){} }

/* ---------- render ---------- */
const tickSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`;
const chev = `<span class="chev" aria-hidden="true"><i></i><i></i></span>`;
function haveTxt(x){
  if (!x.haveRaw) return null;
  if (x.have == null) return `${A.qtyTxt({ qty: Number(x.haveRaw.qty), unit: x.haveRaw.unit })} (other unit)`;
  return `${qty(x.have, x.unit)} · ${A.shortDay(x.haveDay)}`;
}
function buyCell(x){
  if (x.buy == null) return `<b class="bg-buy na" title="Counted in another unit">–</b>`;
  if (x.buy === 0) return `<b class="bg-buy enough">Enough</b>`;
  return `<b class="bg-buy">${esc(qty(x.buy, x.unit))}</b>`;
}
function detail(x, nMonths){
  const hist = x.buys.length ? `<ul class="bg-hist">${x.buys.map(b => `<li><span>${esc(niceDate(b.r.bought_on))} · ${esc(b.r.store)}</span><b>${esc(qty(b.qty, b.unit))}</b></li>`).join("")}</ul>`
    : `<p class="bg-note">Not on any receipt yet.</p>`;
  const avg = x.buys.length ? `Receipt average: <b>${esc(qty(x.avg, x.unit))}</b> a month (${nMonths} ${nMonths === 1 ? "month" : "months"}${x.bad ? `, ${x.bad} line${x.bad === 1 ? "" : "s"} in another unit left out` : ""}).` : "";
  return `<div class="bg-detail">
    ${hist}${avg ? `<p class="bg-note">${avg}</p>` : ""}
    <form class="bg-edit" data-kind="usual" data-id="${esc(x.id)}">
      <label><span>Usual a month</span><span class="bg-in"><input type="number" inputmode="decimal" min="0" max="100000" step="any" value="${x.usual ? esc(showQty(x.usual, x.unit)) : ""}" aria-label="Usual monthly amount of ${esc(x.name)}"><i>${esc(x.unit)}</i></span></label>
      <button class="pill outline sm" type="submit">Save</button>
    </form>
    ${x.set ? `<button class="linkbtn bg-avg" type="button" data-id="${esc(x.id)}">Use the receipt average instead</button>` : ""}
    ${x.beta ? `<form class="bg-edit" data-kind="have" data-id="${esc(x.id)}">
      <label><span>Have at home</span><span class="bg-in"><input type="number" inputmode="decimal" min="0" max="100000" step="any" value="${x.haveRaw ? esc(fmt(Number(x.haveRaw.qty))) : ""}" aria-label="Amount of ${esc(x.name)} at home"><i>${esc(x.unit)}</i></span></label>
      <button class="pill outline sm" type="submit">Save</button>
    </form><p class="bg-note">${esc(x.name)} is only in the Beta for now, so its count is kept here, not in the main list.</p>`
      : `<p class="bg-note">Have is your latest count in the main list.</p>`}
  </div>`;
}
function row(x, nMonths){
  const open = openRow === x.id, t = ticks.has(x.id);
  const sub = x.regular ? `Usual ${qty(x.usual, x.unit)}${x.set ? " (set by you)" : ""} · ${haveTxt(x) ? `Have ${haveTxt(x)}` : "Not counted yet"}`
    : x.buys.length ? `Bought once · ${niceDate(x.buys[0].r.bought_on)} · ${qty(x.buys[0].qty, x.buys[0].unit)}` : "Not on your receipts yet";
  return `<li class="shop-item bg-item${t ? " ticked" : ""}${open ? " open" : ""}" data-id="${esc(x.id)}">
    <div class="bg-line">${x.regular ? `<button type="button" class="tick" role="checkbox" aria-checked="${t}" aria-label="${esc(x.name)} in the cart">${tickSvg}</button>` : `<span class="bg-pad"></span>`}
      <button type="button" class="bg-open" aria-expanded="${open}"><span class="si-t"><span class="si-name" dir="auto">${esc(x.name)}${x.beta ? ` <em class="tag">New</em>` : ""}</span><span class="si-sub">${esc(sub)}</span></span>${x.regular ? buyCell(x) : ""}${chev}</button></div>
    ${open ? detail(x, nMonths) : ""}</li>`;
}
function groups(rows){
  const cats = A.shopCats(), seen = new Set(cats.map(c => c.id)), out = [];
  cats.forEach(c => { const r = rows.filter(x => x.cat === c.id); if (r.length) out.push({ title: c.name, hue: c.hue, rows: r }); });
  const lost = rows.filter(x => !seen.has(x.cat)); if (lost.length) out.push({ title: "Other", hue: "#86868B", rows: lost });
  return out;
}
const groupHtml = (gs, nMonths) => gs.map(g => `<section class="shop-cat"><h3><i class="dot" style="--hue:${esc(g.hue)}"></i>${esc(g.title)}<span>${g.rows.length}</span></h3><ul>${g.rows.sort((a, b) => a.no - b.no).map(x => row(x, nMonths)).join("")}</ul></section>`).join("");

function renderGuide(body){
  const { rows, months, nMonths } = model();
  const reg = rows.filter(x => x.regular), other = rows.filter(x => !x.regular);
  const toBuy = reg.filter(x => x.buy), done = toBuy.filter(x => ticks.has(x.id)).length;
  $("#bgTitle").textContent = "What to buy.";
  $("#bgMeta").textContent = nMonths ? `Usual = monthly average of ${receipts.length} ${receipts.length === 1 ? "receipt" : "receipts"}, ${monthName(months[0])}${nMonths > 1 ? ` to ${monthName(months[months.length - 1])}` : ""} · ${toBuy.length} to buy${done ? ` · ${done} in the cart` : ""}` : "No receipts yet.";
  $("#bgClear").hidden = !ticks.size;
  body.innerHTML = (reg.length ? groupHtml(groups(reg), nMonths) : `<p class="hist-empty">No regular items yet.</p>`)
    + (other.length ? `<button class="bg-more" type="button" aria-expanded="${showOther}"><span>Not bought regularly<small>${other.length} items · tap one to set a usual amount</small></span>${chev}</button>${showOther ? groupHtml(groups(other), nMonths) : ""}` : "");
}
function renderReceipts(body){
  $("#bgClear").hidden = true;
  if (!receiptView){
    $("#bgTitle").textContent = "Receipts.";
    $("#bgMeta").textContent = `${receipts.length} ${receipts.length === 1 ? "receipt" : "receipts"} · newest first`;
    body.innerHTML = receipts.length ? `<ul class="arch-list">${receipts.map(r => { const n = lines.filter(l => l.receipt_id === r.id).length;
      return `<li><button class="arch-open" type="button" data-rid="${r.id}"><span class="arch-t"><span class="arch-date">${esc(A.longDate(r.bought_on))}${r.bought_time ? ` · ${esc(String(r.bought_time).slice(0, 5))}` : ""}</span><span class="arch-sub">${esc(r.store)}${r.branch ? `, ${esc(r.branch)}` : ""} · ${n} lines${r.total != null ? ` · ${money(r.total)} EGP` : ""}</span></span><span class="arch-go" aria-hidden="true">›</span></button></li>`; }).join("")}</ul>`
      : `<p class="hist-empty">No receipts yet.</p>`;
    return;
  }
  const r = receiptView, ls = lines.filter(l => l.receipt_id === r.id), names = Object.fromEntries(allItems().map(i => [i.id, i.name]));
  const counted = ls.filter(l => l.item_key && l.app_qty != null).length;
  $("#bgTitle").textContent = A.longDate(r.bought_on) + ".";
  $("#bgMeta").textContent = `${r.store}${r.branch ? `, ${r.branch}` : ""}${r.bought_time ? ` · ${String(r.bought_time).slice(0, 5)}` : ""} · ${ls.length} lines, ${counted} counted${r.total != null ? ` · ${money(r.total)} EGP` : ""}`;
  const tag = l => l.item_key && l.app_qty != null ? `<span class="bg-map">${esc(names[l.item_key] || l.item_key)} · ${esc(qty(Number(l.app_qty), l.app_unit))}</span>`
    : `<span class="bg-map off">${{ SKIP: "Not tracked", ONEOFF: "Bought once", UNKNOWN: "Not identified", CHECK: "To check" }[l.status] || "Not counted"}</span>`;
  body.innerHTML = `<ul class="bg-lines">${ls.map(l => `<li><span class="si-t"><span class="bg-ar" dir="rtl">${esc(l.name_ar)}</span>${l.name_en ? `<span class="si-sub">${esc(l.name_en)}</span>` : ""}${tag(l)}</span>
    <span class="bg-amt"><b>${esc(fmt(Number(l.qty)))}${l.qty_unit ? ` ${esc(l.qty_unit)}` : ""}</b>${l.line_total != null ? `<small>${money(Number(l.line_total) + Number(l.discount || 0))}</small>` : ""}</span></li>`).join("")}</ul>`;
}
function render(){
  if (!dlg.open) return;
  const body = $("#bgBody"), seg = dlg.querySelector(".bg-seg");
  seg.dataset.sel = tab; seg.querySelectorAll("button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === tab));
  $("#bgBack").hidden = !(tab === "receipts" && receiptView); seg.hidden = tab === "receipts" && !!receiptView;
  if (ok === null){ $("#bgMeta").textContent = ""; body.innerHTML = `<p class="hist-empty">Loading.</p>`; return; }
  if (!ok){ $("#bgMeta").textContent = ""; $("#bgClear").hidden = true; body.innerHTML = `<p class="hist-empty">The buying guide isn't switched on yet.<br>The rest of the app works as usual.</p>`; return; }
  tab === "guide" ? renderGuide(body) : renderReceipts(body);
}
function keepScroll(f){ const b = $("#bgBody"), y = b.scrollTop; f(); b.scrollTop = y; }

/* ---------- saving ---------- */
async function save(kind, id, val){
  if (busy) return; const it = allItems().find(i => i.id === id); if (!it) return;
  const n = Number(String(val).replace(",", "."));
  if (val === "" || !isFinite(n) || n < 0 || n > 100000){ fb.error(); toast("Type an amount of 0 or more."); return; }
  busy = true; const who = A.myProfile() ? A.me.id : null;
  const r = kind === "usual"
    ? await A.sb.from("purchases_usual").upsert({ item_key: id, qty: n, unit: it.unit, updated_by: who, updated_at: new Date().toISOString() }, { onConflict: "item_key" })
    : await A.sb.from("purchases_beta_stock").upsert({ item_key: id, qty: n, unit: it.unit, counted_by: who, counted_at: new Date().toISOString() }, { onConflict: "item_key" });
  busy = false;
  if (r.error){ fb.error(); toast("Couldn't save. Check your connection."); return; }
  fb.success(); toast(kind === "usual" ? `Usual for ${it.name} saved.` : `${it.name} count saved.`);
  await refresh();
}
async function useAverage(id){
  if (busy) return; busy = true;
  const r = await A.sb.from("purchases_usual").delete().eq("item_key", id); busy = false;
  if (r.error){ fb.error(); toast("Couldn't save. Check your connection."); return; }
  fb.success(); await refresh();
}

/* ---------- events ---------- */
dlg.addEventListener("submit", e => { const f = e.target.closest(".bg-edit"); if (!f) return; e.preventDefault(); f.querySelector("input").blur(); save(f.dataset.kind, f.dataset.id, f.querySelector("input").value.trim()); });
$("#bgBody").addEventListener("click", e => {
  const tk = e.target.closest(".tick");
  if (tk){ const li = tk.closest(".bg-item"), id = li.dataset.id, on = !ticks.has(id);
    on ? ticks.add(id) : ticks.delete(id); saveTicks(); on ? fb.success() : fb.tap(); keepScroll(render); return; }
  const op = e.target.closest(".bg-open");
  if (op){ const id = op.closest(".bg-item").dataset.id; fb.tap(); openRow = openRow === id ? null : id; keepScroll(render); return; }
  const av = e.target.closest(".bg-avg"); if (av){ fb.tap(); useAverage(av.dataset.id); return; }
  if (e.target.closest(".bg-more")){ fb.tap(); showOther = !showOther; keepScroll(render); return; }
  const ro = e.target.closest("[data-rid]");
  if (ro){ fb.tap(); receiptView = receipts.find(r => r.id === Number(ro.dataset.rid)) || null; render(); $("#bgBody").scrollTop = 0; }
});
dlg.querySelector(".bg-seg").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (!b || b.dataset.tab === tab) return; fb.tap(); tab = b.dataset.tab; receiptView = null; render(); $("#bgBody").scrollTop = 0; });
$("#bgBack").onclick = () => { fb.tap(); receiptView = null; render(); $("#bgBody").scrollTop = 0; };
$("#bgClear").onclick = () => { fb.tap(); ticks.clear(); saveTicks(); keepScroll(render); };
$("#bgDone").onclick = () => { fb.tap(); dlg.close(); };
document.addEventListener("purchases:data", () => { if (dlg.open) keepScroll(render); });   // a new count changes "Have"
document.addEventListener("purchases:beta-open", () => {
  if (!allowed()) return;
  ticks = getTicks(); tab = "guide"; receiptView = null; openRow = null;
  dlg.showModal(); render(); $("#bgBody").scrollTop = 0; refresh();
});
})();
