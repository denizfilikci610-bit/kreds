-- =============================================================================
-- Set-kvitteringer i kreds-chatten (Messenger-agtigt "hvem har set"):
-- én række pr. (kreds, medlem) med hvor langt medlemmet har læst.
-- Migration: kreds_chat_reads
-- =============================================================================

begin;

create table public.kreds_chat_reads (
  feed_id      uuid        not null references public.feeds(id)    on delete cascade,
  user_id      uuid        not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (feed_id, user_id)
);

alter table public.kreds_chat_reads enable row level security;

-- Kredsens medlemmer ser alle kvitteringer i kredsen
create policy kreds_chat_reads_select on public.kreds_chat_reads
  for select to authenticated
  using (exists (select 1 from public.feed_members fm
                  where fm.feed_id = kreds_chat_reads.feed_id
                    and fm.user_id = auth.uid()));

-- Man skriver kun sin EGEN kvittering, og kun i kredse man er medlem af
create policy kreds_chat_reads_insert on public.kreds_chat_reads
  for insert to authenticated
  with check (user_id = auth.uid()
    and exists (select 1 from public.feed_members fm
                 where fm.feed_id = kreds_chat_reads.feed_id
                   and fm.user_id = auth.uid()));

create policy kreds_chat_reads_update on public.kreds_chat_reads
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and exists (select 1 from public.feed_members fm
                 where fm.feed_id = kreds_chat_reads.feed_id
                   and fm.user_id = auth.uid()));

-- Blokering: kvitteringer fra blokerede medlemmer skjules (samme gate-mønster som
-- posts/comments/likes i 2026-07-10_blocked_users_del_A.sql)
create policy kreds_chat_reads_block_gate on public.kreds_chat_reads
  as restrictive for select
  using (user_id = auth.uid() or not app_hidden.is_blocked_between(auth.uid(), user_id));

grant select, insert, update on public.kreds_chat_reads to authenticated;

-- Realtime: kvitteringerne flytter sig live hos de andre i tråden
alter publication supabase_realtime add table public.kreds_chat_reads;

commit;
