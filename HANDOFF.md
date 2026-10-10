# Purchases List: Handoff Notes

**Owner:** Abdallah (GitHub `abdallah7733`)
**Last updated:** 10 October 2026
**Status:** Live and in daily use on iPhone by more than one person. Code, database and hosting are all set up; this file describes how they fit together.

---

## 1. Working with the owner

- **Confirm before changing anything he will notice** (layout, wording, behaviour) and before any database change. He prefers to decide.
- **Communication:** executive, direct and concise. For anything he has to do himself, give exact click-by-click steps: what to click, where it is, what he should see next, and what to do if it's missing.
- **Design:** Apple style (white/`#F5F5F7` backgrounds, `#1D1D1F` text, `#0071E3` blue, SF Pro / Inter, iOS wheel pickers, haptics and click sounds). The original dark theme is gone; don't bring it back.
- **Decisions already made:**
  - **No login.** Anyone with the link can view and edit. Only the admin passcode protects Full Reset and deleting an archived period.
  - **One Supabase project**, reused (see §4). Don't create a new one.
  - **No AI features in the web app** for now. If he asks later, it needs an Anthropic API key in a Vercel serverless function.
- **Naming notes:** "Stew meat (for vegetables)" = لحمة خضار. "Black honey" = molasses. "Roumi cheese" is his preferred spelling. The item with id `always` is shown as "Pads".

---

## 2. What the app does

