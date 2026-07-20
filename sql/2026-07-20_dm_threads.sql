-- =============================================================================
-- DM-tråde + auto-deling af hele kredsen-minder (kørt via apply_migration
-- 2026-07-20 som "dm_threads"). Arkivkopi.
--
-- En DM-tråd er en kreds-løs 2-personers besked-tråd: en feeds-række med
-- is_dm = true. Genbruger AL tråd-maskinen (kreds_messages, kreds_chat_reads,
-- RLS, realtime). dm_key = 'mindste-uuid:største-uuid' gør parret unikt.
-- =============================================================================

alter table public.feeds add column is_dm boolean not null default false;
alter table public.feeds add column dm_key text;
create unique index feeds_dm_key_uniq on public.feeds (dm_key) where dm_key is not null;

-- En DM-tråd er låst på præcis 2 medlemmer: invitationer/afstemninger/anmodninger kan
-- aldrig tilføje en tredje (alle veje ind går gennem INSERT på feed_members).
create or replace function app_hidden.tg_dm_member_lock()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if (select is_dm from feeds where id = new.feed_id)
     and (select count(*) from feed_members where feed_id = new.feed_id) >= 2 then
    raise exception 'dm_locked';
  end if;
  return new;
end $$;
create trigger dm_member_lock before insert on public.feed_members
  for each row execute function app_hidden.tg_dm_member_lock();

-- Der kan ikke POSTES opslag i en DM-tråd (den er kun en samtale)
create or replace function app_hidden.tg_dm_no_posts()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.feed_id is not null and (select is_dm from feeds where id = new.feed_id) then
    raise exception 'dm_no_posts';
  end if;
  return new;
end $$;
create trigger dm_no_posts before insert on public.posts
  for each row execute function app_hidden.tg_dm_no_posts();

-- Find/opret parrets DM-tråd. Kun mellem venner og aldrig på tværs af en blokering.
create or replace function public.get_or_create_dm(other uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare me uuid := auth.uid(); fid uuid; k text;
begin
  if me is null then raise exception 'not_authenticated'; end if;
  if other is null or other = me then raise exception 'bad_target'; end if;
  if not exists (select 1 from friendships where user_id = me and friend_id = other) then
    raise exception 'not_friend';
  end if;
  if app_hidden.is_blocked_between(me, other) then raise exception 'blocked'; end if;
  k := least(me::text, other::text) || ':' || greatest(me::text, other::text);
  perform pg_advisory_xact_lock(hashtext(k)); -- serialisér dobbelt-tap/kapløb pr. par
  select id into fid from feeds where dm_key = k;
  if fid is null then
    insert into feeds (name, owner, governance, is_dm, dm_key)
    values ('DM', me, 'owner', true, k)
    returning id into fid;
  end if;
  insert into feed_members (feed_id, user_id)
  select fid, v.x from (values (me), (other)) v(x)
  where not exists (select 1 from feed_members fm where fm.feed_id = fid and fm.user_id = v.x);
  return fid;
end $$;
revoke all on function public.get_or_create_dm(uuid) from public;
grant execute on function public.get_or_create_dm(uuid) to authenticated;

-- Minde i en kreds → delings-besked i kredsens tråd (uændret). NYT: minde til HELE
-- kredsen (feed_id null) auto-deles i alle trådene med præcis to medlemmer (rigtige
-- 2-personers kredse OG DM-tråde) hvor den anden stadig er en VEN og intet blokerer.
create or replace function app_hidden.tg_post_memory_message()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.kind = 'memory' then
    if new.feed_id is not null then
      insert into kreds_messages (feed_id, author, post_id) values (new.feed_id, new.author, new.id);
    else
      insert into kreds_messages (feed_id, author, post_id)
      select fm.feed_id, new.author, new.id
      from feed_members fm
      join feed_members fo on fo.feed_id = fm.feed_id and fo.user_id <> fm.user_id
      where fm.user_id = new.author
        and exists (select 1 from friendships f
                     where f.user_id = new.author and f.friend_id = fo.user_id)
        and not app_hidden.is_blocked_between(new.author, fo.user_id)
        and (select count(*) from feed_members c where c.feed_id = fm.feed_id) = 2;
    end if;
  end if;
  return new;
end $$;
