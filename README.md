# Purchases List

A shared home-stock app for iPhone. Each person counts what's left at home, confirms the day's list, and every phone sees the same history, shopping list and notifications.

**Live app:** https://purchase-list-theta.vercel.app (open it in Safari, then Share → Add to Home Screen)

## What it does

- **61 household items in 11 categories**, ordered like a walk through a supermarket, plus a **Seasonal** group for temporary items that Full Reset clears. Anyone can **add an item**; the category and unit are guessed from the name (English or Arabic) and can be changed.
- **Pick an amount** with an iOS-style wheel (quantity + unit), or type an exact amount. Zero is a valid count.
- **Confirm** saves today's list. Confirming again the same day replaces it, and past days can be edited from History.
- **History** by date, **In stock** (each item's latest count), and an item's own history when you pick it.
- **Shopping list** of every item counted since the last reset with the amount left, in market-walk order, with ticks shared live between phones and a PDF export.
- **Profiles** with a name and an avatar (preset or photo), and an **Activity** log of who changed what.
- **Push notifications** to the other phones ("Mohammed added 3 items to your purchase list"), batched while someone is still editing, plus a badge on the app icon.
- **Full Reset** (admin passcode) saves the period to the **Archive**, then clears the days, the shopping ticks and Seasonal items.
- **Export CSV**, haptic ticks and soft click sounds (sound can be turned off in the menu).

## Stack

| Part | What |
|---|---|
| Frontend | Static HTML, CSS and vanilla JS, no build step. Apple-style white and blue theme. |
| Database | Supabase (Postgres with Row Level Security, Realtime, Storage for avatars) |
| Push | Supabase Edge Function `purchases-notify` sending Web Push (VAPID) |
| Hosting | Vercel, deploys automatically from `main` |

Items and categories live in the database, so new items appear without a redeploy. There is no login: anyone with the link can edit the list (the owner's choice).

## Files

| Path | Purpose |
|---|---|
| `index.html` | Page shell, PWA meta tags, loads supabase-js from jsDelivr |
| `styles.css` | Apple-style light theme |
| `app.js` | All app logic |
| `config.js` | Public Supabase URL, publishable key and VAPID public key |
| `sw.js` | Service worker for push notifications and the icon badge (no offline cache) |
| `manifest.webmanifest`, `icon-*.png`, `favicon*` | PWA manifest and icons |
| `vercel.json` | Security and caching headers |
| `supabase/migrations/` | Every database change, in order. Replaying them rebuilds the live schema. |
| `supabase/seed.sql` | Current categories and items |
| `supabase/functions/purchases-notify/` | Edge Function that sends the push notifications |
| `HANDOFF.md` | Technical notes for whoever works on this next |
| `Purchases_List.xlsx` | The original Excel list the app started from |

## Run locally

Serve the folder with any static server (for example `npx serve .`) and open it in a browser. It talks to the live Supabase project, so changes you make are real.

See [HANDOFF.md](HANDOFF.md) for the database, how to change it, and known issues.
