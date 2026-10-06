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

/* ---------- profiles: a name + avatar per device (no password; the device keeps a key so only it can edit) ---------- */
let PROFILES = {}, activity = [], loaded = false;
const ME_KEY = "purchases-me";
const me = (() => { try { const m = JSON.parse(localStorage.getItem(ME_KEY) || "null"); if (m && m.id && m.key) return m; } catch(e){}
  const hex = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, "0")).join(""), h = hex(16);
  const m = { id: crypto.randomUUID ? crypto.randomUUID() : `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20)}`, key: hex(24) };
  try { localStorage.setItem(ME_KEY, JSON.stringify(m)); } catch(e){} return m; })();
const myProfile = () => PROFILES[me.id] || null;
const whoName = id => (PROFILES[id] && PROFILES[id].name) || "Someone";
const AVATARS = { fox:["🦊","#FFE3CC"], cat:["🐱","#FFF1C2"], dog:["🐶","#F3E2D0"], panda:["🐼","#E8E8ED"], lion:["🦁","#FFE8B8"], tiger:["🐯","#FFE0B3"],
  bear:["🐻","#EFDCCB"], koala:["🐨","#E3E7EE"], frog:["🐸","#DDF3D2"], owl:["🦉","#EADFD3"], penguin:["🐧","#DDE9F7"], unicorn:["🦄","#F4E1F7"],
  bunny:["🐰","#FCE4EC"], monkey:["🐵","#F1E3D3"], chick:["🐥","#FFF4C7"], octopus:["🐙","#FADADD"], whale:["🐳","#D8ECFA"], turtle:["🐢","#DFF2DA"],
  bee:["🐝","#FFF1BF"], butterfly:["🦋","#DCEBFF"], avocado:["🥑","#E3F2D5"], strawberry:["🍓","#FDE0E0"], lemon:["🍋","#FFF6C9"], cookie:["🍪","#F4E4D0"] };
function avatar(p, size){
  const cls = "av" + (size ? " " + size : "");
  if (p && /^https:\/\//.test(p.avatar)) return `<img class="${cls}" src="${esc(p.avatar)}" alt="" decoding="async">`;
  const a = p && AVATARS[String(p.avatar || "").replace("preset:", "")];
  if (a) return `<span class="${cls}" style="--av:${a[1]}" aria-hidden="true">${a[0]}</span>`;
  return `<span class="${cls} anon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="9" r="4"/><path d="M4 20.5a8 8 0 0 1 16 0z"/></svg></span>`;
}

/* ---------- guess a category + unit from an item name (English + Arabic) ---------- */
const CAT_UNIT = {1:"kg",2:"bottle",3:"pack",4:"jar",5:"pack",6:"bottle",7:"roll",8:"pcs",9:"kg",10:"pcs",11:"bag"};
const GUESS = [   // [category id, unit, keywords]. The longest matching keyword wins.
  [1,"kg","rice|basmati|flour|lentil|lentils|beans|fava beans|foul|chickpeas|bulgur|freekeh|semolina|couscous|roz|رز|أرز|دقيق|عدس|فول|حمص|برغل|سميد|فريك|كسكسي"],
  [1,"pack","pasta|macaroni|spaghetti|penne|noodles|indomie|vermicelli|starch|bread|toast|baladi|pita|oats|oatmeal|cornflakes|cereal|biscuit|biscuits|crackers|rusk|croissant|yeast|breadcrumbs|cake|مكرونة|معكرونة|اسباجتي|اندومي|شعرية|نشا|عيش|خبز|توست|شوفان|كورن فليكس|بسكويت|بقسماط|خميرة|كيك|كرواسون"],
  [2,"bottle","oil|olive oil|sunflower oil|corn oil|vinegar|ketchup|soy sauce|hot sauce|sauce|bbq sauce|dressing|زيت|زيت زيتون|خل|كاتشب|صويا|شطة|صوص"],
  [2,"jar","mustard|mayonnaise|mayo|pickle|pickles|olives|ghee|samna|مستردة|مسطردة|مايونيز|مخلل|مخللات|طرشي|زيتون|سمنة"],
  [2,"can","tomato paste|tomato sauce|paste|صلصة|معجون طماطم"],
  [3,"pack","salt|pepper|black pepper|paprika|cumin|coriander|cinnamon|turmeric|curry|ginger|cardamom|nutmeg|cloves|oregano|thyme|rosemary|bay leaves|chili flakes|spice|spices|seasoning|garlic powder|onion powder|stock cubes|bouillon|maggi|knorr|ملح|فلفل|فلفل اسود|بابريكا|كمون|كزبرة|قرفة|كركم|كاري|زنجبيل|حبهان|هيل|جوزة الطيب|قرنفل|زعتر|اوريجانو|روزماري|ورق لورا|بهارات|توابل|مرقة|ماجي|كنور|شطة مجروشة"],
  [4,"kg","sugar|brown sugar|سكر"],
  [4,"jar","honey|molasses|tahini|jam|nutella|chocolate spread|peanut butter|halawa|halva|syrup|date paste|عسل|عسل اسود|طحينة|مربى|نوتيلا|حلاوة|زبدة فول سوداني|دبس|عجوة"],
  [4,"box","sweetener|stevia|splenda|محلي|ستيفيا"],
  [5,"pack","coffee|turkish coffee|cocoa|قهوة|بن|كاكاو"],
  [5,"jar","nescafe|instant coffee|نسكافيه|نسكافية"],
  [5,"box","tea|tea bags|green tea|herbal tea|شاي|شاي اخضر|ينسون|كركديه"],
  [5,"bottle","water|mineral water|juice|milkshake|مياه|مياه معدنية|عصير"],
  [5,"can","pepsi|cola|coke|coca cola|soda|sprite|7up|seven up|fanta|mirinda|schweppes|red bull|energy drink|بيبسي|كولا|كوكاكولا|سفن اب|سبرايت|فانتا|ميرندا|ريد بول|مشروب"],
  [6,"bottle","dish soap|dishwashing liquid|detergent|washing gel|laundry|fabric softener|softener|bleach|clorox|cleaner|floor cleaner|glass cleaner|disinfectant|dettol|fairy|pril|persil|ariel|air freshener|منظف|صابون مواعين|سائل غسيل|جل غسيل|منعم|كلور|كلوركس|مطهر|ديتول|فيري|بريل|برسيل|اريال|معطر|معطر جو"],
  [6,"bag","washing powder|powder detergent|مسحوق|مسحوق غسيل"],
  [6,"pcs","soap|sponge|sponges|steel wool|mop|broom|scrubber|gloves|صابون|اسفنجة|سلك|ممسحة|مقشة|جوانتي"],
  [7,"roll","toilet paper|kitchen roll|kitchen paper|paper towels|foil|aluminium foil|aluminum foil|cling film|plastic wrap|baking paper|garbage bags|rubbish bags|trash bags|bin bags|freezer bags|bags|ورق تواليت|ورق مطبخ|فويل|الومنيوم|سلوفان|ورق زبدة|اكياس|أكياس زبالة|شنط زبالة|أكياس فريزر"],
  [7,"box","tissue|tissues|napkins|kleenex|facial tissues|مناديل|كلينكس|فاين"],
  [7,"pack","paper cups|paper plates|plastic cups|plastic plates|plastic forks|plastic spoons|straws|اكواب ورق|اطباق ورق|اطباق بلاستيك"],
  [8,"pcs","toothpaste|toothbrush|shampoo|conditioner|shower gel|body wash|hand soap|deodorant|razor|razors|shaving foam|shaving cream|lotion|body lotion|hand cream|face cream|sunscreen|floss|mouthwash|sanitizer|hand sanitizer|hair oil|hair gel|perfume|cotton|cotton buds|معجون|معجون اسنان|فرشاة|فرشة اسنان|شامبو|بلسم|شاور جل|صابون ايد|مزيل عرق|ديودرانت|موس|موس حلاقة|كريم حلاقة|لوشن|كريم|واقي شمس|غسول|معقم|جل شعر|زيت شعر|برفان|قطن"],
  [8,"pack","pads|always|sanitary pads|diapers|pampers|wipes|wet wipes|baby wipes|tampons|فوط|فوط صحية|اولويز|بامبرز|حفاضات|مناديل مبللة|مناديل مبلولة"],
  [9,"kg","beef|meat|steak|minced meat|mince|ground beef|veal|lamb|mutton|liver|chicken|chicken breast|chicken thighs|chicken wings|wings|fillet|turkey|duck|rabbit|fish|salmon|tilapia|shrimp|shrimps|prawns|calamari|kofta|لحم|لحمة|لحمة مفرومة|مفروم|كبدة|كلاوي|كندوز|بتلو|ضاني|فراخ|دجاج|صدور فراخ|اوراك|اجنحة|ديك رومي|بط|ارانب|سمك|بلطي|سلمون|جمبري|كاليماري|كفتة|فيليه|استيك|بفتيك"],
  [9,"pcs","whole chicken|فرخة"],
  [9,"pack","burger|burgers|sausage|sausages|hot dog|hot dogs|برجر|سجق|هوت دوج"],
  [9,"can","tuna|sardines|تونة|سردين"],
  [10,"L","milk|full cream milk|skimmed milk|laban|لبن|حليب"],
  [10,"pcs","yogurt|yoghurt|zabadi|rayeb|actimel|butter|zebda|kiri|la vache|cream cheese|زبادي|رايب|اكتيميل|زبدة|كيري|لافاش|جبنة مثلثات"],
  [10,"kg","cheese|gebna|feta|cheddar|mozzarella|roumi|halloumi|gouda|edam|white cheese|old cheese|cottage cheese|labneh|luncheon|salami|pastrami|turkey slices|smoked turkey|جبنة|جبن|جبنة بيضاء|جبنة رومي|رومي|موتزاريلا|شيدر|فيتا|حلومي|جودة|ايدام|قريش|لبنة|مش|لانشون|سلامي|بسطرمة|تركي مدخن"],
  [10,"pack","cream|cooking cream|whipping cream|qishta|eshta|قشطة|كريمة|كريمة طبخ|كريمة خفق"],
  [10,"tray","eggs|egg|بيض"],
  [11,"bag","frozen|frozen vegetables|mixed vegetables|peas|green beans|okra|molokhia|spinach|corn|fries|french fries|nuggets|frozen pizza|بسلة|فاصوليا خضراء|بامية|ملوخية|سبانخ|ذرة|خضار مشكل|خضار مجمد|مجمد|مجمدة|بطاطس محمرة|بطاطس مجمدة|ناجتس"],
  [11,"box","ice cream|ايس كريم|آيس كريم|جيلاتي"]
];
// Lower-case, strip accents/harakat, unify alef/taa marbuta/yaa so spellings match.
const norm = s => String(s).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, "")
  .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const GUESS_RULES = GUESS.flatMap(([cat, unit, words]) => words.split("|").map(w => {
  const k = norm(w), latin = /[a-z0-9]/.test(k), esk = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // English: whole words (+ plural). Short Arabic words: whole word, optional "ال". Longer Arabic: anywhere in the name.
  const re = latin ? new RegExp(`(?:^| )${esk}(?:s|es)?(?= |$)`) : k.length <= 3 ? new RegExp(`(?:^| )(?:ال|وال|بال)?${esk}(?= |$)`) : null;
  return { cat, unit, k, len: k.length, test: re ? t => re.test(t) : t => t.includes(k) };
}));
function guessCategory(name){
  const t = norm(name); let best = null;
  if (t) GUESS_RULES.forEach(r => { if (r.len > (best ? best.len : 0) && CATS.some(c => c.id === r.cat) && r.test(t)) best = r; });
  return best && { cat: best.cat, unit: best.unit };
}

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
function cache(){ try { localStorage.setItem(CACHE, JSON.stringify({CATS, ITEMS, sessions, PROFILES})); } catch(e){} }
const chev = `<span class="chev" aria-hidden="true"><i></i><i></i></span>`;
const hueOf = id => { const c = CATS.find(c => c.id === id); return c ? c.hue : "#0071E3"; };

