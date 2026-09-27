# Purchases List: Handoff Report

**Owner:** Abdallah (GitHub `abdallah7733`, email mabdallah.faith@gmail.com)
**Date:** 27 September 2026
**Status:** Steps 1 and 2 of 3 are finished or in progress. Supabase is live. The code is ready but **not yet on GitHub** (the upload is waiting on Abdallah). Vercel has not been started.

---

## 1. What this project is

It's a personal home stock tracker called **Purchases List**, with 49 household items in 11 categories. For each item you can open it, set the stock with a − / + counter, and pick a unit from a dropdown.

The plan runs in three steps, in this order:

1. **Supabase** for the database. **Done.**
2. **GitHub** for the code repository. **Blocked:** Abdallah has to upload the files by hand (see §6).
3. **Vercel** for hosting and a public URL, then testing on iPhone. **Not started.**

### Abdallah's requirements

- **Visual style:** dark colours and as much animation as possible.
- **iPhone:** the app must work well on iPhone. He'll use it from Safari and "Add to Home Screen".
- **How to work:** go step by step and **ask him for confirmation whenever you're unsure.** He wants to confirm decisions, so don't assume.
- **His decisions so far:**
  - **Database:** reuse the existing Supabase project; don't create a new one.
  - **Access:** anyone with the link can view and edit, with no login. He was told the risk (anyone with the URL can change or zero the stock numbers) and chose this anyway.
  - **AI:** leave AI features out of the web version for now. They'd need an Anthropic API key in a Vercel serverless function; offer that later.
  - **Repository:** public GitHub repo. He named it **`Purchase-List`**, singular with a capital L. The code was prepared under the working name `purchases-list`.
- **Communication:** executive, direct and concise. He prefers exact click-by-click instructions for tech steps: what to click, where it is, what he should see next, and what to do if it's missing.

---

## 2. Item list (single source of truth = Supabase)

The numbers are display order.

| # | Category | Items (default unit) |
|---|---|---|
| 1–6 | Grains & Bakery | White rice (kg), Basmati rice (kg), Vermicelli (pack), Flour (kg), Starch (pack), Toast (pack) |
| 7–12 | Oils, Sauces & Condiments | Cooking oil (bottle), Olive oil (bottle), Vinegar (bottle), Tomato paste (can), Mustard (jar), Mayonnaise (jar) |
| 13–19 | Spices | Salt, Black pepper, Paprika, Smoked paprika, Onion powder, Garlic powder, Other cooking spices (all pack) |
| 20–22 | Sweeteners & Spreads | White honey, Black honey, Tahini (all jar) |
| 23–26 | Beverages | Plain Turkish coffee (pack), Roasted Turkish coffee (pack), Nescafé (jar), Pepsi (can) |
| 27–29 | Cleaning & Laundry | Dish soap, Clothes washing gel, Black clothes washing gel (all bottle) |
| 30–34 | Paper & Bags | Toilet paper (roll), Table tissue (box), Kitchen tissue (roll), Refrigerator bags (roll), Rubbish bags (roll) |
| 35 | Personal Care | Toothpaste (pcs) |
| 36–40 | Meat & Poultry (Chilled) | Beef tenderloin (kg), Minced meat (kg), Stew meat (for vegetables) (kg), Chicken breast (kg), Whole chicken (pcs) |
| 41–48 | Dairy, Eggs & Deli (Chilled) | Full cream milk (L), Skimmed milk (L), Yogurt (pcs), Cooking cream (pack), Mozzarella (kg), Roumi cheese (kg), Luncheon (g), Eggs (tray) |
| 49 | Frozen (Keep cold) | Frozen vegetables (bag) |

**Allowed units:** kg, g, L, ml, pcs, pack, bottle, box, can, jar, bag, roll, carton, dozen, tray. The counter steps by 0.5 for kg and L and by 1 for every other unit.

**Order logic:** it follows a walk through a supermarket. Dry goods come first; chilled and frozen items come last so they stay cold.

**Naming notes:**
- "Stew meat (for vegetables)" = لحمة خضار.
- "Black honey" = molasses.
- "Roumi cheese" is his preferred spelling (he said "roomy").

---

## 3. What already exists

### A. Excel draft (the original request)

- **File:** `Purchases_List.xlsx`, a copy of which is in this folder.
- **Contents:** title "Purchases List", columns No. | Items | Stock | Unit, grouped by category with shaded heading rows.
- **Numbering:** static numbers, not formulas, so they display reliably in Apple Numbers.
- **Empty:** the Stock and Unit columns haven't been filled in yet.

### B. Claude Artifact version (inside claude.ai)

