# Purchases List

Home stock tracker: 49 items in 11 categories, with a counter and unit picker per item. Dark, animated, built for iPhone (add it to your Home Screen from Safari).

- **Frontend:** static HTML/CSS/JS, no build step
- **Database:** Supabase (`purchases_categories`, `purchases_items`, `purchases_stock`), live sync between devices
- **Hosting:** Vercel

Items and categories live in the database, so new items appear without redeploying.

## Smoke test

`npm install && npx playwright test` loads the app at iPhone size (WebKit), types a quantity and confirms the list. Supabase is faked in the test, so real data is never touched. GitHub Actions runs it on every push. To run it locally without WebKit: `PW_BROWSER=chromium npx playwright test`.
