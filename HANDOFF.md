# Purchases List: Handoff Notes

**Owner:** Abdallah (GitHub `abdallah7733`)
**Last updated:** 27 September 2026
**Status:** Live and in use. Supabase, GitHub and Vercel are all set up; `main` deploys automatically.

---

## 1. Working with Abdallah

- **Confirm before changing things.** He wants to approve decisions; don't assume.
- **Communication:** executive, direct, concise. For tech steps give exact click-by-click instructions: what to click, where it is, what he should see next, and what to do if it's missing.
- **Decisions already made:**
  - **No login.** Anyone with the link can view and save. He was told the risk (anyone with the URL can change or clear the lists) and chose it anyway. Full Reset is the only passcode-protected action.
  - **No AI features** in the web app for now. Adding them would need an Anthropic API key in a server function; offer it only if he asks.
  - **Visual style:** Apple-style white and blue (this replaced the earlier dark, saffron design). Keep it.
  - **Reuse the existing Supabase project;** don't create a new one.

---

## 2. What the app does

An iPhone-first web app (PWA) for recording household purchases day by day.

| Feature | How it works |
|---|---|
| Item list | 53 items in 11 categories, loaded from Supabase. Numbering follows `sort`, so it renumbers itself when items are added. |
| Picking | Tap an item to open an iOS-style wheel picker (quantity + unit). "Type amount" allows any value; "Clear" removes the pick. Zero is a valid entry. Step size: 0.5 for kg/L, 50 for g/ml, 1 for everything else. |
| Confirm | A bar appears only when today's picks differ from what's saved. Confirm upserts one row per calendar day (device-local date) into `purchases_sessions`. Confirming again the same day replaces that day. |
| History | "By date" lists every saved day; "Totals" sums all days per item and unit. |
| Recently saved | A sheet shows the last saved list once per app open. |
| Live sync | Realtime subscription on `purchases_sessions` refreshes other open devices. Unconfirmed picks on a device aren't overwritten. |
| Push notifications | Menu → Notifications. On iPhone this only works after Add to Home Screen (iOS 16.4+). When one device confirms, every *other* subscribed device gets a push and an icon badge count. |
| Full Reset | Menu → Full Reset (or the link under History). Deletes all history after the admin passcode is checked in the database. 15-minute lockout after 5 wrong tries in a row. The passcode is stored hashed and is **not** in this repo. |
| Export CSV | Menu → Export CSV. Columns: Date, No., Category, Item, Qty, Unit. UTF-8 with BOM so Numbers/Excel read it correctly. |
| Feedback | Haptic tick (iOS 18+ via a hidden switch input) and soft click sounds; sound toggle in the menu, remembered per device. |

`localStorage` caches categories, items and history for an instant first paint.

---

## 3. Item list (source of truth: Supabase `purchases_items`)

| Category | Items (default unit) |
|---|---|
| Grains & Bakery | White rice (kg), Basmati rice (kg), Vermicelli (pack), Flour (kg), Starch (pack), Toast (pack) |
| Oils, Sauces & Condiments | Cooking oil (bottle), Olive oil (bottle), Vinegar (bottle), Tomato paste (can), Mustard (jar), Mayonnaise (jar) |
| Spices | Salt, Black pepper, Paprika, Smoked paprika, Onion powder, Garlic powder, Other cooking spices (all pack) |
| Sweeteners & Spreads | White honey, Black honey, Tahini (all jar) |
| Beverages | Plain Turkish coffee (pack), Roasted Turkish coffee (pack), Nescafé (jar), Loose Tea (pack), Packet Tea (box), Pepsi (can) |
| Cleaning & Laundry | Dish soap, Clothes washing gel, Black clothes washing gel (all bottle) |
| Paper & Bags | Toilet paper, Table tissue (box), Kitchen tissue, Refrigerator bags, Rubbish bags, Mattress Roll (rolls unless noted) |
| Personal Care | Toothpaste (pcs), Pads (pack) |
| Meat & Poultry *(Chilled)* | Beef tenderloin, Minced meat, Stew meat (for vegetables), Chicken breast (all kg), Whole chicken (pcs) |
| Dairy, Eggs & Deli *(Chilled)* | Full cream milk (L), Skimmed milk (L), Yogurt (pcs), Cooking cream (pack), Mozzarella (kg), Roumi cheese (kg), Luncheon (g), Eggs (tray) |
| Frozen *(Keep cold)* | Frozen vegetables (bag) |

**Units:** kg, g, L, ml, pcs, pack, bottle, box, can, jar, bag, roll, carton, dozen, tray.