- **Main list:** categories in supermarket-walk order (dry goods first, chilled and frozen last). Tap an item to open an iOS-style wheel for quantity and unit, or type an exact amount. Zero is a valid count.
- **Confirm:** saves the day's picks as one row in `purchases_sessions` (one row per date). Confirming again the same day replaces it. Past days can be reopened with **Edit** in History.
- **History** by date (collapsed by default), **In stock** (each item's latest count, so a later 0.5 L replaces an earlier 1 L), and a per-item history shown when you pick an item.
- **Shopping list** (menu): every item counted since the last Full Reset with the amount left, in market-walk order (`purchases_categories.shop_sort`). Ticks are shared live between phones (`purchases_shop_ticks`). Exports to PDF; each A4 page is drawn from HTML so Arabic names render correctly.
- **Profiles:** a name plus a preset avatar or a photo (cropped to 256×256 JPEG on the phone, stored in the `purchases-avatars` bucket). No password: the device keeps a random key, and only that device can edit its profile. The same name may be used on several devices.
- **Add item:** guesses the category and unit from the name (English and Arabic), both editable. New items appear for everyone at once.
- **Activity:** a log of saves (with exactly which items changed), added items and resets, written by database triggers.
- **Push notifications:** every new activity row calls the `purchases-notify` Edge Function. It waits for 30 s of quiet (at most 3 min) and sends one message per person to every other subscribed device, e.g. "Mohammed added 3 items to your purchase list". Tapping it opens Activity. The app icon shows an unread badge.
- **Full Reset** (passcode): saves everything logged since the previous reset as one snapshot in `purchases_archives`, then clears the days and the shopping ticks. **Archive** shows past periods; deleting one also needs the passcode. Five wrong passcodes lock both for 15 minutes.
- **Also:** CSV export, a "Recently saved" pop-up once per app open, sound on/off.

---

## 3. Code

Static site, no build step. `index.html`, `styles.css` and `app.js` hold the whole frontend; `config.js` has the public Supabase URL, publishable key and VAPID public key (all safe to be public). `sw.js` handles push and the badge only; there is no offline cache. Categories, items and saved days are cached in `localStorage` for an instant first paint, then refreshed from Supabase and kept live over Realtime.

**Hosting:** Vercel project `purchase-list`, production URL https://purchase-list-theta.vercel.app. Every push to `main` deploys automatically. There are no environment variables.

**Workflow:** changes go through a pull request into `main`. There is no automated test or CI yet (a smoke-test PR exists as a draft), so check changes in a browser at phone width before merging.

---

## 4. Database (Supabase)

- **Project:** `abdallah7733's Project`, ref `cqqeffacjibhkahbfjzu`, Frankfurt, Postgres 17, free plan.
- **API URL:** `https://cqqeffacjibhkahbfjzu.supabase.co`, publishable key in `config.js`.

### Schema is in the repo

`supabase/migrations/` holds every change in order. Replaying them on an empty Supabase project rebuilds the live schema exactly; this was checked on 10 October 2026 by replaying them into a scratch Postgres and comparing tables, columns, constraints, indexes, functions, triggers, policies, grants and Realtime tables against the live database. Two things differ, both on purpose:

- `public.rls_auto_enable()` existed in the project before this app and isn't ours.
- The `seasonal` column and `purchases_clear_seasonal()` are live but their migration (`20261006100000_purchases_seasonal.sql`) is still in the open Seasonal items PR. It joins the folder when that PR merges.

`supabase/seed.sql` restores the current categories and items. It deliberately leaves out people's data and the secrets row (below).

### Tables

| Table | What it holds | App can |
|---|---|---|
| `purchases_categories` | 11 categories: name, colour (`hue`), `sort`, `shop_sort` | read |
| `purchases_items` | 61 items: slug id, name, category, default unit, `sort`, `added_by` | read (add through `purchases_add_item`) |
| `purchases_sessions` | One row per date: `items` = `[{item_id, qty, unit}]`, who saved it | read, insert, update |
| `purchases_activity` | Change log (`save`, `add_item`, `reset`) | read only |
| `purchases_profiles` | Name + avatar per device | read (save through `purchases_profile_save`) |
| `purchases_shop_ticks` | Items ticked off on the shopping list | read, insert, delete |
| `purchases_archives` | One snapshot per Full Reset | read only |
| `purchases_stock` | Legacy table from the first version; no longer used by the app | read, insert, update |

The `purchases_private` schema is not exposed through the API and anon has no access to it. It holds the admin passcode hash and lock counter (`admin`), the push keys and webhook secret (`push_config`), push subscriptions (`push_subs`), the last activity already notified per person (`push_sent`) and each profile's device-key hash (`profile_keys`).

**Functions the app calls** (all `security definer`): `purchases_profile_save`, `purchases_add_item`, `purchases_push_subscribe`, `purchases_push_unsubscribe`, `purchases_reset_history`, `purchases_delete_archive`.

**Triggers:** saving a day logs the item-level changes to `purchases_activity` (`purchases_sessions_log`). Every new activity row calls the Edge Function through `pg_net` (`purchases_activity_notify`).

**Allowed units:** kg, g, L, ml, pcs, pack, bottle, box, can, jar, bag, roll, carton, dozen, tray.

### Changing the database

1. Add a new file to `supabase/migrations/` named `YYYYMMDDHHMMSS_short_name.sql`, written so it can safely run twice (`if not exists`, `create or replace`).
2. Get Abdallah's go-ahead, then apply it. The Supabase connector's `apply_migration` has hung from cloud sessions, so the reliable route is for Abdallah (or Cowork on his Mac) to paste the file into the Supabase **SQL Editor** and run it. Changes applied that way don't appear in Supabase's migration history; the repo folder is the record.
3. Merge the PR that adds the file.

To add an item without code, use **Add item** in the app.

### Rebuilding from scratch

Run the migrations in order on a new project, then `seed.sql`. Then, by hand:

- **Change the admin passcode.** The first migration sets it to `1234`. Run in the SQL Editor: `update purchases_private.admin set passcode_hash = extensions.crypt('NEW-CODE', extensions.gen_salt('bf'));`
- **Insert the push keys row** into `purchases_private.push_config` (VAPID public/private key, subject, hook secret). Never commit it. The public key must match `vapidPublicKey` in `config.js`.
- **Deploy the Edge Function** from `supabase/functions/purchases-notify/` with JWT verification **off** (the trigger authenticates with the hook secret instead).
- If the project ref changes, update the URL in `config.js`, in `notify_activity()` and in the avatar URL check on `purchases_profiles`.

---

## 5. Push notifications

- The Edge Function in the repo matches the deployed version (v5).
- Apple's push service rejects a `Topic` header (400 BadWebPushTopic), so the function builds the request with `web-push` and sends it with `fetch`, without that header. Failures are logged with the push service's reason.
- On iPhone, notifications only work once the app is added to the Home Screen and the person turns on **Menu → Notifications**.
- Dead subscriptions (404/410) are deleted automatically.

---

## 6. Known issues and open work

- **Open pull requests:** Seasonal items (a temporary category that Full Reset empties; already live in the database) and the draft smoke test. Older draft PRs for these docs and the migrations are replaced by this update.
- **Supabase security advisor:**
  - It flags RLS as off on the `purchases_private` tables. Those tables aren't reachable from the API (the schema isn't exposed and anon has no usage on it), so this is low risk. Enabling RLS on them with no policies would add defence in depth without breaking anything, because only `security definer` functions and the Edge Function read them. Ask Abdallah first.
  - `public.rls_auto_enable()` predates this app. Ask Abdallah before touching it.
- **No automated tests.** A browser smoke test on each push would catch breakage before it reaches the phones.
- **Open access by design:** anyone with the URL can change counts or add items. Full Reset, deleting archives and editing someone else's profile are protected.