/* ---------- dates (device-local calendar day) ---------- */
const pad = n => String(n).padStart(2, "0");
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
function longDate(k){ const d = parseDay(k);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }); }
const shortDay = k => { const y = new Date(); y.setDate(y.getDate() - 1); return k === dayKey() ? "today" : k === dayKey(y) ? "yesterday" : longDate(k); };
const timeOf = ts => new Date(ts).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
function whenLabel(ts){ const s = shortDay(dayKey(new Date(ts))); return `${s[0].toUpperCase() + s.slice(1)}, ${timeOf(ts)}`; }
function dayLabel(k){
  const y = new Date(); y.setDate(y.getDate() - 1);
  return k === dayKey() ? `Today · ${longDate(k)}` : k === dayKey(y) ? `Yesterday · ${longDate(k)}` : longDate(k);
}
/* The picker edits today's list, or a past day opened with "Edit" in History (editDay). */
let editDay = null, todayStash = null;
const activeDay = () => editDay || dayKey();
const daySession = () => sessions.find(s => s.day === activeDay());
const picks = () => ITEMS.filter(i => stock[i.id]).map(i => ({ item_id: i.id, qty: stock[i.id].qty, unit: stock[i.id].unit }));
const sig = list => JSON.stringify((list || []).map(r => [r.item_id, Number(r.qty), r.unit]).sort((a, b) => a[0] < b[0] ? -1 : 1));
const isDirty = () => sig(picks()) !== sig(daySession() ? daySession().items : []);
function loadDay(){ stock = {}; const t = daySession(); if (t) t.items.forEach(r => { stock[r.item_id] = { qty: Number(r.qty), unit: r.unit }; }); }
function startEdit(day){
  if (day === dayKey()){ if (editDay) stopEdit(); go("catsBlock"); return; }
  if (!editDay) todayStash = isDirty() ? { ...stock } : null;   // keep unsaved picks for today
  editDay = day; if (selected) selectItem(selected);
  loadDay(); render(); renderHistory(); go("catsBlock");
}
function stopEdit(){
  if (!editDay) return;
  editDay = null; if (selected) selectItem(selected);
  if (todayStash) stock = todayStash; else loadDay();
  todayStash = null; render(); renderHistory();
}

/* ---------- build ---------- */
function build(){
  catsEl.innerHTML = ""; picker = null;
  byId = Object.fromEntries(ITEMS.map(i => [i.id, i]));
  $("#totalItems").textContent = ITEMS.length; $("#totalCats").textContent = CATS.filter(c => !c.seasonal || ITEMS.some(i => i.cat === c.id)).length;
  CATS.forEach(c => {
    const its = ITEMS.filter(i => i.cat === c.id);
    if (c.seasonal && !its.length) return;   // the Seasonal group only shows once something is in it
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
    const f = its.filter(i => stock[i.id]).length; filledTotal += f;
    const open = openCats.has(c.id);
    sec.classList.toggle("open", open); sec.classList.toggle("has", f > 0);
    sec.querySelector(".cat-head").setAttribute("aria-expanded", open);
    sec.querySelector(".cat-count").textContent = f ? `${f} of ${its.length}` : `${its.length}`;
    sec.querySelector(".cat-sub").textContent = (c.sub ? c.sub + " · " : "") + its.length + (its.length === 1 ? " item" : " items");
  });
  ITEMS.forEach(it => {
    const li = catsEl.querySelector(`.item[data-id="${it.id}"]`); if (!li) return;
    const s = stock[it.id]; const qty = s ? s.qty : 0, unit = (s && s.unit) || it.unit;
    li.classList.toggle("filled", !!s); li.classList.toggle("sel", selected === it.id);
    li.querySelector(".item-row").setAttribute("aria-expanded", selected === it.id);
    const b = li.querySelector(".badge"); const txt = s ? `${fmt(qty)} ${unit}` : "—";
    if (b.textContent !== txt){ b.textContent = txt; if (changed && changed.has(it.id)){ b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); } }
    b.classList.toggle("has", !!s && qty > 0); b.classList.toggle("zero", !!s && qty === 0);
  });
  $("#filledCount").textContent = `${filledTotal} of ${ITEMS.length}`;
  $("#todayLbl").textContent = longDate(activeDay());
  $("#heroSub").textContent = editDay ? `Editing ${longDate(editDay)}.` : "Pick today's items.";
  $("#editBanner").hidden = !editDay; $("#editDayLbl").textContent = editDay ? longDate(editDay) : "";
  $("#seasonalMenu").hidden = !seasonalCat();
  renderConfirm(filledTotal); renderNow();
}