- **Link:** https://claude.ai/artifact/SXj2CCo9WePByEXqCGrV8N (private to Abdallah).
- **Features:** dark and animated, AI quick entry (Claude parses text like "5 kg rice, 2 bottles oil"), "Review my list" AI bullets, CSV export, and an iPhone-optimised layout (version 2).
- **Storage:** it saves stock in the **artifact's own database**, not in Supabase. The artifact and the web app are **separate stores and do not sync.** The web app on Vercel is meant to be the main version going forward.

### C. Standalone web app (for GitHub and Vercel)

The files are in **`~/Downloads/Purchase-List/`** on Abdallah's Mac, which is the folder this report is in.

| File | Purpose |
|---|---|
| `index.html` | Page shell. It includes the iOS PWA meta tags (`apple-mobile-web-app-capable`, black-translucent status bar, `apple-touch-icon`, theme colour `#0D1014`, `viewport-fit=cover`) and loads supabase-js **2.117.2** UMD from jsDelivr. |
| `styles.css` | The full dark, animated design: tokens, aurora background, accordion, counters, reduced-motion support and phone breakpoints. |
| `app.js` | All logic (vanilla JS, no build step), described below. |
| `config.js` | Supabase URL and **publishable** key. This key is safe to be public because Row Level Security protects the data. |
| `manifest.webmanifest` | PWA manifest: name "Purchases List", short name "Purchases", standalone display. |
| `icon-180.png`, `icon-192.png`, `icon-512.png` | App icons: dark background with a saffron checklist mark. |
| `vercel.json` | Security headers, plus the manifest content type. There's no build config because the site is static. |
| `README.md` | Short project description. |

What `app.js` does:

- **Loading:** reads categories, items and stock from Supabase and caches them in localStorage for an instant first paint.
- **Saving:** writes each change as an upsert to `purchases_stock`, debounced by 600 ms per item.
- **Live sync:** subscribes to Realtime changes on `purchases_stock` so multiple devices stay in sync.
- **Other features:** search, open all / close all categories, and CSV export (a Blob download that opens in Numbers).

**Design tokens:** background `#0D1014`, accent saffron `#E9A93B`, text `#ECE7DC`. Fonts are Bricolage Grotesque (display), Figtree (body) and JetBrains Mono (numbers). Each category has its own colour, stored in the database.

**iPhone fixes already applied:**
- All inputs are at least 16px, so iOS doesn't zoom in on focus.
- Tap targets are at least 44px.
- `touch-action: manipulation`, so fast taps on + / − don't zoom the page.
- Hover effects only apply on devices with a real mouse.
- The quantity box isn't auto-focused on touch devices, so the keyboard doesn't pop up by itself.
- The search bar sticks to the top.
- Icon-only toolbar buttons are used on narrow screens.
- The background blur is lighter on phones.

**Tests done:** loaded in headless Chromium with iPhone 13 emulation against the live Supabase. All 49 items loaded, a +/+ tap saved `1 kg` for White rice, and the status showed "Saved". The test row was then deleted.

**Local git:** the cloud copy was committed as `92a709b` on branch `main`. That commit isn't reachable from a new session; the Downloads folder is the copy that counts.

---

## 4. Supabase (step 1, done)

- **Organization:** `abdallah7733's Org` (id `rqcfcymqqfolixshuojo`), **free plan**.
- **Project:** `abdallah7733's Project`, ref / id **`cqqeffacjibhkahbfjzu`**, region eu-central-1 (Frankfurt), Postgres 17.
- **API URL:** `https://cqqeffacjibhkahbfjzu.supabase.co`
- **Publishable key:** `sb_publishable_9FFaxUXZNTTZXD8ng8_UnQ_MyDPNkqK`. A legacy anon JWT also exists, but use the publishable key.
- **Before this project:** the project was empty, with no tables.

### Schema (migration `purchases_list_schema`)

```sql
purchases_categories (id smallint PK, name text unique, sub text, hue text, sort smallint)
purchases_items      (id text PK -- slug e.g. 'white-rice', name text unique,
                      category_id smallint FK -> purchases_categories, default_unit text, sort smallint)
purchases_stock      (item_id text PK FK -> purchases_items ON DELETE CASCADE,
                      qty numeric(10,2) CHECK 0..100000,
                      unit text CHECK in (kg,g,L,ml,pcs,pack,bottle,box,can,jar,bag,roll,carton,dozen,tray),
                      updated_at timestamptz, auto-updated by trigger purchases_stock_touch)
```