**Naming notes:** "Stew meat (for vegetables)" = لحمة خضار. "Black honey" = molasses. "Roumi cheese" is his preferred spelling.

**Category ids:** 1 Grains & Bakery, 2 Oils, Sauces & Condiments, 3 Spices, 4 Sweeteners & Spreads, 5 Beverages, 6 Cleaning & Laundry, 7 Paper & Bags, 8 Personal Care, 9 Meat & Poultry, 10 Dairy, Eggs & Deli, 11 Frozen.

### Adding an item (no redeploy needed)

Make room at the right `sort` position, then insert. Example: Lentils after Toast (sort 6).

```sql
update public.purchases_items set sort = sort + 1 where sort > 6;
insert into public.purchases_items (id, name, category_id, default_unit, sort)
values ('lentils', 'Lentils', 1, 'kg', 7);
```

---

## 4. Supabase

- **Project:** ref `cqqeffacjibhkahbfjzu`, free plan, eu-central-1 (Frankfurt).
- **API URL:** `https://cqqeffacjibhkahbfjzu.supabase.co`. The publishable key and VAPID public key are in `config.js` and are safe to be public.

### Tables

| Table | Purpose | Access for `anon` |
|---|---|---|
| `public.purchases_categories` | id, name, sub, hue, sort | read |
| `public.purchases_items` | id (slug), name, category_id, default_unit, sort | read |
| `public.purchases_sessions` | **one row per day:** `day date` PK, `items jsonb` (`[{item_id, qty, unit}]`, under 32 KB), `saved_by` (device id), `updated_at` | read, insert, update (no delete) |
| `public.purchases_stock` | Legacy per-item stock from the first version. **No longer used by the app.** | read, insert, update |
| `purchases_private.admin` | Hashed Full Reset passcode, failed attempts, lock time | none (schema not granted) |
| `purchases_private.push_config` | VAPID keys, push subject, hook secret | none |
| `purchases_private.push_subs` | Push subscriptions per device | none |

### Functions and triggers

- `purchases_reset_history(passcode)`: SECURITY DEFINER RPC. Checks the passcode (bcrypt via pgcrypto), applies the lockout, deletes all sessions and returns the number deleted. Returns -1 on a wrong passcode.
- `purchases_push_subscribe(...)` / `purchases_push_unsubscribe(sub_endpoint)`: SECURITY DEFINER RPCs that write `push_subs`.
- Trigger `purchases_sessions_notify` (function `notify_session`) calls the `purchases-notify` Edge Function through pg_net on every save, authenticated with the hook secret.
- Triggers `purchases_sessions_touch` / `purchases_stock_touch` keep `updated_at` current.
- Realtime publication includes `purchases_sessions` (and the legacy `purchases_stock`).

### Edge Function `purchases-notify`

Source in `supabase/functions/purchases-notify/index.ts`. Reads the saved day, builds a short summary ("Sat 27 Sep · 4 items: …"), and sends Web Push to every subscription except the device that saved. Expired subscriptions (404/410) are deleted. Deploy changes with the Supabase CLI or the Supabase connector.

---

## 5. Vercel

- **Project:** `purchase-list`, connected to `abdallah7733/Purchase-List`, framework preset Other, no build command, no environment variables.
- **Production URL:** https://purchase-list-theta.vercel.app
- Every push to `main` deploys to production. Branches get preview URLs, which are behind Vercel login (Standard Protection).
- `sw.js` is served with `Cache-Control: no-cache` so service-worker updates reach phones quickly.

---

## 6. Other files

- `Purchases_List.xlsx`: the original Excel draft (No. | Items | Stock | Unit). Not used by the app.
- An older Claude Artifact version of the list exists in Abdallah's claude.ai account. It uses its own storage and doesn't sync with this app; the Vercel app is the main version.

---

## 7. Open items

1. **Schema isn't in the repo.** Tables, policies, RPCs and triggers were created directly in Supabase. Exporting them to `supabase/migrations/` would make the project reproducible.
2. **Legacy `purchases_stock`** table is unused. It can be dropped once Abdallah agrees.
3. **Supabase advisor warnings:**
   - `purchases_private` tables have RLS off. They aren't reachable through the API because `anon` has no access to that schema, so this is low risk, but enabling RLS would silence the warning.
   - `public.rls_auto_enable()` is a pre-existing SECURITY DEFINER function executable by `anon`. It isn't ours; ask before revoking.
4. **No tests and no CI.**
5. **Dates are device-local.** Two devices in different time zones could save to different days.

### Only if Abdallah asks

- AI quick entry ("5 kg rice, 2 bottles oil") via a server function with his Anthropic key.
- Email login instead of open access.
- A custom domain.