let justSaved = false, justSavedT;
function renderConfirm(n){
  const bar = $("#confirmBar"), btn = $("#confirmBtn"), t = daySession(), dirty = isDirty(), past = !!editDay;
  $("#confirmCount").textContent = n === 1 ? "1 item picked" : `${n} items picked`;
  $("#confirmHint").textContent = past ? `Editing ${longDate(editDay)}${dirty ? "" : " · no changes yet"}`
    : !dirty && t ? (n ? "Saved for today" : "Today's list cleared") : t ? "Confirm to replace today's list" : `For today · ${longDate(dayKey())}`;
  btn.disabled = saving || !dirty || (!t && n === 0);
  btn.querySelector("span").textContent = saving ? "Saving…" : past ? "Save" : !dirty && t ? "Saved" : "Confirm";
  bar.classList.toggle("done", !past && !dirty && !!t); bar.classList.toggle("editing", past);
  $("#editCancel").hidden = !past;
  // Only visible while there's something to confirm, briefly after saving, and while editing a past day.
  const show = saving || dirty || justSaved || past;
  bar.classList.toggle("show", show);
  document.body.classList.toggle("has-bar", show);
}

/* ---------- iOS-style wheel picker (quantity + unit) ---------- */
const ROW = 36;
const unitClass = u => HALF.has(u) ? "half" : FIFTY.has(u) ? "fifty" : "one";
// Index 0 is null ("—", not entered). A typed value that isn't a wheel step is inserted in order.
function qtyValues(u, extra){ const a = [null], c = unitClass(u);
  for (let i = 0; i <= (c === "half" ? 200 : 100); i++) a.push(c === "half" ? i / 2 : c === "fifty" ? i * 50 : i);
  if (extra != null && !a.includes(extra)){ a.push(extra); a.sort((x, y) => x === null ? -1 : y === null ? 1 : x - y); }
  return a; }
