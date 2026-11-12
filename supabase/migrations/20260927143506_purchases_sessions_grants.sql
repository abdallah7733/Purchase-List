grant select, insert, update on public.purchases_sessions to anon, authenticated;
revoke truncate, delete on public.purchases_sessions from anon, authenticated;
