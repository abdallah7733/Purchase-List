-- Buying guide (Beta): Seoudi receipt of 24 Nov 2026 (Sheikh Zayed, 15:46), checked line by line with Abdallah.
-- Adds 2 Beta-only items he asked for (White cheese, Pickles). Pieces is left empty: Seoudi prints 6.69, a sum of weights and pieces. Safe to run again.

insert into public.purchases_beta_items (id, name, category_id, unit, sort) values
  ('beta-white-cheese', 'White cheese', 10, 'kg', 15),
  ('beta-pickles', 'Pickles', 10, 'kg', 16)
on conflict (id) do update set name = excluded.name, category_id = excluded.category_id, unit = excluded.unit, sort = excluded.sort;

insert into public.purchases_receipts (id, store, branch, bought_on, bought_time, total, paid, pieces, source) values
  (5, 'Seoudi', 'Sheikh Zayed', '2026-11-24', '15:46', 1148.36, 1148.36, null, 'photo')
on conflict (id) do update set store = excluded.store, branch = excluded.branch, bought_on = excluded.bought_on, bought_time = excluded.bought_time, total = excluded.total, paid = excluded.paid, pieces = excluded.pieces, source = excluded.source;
select setval(pg_get_serial_sequence('public.purchases_receipts', 'id'), greatest((select max(id) from public.purchases_receipts), 1));

insert into public.purchases_receipt_lines (receipt_id, line_no, barcode, name_ar, name_en, qty, qty_unit, unit_price, line_total, discount, item_key, app_qty, app_unit, status, note) values
  (5, 1, null, 'سعودي بيض ابيض 30ق', 'Seoudi white eggs, tray of 30', 1.0, 'pcs', 151.45, 151.45, 0.0, 'eggs', 1.0, 'tray', 'OK', null),
  (5, 2, null, 'مفازا موتزاريلا طبيعي 280جم', 'Mafaza natural mozzarella 280 g', 1.0, 'pcs', 178.95, 178.95, -27.45, 'mozzarella', 0.28, 'kg', 'OK', null),
  (5, 3, null, 'بسمة بسلة بالجزر 400جم', 'Basma peas & carrots 400 g', 1.0, 'pcs', 29.75, 29.75, 0.0, 'frozen-vegetables', 1.0, 'bag', 'OK', null),
  (5, 4, null, 'المراعي كريمة طهي 500جم', 'Almarai cooking cream 500 g', 1.0, 'pcs', 159.95, 159.95, -20.0, 'cooking-cream', 1.0, 'pack', 'OK', null),
  (5, 5, null, 'سعودي ميني كرواسون وزن', 'Seoudi mini croissant (by weight)', 0.242, 'kg', 375.0, 90.75, 0.0, null, null, null, 'SKIP', 'Bakery snack (you said skip)'),
  (5, 6, null, 'موتزاريلا طبيعي مبشور وزن', 'Natural shredded mozzarella (by weight)', 0.292, 'kg', 410.0, 119.72, 0.0, 'mozzarella', 0.292, 'kg', 'OK', null),
  (5, 7, null, 'بريموس موتزاريلا طبيعي 300جم', 'Primos natural mozzarella 300 g', 1.0, 'pcs', 152.0, 152.0, 0.0, 'mozzarella', 0.3, 'kg', 'OK', null),
  (5, 8, null, 'جبنة ملح خفيف طبيعي دومتي وزن', 'Domty white cheese, light salt (by weight)', 0.572, 'kg', 327.5, 187.33, -18.62, 'beta-white-cheese', 0.572, 'kg', 'NEWITEM', 'New app item (you asked, 24 Nov 2026)'),
  (5, 9, null, 'طرشي بلدي لوكس وزن', 'Torshi baladi lux pickles (by weight)', 0.298, 'kg', 57.95, 17.27, 0.0, 'beta-pickles', 0.298, 'kg', 'NEWITEM', 'New app item (you asked, 24 Nov 2026)'),
  (5, 10, null, 'حلواني لانشون بقري زيتون وزن', 'Halwani beef luncheon with olives (by weight)', 0.286, 'kg', 444.95, 127.26, 0.0, 'luncheon', 286.0, 'g', 'OK', null)
on conflict (receipt_id, line_no) do update set barcode = excluded.barcode, name_ar = excluded.name_ar, name_en = excluded.name_en, qty = excluded.qty, qty_unit = excluded.qty_unit, unit_price = excluded.unit_price, line_total = excluded.line_total, discount = excluded.discount, item_key = excluded.item_key, app_qty = excluded.app_qty, app_unit = excluded.app_unit, status = excluded.status, note = excluded.note;
