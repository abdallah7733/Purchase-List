# Purchases List

Home stock tracker: 49 items in 11 categories, with a counter and unit picker per item. Dark, animated, built for iPhone (add it to your Home Screen from Safari).

- **Frontend:** static HTML/CSS/JS, no build step
- **Database:** Supabase (`purchases_categories`, `purchases_items`, `purchases_stock`), live sync between devices
- **Hosting:** Vercel

Items and categories live in the database, so new items appear without redeploying.

## Rebuilding the database

The full Supabase schema is in `supabase/migrations` (tables, policies, grants, the passcode-protected reset function, push-notification tables and trigger), and `supabase/seed.sql` holds the categories and items. These files match the migrations applied to the live project.

1. `supabase link --project-ref <project-ref>` then `supabase db push` (or run the migration files in order in the SQL editor, then `seed.sql`).
2. Change the Full Reset passcode from the starter `1234`: `update purchases_private.admin set passcode_hash = extensions.crypt('<new>', extensions.gen_salt('bf')) where id;`
3. For push notifications: insert one row into `purchases_private.push_config` (VAPID keys, subject, hook secret; never commit these), deploy `supabase/functions/purchases-notify`, and update the function URL in `purchases_private.notify_session()` if the project ref changed.
