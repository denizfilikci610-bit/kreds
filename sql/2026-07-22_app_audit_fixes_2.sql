-- =============================================================================
-- App-eftersyn 2026-07-21, de mindre DB-fund 5, 6, 11 og 12. ANVENDT 2026-07-22.
-- Migrationer i Supabase: fix_friends_count_of_block_filters,
-- fix_story_views_insert_can_see_gate, lock_profile_handle_from_clients,
-- orphan_media_sweep. Hver ændring blev rollback-testet mod produktion som
-- simuleret bruger (set local role + request.jwt.claims) FØR anvendelse.
-- Se også [[app-eftersyn-2026-07-21]], [[blocked-users-feature]],
-- [[supabase-storage-sletning]], [[demo-profiler]].
-- =============================================================================


-- -----------------------------------------------------------------------------
-- FUND 5: venne-TALLET talte blokerede med, mens venne-LISTEN (friends_of) ikke
--   gjorde. friends_count_of fik de SAMME to blokerings-filtre som friends_of.
--   SECURITY DEFINER bevaret (bypasser RLS på friendships, ellers ser man kun sine
--   egne venskaber og tallet falder til ~1). Grants uændrede (authenticated,
--   service_role). VERIFICERET: tal == cardinality(friends_of) både før (4=4) og
--   efter en blokering (3=3).
create or replace function public.friends_count_of(u uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  select count(*)::int
  from friendships f
  join profiles p on p.id = f.friend_id
  where f.user_id = u
    and auth.uid() is not null
    and not exists (
      select 1 from blocked_users b
      where (b.blocker = auth.uid() and b.blocked = u)
         or (b.blocker = u and b.blocked = auth.uid())
    )
    and not exists (
      select 1 from blocked_users b2
      where (b2.blocker = auth.uid() and b2.blocked = p.id)
         or (b2.blocker = p.id and b2.blocked = auth.uid())
    );
$function$;


-- -----------------------------------------------------------------------------
-- FUND 6: en story-visning kunne forfalskes. story_views_insert kontrollerede kun
--   viewer = auth.uid(), ikke om brugeren måtte SE storyen. Tilføjede can_see_story-
--   gaten (findes fra story_reports.sql). Policyen gælder {public} som før, så
--   can_see_story grantes også til anon (returnerer false for anon), så gaten ikke
--   kaster "permission denied for function". VERIFICERET: en fremmed/ikke-medlem
--   afvises nu (42501), mens ven-story og egen story stadig kan registreres.
drop policy if exists story_views_insert on public.story_views;
create policy story_views_insert on public.story_views
  for insert
  with check (
    viewer = (select auth.uid())
    and app_hidden.can_see_story(story_id)
  );
grant execute on function app_hidden.can_see_story(uuid) to anon;


-- -----------------------------------------------------------------------------
-- FUND 11: brugernavn (handle) kunne ændres via REST trods låst UI. En BEFORE
--   UPDATE OF handle-trigger afviser handle-skift for almindelige brugere. BEVIDST
--   security INVOKER, så den ser den KALDENDE rolle i current_user: authenticated/
--   anon afvises; service_role og interne SECURITY DEFINER-funktioner (kører som
--   'postgres') slipper igennem, så signup-genbrug og kontosletning ikke brydes.
--   Bekræftet: ingen DB-funktion UPDATEr profiles, og profil-gem sender aldrig
--   handle. VERIFICERET: handle-skift som bruger afvist (23514), name-skift og
--   samme-handle-no-op virker, handle-skift som service_role virker.
create or replace function app_hidden.tg_lock_handle()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.handle is distinct from old.handle
     and current_user in ('authenticated', 'anon') then
    raise exception 'handle is immutable'
      using errcode = 'check_violation',
            hint = 'handle changes are only allowed server-side';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_lock_handle on public.profiles;
create trigger profiles_lock_handle
  before update of handle on public.profiles
  for each row execute function app_hidden.tg_lock_handle();


-- -----------------------------------------------------------------------------
-- FUND 12: upload-før-insert efterlader filer uden DB-række hvis appen lukkes.
--   sweep_orphan_media lægger forældreløse filer (ældre end p_older, ikke i brug)
--   fra begge bøtter i den eksisterende kø (app_hidden.deleted_media); fejeren
--   media-sweeper (cron sweep-media hvert 5. min) sletter dem via Storage-API.
--   To værn mod at ramme et upload-før-insert: alders-filteret OG media_in_use her,
--   plus claim_media re-tjekker media_in_use inden sletning. enqueue_media udleder
--   bøtten af stien. VERIFICERET: 100-års-vindue → 0, 1-dags → 6; de 6 forventede
--   stier havnede i køen; engangs-kørsel + sweep tømte storage (0 orphans tilbage).
create or replace function app_hidden.sweep_orphan_media(p_older interval default interval '1 day')
returns int
language plpgsql
security definer
set search_path to 'app_hidden', 'storage', 'public'
as $$
declare n int := 0; r record;
begin
  for r in
    select o.name
      from storage.objects o
     where o.bucket_id in ('post-images', 'vf-private')
       and o.created_at < now() - p_older
       and coalesce(o.name, '') <> ''
       and o.name not like '%/'
       and o.name not like '%.emptyFolderPlaceholder'
       and not app_hidden.media_in_use(o.name)
  loop
    perform app_hidden.enqueue_media(r.name);
    n := n + 1;
  end loop;
  return n;
exception when others then
  return n;
end;
$$;

revoke all on function app_hidden.sweep_orphan_media(interval) from public;

-- Engangs-oprydningen (kørt 2026-07-22): køede 6, media-sweeper slettede dem.
--   select app_hidden.sweep_orphan_media(interval '1 day');
--   select app_hidden.sweep_media();

-- Dagligt job (kørt uden for transaktionen; 04:23 for at undgå :00/:30-myldretid):
--   select cron.schedule('sweep-orphan-media', '23 4 * * *',
--     $$select app_hidden.sweep_orphan_media(interval '1 day')$$);   -- jobid 5


-- =============================================================================
-- FUND 8 (edge, ikke SQL): notif-poll manglede mention-dedupen som klienten og
-- push-triggerne har, så en @-omtale i en kommentar gav to lokalnotifikationer.
-- Rettet i supabase/functions/notif-poll/index.ts og deployet som v33. Et
-- dedupe-pass fjerner comment/reply-events hvis cid er i menCids, og post/
-- post_kreds hvis pid er i menPids. VERIFICERET read-only mod demo-data: for
-- demojonas fjernes den overlappende comment (cid 208) mens mentionen beholdes,
-- og urelaterede comment-events (200/201/207) er urørte.
-- =============================================================================
