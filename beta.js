/* Buying guide (Beta): usual monthly amount from supermarket receipts, compared with what's at home.
   Usual = everything bought of an item on the receipts / number of months the receipts cover (or a hand-set amount).
   Have  = the newest count: Count at home (kept in the Beta) or the main list (whoever saved it), whichever is more recent,
           plus everything a receipt shows was bought after that count (count at home, go shopping, add the receipt).
   Buy   = Usual - Have, never below 0. Items you can't count (spices, dish soap…) are marked Low or Enough instead:
           Low = buy what you usually buy at once, Enough = nothing to buy.
   Shown on Abdallah's and Maguie's profiles (they share the same counts and usual amounts; each count shows who made it),
   or on a device opened once with ?beta=1 (?beta=0 hides it). */
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
const allowed = () => { const f = flag(); if (f === "1") return true; if (f === "0") return false; const p = A.myProfile(); return !!(p && /^\s*(abdallah|maguie)\s*$/i.test(p.name)); };
const menuLi = $("#betaMenu");
const gate = () => { if (menuLi) menuLi.hidden = !allowed(); };
document.addEventListener("purchases:me", gate); gate();

/* ---------- sheet ---------- */
const dlg = document.createElement("dialog");
dlg.className = "dlg sheet shop bg"; dlg.id = "betaDlg"; dlg.setAttribute("aria-labelledby", "bgTitle");
dlg.innerHTML = `<div class="shop-head">
    <button class="linkbtn arch-back" id="bgBack" type="button" hidden><span aria-hidden="true">‹</span><b id="bgBackLbl">All receipts</b></button>
    <p class="eyebrow">Buying guide <em class="tag">Beta</em></p>
    <h2 id="bgTitle">What to buy.</h2>
    <p class="shop-meta" id="bgMeta"></p>
    <div class="seg bg-seg" role="tablist" aria-label="Buying guide view" data-sel="guide">
      <button type="button" role="tab" data-tab="guide" aria-selected="true">Guide</button>
      <button type="button" role="tab" data-tab="often" aria-selected="false">How often</button>
      <button type="button" role="tab" data-tab="receipts" aria-selected="false">Receipts</button>
    </div>
  </div>
  <div class="shop-body" id="bgBody"></div>
  <div class="shop-foot">
    <button class="linkbtn shop-clear" id="bgClear" type="button" hidden>Clear ticks</button>
    <div class="dlg-btns" id="bgBtns"><button class="pill primary" id="bgDone" type="button">Done</button></div>
    <div class="dlg-btns" id="bgCountBtns" hidden><button class="pill outline" id="bgCountCancel" type="button">Cancel</button><button class="pill primary" id="bgCountSave" type="button" disabled>Save</button></div>
  </div>`;
document.body.appendChild(dlg);

let ok = null, receipts = [], lines = [], betaItems = [], usualSet = {}, betaStock = {};
let tab = "guide", receiptView = null, openRow = null, showOther = false, busy = false;
let counting = false, draft = {}, lvlDraft = {}, modeDraft = {};   // "Count at home" form: typed amounts, Low/Enough picks, switched rows

/* Items checked by eye (Low / Enough) instead of counted, until you switch a row. All spices, plus these. */
const LEVEL_CAT = 3;
const LEVEL_IDS = new Set(["cooking-oil", "olive-oil", "vinegar", "mustard", "mayonnaise", "white-honey", "black-honey", "tahini", "nescafe",
  "dish-soap", "clothes-washing-gel", "black-clothes-washing-gel", "clorox-kitchen-cleaner-spray", "glance", "vanish", "ciff"]);
