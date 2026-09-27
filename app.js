(() => {
const UNITS = ["kg","g","L","ml","pcs","pack","bottle","box","can","jar","bag","roll","carton","dozen","tray"];
const HALF = new Set(["kg","L"]);
const CACHE = "purchases-cache-v1";
const $ = s => document.querySelector(s);
const fmt = q => Number.isInteger(q) ? String(q) : q.toFixed(2).replace(/0+$/,"").replace(/\.$/,"");
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

const cfg = window.PURCHASES_CONFIG || {};
const sb = window.supabase && cfg.supabaseUrl ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey) : null;

let CATS = [], ITEMS = [], byId = {}, stock = {};
const openCats = new Set();
let selected = null, built = false;
const catsEl = $("#cats");
const R = 16, C = 2 * Math.PI * R;

function setSave(state, label){ const el = $("#saveState"); el.className = "save-state " + state; el.querySelector("span").textContent = label; }
let toastT; function toast(m){ const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2800); }
function cache(){ try { localStorage.setItem(CACHE, JSON.stringify({CATS, ITEMS, stock})); } catch(e){} }

/* ---------- build ---------- */
function build(){
  catsEl.innerHTML = "";
  byId = Object.fromEntries(ITEMS.map(i => [i.id, i]));
  $("#totalItems").textContent = ITEMS.length; $("#totalCats").textContent = CATS.length;
  if (!openCats.size && CATS.length) openCats.add(CATS[0].id);
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
          <input class="qty" id="qty-${esc(it.id)}" type="number" min="0" step="any" inputmode="decimal" aria-label="Stock for ${esc(it.name)}" placeholder="0">
          <button class="step" type="button" data-d="1" aria-label="Increase">+</button></div>
          <select class="unit" id="unit-${esc(it.id)}" aria-label="Unit for ${esc(it.name)}">${UNITS.map(u => `<option>${u}</option>`).join("")}</select>
          <button class="clear" type="button" aria-label="Clear stock"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
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
}

/* ---------- saving (one debounced upsert per item) ---------- */
const timers = {}, pending = new Set();
function queueSave(id){
  cache();
  if (!sb){ setSave("", "Saved on this device"); return; }
  pending.add(id); setSave("saving", "Saving");
  clearTimeout(timers[id]); timers[id] = setTimeout(() => flush(id), 600);
}
async function flush(id){
  const s = stock[id]; if (!s) return;
  const { error } = await sb.from("purchases_stock").upsert({ item_id: id, qty: s.qty, unit: s.unit });
  pending.delete(id);
  if (error){ setSave("", "Not saved"); toast("Couldn't save " + (byId[id] ? byId[id].name : "item") + ". Check your connection and try again."); return; }
  if (!pending.size) setSave("saved", "Saved");
}
function setItem(id, qty, unit){
  qty = Math.max(0, Math.min(100000, Math.round((Number(qty) || 0) * 100) / 100));
  const cur = stock[id] || {}; unit = unit || cur.unit || byId[id].unit;
  stock[id] = { qty, unit };
  render(new Set([id])); queueSave(id);
}

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
  const rows = [["No.","Category","Items","Stock","Unit"]].concat(ITEMS.map(i => { const s = stock[i.id]; const c = CATS.find(c => c.id === i.cat);
    return [i.no, c ? c.name : "", i.name, s && s.qty > 0 ? fmt(s.qty) : "", s && s.qty > 0 ? s.unit : ""]; }));
  const blob = new Blob(["﻿" + rows.map(r => r.map(q).join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "Purchases List.csv";
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
async function load(){
  try { const c = JSON.parse(localStorage.getItem(CACHE) || "null"); if (c && c.CATS && c.CATS.length){ CATS = c.CATS; ITEMS = c.ITEMS; stock = c.stock || {}; build(); render(); } } catch(e){}
  if (!sb){ setSave("", "Offline"); return; }
  const [cr, ir, sr] = await Promise.all([
    sb.from("purchases_categories").select("id,name,sub,hue,sort").order("sort"),
    sb.from("purchases_items").select("id,name,category_id,default_unit,sort").order("sort"),
    sb.from("purchases_stock").select("item_id,qty,unit")
  ]);
  if (cr.error || ir.error || sr.error){ setSave("", "Offline"); if (!built) catsEl.innerHTML = `<div class="empty">Couldn't load your list. Check your connection and reload.</div>`; return; }
  const prevKey = JSON.stringify(ITEMS.map(i => [i.id, i.name, i.cat]));
  apply(cr.data, ir.data);
  stock = {}; sr.data.forEach(r => { stock[r.item_id] = { qty: Number(r.qty), unit: r.unit }; });
  if (!built || prevKey !== JSON.stringify(ITEMS.map(i => [i.id, i.name, i.cat]))) build();
  render(); cache(); setSave("saved", "Synced");
  sb.channel("purchases-stock").on("postgres_changes", { event: "*", schema: "public", table: "purchases_stock" }, p => {
    const r = p.new && p.new.item_id ? p.new : null; if (!r || pending.has(r.item_id)) return;
    stock[r.item_id] = { qty: Number(r.qty), unit: r.unit }; render(new Set([r.item_id])); cache();
  }).subscribe();
}
load();
})();