const qtyLabels = vals => vals.map(v => v === null ? "—" : fmt(v));
const qtyIndex = (vals, s) => s ? Math.max(1, vals.indexOf(s.qty)) : 0;
const unitSel = () => picker.unit.values[picker.unit.idx];
let picker = null;   // { id, li, cls, qty: wheel, unit: wheel }

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
    if (w === picker.qty){ const v = w.values[idx]; v === null ? unsetItem(picker.id) : setItem(picker.id, v, unitSel()); syncTyped(); }
    else changeUnit(w.values[idx]);
  });
}
function changeUnit(u){
  const id = picker.id, cur = stock[id];
  let q = cur ? cur.qty : null;
  if (unitClass(u) !== picker.cls){
    picker.cls = unitClass(u);
    const vals = qtyValues(u); let i = q === null ? 0 : vals.indexOf(q); if (i < 0) i = q > 0 ? 2 : 1;
    q = vals[i]; fillWheel(picker.qty, vals, qtyLabels(vals), i); syncTyped();
  }
  if (q !== null) setItem(id, q, u);
  const tu = picker.li.querySelector(".type-unit"); if (tu) tu.textContent = u;
}
function syncTyped(force){ const inp = picker && picker.li.querySelector(".type-in"); if (inp && (force || document.activeElement !== inp)){ const s = stock[picker.id]; inp.value = s ? fmt(s.qty) : ""; } }
function mountPicker(li){
  const id = li.dataset.id, s = stock[id], unit = s ? s.unit : byId[id].unit;
  if (picker && picker.li !== li){ const old = picker.li.querySelector(".picker-slot"); setTimeout(() => { if (!picker || picker.li !== old.closest(".item")) old.innerHTML = ""; }, 500); }
  const slot = li.querySelector(".picker-slot");
  slot.innerHTML = `${itemHistHtml(id)}<div class="picker"><div class="band"></div><div class="wheel" role="listbox" aria-label="Quantity"></div><div class="wheel" role="listbox" aria-label="Unit"></div></div>
    <div class="type-row" hidden><input class="type-in" type="number" inputmode="decimal" min="0" max="100000" step="any" placeholder="Amount" aria-label="Type amount for ${esc(byId[id].name)}"><span class="type-unit">${esc(unit)}</span></div>
    <div class="picker-foot"><button class="linkbtn clear" type="button">Clear</button><button class="linkbtn type" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg>Type amount</button><button class="linkbtn done" type="button">Done</button></div>`;
  const [qEl, uEl] = slot.querySelectorAll(".wheel");
  picker = { id, li, cls: unitClass(unit), qty: { el: qEl }, unit: { el: uEl } };
  const vals = qtyValues(unit, s ? s.qty : null);
  fillWheel(picker.unit, UNITS, UNITS, Math.max(0, UNITS.indexOf(unit)));
  fillWheel(picker.qty, vals, qtyLabels(vals), qtyIndex(vals, s));
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
/* Each saved amount is what's at home that day, so an item's latest entry replaces the earlier ones (1 L, then 0.5 L = 0.5 L). */
const itemHistory = (id, before) => sessions.filter(s => !before || s.day < before).flatMap(s => {   // newest first
  const r = s.items.find(r => r.item_id === id); return r ? [{ day: s.day, qty: Number(r.qty), unit: r.unit }] : []; });
const qtyTxt = r => `${fmt(r.qty)} ${r.unit}`;
function itemHistHtml(id){
  const h = itemHistory(id, activeDay()), last = h[0];
  if (!last) return `<div class="item-hist"><p class="ih-last">First time counting ${esc(byId[id].name)}.</p></div>`;
  return `<div class="item-hist"><p class="ih-last">You had <b>${esc(qtyTxt(last))}</b> left · ${esc(shortDay(last.day))}</p><p class="ih-now" hidden></p>${h.length > 1 ? `
    <ul class="ih-list" aria-label="Earlier entries">${h.slice(1, 6).map(r => `<li><span>${esc(shortDay(r.day))}</span><b>${esc(qtyTxt(r))}</b></li>`).join("")}</ul>` : ""}</div>`;
}
// Live line under "You had …": what's left now and the change since the last count.
function renderNow(){
  const el = picker && picker.li.querySelector(".ih-now"); if (!el) return;
  const last = itemHistory(picker.id, activeDay())[0], s = stock[picker.id];
  el.hidden = !s || !last; if (el.hidden) return;
  const d = Math.round((s.qty - last.qty) * 100) / 100;
  el.innerHTML = `Now <b>${esc(qtyTxt(s))}</b>` + (s.unit !== last.unit ? "" : d < 0 ? ` · used ${esc(fmt(-d))} ${esc(s.unit)}` : d > 0 ? ` · ${esc(fmt(d))} ${esc(s.unit)} more` : " · no change");
}
function latest(){   // item_id -> [latest entry, previous entry]
  const t = {};
  ITEMS.forEach(i => { const h = itemHistory(i.id); if (h.length) t[i.id] = h; });
  return t;
}
function renderHistory(){
  if (!built) return;
  shopRefresh();
  const body = $("#histBody"), days = sessions.filter(s => s.items.length);
  $("#histMeta").textContent = days.length ? `${days.length} ${days.length === 1 ? "day" : "days"} saved.` : "Nothing saved yet.";
  $(".seg").dataset.sel = histTab;
  document.querySelectorAll(".seg button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === histTab));
  if (histTab === "activity"){ renderActivity(body); return; }
  if (!days.length){ body.innerHTML = `<p class="hist-empty">Pick items and press <b>Confirm</b>.<br>Each day's list shows up here.</p>`; return; }
  if (histTab === "dates"){
    body.innerHTML = days.map(s => { const open = openDays.has(s.day), rows = s.items.filter(r => byId[r.item_id]).sort((a, b) => byId[a.item_id].no - byId[b.item_id].no);
      const by = s.updated_at ? `<span class="day-by">${s.saved_by_profile ? `Saved by ${esc(whoName(s.saved_by_profile))} · ` : "Saved "}${esc(timeOf(s.updated_at))}</span>` : "";
      return `<div class="day${open ? " open" : ""}${s.day === editDay ? " editing" : ""}" data-day="${s.day}">
        <button class="day-head" type="button" aria-expanded="${open}">${avatar(PROFILES[s.saved_by_profile], "s32")}<span class="day-t"><span class="day-date">${esc(dayLabel(s.day))}</span>${by}</span><span class="day-n">${rows.length} ${rows.length === 1 ? "item" : "items"}</span>${chev}</button>
        <div class="day-body"><div><table class="htable"><tbody>${rows.map(r => itemRow(r.item_id, `${fmt(Number(r.qty))} ${esc(r.unit)}`)).join("")}</tbody></table>
          <div class="day-acts"><button class="pill outline small edit-day" type="button" data-day="${s.day}"${s.day === editDay ? " disabled" : ""}>${s.day === editDay ? "Editing now" : "Edit this day"}</button></div></div></div></div>`; }).join("");
  } else {
    const t = latest();
    body.innerHTML = `<p class="hist-note">What's at home now: each item's latest count.</p>
      <table class="htable totals"><thead><tr><th>Item</th><th>Left</th></tr></thead><tbody>${ITEMS.filter(i => t[i.id]).map(i => { const [l, p] = t[i.id];
        return itemRow(i.id, `${esc(qtyTxt(l))}<span class="when">${esc(shortDay(l.day))}${p ? ` · was ${esc(qtyTxt(p))}` : ""}</span>`); }).join("")}</tbody></table>`;
  }
}
function changeRow(c){
  const nm = byId[c.item_id] ? byId[c.item_id].name : c.item_id, q = v => `${fmt(Number(v.qty))} ${v.unit}`;
  if (!c.from) return `<li><i class="chg add" aria-label="added">+</i><span>${esc(nm)}</span><b${Number(c.to.qty) === 0 ? ' class="gone"' : ""}>${esc(q(c.to))}</b></li>`;
  if (!c.to) return `<li><i class="chg rem" aria-label="removed">−</i><span>${esc(nm)}</span><b class="muted">removed</b></li>`;
  return `<li><i class="chg edit" aria-label="changed">↻</i><span>${esc(nm)}</span><b>${esc(c.from.unit === c.to.unit ? fmt(Number(c.from.qty)) : q(c.from))} → ${esc(q(c.to))}</b></li>`;
}
function renderActivity(body){
  if (!activity.length){ body.innerHTML = `<p class="hist-empty">No activity yet.<br>Every save and new item shows up here with who did it.</p>`; return; }
  body.innerHTML = `<ul class="acts">${activity.map(a => {
    const who = `<b>${esc(whoName(a.profile_id))}</b>`, d = a.details || {};
    let what = "", extra = "";
    if (a.kind === "save"){ const ch = d.changes || [];
      what = `${who} ${a.day && a.day !== dayKey(new Date(a.at)) ? "edited" : "saved"} the list for ${esc(shortDay(a.day))}`;
      extra = `<ul class="chgs">${ch.slice(0, 8).map(changeRow).join("")}${ch.length > 8 ? `<li class="more">+ ${ch.length - 8} more changes</li>` : ""}</ul>`; }
    else if (a.kind === "add_item"){ const c = CATS.find(c => c.id === d.category_id);
      what = `${who} added a new item`;
      extra = `<ul class="chgs"><li><i class="chg add" aria-label="added">+</i><span>${esc(d.name)}</span><b class="muted">${esc(c ? c.name : "")} · ${esc(d.unit)}</b></li></ul>`; }
    else if (a.kind === "reset"){ what = `${who} reset all history`; extra = `<p class="act-note">${d.days || 0} saved ${d.days === 1 ? "day" : "days"} deleted</p>`; }
    return `<li class="act">${avatar(PROFILES[a.profile_id], "s32")}<div><p class="act-t">${what}</p>${extra}<time datetime="${esc(a.at)}">${esc(whenLabel(a.at))}</time></div></li>`;
  }).join("")}</ul>`;
}
function setTab(tab){ if (histTab === tab) return; histTab = tab; renderHistory(); }
$("#history").addEventListener("click", e => {
  const tab = e.target.closest(".seg button");
  if (tab){ if (tab.dataset.tab !== histTab) fb.tap(); setTab(tab.dataset.tab); return; }
  const ed = e.target.closest(".edit-day");
  if (ed){ fb.tap(); startEdit(ed.dataset.day); return; }
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
function unsetItem(id){ delete stock[id]; render(new Set([id])); }

/* ---------- confirm: save today's list (replaces today's row) ---------- */
$("#confirmBtn").onclick = async () => {
  if (!sb){ fb.error(); toast("You're offline. Connect and try again."); return; }
  if (needProfile(() => $("#confirmBtn").click(), "Add your name first, so everyone can see who saved this list.")) return;
  fb.tap();
  const day = activeDay(), items = picks();
  saving = true; render(); setSave("saving", "Saving");
  const { error } = await sb.from("purchases_sessions").upsert({ day, items, saved_by: DEVICE, saved_by_profile: me.id });
  saving = false;
  if (error){ setSave("", "Not saved"); render(); fb.error(); toast("Couldn't save. Check your connection and try again."); return; }
  const i = sessions.findIndex(s => s.day === day);
  const row = { day, items, saved_by_profile: me.id, updated_at: new Date().toISOString() };
  if (i >= 0) sessions[i] = row; else { sessions.push(row); sessions.sort((a, b) => a.day < b.day ? 1 : -1); }
  refreshActivity();
  openDays.clear(); openDays.add(day); histTab = "dates";
  if (editDay){   // past day saved: back to today, show the updated day in History
    stopEdit(); cache(); setSave("saved", "Saved"); fb.success(); toast(`Saved changes to ${longDate(day)}.`); go("history"); return;
  }
  justSaved = true; clearTimeout(justSavedT); justSavedT = setTimeout(() => { justSaved = false; render(); }, 2000);
  cache(); setSave("saved", "Saved"); render(); renderHistory(); fb.success();
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
  const { data, error } = await sb.rpc("purchases_reset_history", { passcode: code, p_profile: myProfile() ? me.id : null });
  go.disabled = false;
  if (error){ fb.error(); $("#resetErr").textContent = /locked/.test(error.message) ? "Too many wrong tries. Wait 15 minutes." : "Couldn't reset. Check your connection."; return; }
  if (data < 0){ fb.error(); $("#resetErr").textContent = "Wrong passcode."; $("#passcode").select(); return; }
  editDay = null; todayStash = null; sessions = []; stock = {}; ticks.clear(); try { localStorage.removeItem(TICKS_KEY); } catch(e){} openDays.clear(); if (selected) selectItem(selected); cache(); render(); renderHistory(); dlg.close(); refreshActivity();
  fb.success(); toast("History reset.");
});

/* ---------- "Recently saved" pop-up, once per app open ---------- */
let recentShown = false;
function showRecent(){
  if (recentShown) return; recentShown = true;
  const last = sessions.find(s => s.items.length); if (!last) return;
  const rows = last.items.filter(r => byId[r.item_id]).sort((a, b) => byId[a.item_id].no - byId[b.item_id].no), shown = rows.slice(0, 6);
  $("#recentMeta").textContent = `${dayLabel(last.day)} · ${rows.length} ${rows.length === 1 ? "item" : "items"}`;
  $("#recentList").innerHTML = shown.map(r => itemRow(r.item_id, `<span${Number(r.qty) === 0 ? ' class="qty-zero"' : ""}>${fmt(Number(r.qty))} ${esc(r.unit)}</span>`)).join("")
    + (rows.length > shown.length ? `<tr class="more"><td colspan="2">+ ${rows.length - shown.length} more</td></tr>` : "");
  const by = last.saved_by_profile, byEl = $("#recentBy"); byEl.hidden = !by;
  if (by) byEl.innerHTML = `${avatar(PROFILES[by], "s22")}<span>Saved by <b>${esc(whoName(by))}</b>${last.updated_at ? ` · ${esc(timeOf(last.updated_at))}` : ""}</span>`;
  $("#recentDlg").dataset.day = last.day;
  if (!document.querySelector("dialog[open]")) $("#recentDlg").showModal();
}
$("#recentOk").onclick = () => { fb.tap(); $("#recentDlg").close(); };
$("#recentHist").onclick = () => { fb.tap(); const d = $("#recentDlg"); d.close(); openDays.clear(); openDays.add(d.dataset.day); histTab = "dates"; renderHistory(); go("history"); };
$("#recentDlg").addEventListener("click", e => {   // tap outside the sheet closes it
  const d = e.currentTarget, r = d.getBoundingClientRect();
  if (e.target === d && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) d.close();
});

/* ---------- profile sheet: name + preset avatar or uploaded photo ---------- */
const pfDlg = $("#profileDlg"), pfNoteDefault = $("#pfNote").textContent;
let pfAvatar = null, pfThen = null, pfBusy = false;
$("#avGrid").innerHTML = Object.entries(AVATARS).map(([k, [e, bg]]) =>
  `<button type="button" class="av-opt" role="radio" aria-checked="false" aria-label="${k}" data-av="preset:${k}"><span class="av" style="--av:${bg}">${e}</span></button>`).join("");
function renderMe(){
  const p = myProfile();
  $("#meAv").innerHTML = avatar(p); $("#meName").textContent = p ? p.name : "Profile";
  $("#meBtn").setAttribute("aria-label", p ? `Your profile: ${p.name}` : "Create your profile");
  $("#profileLbl").textContent = p ? `Profile: ${p.name}` : "Create your profile";
}
function pfPaint(){
  $("#pfPreview").innerHTML = avatar({ avatar: pfAvatar }, "lg");
  $("#avGrid").querySelectorAll(".av-opt").forEach(b => b.setAttribute("aria-checked", b.dataset.av === pfAvatar));
}
function openProfile(then, note){
  const p = myProfile(), keys = Object.keys(AVATARS); pfThen = then || null;
  pfAvatar = p ? p.avatar : "preset:" + keys[Math.floor(Math.random() * keys.length)];
  $("#pfName").value = p ? p.name : ""; $("#pfErr").textContent = ""; $("#pfNote").textContent = note || pfNoteDefault;
  $("#pfTitle").textContent = p ? "Your profile" : "Who's picking?"; $("#pfCancel").textContent = p ? "Cancel" : "Not now";
  $("#pfFileLbl").textContent = "Upload your own photo"; pfPaint();
  document.querySelectorAll("dialog[open]").forEach(d => d.close());
  pfDlg.showModal();
}
function needProfile(then, note){ if (myProfile()) return false; openProfile(then, note); return true; }
pfDlg.addEventListener("close", () => { const t = pfThen; pfThen = null; if (t && myProfile()) setTimeout(t, 250); else if (loaded) setTimeout(showRecent, 250); });
$("#avGrid").addEventListener("click", e => { const b = e.target.closest(".av-opt"); if (!b) return; fb.tap(); pfAvatar = b.dataset.av; pfPaint(); });
$("#pfCancel").onclick = () => { fb.tap(); pfThen = null; pfDlg.close(); };
// Photos are centre-cropped to 256×256 JPEG on the phone before upload (small, and strips location data).
function squareJpeg(file, size){
  return new Promise((ok, bad) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(img.naturalWidth, img.naturalHeight), c = document.createElement("canvas"); c.width = c.height = size;
      const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, size, size);
      x.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url); c.toBlob(b => b ? ok(b) : bad(new Error("encode")), "image/jpeg", 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); bad(new Error("decode")); };
    img.src = url;
  });
}
$("#pfFile").addEventListener("change", async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = ""; if (!f) return;
  if (!sb){ fb.error(); $("#pfErr").textContent = "You're offline."; return; }
  pfBusy = true; $("#pfSave").disabled = true; $("#pfErr").textContent = ""; $("#pfFileLbl").textContent = "Uploading…";
  try {
    const blob = await squareJpeg(f, 256), path = `${me.id}/${Date.now().toString(36)}.jpg`;
    const { error } = await sb.storage.from("purchases-avatars").upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
    if (error) throw error;
    pfAvatar = sb.storage.from("purchases-avatars").getPublicUrl(path).data.publicUrl; pfPaint(); fb.success();
    $("#pfFileLbl").textContent = "Choose a different photo";
  } catch(err){ fb.error(); $("#pfErr").textContent = "Couldn't use that photo. Try another one."; $("#pfFileLbl").textContent = "Upload your own photo"; }
  pfBusy = false; $("#pfSave").disabled = false;
});
$("#profileForm").addEventListener("submit", async e => {
  e.preventDefault(); if (pfBusy) return;
  const name = $("#pfName").value.trim().replace(/\s+/g, " ");
  if (!name){ fb.error(); $("#pfErr").textContent = "Type your name."; return; }
  if (!sb){ fb.error(); $("#pfErr").textContent = "You're offline."; return; }
  fb.tap(); $("#pfSave").disabled = true;
  const { data, error } = await sb.rpc("purchases_profile_save", { p_id: me.id, p_key: me.key, p_name: name, p_avatar: pfAvatar });
  $("#pfSave").disabled = false;
  if (error || !data){ fb.error(); $("#pfErr").textContent = error && /not_yours/.test(error.message) ? "This profile belongs to another device." : "Couldn't save. Check your connection."; return; }
  const first = !myProfile(); PROFILES[me.id] = { id: data.id, name: data.name, avatar: data.avatar };
  cache(); renderMe(); renderHistory(); fb.success(); pfDlg.close();
  toast(first ? `Welcome, ${data.name}!` : "Profile saved.");
});
$("#meBtn").onclick = () => { fb.tap(); if (menuOpen()) setMenu(false); openProfile(); };