const LEVEL = "level";   // purchases_beta_stock.unit for a Low / Enough check: qty 0 = Low, 1 = Enough

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
    sb.from("purchases_usual").select("item_key,qty,unit,updated_by,updated_at"),
    sb.from("purchases_beta_stock").select("item_key,qty,unit,counted_by,counted_at")]);
  ok = !(r.error || l.error || b.error || u.error || s.error);
  if (ok){
    receipts = r.data; lines = l.data; betaItems = b.data;
    usualSet = Object.fromEntries(u.data.map(x => [x.item_key, { qty: Number(x.qty), unit: x.unit, by: x.updated_by || null }]));
    betaStock = Object.fromEntries(s.data.map(x => [x.item_key, { qty: Number(x.qty), unit: x.unit, by: x.counted_by || null, day: A.dayKey(new Date(x.counted_at)), at: x.counted_at, exact: true }]));
    if (receiptView) receiptView = receipts.find(x => x.id === receiptView.id) || null;
  }
  if (dlg.open && !counting && !typing()) keepScroll(render);
}
// someone typing in the sheet (a usual amount, a count): don't redraw under their fingers
const typing = () => { const a = document.activeElement; return !!a && dlg.contains(a) && a.tagName === "INPUT"; };

/* ---------- maths ---------- */
const conv = (q, from, to) => from === to ? q : from === "kg" && to === "g" || from === "L" && to === "ml" ? q * 1000
  : from === "g" && to === "kg" || from === "ml" && to === "L" ? q / 1000 : null;
const monthOf = d => String(d).slice(0, 7);
/* Counts and receipts compared as Cairo clock time, "YYYY-MM-DD HH:MM" (receipts print the shop's local time). */
const wall = iso => { try {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return p.year && p.hour ? `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}` : null; } catch(e){ return null; } };
const receiptAt = r => `${r.bought_on} ${r.bought_time ? String(r.bought_time).slice(0, 5) : "23:59"}`;   // no time printed: end of that day
// When a count was made. Count at home keeps the exact moment. A main-list count belongs to its day: its save time is used
// only when it was saved that same day, otherwise it counts as the end of that day.
const countAt = h => { const w = h.at ? wall(h.at) : null; return w && (h.exact || w.slice(0, 10) === h.day) ? w : `${h.day} 23:59`; };
const showQty = (q, u) => u === "kg" || u === "L" ? fmt(Math.round(q * 100) / 100) : u === "g" || u === "ml" ? fmt(Math.round(q / 10) * 10) : fmt(Math.round(q * 10) / 10);
const qty = (q, u) => q == null ? "–" : `${showQty(q, u)} ${u}`;
function roundBuy(q, u){   // round up to something you can pick off a shelf
  if (q <= 1e-9) return 0;
  if (u === "kg" || u === "L") return Math.ceil(q * 10 - 1e-6) / 10;
  if (u === "g" || u === "ml") return Math.ceil(q / 10 - 1e-6) * 10;
  return Math.round(q);   // packs, cans…: nearest whole one (1.3 cans = 1, 1.7 = 2)
}
const roundLow = (q, u) => u === "kg" || u === "L" || u === "g" || u === "ml" ? roundBuy(q, u) : Math.max(1, Math.round(q));
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
    const perBuy = monthsBought ? sum / monthsBought : 0;   // amount in a month you bought it (all receipts that month together)
    let have = null, haveDay = null, haveRaw = null, lvl = null, since = [], added = 0;
    // Have = the newest count: "Count at home" (kept in the Beta) or the main list (whoever saved it), whichever is more recent…
    const bs = betaStock[it.id], ml = !it.beta && latest[it.id] && latest[it.id][0];
    const h = bs && (!ml || bs.day >= ml.day) ? bs : ml || null;
    // checked by eye unless your last Count at home for it was a number
    const level = bs ? bs.unit === LEVEL : it.cat === LEVEL_CAT || LEVEL_IDS.has(it.id);
    if (h){ haveRaw = h; haveDay = h.day;
      // …plus what the receipts show you bought after that count (counted 4 yogurts, then bought 12 = 16 at home)
      const at = countAt(h); since = buys.filter(b => receiptAt(b.r) > at);
      let odd = false; since.forEach(b => { const q = conv(b.qty, b.unit, it.unit); if (q == null) odd = true; else added += q; });
      if (h.unit === LEVEL) lvl = since.length || Number(h.qty) > 0 ? "ok" : "low";   // Low, then bought it: Enough
      else { const c = conv(Number(h.qty), h.unit, it.unit); have = c == null || odd ? null : c + added; } }
    const regular = !!set || monthsBought >= 2 || lvl === "low";
    // Low: buy what you usually buy at once (your set amount if you set one); at least one pack, can…
    const once = set ? usual : perBuy || null;
    const buy = lvl === "ok" ? 0 : lvl === "low" ? (once ? roundLow(once, it.unit) : null)
      : usual == null ? null : have == null ? (h ? null : roundBuy(usual, it.unit)) : roundBuy(usual - have, it.unit);
    return { ...it, buys, avg, perBuy, once, monthsBought, set: !!set, usual, have, haveDay, haveRaw, lvl, level, regular, buy, bad, since, added };
  });
  return { rows, months, nMonths };
}

