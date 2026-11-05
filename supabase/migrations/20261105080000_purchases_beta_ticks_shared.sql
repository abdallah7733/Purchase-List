-- Buying guide: "in the cart" ticks shared live between phones (Abdallah and Maguie shopping together).
-- One row per ticked item. Unticking or "Clear ticks" deletes rows. month = the month it was ticked (YYYY-MM);
-- the app ignores rows from an earlier month, so the list starts fresh each month.
create table if not exists public.purchases_beta_ticks (
  item_key text primary key,          -- a purchases_items id or a purchases_beta_items id (beta-…)
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  ticked_by uuid references public.purchases_profiles(id) on delete set null,
  ticked_at timestamptz not null default now()
);
alter table public.purchases_beta_ticks enable row level security;
drop policy if exists "beta ticks read" on public.purchases_beta_ticks;
drop policy if exists "beta ticks add" on public.purchases_beta_ticks;
drop policy if exists "beta ticks update" on public.purchases_beta_ticks;
drop policy if exists "beta ticks remove" on public.purchases_beta_ticks;
create policy "beta ticks read" on public.purchases_beta_ticks for select to anon, authenticated using (true);
create policy "beta ticks add" on public.purchases_beta_ticks for insert to anon, authenticated with check (true);
create policy "beta ticks update" on public.purchases_beta_ticks for update to anon, authenticated using (true) with check (true);
create policy "beta ticks remove" on public.purchases_beta_ticks for delete to anon, authenticated using (true);
-- upsert (re-ticking an item last ticked in an earlier month) needs update as well as insert
grant select, insert, update, delete on public.purchases_beta_ticks to anon, authenticated;
alter table public.purchases_beta_ticks replica identity full;   -- so the other phone hears which item was unticked
do $$ begin
  alter publication supabase_realtime add table public.purchases_beta_ticks;
exception when duplicate_object then null; end $$;