/* ---------- add an item: category + unit picked automatically, both can be changed ---------- */
const addDlg = $("#addDlg"); let catPicked = false, unitPicked = false, addSeasonal = false;
// Seasonal items live in their own temporary category; Full Reset removes them.
const seasonalCat = () => CATS.find(c => c.seasonal);
$("#addUnit").innerHTML = UNITS.map(u => `<option value="${u}">${u}</option>`).join("");
function openAdd(name, seasonal){
  if (needProfile(() => openAdd(name, seasonal), "Add your name first, so everyone can see who added the item.")) return;
  const sc = seasonal && seasonalCat(); if (seasonal && !sc){ toast("Seasonal items aren't switched on yet."); return; }
  catPicked = unitPicked = false; addSeasonal = !!sc;
  $("#addCat").innerHTML = sc ? `<option value="${sc.id}">${esc(sc.name)}</option>`
    : `<option value="">Choose a category</option>` + CATS.filter(c => !c.seasonal).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
  $("#addCatFld").hidden = !!sc;
  $("#addTitle").textContent = sc ? "Add a seasonal item" : "Add an item";
  $("#addNameLbl").textContent = sc ? "What's the seasonal item?" : "Item name";
  $("#addName").placeholder = sc ? "e.g. Vanilla" : "e.g. Cheddar cheese";
  $("#addName").value = name || ""; $("#addErr").textContent = ""; addGuess();
  document.querySelectorAll("dialog[open]").forEach(d => d.close());
  addDlg.showModal();
}
function addGuess(){
  const name = $("#addName").value.trim().replace(/\s+/g, " "), low = name.toLowerCase();
  const dup = name && ITEMS.find(i => i.name.toLowerCase() === low), g = name ? guessCategory(name) : null, sel = $("#addCat"), hint = $("#addHint");
  if (!catPicked && !addSeasonal) sel.value = g ? String(g.cat) : "";
  const cat = +sel.value || null;
  if (!unitPicked) $("#addUnit").value = g && (addSeasonal || g.cat === cat) ? g.unit : CAT_UNIT[cat] || "pcs";
  $("#addAuto").hidden = catPicked || !g;
  hint.className = "add-hint" + (dup ? " warn" : "");
  hint.textContent = dup ? `"${dup.name}" is already on the list, in ${CATS.find(c => c.id === dup.cat).name}.`
    : addSeasonal ? (name ? "Goes in Seasonal until the next Full Reset." : "Type the item. It stays in Seasonal until the next Full Reset.")
    : !name ? "Type a name and the app picks a category."
    : catPicked ? "You chose the category." : g ? "Category picked automatically. You can change it." : "Couldn't tell the category. Please choose one.";
  $("#addGo").disabled = !name || !!dup || !cat;
}
$("#addName").addEventListener("input", addGuess);
$("#addCat").addEventListener("change", () => { catPicked = true; fb.tap(); addGuess(); });
$("#addUnit").addEventListener("change", () => { unitPicked = true; fb.tap(); });
$("#addCancel").onclick = () => { fb.tap(); addDlg.close(); };
$("#addForm").addEventListener("submit", async e => {
  e.preventDefault(); const btn = $("#addGo"); if (btn.disabled) return;
  const name = $("#addName").value.trim().replace(/\s+/g, " "), cat = +$("#addCat").value, unit = $("#addUnit").value;
  if (!sb){ fb.error(); $("#addErr").textContent = "You're offline."; return; }
  fb.tap(); btn.disabled = true; $("#addErr").textContent = "";
  const { data: id, error } = await sb.rpc("purchases_add_item", { p_name: name, p_category: cat, p_unit: unit, p_profile: me.id });
  btn.disabled = false;
  if (error){ fb.error(); $("#addErr").textContent = /exists/.test(error.message) ? "That item is already on the list." : /no_profile/.test(error.message) ? "Save your profile first." : "Couldn't add it. Check your connection."; return; }
  addDlg.close(); fb.success();
  await reloadItems(); refreshActivity();
  const c = CATS.find(c => c.id === cat); toast(`Added ${name} to ${c ? c.name : "the list"}.`);
  const s = $("#search"); if (s.value){ s.value = ""; s.dispatchEvent(new Event("input")); }
  openCats.add(cat); render();
  const li = catsEl.querySelector(`.item[data-id="${CSS.escape(id)}"]`);
  if (li){ li.classList.add("new"); setTimeout(() => li.scrollIntoView({ block: "center", behavior: "smooth" }), 350); setTimeout(() => li.classList.remove("new"), 2600); }
});