/* ---------- "in the cart" ticks: shared live between phones (purchases_beta_ticks), start fresh each month.
   Until that table exists, or if it can't be reached, they stay on this phone as before. ---------- */
let shared = null, tickBy = {};   // shared: null = not checked yet, true = table works, false = this phone only
const thisMonth = () => monthOf(A.dayKey());
function localTicks(){ try { const t = JSON.parse(localStorage.getItem(TICKS) || "null"); if (t && t.month === thisMonth()) return new Set(t.ids); } catch(e){} return new Set(); }
let ticks = localTicks();
function saveTicks(){ try { localStorage.setItem(TICKS, JSON.stringify({ month: thisMonth(), ids: [...ticks] })); } catch(e){} }
async function refreshTicks(){
  if (!A.sb) return;
  const r = await A.sb.from("purchases_beta_ticks").select("item_key,month,ticked_by");
  if (r.error){ if (shared === null) shared = false; return; }
  shared = true; const m = thisMonth(), rows = r.data.filter(x => x.month === m);
  ticks = new Set(rows.map(x => x.item_key)); tickBy = Object.fromEntries(rows.map(x => [x.item_key, x.ticked_by]));
  if (dlg.open && !counting && tab === "guide" && !typing()) keepScroll(render);
}
async function setTick(id, on){
  on ? ticks.add(id) : ticks.delete(id); if (on) tickBy[id] = A.myProfile() ? A.me.id : null;
  if (!shared){ saveTicks(); return; }
  const q = A.sb.from("purchases_beta_ticks");
  const r = on ? await q.upsert({ item_key: id, month: thisMonth(), ticked_by: tickBy[id], ticked_at: new Date().toISOString() }, { onConflict: "item_key" })
    : await q.delete().eq("item_key", id);
  if (r.error){ fb.error(); toast("Couldn't sync that tick. Check your connection."); refreshTicks(); }
}
async function clearTicks(){
  ticks.clear(); tickBy = {};
  if (!shared){ saveTicks(); return; }
  const r = await A.sb.from("purchases_beta_ticks").delete().neq("item_key", "");   // every row, older months too
  if (r.error){ fb.error(); toast("Couldn't clear the ticks. Check your connection."); refreshTicks(); }
}
const tickedBy = id => { const by = tickBy[id]; return !by || (A.myProfile() && by === A.me.id) ? "" : ` · ${A.whoName(by)} ticked it`; };

