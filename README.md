# Purchases List

A home shopping tracker built for iPhone. Pick what you bought today, confirm it, and the day is saved to a shared history that every device sees.

**Live app:** https://purchase-list-theta.vercel.app (open in Safari, then Share → Add to Home Screen)

## What it does

- **53 household items in 11 categories**, ordered like a walk through a supermarket (dry goods first, chilled and frozen last).
- **Pick an amount** for any item with an iOS-style wheel picker (quantity + unit), or type an exact amount. Zero is a valid entry.
- **Confirm** saves today's list. Confirming again the same day replaces that day's list.
- **History** by date, plus a **Totals** view that adds every saved day together (different units for one item stay separate, for example `2 kg + 500 g`).
- **Recently saved** pop-up shows the last saved list when the app opens.
- **Push notifications** tell your other devices when a list is saved, with a count badge on the app icon.
- **Full Reset** wipes all history, protected by an admin passcode checked in the database.
- **Export CSV** of the whole history, ready to open in Numbers or Excel.
- Haptic ticks and soft click sounds (sound can be turned off in the menu).

## Stack

| Part | What |
|---|---|
| Frontend | Static HTML, CSS and vanilla JS. No build step. Apple-style white and blue theme. |
| Database | Supabase (Postgres, Row Level Security, Realtime) |
| Push | Supabase Edge Function `purchases-notify` using Web Push (VAPID) |
| Hosting | Vercel, deploys automatically from `main` |

Items and categories live in the database, so new items appear without redeploying.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell, PWA meta tags, loads supabase-js from jsDelivr |
| `styles.css` | Apple-style light theme |
| `app.js` | All app logic |
| `config.js` | Public Supabase URL, publishable key and VAPID public key |
| `sw.js` | Service worker for push notifications and the icon badge (no offline cache) |
| `manifest.webmanifest`, `icon-*.png` | PWA manifest and icons |
| `vercel.json` | Security and caching headers |
| `supabase/functions/purchases-notify/` | Edge Function that sends the push notifications |
| `HANDOFF.md` | Full technical notes for whoever works on this next |

## Run locally

Serve the folder with any static server, for example `npx serve .`, and open it in a browser. It talks to the live Supabase project.

See [HANDOFF.md](HANDOFF.md) for the database schema, how to add items, and open issues.