/* ---------- push notifications + app-icon badge ---------- */
const DEVICE = (() => { try { let d = localStorage.getItem("purchases-device");
  if (!d){ d = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("purchases-device", d); } return d; } catch(e){ return null; } })();
const pushOk = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const keyBytes = k => { const b = atob((k + "=".repeat((4 - k.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, c => c.charCodeAt(0)); };
let swReg = null, pushOn = false;
function notifyLabel(){ $("#notifyLbl").textContent = `Notifications: ${pushOn ? "On" : "Off"}`; }
async function saveSub(sub){ const j = sub.toJSON();
  return sb.rpc("purchases_push_subscribe", { sub_endpoint: j.endpoint, sub_p256dh: j.keys.p256dh, sub_auth: j.keys.auth, sub_device: DEVICE, sub_profile: me.id }); }
function clearBadge(){
  if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  if (window.caches) caches.open("purchases-meta").then(c => c.delete("/__badge-count")).catch(() => {});
}
if ("serviceWorker" in navigator){
  navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready).then(async r => {
    swReg = r;
    const sub = pushOk() && Notification.permission === "granted" ? await r.pushManager.getSubscription() : null;
    pushOn = !!sub; notifyLabel();
    if (sub && sb) saveSub(sub);   // keep the server copy fresh (endpoints can rotate)
  }).catch(() => {});
}
clearBadge();
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") clearBadge(); });
// Tapping a notification opens Activity (sw.js sends a message to an open app, or launches it at /#activity).
function openActivity(){ setTab("activity"); go("history"); }
if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", e => { if (e.data && e.data.open === "activity") openActivity(); });
async function toggleNotify(){
  if (!pushOk() || !sb){ toast(isIOS && !standalone ? "First add the app to your Home Screen: Share → Add to Home Screen, then open it from the icon." : "This browser can't show notifications."); return; }
  if (!swReg){ toast("Still starting up. Try again in a second."); return; }
  if (pushOn){
    const sub = await swReg.pushManager.getSubscription();
    if (sub){ await sb.rpc("purchases_push_unsubscribe", { sub_endpoint: sub.endpoint }); await sub.unsubscribe().catch(() => {}); }
    pushOn = false; notifyLabel(); toast("Notifications off on this device."); return;
  }
  let sub;
  try { sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(cfg.vapidPublicKey) }); }   // shows the permission prompt
  catch(e){ fb.error(); toast(Notification.permission === "denied" ? "Notifications are blocked. Allow them in Settings → Notifications → Purchases." : "Couldn't turn on notifications. Try again."); return; }
  const { error } = await saveSub(sub);
  if (error){ fb.error(); toast("Couldn't turn on notifications. Check your connection."); return; }
  pushOn = true; notifyLabel(); fb.success(); toast("Notifications on. You'll be told what others change on the list.");
}

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
  if (g === "notify"){ fb.tap(); toggleNotify(); return; }   // stays in the tap so iOS allows the permission prompt
  fb.tap(); setMenu(false);
  setTimeout(() => {
    if (g === "history" || g === "totals" || g === "activity"){ setTab(g === "history" ? "dates" : g); go("history"); }
    else if (g === "add") openAdd();
    else if (g === "seasonal") openAdd("", true);
    else if (g === "profile") openProfile();
    else if (g === "cats") go("catsBlock");
    else if (g === "export") exportCsv();
    else if (g === "reset") openReset();
    else if (g === "shop") openShop();
  }, 280);
});
function cancelEdit(){ fb.tap(); const changed = isDirty(); stopEdit(); toast(changed ? "Changes discarded." : "Stopped editing."); }
$("#editStop").onclick = cancelEdit; $("#editCancel").onclick = cancelEdit;
$("#searchBtn").onclick = () => { fb.tap(); go("catsBlock"); setTimeout(() => $("#search").focus({ preventScroll: true }), 350); };
$("#startBtn").onclick = () => { fb.tap(); go("catsBlock"); };
$("#histBtn").onclick = () => { fb.tap(); go("history"); };

/* ---------- interactions ---------- */
catsEl.addEventListener("click", e => {
  if (e.target.closest(".add-miss")){ fb.tap(); $("#search").blur(); openAdd($("#search").value.trim()); return; }
  const head = e.target.closest(".cat-head");
  if (head){ const cid = +head.parentElement.dataset.cid; openCats.has(cid) ? openCats.delete(cid) : openCats.add(cid); fb.tap(); render(); return; }
  const li = e.target.closest(".item"); if (!li) return; const id = li.dataset.id;
  if (e.target.closest(".item-row")){ fb.tap(); selectItem(id); return; }
  if (e.target.closest(".clear") && picker){
    fb.tap(); unsetItem(id); const u = byId[id].unit, vals = qtyValues(u); picker.cls = unitClass(u);
    fillWheel(picker.unit, UNITS, UNITS, Math.max(0, UNITS.indexOf(u))); fillWheel(picker.qty, vals, qtyLabels(vals), 0);
    li.querySelector(".type-unit").textContent = u; syncTyped(true); return; }
  if (e.target.closest(".type") && picker){
    fb.tap(); const row = li.querySelector(".type-row"), inp = row.querySelector(".type-in");
    row.hidden = !row.hidden; if (!row.hidden){ syncTyped(); inp.focus(); inp.select(); } return; }
  if (e.target.closest(".done")){ fb.tap(); selectItem(id); return; }
});
// Typed amount: updates live; on commit the value is added to the wheel so the wheel shows it.
catsEl.addEventListener("input", e => {
  if (!e.target.classList.contains("type-in") || !picker) return;
  const v = e.target.value.trim(); if (v === "" || isNaN(+v)) return;
  setItem(picker.id, +v, unitSel());
});
catsEl.addEventListener("change", e => {
  if (!e.target.classList.contains("type-in") || !picker) return;
  const s = stock[picker.id]; if (!s) return;
  const vals = qtyValues(unitSel(), s.qty); fillWheel(picker.qty, vals, qtyLabels(vals), qtyIndex(vals, s)); fb.tap();
});
catsEl.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.classList.contains("type-in")) e.target.blur(); });
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
  if (!any){ if (!em){ em = document.createElement("div"); em.id = "emptyMsg"; em.className = "empty"; catsEl.appendChild(em); }
    em.innerHTML = `No item matches "${esc(e.target.value.trim())}".<br><button class="pill outline small add-miss" type="button">Add "${esc(e.target.value.trim())}" to the list</button>`; }
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