/* ---------- render ---------- */
const tickSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`;
const chev = `<span class="chev" aria-hidden="true"><i></i><i></i></span>`;
const stale = day => day && (A.parseDay(A.dayKey()) - A.parseDay(day)) / 864e5 > 7;
const who = by => !by ? "" : A.myProfile() && by === A.me.id ? "you, " : `${A.whoName(by)}, `;
const setBy = id => { const by = usualSet[id] && usualSet[id].by; return !by ? "hand" : A.myProfile() && by === A.me.id ? "you" : A.whoName(by); };
const when = x => `${who(x.haveRaw.by)}${A.shortDay(x.haveDay)}${stale(x.haveDay) ? " (over a week old)" : ""}`;
const rawTxt = r => r.unit === LEVEL ? (Number(r.qty) > 0 ? "Enough" : "Low") : A.qtyTxt({ qty: Number(r.qty), unit: r.unit });
function haveTxt(x){
  if (!x.haveRaw) return null;
  if (x.lvl) return x.since.length ? `Enough · bought after your ${rawTxt(x.haveRaw)} check (${when(x)})` : `${x.lvl === "low" ? "Low" : "Enough"} · ${when(x)}`;
  if (x.have == null) return `${rawTxt(x.haveRaw)} (other unit)`;
  return x.since.length ? `${qty(x.have, x.unit)} · counted ${rawTxt(x.haveRaw)} + bought ${qty(x.added, x.unit)} · ${when(x)}` : `${qty(x.have, x.unit)} · ${when(x)}`;
}
// for Count at home: what the receipts added since the last count
const sinceTxt = x => !x.since.length ? "" : x.haveRaw && x.haveRaw.unit === LEVEL ? " · bought since" : ` · ${qty(x.added, x.unit)} bought since`;
function buyCell(x){
  if (x.buy == null && x.lvl === "low") return `<b class="bg-buy">Needed</b>`;
  if (x.buy == null) return `<b class="bg-buy na" title="Counted in another unit">–</b>`;
  if (x.buy === 0) return `<b class="bg-buy enough">Enough</b>`;
  return `<b class="bg-buy">${esc(qty(x.buy, x.unit))}</b>`;
}
const freqTxt = (x, n) => !x.monthsBought ? "Not on your receipts yet" : x.monthsBought >= n ? "Every month" : `In ${x.monthsBought} of ${n} months`;
function detail(x, nMonths){
  const hist = x.buys.length ? `<ul class="bg-hist">${x.buys.map(b => `<li><span>${esc(niceDate(b.r.bought_on))} · ${esc(b.r.store)}</span><b>${esc(qty(b.qty, b.unit))}</b></li>`).join("")}</ul>`
    : `<p class="bg-note">Not on any receipt yet.</p>`;
  const avg = x.buys.length ? `How often: <b>${esc(freqTxt(x, nMonths))}</b>, about ${esc(qty(x.perBuy, x.unit))} each time.<br>Receipt average: <b>${esc(qty(x.avg, x.unit))}</b> a month (${nMonths} ${nMonths === 1 ? "month" : "months"}${x.bad ? `, ${x.bad} line${x.bad === 1 ? "" : "s"} in another unit left out` : ""}).` : "";
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
      : `<p class="bg-note">Have is the newest count: from Count at home (kept in the Beta) or from the main list, whichever is more recent. It shows who counted it.</p>`}
    ${x.since.length ? `<p class="bg-note">Have adds what your receipts show you bought after that count: ${x.since.map(b => `<b>${esc(qty(b.qty, b.unit))}</b> on ${esc(niceDate(b.r.bought_on))} (${esc(b.r.store)})`).join(", ")}.</p>` : ""}
    ${x.level ? `<p class="bg-note">You check this one by eye in Count at home. Low means buy ${x.once ? `what you usually buy at once: <b>${esc(qty(x.once, x.unit))}</b>` : "it (no amount on your receipts yet; set a usual amount above)"}.</p>` : ""}
  </div>`;
}
function row(x, nMonths){
  const open = openRow === x.id, t = ticks.has(x.id);
  const sub = x.lvl === "low" ? `${haveTxt(x)}${x.once ? ` · usually ${qty(x.once, x.unit)} at a time` : ""}`
    : x.regular ? `Usual ${qty(x.usual, x.unit)}${x.set ? ` (set by ${setBy(x.id)})` : ""} · ${haveTxt(x) ? `Have ${haveTxt(x)}` : "Not counted yet"}`
    : x.buys.length ? `Bought once · ${niceDate(x.buys[0].r.bought_on)} · ${qty(x.buys[0].qty, x.buys[0].unit)}` : "Not on your receipts yet";
  return `<li class="shop-item bg-item${t ? " ticked" : ""}${open ? " open" : ""}" data-id="${esc(x.id)}">
    <div class="bg-line">${x.regular ? `<button type="button" class="tick" role="checkbox" aria-checked="${t}" aria-label="${esc(x.name)} in the cart">${tickSvg}</button>` : `<span class="bg-pad"></span>`}
      <button type="button" class="bg-open" aria-expanded="${open}"><span class="si-t"><span class="si-name" dir="auto">${esc(x.name)}${x.beta ? ` <em class="tag">New</em>` : ""}</span><span class="si-sub">${esc(sub + (t ? tickedBy(x.id) : ""))}</span></span>${x.regular ? buyCell(x) : ""}${chev}</button></div>
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
  const toBuy = reg.filter(x => x.buy || x.lvl === "low"), done = toBuy.filter(x => ticks.has(x.id)).length;
  $("#bgTitle").textContent = "What to buy.";
  $("#bgMeta").textContent = nMonths ? `Usual = monthly average of ${receipts.length} ${receipts.length === 1 ? "receipt" : "receipts"}, ${monthName(months[0])}${nMonths > 1 ? ` to ${monthName(months[months.length - 1])}` : ""} · ${toBuy.length} to buy${done ? ` · ${done} in the cart` : ""}` : "No receipts yet.";
  $("#bgClear").hidden = !ticks.size;
  body.innerHTML = `<button class="bg-countbtn" type="button"><span>Count at home<small>Before you go: update what's at home, then come back here.</small></span><span class="arch-go" aria-hidden="true">›</span></button>`
    + (reg.length ? groupHtml(groups(reg), nMonths) : `<p class="hist-empty">No regular items yet.</p>`)
    + (other.length ? `<button class="bg-more" type="button" aria-expanded="${showOther}"><span>Not bought regularly<small>${other.length} items · tap one to set a usual amount</small></span>${chev}</button>${showOther ? groupHtml(groups(other), nMonths) : ""}` : "");
}
/* ---------- Count at home: one form for the regular items, saved as today's count ---------- */
const parseQty = t => { const v = String(t).trim().replace(",", "."); if (v === "") return null; const n = Number(v); return isFinite(n) && n >= 0 && n <= 100000 ? n : NaN; };
function countRows(){   // regular items + everything you check by eye, in the main list's category order (the order you walk the house)
  const { rows } = model(), reg = rows.filter(x => x.regular || x.level || betaStock[x.id]), order = new Map(A.CATS.map((c, k) => [c.id, k]));
  return reg.sort((a, b) => (order.get(a.cat) ?? 99) - (order.get(b.cat) ?? 99) || a.no - b.no);
}
function countState(){
  const vals = Object.entries(draft).map(([id, t]) => [id, parseQty(t)]).filter(([, n]) => n !== null);
  return { n: vals.filter(([, n]) => !isNaN(n)).length + Object.keys(lvlDraft).length, bad: vals.filter(([, n]) => isNaN(n)).length };
}
const isLevel = x => modeDraft[x.id] ?? x.level;
function countFoot(){ const { n, bad } = countState(), b = $("#bgCountSave");
  b.disabled = !n || bad > 0 || busy; b.textContent = bad ? "Check the amounts" : n ? `Save ${n} ${n === 1 ? "count" : "counts"}` : "Save"; }