- **Row Level Security:** on for all three tables.
  - `anon` and `authenticated` can **select** all three tables.
  - They can **insert and update** `purchases_stock`, but can't delete stock rows.
  - They can't change categories or items; only an admin can, through SQL or the dashboard.
- **Realtime:** `purchases_stock` is added to the `supabase_realtime` publication.
- **Seeded data:** 11 categories and 49 items. `purchases_stock` is empty (0 rows). Clearing an item in the app writes qty 0 rather than deleting the row.
- **Verified with the publishable key:**
  - Selecting items works.
  - Upsert works.
  - An invalid unit is rejected by the check constraint.
  - Deleting stock or items returns 401.

### Adding a new item later (no redeploy needed)

The app renumbers items automatically from `sort`, so a new item just needs a slot. Example: add Lentils to Grains & Bakery after Toast (sort 6).

```sql
update public.purchases_items set sort = sort + 1 where sort > 6;
insert into public.purchases_items (id, name, category_id, default_unit, sort)
values ('lentils', 'Lentils', 1, 'kg', 7);
```

**Category ids:**

| id | Category |
|---|---|
| 1 | Grains & Bakery |
| 2 | Oils, Sauces & Condiments |
| 3 | Spices |
| 4 | Sweeteners & Spreads |
| 5 | Beverages |
| 6 | Cleaning & Laundry |
| 7 | Paper & Bags |
| 8 | Personal Care |
| 9 | Meat & Poultry |
| 10 | Dairy, Eggs & Deli |
| 11 | Frozen |

### Open Supabase notes

- **Security advisor warning:** it flags a function `public.rls_auto_enable()` (SECURITY DEFINER, executable by anon). This existed **before** our work and isn't ours. Ask Abdallah before revoking it.
- **Live sync untested:** the Realtime WebSocket couldn't be tested because the sandbox proxy returned 500 on the handshake. Test it on the live Vercel URL with two devices or tabs. If it fails, the app still works; changes just need a reload to appear on other devices.

---

## 5. Vercel (step 3, not started)

- The Vercel MCP connector is linked. It's a **personal account with no teams.**
- **Plan:** import the GitHub repo `abdallah7733/Purchase-List` as a new project.
  - Framework preset: **Other**.
  - No build command, no output directory; the root is static.
  - No environment variables are needed, because the config is in `config.js`.
- **After deploying:**
  1. Open the live URL at phone width and confirm the list loads and saves.
  2. Test Realtime with two tabs.
  3. Send Abdallah the iPhone steps: Safari → Share → Add to Home Screen → Add.
- **Suggested project name:** `purchase-list`. Confirm the name and any custom domain with Abdallah.

---

## 6. GitHub (step 2, blocked, waiting on Abdallah)

- **Repo:** https://github.com/abdallah7733/Purchase-List, **public** and **currently empty**. Abdallah created it on github.com with no README, .gitignore or license.
- **Why automatic pushing failed:** the previous Cowork session could only push to repositories linked when it started. `git push` returned 403 ("not in this session's authorized repository set"), and creating repos through the API was also blocked.
- **Fallback in progress:** Abdallah was told to upload the files through the web.
  1. Open the repo and click **"uploading an existing file"**.
  2. Drag the **files** from `~/Downloads/Purchase-List/` onto the page, not the folder itself.
  3. Commit to `main` with the message "Initial upload".
- **Don't upload:** `HANDOFF.md` or `Purchases_List.xlsx`. These are for Cowork and Abdallah, not the website. They're harmless if uploaded, but keep the repo clean.
- **If the new session has this repo linked,** it can push directly instead.

---

## 7. Next actions for the new session (in order)

1. **Confirm the upload:** ask Abdallah whether the GitHub upload is done. Check that the repo shows the 10 files at its root, with `index.html` at the top level.
2. **Vercel import:** confirm with Abdallah, then guide him click by click (or use the Vercel tools if they can import):
   1. vercel.com → **Add New… → Project**.
   2. **Import** next to Purchase-List. If it's missing: **Adjust GitHub App Permissions** and give access to the repo.
   3. Framework **Other** → **Deploy**.
3. **Verify:** confirm the build succeeded, then open the URL at iPhone size.
   - The list loads 49 items.
   - A stock change saves.
   - Realtime sync works across two tabs.
4. **Report back:** give Abdallah the live URL and the iPhone Add to Home Screen steps.
5. **Optional, only if he asks:**
   - Fill in stock values together, then regenerate the Excel file from the Supabase data.
   - Add AI quick entry to the web version (a Vercel serverless function with his Anthropic API key).
   - Add email login if he changes his mind about open access.
   - Revoke the pre-existing `rls_auto_enable` warning.