/* ---------- shopping list: every item counted since the last Full Reset, with its latest amount left ---------- */
const shopDlg = $("#shopDlg"), TICKS_KEY = "purchases-shop-ticks";
const periodStart = () => { const d = sessions.filter(s => s.items.length); return d.length ? d[d.length - 1].day : null; };
/* Ticks are shared live between phones (purchases_shop_ticks). Until that table exists they stay on this phone. */
let ticks = new Set(), ticksShared = false, shopPdfFile = null;
function localTicks(){ try { const t = JSON.parse(localStorage.getItem(TICKS_KEY) || "null"); if (t && t.start === periodStart()) return new Set(t.ids); } catch(e){} return new Set(); }
function saveLocalTicks(){ if (!ticksShared) try { localStorage.setItem(TICKS_KEY, JSON.stringify({ start: periodStart(), ids: [...ticks] })); } catch(e){} }
async function refreshTicks(){
  const r = sb ? await sb.from("purchases_shop_ticks").select("item_id") : { error: true };
  if (r.error){ ticksShared = false; ticks = localTicks(); } else { ticksShared = true; ticks = new Set(r.data.map(t => t.item_id)); }
  shopRefresh();
}
async function setTick(id, on){
  on ? ticks.add(id) : ticks.delete(id); saveLocalTicks(); shopPdfFile = null;
  if (!ticksShared) return;
  const q = sb.from("purchases_shop_ticks"), { error } = on ? await q.upsert({ item_id: id, ticked_by: myProfile() ? me.id : null }, { onConflict: "item_id", ignoreDuplicates: true }) : await q.delete().eq("item_id", id);
  if (error){ fb.error(); toast("Couldn't save the tick. Check your connection."); refreshTicks(); }
}
// Market-walk order (category ids), used until purchases_categories.shop_sort is filled in; new categories go last.
const SHOP_ORDER = [5, 4, 2, 8, 6, 7, 1, 3, 10, 9, 11];
const shopRank = c => c.shop_sort ?? (SHOP_ORDER.includes(c.id) ? SHOP_ORDER.indexOf(c.id) + 1 : 100 + (c.sort ?? 0));
const shopCats = () => CATS.slice().sort((a, b) => shopRank(a) - shopRank(b));
function shopRows(){   // [{title, hue, rows:[{id, name, left, prev, used, zero}]}] in market-walk category order
  const t = latest(), groups = new Map(CATS.map(c => [c.id, []]));
  ITEMS.filter(i => t[i.id] && groups.has(i.cat)).sort((a, b) => a.no - b.no).forEach(i => {
    const [left, prev] = t[i.id], used = prev && prev.unit === left.unit && prev.qty > left.qty ? Math.round((prev.qty - left.qty) * 100) / 100 : 0;
    groups.get(i.cat).push({ id: i.id, name: i.name, left, prev, used, zero: left.qty === 0 });
  });
  return shopCats().filter(c => groups.get(c.id).length).map(c => ({ title: c.name, hue: c.hue, rows: groups.get(c.id) }));
}
const shopSub = r => `Counted ${shortDay(r.left.day)}${r.used ? ` · used ${fmt(r.used)} ${r.left.unit}` : r.prev && r.prev.unit === r.left.unit && r.prev.qty < r.left.qty ? ` · was ${qtyTxt(r.prev)}` : ""}`;
function shopMeta(groups){
  const ids = groups.flatMap(g => g.rows.map(r => r.id)), n = ids.length, done = ids.filter(id => ticks.has(id)).length;
  $("#shopMeta").textContent = n ? `Since ${longDate(periodStart())} · ${n} ${n === 1 ? "item" : "items"}${done ? ` · ${done} in the cart` : ""}` : "Nothing counted since the last reset.";
  $("#shopClear").hidden = !done; return n;
}
function renderShop(){
  const groups = shopRows(), n = shopMeta(groups);
  $("#shopPdf").disabled = !n;
  $("#shopBody").innerHTML = n ? groups.map(g => `<section class="shop-cat"><h3><i class="dot" style="--hue:${esc(g.hue)}"></i>${esc(g.title)}<span>${g.rows.length}</span></h3>
    <ul>${g.rows.map(r => `<li class="shop-item${ticks.has(r.id) ? " ticked" : ""}" data-id="${esc(r.id)}"><button type="button" class="tick" role="checkbox" aria-checked="${ticks.has(r.id)}" aria-label="${esc(r.name)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></button>
      <span class="si-t"><span class="si-name" dir="auto">${esc(r.name)}</span><span class="si-sub">${esc(shopSub(r))}</span></span><b class="si-left${r.zero ? " zero" : ""}">${esc(qtyTxt(r.left))}</b></li>`).join("")}</ul></section>`).join("")
    : `<p class="hist-empty">Count items and press <b>Confirm</b>.<br>Everything you count shows up here until the next Full Reset.</p>`;
}
function shopRefresh(){ if (shopDlg.open){ shopPdfFile = null; const y = $("#shopBody").scrollTop; renderShop(); $("#shopBody").scrollTop = y; } }
function openShop(){ shopPdfFile = null; renderShop(); shopDlg.showModal(); $("#shopBody").scrollTop = 0; refreshTicks(); loadPdfLibs().catch(() => {}); }
$("#shopDone").onclick = () => { fb.tap(); shopDlg.close(); };
$("#shopBody").addEventListener("click", e => {
  const li = e.target.closest(".shop-item"); if (!li) return; const id = li.dataset.id, on = !ticks.has(id);
  li.classList.toggle("ticked", on); li.querySelector(".tick").setAttribute("aria-checked", on);
  on ? fb.success() : fb.tap(); setTick(id, on); shopMeta(shopRows());
});
$("#shopClear").onclick = async () => {
  fb.tap(); const ids = [...ticks]; ticks.clear(); saveLocalTicks(); shopPdfFile = null; renderShop();
  if (ticksShared && ids.length){ const { error } = await sb.from("purchases_shop_ticks").delete().in("item_id", ids); if (error){ fb.error(); toast("Couldn't clear the ticks."); refreshTicks(); } }
};

