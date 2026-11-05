-- 프리나눔 access control.
-- Clients (anon/authenticated) cannot write any table directly and can read only
-- season/config tables. Everything else goes through the checked functions.

do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('alter table public.%I force row level security', t.tablename);
    execute format('revoke all on table public.%I from anon, authenticated', t.tablename);
  end loop;
end;
$$;

-- Public, non-personal configuration
grant select on public.campaigns, public.sticker_types, public.app_settings to anon, authenticated;
create policy campaigns_read on public.campaigns for select to anon, authenticated using (true);
create policy sticker_types_read on public.sticker_types for select to anon, authenticated using (true);
create policy app_settings_read on public.app_settings for select to anon, authenticated using (true);

-- Sequences behind identity columns are not needed by clients either.
revoke all on all sequences in schema public from anon, authenticated;

-- Private schema: no client access at all.
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
alter default privileges in schema private revoke all on tables from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

-- Function permissions: start from nothing, then open what each role needs.
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant execute on function
  public.get_bootstrap(),
  public.get_me(),
  public.list_posts(text, text, text, boolean, int, timestamptz),
  public.get_post(text)
to anon, authenticated;

grant execute on function
  public.register_profile(text, boolean, boolean),
  public.update_nickname(text),
  public.my_posts(),
  public.my_entries(),
  public.create_giveaway(jsonb),
  public.create_request(jsonb),
  public.create_swap(jsonb),
  public.close_my_post(uuid, boolean),
  public.enter_giveaway(uuid, int, text),
  public.withdraw_entry(uuid),
  public.draw_giveaway(uuid),
  public.select_winners(uuid, uuid[]),
  public.cancel_giveaway(uuid, text),
  public.offer_to_request(uuid, int),
  public.propose_swap(uuid, boolean),
  public.submit_trade_info(uuid, text, text, boolean),
  public.confirm_peer(uuid),
  public.reveal_barcode(uuid, uuid),
  public.declare_sent(uuid),
  public.confirm_receipt(uuid),
  public.cancel_trade(uuid, text),
  public.report_trade(uuid, text, text),
  public.report_target(text, uuid, text, text),
  public.my_reports(),
  public.set_block(text, boolean),
  public.my_blocks(),
  public.get_trade(uuid),
  public.my_trades(text),
  public.my_summary(),
  public.my_contacts(),
  public.delete_contact(uuid),
  public.my_notifications(int),
  public.mark_notifications_read(bigint[]),
  public.set_threads_handle(text),
  public.request_threads_verification(),
  -- admin functions check the caller's role themselves
  public.admin_overview(),
  public.admin_list_reports(text),
  public.admin_update_report(uuid, text, text),
  public.admin_list_trades(text),
  public.admin_resolve_trade(uuid, text, text),
  public.admin_set_post_visibility(uuid, text, text),
  public.admin_find_member(text),
  public.admin_set_account_status(uuid, text, timestamptz, text),
  public.admin_revoke_progress(uuid, text),
  public.admin_set_setting(text, jsonb),
  public.admin_update_campaign(text, jsonb),
  public.admin_list_threads(text),
  public.admin_decide_threads(uuid, boolean),
  public.admin_audit_logs(int),
  public.admin_run_jobs()
to authenticated;

grant execute on function public.run_scheduled_jobs() to service_role;

-- Run deadlines and due draws every 5 minutes when pg_cron is available.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('freenanum-jobs', '*/5 * * * *', 'select public.run_scheduled_jobs()');
exception when others then
  raise notice 'pg_cron not available (%). Call public.run_scheduled_jobs() from a scheduler instead.', sqlerrm;
end;
$$;
