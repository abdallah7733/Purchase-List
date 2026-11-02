create table public.purchases_categories (
  id smallint primary key,
  name text not null unique,
  sub text,
  hue text not null default '#E9A93B',
  sort smallint not null
);
create table public.purchases_items (
  id text primary key,
  name text not null unique,
  category_id smallint not null references public.purchases_categories(id) on update cascade,
  default_unit text not null,
  sort smallint not null
);
create index purchases_items_category_idx on public.purchases_items(category_id);
create table public.purchases_stock (
  item_id text primary key references public.purchases_items(id) on delete cascade,
  qty numeric(10,2) not null default 0 check (qty >= 0 and qty <= 100000),
  unit text not null check (unit in ('kg','g','L','ml','pcs','pack','bottle','box','can','jar','bag','roll','carton','dozen','tray')),
  updated_at timestamptz not null default now()
);
create or replace function public.purchases_touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger purchases_stock_touch before update on public.purchases_stock for each row execute function public.purchases_touch();

alter table public.purchases_categories enable row level security;
alter table public.purchases_items enable row level security;
alter table public.purchases_stock enable row level security;

create policy "read categories" on public.purchases_categories for select to anon, authenticated using (true);
create policy "read items" on public.purchases_items for select to anon, authenticated using (true);
create policy "read stock" on public.purchases_stock for select to anon, authenticated using (true);
create policy "add stock" on public.purchases_stock for insert to anon, authenticated with check (true);
create policy "change stock" on public.purchases_stock for update to anon, authenticated using (true) with check (true);

grant select on public.purchases_categories, public.purchases_items to anon, authenticated;
grant select, insert, update on public.purchases_stock to anon, authenticated;
revoke delete on public.purchases_stock from anon, authenticated;

alter publication supabase_realtime add table public.purchases_stock;