/* PDF: each A4 page is laid out as HTML (so Arabic names render correctly), drawn to an image, then put in a PDF. */
let pdfLibs = null;
function loadScript(src){ return new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); }); }
function loadPdfLibs(){
  pdfLibs = pdfLibs || Promise.all([
    window.html2canvas || loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"),
    window.jspdf || loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js")]).catch(e => { pdfLibs = null; throw e; });
  return pdfLibs;
}
async function buildPdf(){
  await loadPdfLibs();
  const groups = shopRows(), n = groups.reduce((a, g) => a + g.rows.length, 0), today = dayKey();
  const root = document.createElement("div"); root.className = "pdf-root"; document.body.appendChild(root);
  const head = `<tr><th class="c-tick"></th><th>Item</th><th class="c-left">Left</th><th>Last counted</th><th class="c-used">Used since previous</th></tr>`;
  const pages = [];
  const newPage = first => {
    const p = document.createElement("div"); p.className = "pdf-page";
    p.innerHTML = (first ? `<header><p class="eyebrow">Purchases List</p><h1>Shopping list</h1>
      <p class="sub">Since ${esc(longDate(periodStart()))} to ${esc(longDate(today))} · ${n} ${n === 1 ? "item" : "items"}</p></header>` : "")
      + `<table><thead>${head}</thead><tbody></tbody></table><footer></footer>`;
    root.appendChild(p); pages.push(p); return p.querySelector("tbody");
  };
  const fits = tb => tb.closest(".pdf-page").querySelector("table").getBoundingClientRect().bottom <= tb.closest(".pdf-page").getBoundingClientRect().top + 1123 - 64;
  let tb = newPage(true);
  const add = (html, title) => {
    tb.insertAdjacentHTML("beforeend", html);
    if (fits(tb)) return;
    tb.lastElementChild.remove(); tb = newPage(false);
    if (title) tb.insertAdjacentHTML("beforeend", title);
    tb.insertAdjacentHTML("beforeend", html);
  };
  groups.forEach(g => {
    const cat = `<tr class="pcat"><td colspan="5"><i style="background:${esc(g.hue)}"></i>${esc(g.title)}</td></tr>`;
    add(cat); const contd = cat.replace("</td>", " (continued)</td>");
    g.rows.forEach(r => add(`<tr class="row${ticks.has(r.id) ? " ticked" : ""}"><td class="c-tick"><span class="box">${ticks.has(r.id) ? "✓" : ""}</span></td><td dir="auto">${esc(r.name)}</td>
      <td class="c-left${r.zero ? " zero" : ""}">${esc(qtyTxt(r.left))}</td><td>${esc(longDate(r.left.day))}</td><td class="c-used">${r.used ? esc(`${fmt(r.used)} ${r.left.unit}`) : "–"}</td></tr>`, contd));
  });
  pages.forEach((p, k) => { p.querySelector("footer").textContent = `Exported ${longDate(today)} · Page ${k + 1} of ${pages.length}`; });
  try {
    const pdf = new window.jspdf.jsPDF({ unit: "pt", format: "a4", compress: true });
    for (let k = 0; k < pages.length; k++){
      const c = await window.html2canvas(pages[k], { scale: 2, backgroundColor: "#ffffff", logging: false, width: 794, height: 1123, windowWidth: 794 });
      if (k) pdf.addPage();
      pdf.addImage(c.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 595.28, 841.89);
    }
    return new File([pdf.output("blob")], `Shopping list ${today}.pdf`, { type: "application/pdf" });
  } finally { root.remove(); }
}
async function sharePdf(){
  const btn = $("#shopPdf"), lbl = btn.querySelector("span");
  if (btn.disabled) return; fb.tap();
  if (!shopPdfFile){
    btn.disabled = true; lbl.textContent = "Preparing…";
    try { shopPdfFile = await buildPdf(); }
    catch(e){ btn.disabled = false; lbl.textContent = "Share PDF"; fb.error(); toast("Couldn't make the PDF. Check your connection."); return; }
    btn.disabled = false;
  }
  const f = shopPdfFile;
  if (navigator.canShare && navigator.canShare({ files: [f] })){
    try { await navigator.share({ files: [f], title: "Shopping list" }); lbl.textContent = "Share PDF"; return; }
    catch(e){
      if (e.name === "AbortError"){ lbl.textContent = "Share PDF"; return; }
      if (e.name === "NotAllowedError"){ lbl.textContent = "PDF ready · Tap to share"; return; }   // iOS wants a fresh tap after a slow build
    }
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  lbl.textContent = "Share PDF"; toast("PDF saved.");
}
$("#shopPdf").onclick = sharePdf;
shopDlg.addEventListener("close", () => { $("#shopPdf span").textContent = "Share PDF"; });

/* ---------- load ---------- */
function apply(cats, items){
  CATS = cats.map(c => ({ id: c.id, name: c.name, sub: c.sub, hue: c.hue, sort: c.sort, shop_sort: c.shop_sort, seasonal: !!c.seasonal }));
  let n = 0; ITEMS = [];
  CATS.forEach(c => items.filter(i => i.category_id === c.id).sort((a, b) => a.sort - b.sort)
    .forEach(i => ITEMS.push({ id: i.id, name: i.name, unit: i.default_unit, cat: c.id, no: ++n })));
}
const fetchSessions = () => sb.from("purchases_sessions").select("day,items,saved_by_profile,updated_at").order("day", { ascending: false });
const fetchCats = () => sb.from("purchases_categories").select("*").order("sort");   // * so shop_sort is picked up once it exists
const fetchItems = () => sb.from("purchases_items").select("id,name,category_id,default_unit,sort").order("sort");
const fetchProfiles = () => sb.from("purchases_profiles").select("id,name,avatar");
const fetchActivity = () => sb.from("purchases_activity").select("id,at,profile_id,kind,day,details").order("at", { ascending: false }).limit(100);
const itemsKey = () => JSON.stringify(ITEMS.map(i => [i.id, i.name, i.cat, i.unit]));
const setProfiles = rows => { PROFILES = Object.fromEntries(rows.map(p => [p.id, { id: p.id, name: p.name, avatar: p.avatar }])); };
async function reloadItems(){
  const [cr, ir] = await Promise.all([fetchCats(), fetchItems()]); if (cr.error || ir.error) return;
  const prev = itemsKey(); apply(cr.data, ir.data);
  if (prev !== itemsKey()){ const sel = selected; build(); selected = null; if (sel && byId[sel]) selectItem(sel); if ($("#search").value) $("#search").dispatchEvent(new Event("input")); }
  cache(); render(); renderHistory();
}
async function refreshProfiles(){ const r = await fetchProfiles(); if (r.error) return; setProfiles(r.data); cache(); renderMe(); renderHistory(); }
async function refreshActivity(){ const r = await fetchActivity(); if (r.error) return; activity = r.data; if (histTab === "activity") renderHistory(); }
const debounce = (f, ms) => { let t; return () => { clearTimeout(t); t = setTimeout(f, ms); }; };
async function refreshSessions(){
  const wasDirty = isDirty(), r = await fetchSessions(); if (r.error) return;
  sessions = r.data;
  if (!wasDirty){ loadDay(); if (selected) mountPicker(catsEl.querySelector(`.item[data-id="${selected}"]`)); }   // don't wipe picks that aren't confirmed yet
  cache(); render(); renderHistory();
}
async function load(){
  try { const c = JSON.parse(localStorage.getItem(CACHE) || "null");
    if (c && c.CATS && c.CATS.length){ CATS = c.CATS; ITEMS = c.ITEMS; sessions = c.sessions || []; PROFILES = c.PROFILES || {}; build(); loadDay(); render(); renderHistory(); } } catch(e){}
  renderMe();
  const fromNotification = location.hash === "#activity";
  if (fromNotification){ history.replaceState(null, "", location.pathname + location.search); openActivity(); }
  if (!sb){ setSave("", "Offline"); return; }
  const [cr, ir, hr, pr, ar] = await Promise.all([fetchCats(), fetchItems(), fetchSessions(), fetchProfiles(), fetchActivity()]);
  if (!pr.error){ setProfiles(pr.data); renderMe(); }
  if (!ar.error) activity = ar.data;
  if (cr.error || ir.error || hr.error){ setSave("", "Offline"); if (!built) catsEl.innerHTML = `<div class="empty">Couldn't load your list. Check your connection and reload.</div>`; return; }
  const prevKey = itemsKey(), wasDirty = built && isDirty();
  apply(cr.data, ir.data); sessions = hr.data;
  if (!built || prevKey !== itemsKey()){ build(); selected = null; }
  if (!wasDirty) loadDay();
  render(); renderHistory(); cache(); setSave("saved", "Synced"); loaded = true;
  if (!myProfile()) openProfile(); else if (!fromNotification) showRecent();   // new visitors pick a name + avatar first
  const pg = (table, fn) => ["postgres_changes", { event: "*", schema: "public", table }, fn];
  sb.channel("purchases-live")
    .on(...pg("purchases_sessions", () => { if (!saving) refreshSessions(); }))
    .on(...pg("purchases_items", debounce(reloadItems, 300)))
    .on(...pg("purchases_profiles", debounce(refreshProfiles, 300)))
    .on(...pg("purchases_activity", debounce(refreshActivity, 300)))
    .subscribe();
  refreshTicks();   // own channel, so a missing ticks table can't break the live updates above
  sb.channel("purchases-ticks").on(...pg("purchases_shop_ticks", debounce(refreshTicks, 200))).subscribe();
}
load();
})();
