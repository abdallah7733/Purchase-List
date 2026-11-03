-- Buying guide (Beta), 3 Nov 2026: "Count at home" keeps its counts inside the Beta (owner's choice),
-- so purchases_beta_stock must accept any item, not only the 9 Beta-only ones. The main list is not touched.
alter table public.purchases_beta_stock drop constraint if exists purchases_beta_stock_item_key_fkey;
comment on column public.purchases_beta_stock.item_key is 'A purchases_items id or a purchases_beta_items id (beta-…)';