function renderCount(body){
  const rows = countRows(), cats = Object.fromEntries(A.CATS.map(c => [c.id, c]));
  $("#bgTitle").textContent = "Count at home.";
  $("#bgMeta").textContent = "Type what's at home, or tap Low / Enough for things you can't count. Skip anything you didn't check; its last count stays.";
  const gs = []; rows.forEach(x => { const g = gs[gs.length - 1]; if (g && g.cat === x.cat) g.rows.push(x); else gs.push({ cat: x.cat, rows: [x] }); });
  body.innerHTML = gs.map(g => { const c = cats[g.cat] || { name: "Other", hue: "#86868B" };
    return `<section class="shop-cat"><h3><i class="dot" style="--hue:${esc(c.hue)}"></i>${esc(c.name)}<span>${g.rows.length}</span></h3><ul>${g.rows.map(x => {
      const last = x.haveRaw ? `Last: ${rawTxt(x.haveRaw)} · ${when(x)}${sinceTxt(x)}` : "Not counted yet";
      const head = `<span class="si-t"><span class="si-name" dir="auto">${esc(x.name)}${x.beta ? ` <em class="tag">New</em>` : ""}</span><span class="si-sub${stale(x.haveDay) ? " old" : ""}">${esc(last)}</span></span>`;
      if (isLevel(x)){ const l = lvlDraft[x.id];
        return `<li class="bg-count lvl${l ? " filled" : ""}" data-id="${esc(x.id)}">${head}
        <span class="bg-lvl" role="group" aria-label="${esc(x.name)} at home"><button type="button" data-lvl="low" aria-pressed="${l === "low"}">Low</button><button type="button" data-lvl="ok" aria-pressed="${l === "ok"}">Enough</button></span>
        <button type="button" class="linkbtn bg-mode" data-mode="count">Count it instead</button></li>`; }
      const v = draft[x.id] ?? "", bad = isNaN(parseQty(v));
      return `<li class="bg-count${v !== "" ? " filled" : ""}${bad ? " bad" : ""}" data-id="${esc(x.id)}">${head}
        <button type="button" class="bg-zero" aria-label="None of ${esc(x.name)} left">0</button>
        <span class="bg-in"><input type="text" inputmode="decimal" autocomplete="off" enterkeyhint="next" value="${esc(v)}" aria-label="${esc(x.name)} at home, in ${esc(x.unit)}"><i>${esc(x.unit)}</i></span>
        <button type="button" class="linkbtn bg-mode" data-mode="level">Can't count it? Low / Enough</button></li>`; }).join("")}</ul></section>`; }).join("")
    || `<p class="hist-empty">No regular items yet.</p>`;
  countFoot();
}
async function saveCount(){
  const { n, bad } = countState(); if (busy || !n || bad) return;
  const items = Object.fromEntries(allItems().map(i => [i.id, i]));
  const vals = Object.entries(draft).map(([id, t]) => [items[id], parseQty(t), null]).filter(([it, q]) => it && q !== null && !isNaN(q))
    .concat(Object.entries(lvlDraft).filter(([id]) => items[id]).map(([id, l]) => [items[id], l === "ok" ? 1 : 0, LEVEL]));
  const by = A.myProfile() ? A.me.id : null, now = new Date().toISOString();
  busy = true; countFoot(); fb.tap();
  // Saved only in the Beta (Abdallah's choice, 3 Nov 2026): the main list is not touched. Shared by everyone who uses the guide.
  const r = await A.sb.from("purchases_beta_stock").upsert(vals.map(([it, q, u]) => ({ item_key: it.id, qty: Math.round(q * 100) / 100, unit: u || it.unit, counted_by: by, counted_at: now })), { onConflict: "item_key" });
  busy = false;
  if (r.error){ countFoot(); fb.error(); toast(r.error.code === "23503" ? "The Beta needs a small database update first. Nothing was saved." : "Couldn't save the counts. Check your connection."); return; }
  fb.success(); toast(`Saved ${vals.length} ${vals.length === 1 ? "count" : "counts"}. The guide is up to date.`);
  counting = false; draft = {}; lvlDraft = {}; modeDraft = {}; render(); $("#bgBody").scrollTop = 0; refresh();
}

/* ---------- How often: how many months each item shows up on the receipts ---------- */
function renderOften(body){
  const { rows, months, nMonths } = model(), bought = rows.filter(x => x.monthsBought), cats = Object.fromEntries(A.CATS.map(c => [c.id, c]));
  $("#bgClear").hidden = true;
  $("#bgTitle").textContent = "How often you buy.";
  $("#bgMeta").textContent = nMonths ? `From ${receipts.length} ${receipts.length === 1 ? "receipt" : "receipts"} over ${nMonths} ${nMonths === 1 ? "month" : "months"} (${monthName(months[0])}${nMonths > 1 ? ` to ${monthName(months[months.length - 1])}` : ""}). More receipts make this more precise.` : "No receipts yet.";
  const levels = [...new Set(bought.map(x => x.monthsBought))].sort((a, b) => b - a);
  body.innerHTML = levels.map(m => { const g = bought.filter(x => x.monthsBought === m).sort((a, b) => (cats[a.cat] ? cats[a.cat].sort : 99) - (cats[b.cat] ? cats[b.cat].sort : 99) || a.no - b.no);
    const title = m >= nMonths ? "Every month" : `${m} of ${nMonths} months`;
    return `<section class="shop-cat"><h3>${esc(title)}<span>${g.length}</span></h3><ul class="bg-often">${g.map(x => { const last = x.buys[0];
      return `<li><i class="dot" style="--hue:${esc(cats[x.cat] ? cats[x.cat].hue : "#86868B")}"></i><span class="si-t"><span class="si-name" dir="auto">${esc(x.name)}${x.beta ? ` <em class="tag">New</em>` : ""}</span><span class="si-sub">Last bought ${esc(niceDate(last.r.bought_on))} · ${esc(last.r.store)}</span></span>
        <span class="bg-amt"><b>${esc(qty(x.perBuy, x.unit))}</b><small>each time</small></span></li>`; }).join("")}</ul></section>`; }).join("")
    || `<p class="hist-empty">No receipts yet.</p>`;
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
  const sub = counting || (tab === "receipts" && !!receiptView);
  $("#bgBack").hidden = !sub; seg.hidden = sub; $("#bgBackLbl").textContent = counting ? "Buying guide" : "All receipts";
  $("#bgBtns").hidden = counting; $("#bgCountBtns").hidden = !counting; if (counting) $("#bgClear").hidden = true;
  if (ok === null){ $("#bgMeta").textContent = ""; body.innerHTML = `<p class="hist-empty">Loading.</p>`; return; }
  if (!ok){ $("#bgMeta").textContent = ""; $("#bgClear").hidden = true; body.innerHTML = `<p class="hist-empty">The buying guide isn't switched on yet.<br>The rest of the app works as usual.</p>`; return; }
  counting ? renderCount(body) : tab === "guide" ? renderGuide(body) : tab === "often" ? renderOften(body) : renderReceipts(body);
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
    setTick(id, on); on ? fb.success() : fb.tap(); keepScroll(render); return; }
  const op = e.target.closest(".bg-open");
  if (op){ const id = op.closest(".bg-item").dataset.id; fb.tap(); openRow = openRow === id ? null : id; keepScroll(render); return; }
  const av = e.target.closest(".bg-avg"); if (av){ fb.tap(); useAverage(av.dataset.id); return; }
  if (e.target.closest(".bg-more")){ fb.tap(); showOther = !showOther; keepScroll(render); return; }
  const ro = e.target.closest("[data-rid]");
  if (ro){ fb.tap(); receiptView = receipts.find(r => r.id === Number(ro.dataset.rid)) || null; render(); $("#bgBody").scrollTop = 0; return; }
  if (e.target.closest(".bg-countbtn")){ fb.tap(); counting = true; draft = {}; lvlDraft = {}; modeDraft = {}; render(); $("#bgBody").scrollTop = 0; return; }
  const lv = e.target.closest("[data-lvl]");
  if (lv){ const li = lv.closest(".bg-count"), id = li.dataset.id, v = lv.dataset.lvl;
    if (lvlDraft[id] === v) delete lvlDraft[id]; else lvlDraft[id] = v;
    fb.tap(); li.classList.toggle("filled", !!lvlDraft[id]); li.querySelectorAll("[data-lvl]").forEach(b => b.setAttribute("aria-pressed", b.dataset.lvl === lvlDraft[id])); countFoot(); return; }
  const md = e.target.closest(".bg-mode");
  if (md){ const id = md.closest(".bg-count").dataset.id; fb.tap(); delete draft[id]; delete lvlDraft[id]; modeDraft[id] = md.dataset.mode === "level"; keepScroll(render); return; }
  const z = e.target.closest(".bg-zero");
  if (z){ const li = z.closest(".bg-count"), inp = li.querySelector("input"); fb.tap(); inp.value = "0"; inp.dispatchEvent(new Event("input", { bubbles: true })); }
});
$("#bgBody").addEventListener("input", e => {
  const li = e.target.closest(".bg-count"); if (!li) return; const v = e.target.value;
  if (v.trim() === "") delete draft[li.dataset.id]; else draft[li.dataset.id] = v;
  li.classList.toggle("filled", v.trim() !== ""); li.classList.toggle("bad", isNaN(parseQty(v))); countFoot();
});
$("#bgBody").addEventListener("keydown", e => {   // Return moves to the next box
  if (e.key !== "Enter" || !e.target.closest(".bg-count")) return; e.preventDefault();
  const all = [...$("#bgBody").querySelectorAll(".bg-count input")], i = all.indexOf(e.target);
  if (all[i + 1]) all[i + 1].focus(); else e.target.blur();
});
const leaveCount = () => { if ((Object.keys(draft).length || Object.keys(lvlDraft).length) && !confirm("Leave without saving these counts?")) return; fb.tap(); counting = false; draft = {}; lvlDraft = {}; modeDraft = {}; render(); $("#bgBody").scrollTop = 0; };
$("#bgCountCancel").onclick = leaveCount;
$("#bgCountSave").onclick = saveCount;
dlg.querySelector(".bg-seg").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (!b || b.dataset.tab === tab) return; fb.tap(); tab = b.dataset.tab; receiptView = null; render(); $("#bgBody").scrollTop = 0; });
$("#bgBack").onclick = () => { if (counting){ leaveCount(); return; } fb.tap(); receiptView = null; render(); $("#bgBody").scrollTop = 0; };
$("#bgClear").onclick = () => { if (!confirm(shared ? "Clear the ticks on both phones?" : "Clear the ticks?")) return; fb.tap(); clearTicks(); keepScroll(render); };
$("#bgDone").onclick = () => { fb.tap(); dlg.close(); };
document.addEventListener("purchases:data", () => { if (dlg.open && !counting) keepScroll(render); });   // never redraw the form while typing   // a new count changes "Have"
// Two people can use the guide at once: pick up each other's counts while it's open (every 20 s, and on coming back to the app).
setInterval(() => { if (dlg.open && !counting && !busy && document.visibilityState === "visible"){ refresh(); refreshTicks(); } }, 20000);
document.addEventListener("visibilitychange", () => { if (dlg.open && !counting && document.visibilityState === "visible"){ refresh(); refreshTicks(); } });
// ticks arrive live from the other phone (own channel, so a missing table can't break anything else)
let tickT = null;
if (A.sb) A.sb.channel("purchases-beta-ticks").on("postgres_changes", { event: "*", schema: "public", table: "purchases_beta_ticks" }, () => { clearTimeout(tickT); tickT = setTimeout(refreshTicks, 200); }).subscribe();
document.addEventListener("purchases:beta-open", () => {
  if (!allowed()) return;
  if (!shared) ticks = localTicks(); tab = "guide"; receiptView = null; openRow = null; counting = false; draft = {}; lvlDraft = {}; modeDraft = {};
  dlg.showModal(); render(); $("#bgBody").scrollTop = 0; refresh(); refreshTicks();
});
})();
