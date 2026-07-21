-- =============================================================================
-- Server-side medieoprydning. Migrationer: media_cleanup_queue +
-- media_cleanup_sweeper_rpcs + media_sweeper_cron (kørt 2026-07-21).
--
-- HVAD DER VAR GALT
-- 1. Alle løbende sletninger af filer var fire-and-forget fra klienten
--    (sb.storage...remove(...).catch(function(){})). Lukkede brugeren appen, eller
--    fejlede kaldet, blev filen liggende.
-- 2. delete-account (edge v24) ryddede kun post-images/{user.id}/ med limit 1000.
-- 3. VÆRST: app_hidden.cleanup_expired_stories forsøgte at slette direkte i
--    storage.objects. Det er FORBUDT: Supabase har en BEFORE DELETE-trigger
--    (storage.protect_delete) der kaster 42501 "Direct deletion from storage
--    tables is not allowed". Hele funktionen fejlede derfor, HVER TIME, hvilket
--    betød at udløbne stories ALDRIG blev slettet, hverken rækker eller filer.
--    Set i cron.job_run_details: jobid 3 fejlede ved hver eneste kørsel.
--    Løftet i privatlivspolitikken om at en story forsvinder efter 24 timer var
--    altså ikke sandt for de gemte data.
--
-- MODELLEN NU
--   triggere  → lægger stien i en kø (kan aldrig fejle, kan aldrig vælte
--               brugerens handling, virker også når rækken forsvinder via cascade
--               fra "Slet konto", og kender ingen 1000-grænse)
--   fejeren   → edge-funktionen media-sweeper tømmer køen med service-nøglen via
--               Storage-API'et, som er den eneste vej filer reelt forsvinder
--   cron      → sweep-media hvert 5. minut; gør intet når køen er tom
-- =============================================================================

begin;

-- ---- Køen ----
create table if not exists app_hidden.deleted_media (
  id         bigserial primary key,
  bucket     text        not null default 'post-images',
  path       text        not null,
  created_at timestamptz not null default now(),
  attempts   int         not null default 0,
  last_error text,
  unique (bucket, path)
);

-- Er stien stadig i brug? Sikkerhedsnet inden en fil slettes for alvor.
create or replace function app_hidden.media_in_use(p_path text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from posts          where image_path  = p_path or video_path  = p_path)
      or exists (select 1 from comments       where image_path  = p_path)
      or exists (select 1 from stories        where image_path  = p_path or video_path  = p_path)
      or exists (select 1 from kreds_messages where image_path  = p_path or video_path  = p_path)
      or exists (select 1 from profiles       where avatar_path = p_path or banner_path = p_path);
$$;

create or replace function app_hidden.enqueue_media(p_path text)
returns void
language plpgsql
security definer
set search_path to 'app_hidden', 'public'
as $$
begin
  if p_path is null or btrim(p_path) = '' then return; end if;
  insert into app_hidden.deleted_media (bucket, path) values ('post-images', p_path)
  on conflict (bucket, path) do nothing;
exception when others then
  return; -- oprydning må ALDRIG vælte brugerens sletning
end;
$$;

-- Én generisk trigger-funktion. Argumenterne er (ejer-kolonne, sti-kolonne, ...).
--
-- EJERSKABS-VÆRNET er ikke pynt. Angrebet det lukker (fundet i den adversariske
-- gennemgang): Mallory læser Alices avatar_path, for profiler er læsbare, sætter
-- sin EGEN rækkes image_path til Alices sti og sletter så sin egen række. Uden
-- værnet ville Alices billede ryge i køen og blive slettet. Derfor køes en sti kun
-- hvis den ligger i rækkens egen ejers mappe. Alle 120 stier i produktionen
-- overholder det, fordi upload altid sker til {auth.uid()}/....
create or replace function app_hidden.tg_media_cleanup()
returns trigger
language plpgsql
security definer
set search_path to 'app_hidden', 'public'
as $$
declare
  owner_col text; owner_id text; col text; old_path text; new_path text; i int;
begin
  owner_col := tg_argv[0];
  execute format('select ($1).%I::text', owner_col) into owner_id using old;
  if owner_id is null then return null; end if;

  for i in 1 .. (array_upper(tg_argv, 1)) loop
    col := tg_argv[i];
    execute format('select ($1).%I::text', col) into old_path using old;
    if old_path is null or btrim(old_path) = '' then continue; end if;

    if tg_op = 'UPDATE' then
      execute format('select ($1).%I::text', col) into new_path using new;
      if new_path is not distinct from old_path then continue; end if; -- uændret sti
    end if;

    if split_part(old_path, '/', 1) is distinct from owner_id then continue; end if; -- værnet

    perform app_hidden.enqueue_media(old_path);
  end loop;
  return null;
exception when others then
  return null;
end;
$$;

revoke all on function app_hidden.media_in_use(text)  from public;
revoke all on function app_hidden.enqueue_media(text) from public;
revoke all on function app_hidden.tg_media_cleanup()  from public;

-- ---- Triggerne: slettes rækken, eller udskiftes stien, ryger den gamle fil i køen ----
drop trigger if exists posts_media_cleanup_del on public.posts;
create trigger posts_media_cleanup_del after delete on public.posts
  for each row execute function app_hidden.tg_media_cleanup('author', 'image_path', 'video_path');
drop trigger if exists posts_media_cleanup_upd on public.posts;
create trigger posts_media_cleanup_upd after update of image_path, video_path on public.posts
  for each row execute function app_hidden.tg_media_cleanup('author', 'image_path', 'video_path');

drop trigger if exists comments_media_cleanup_del on public.comments;
create trigger comments_media_cleanup_del after delete on public.comments
  for each row execute function app_hidden.tg_media_cleanup('author', 'image_path');
drop trigger if exists comments_media_cleanup_upd on public.comments;
create trigger comments_media_cleanup_upd after update of image_path on public.comments
  for each row execute function app_hidden.tg_media_cleanup('author', 'image_path');

drop trigger if exists stories_media_cleanup_del on public.stories;
create trigger stories_media_cleanup_del after delete on public.stories
  for each row execute function app_hidden.tg_media_cleanup('author', 'image_path', 'video_path');

drop trigger if exists kreds_messages_media_cleanup_del on public.kreds_messages;
create trigger kreds_messages_media_cleanup_del after delete on public.kreds_messages
  for each row execute function app_hidden.tg_media_cleanup('author', 'image_path', 'video_path');

drop trigger if exists profiles_media_cleanup_del on public.profiles;
create trigger profiles_media_cleanup_del after delete on public.profiles
  for each row execute function app_hidden.tg_media_cleanup('id', 'avatar_path', 'banner_path');
drop trigger if exists profiles_media_cleanup_upd on public.profiles;
create trigger profiles_media_cleanup_upd after update of avatar_path, banner_path on public.profiles
  for each row execute function app_hidden.tg_media_cleanup('id', 'avatar_path', 'banner_path');

-- ---- Det knækkede cron-job repareres ----
create or replace function app_hidden.cleanup_expired_stories()
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  -- Ingen storage-sletning her: den var ulovlig og fik hele funktionen til at
  -- fejle, så udløbne stories aldrig blev slettet. Trigger'en køer filerne.
  delete from public.stories where expires_at < now();
end;
$$;

-- ---- RPC'erne som fejeren bruger (samme mønster som send-push) ----
create table if not exists app_hidden.media_hook (secret text primary key);
insert into app_hidden.media_hook (secret)
select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
where not exists (select 1 from app_hidden.media_hook);

create or replace function public.check_media_hook(sec text)
returns boolean
language sql
stable
security definer
set search_path to 'app_hidden'
as $$ select exists (select 1 from media_hook where secret = sec) $$;

-- Tager op til n stier ud af køen. Rydder først dem der er kommet i brug igen, og
-- tæller forsøg op, så en fil der bliver ved med at fejle lægges til side i stedet
-- for at spærre køen.
create or replace function public.claim_media(n int)
returns table(id bigint, bucket text, path text)
language plpgsql
security definer
set search_path to 'app_hidden', 'public'
as $$
begin
  delete from app_hidden.deleted_media d
   where d.id in (select d2.id from app_hidden.deleted_media d2 where d2.attempts < 8 order by d2.id limit n)
     and app_hidden.media_in_use(d.path);

  return query
    update app_hidden.deleted_media d
       set attempts = d.attempts + 1
     where d.id in (select d2.id from app_hidden.deleted_media d2 where d2.attempts < 8 order by d2.id limit n)
    returning d.id, d.bucket, d.path;
end;
$$;

create or replace function public.ack_media(ids bigint[])
returns void
language sql
security definer
set search_path to 'app_hidden'
as $$ delete from deleted_media where id = any(ids) $$;

create or replace function public.fail_media(ids bigint[], err text)
returns void
language sql
security definer
set search_path to 'app_hidden'
as $$ update deleted_media set last_error = left(err, 300) where id = any(ids) $$;

-- VIGTIGT: 'revoke ... from public' er IKKE nok i Supabase. Skemaet public har
-- default privileges der giver EXECUTE på NYE funktioner til anon og
-- authenticated, og de grants er eksplicitte, så PUBLIC-revoket rører dem ikke.
-- Uden linjerne til anon/authenticated nedenfor kunne hvem som helst kalde
-- fejerens RPC'er over REST: ack_media ville tømme køen så filer aldrig blev
-- slettet, og claim_media ville vise stier på andres slettede medier.
-- (Fanget ved at spørge has_function_privilege i stedet for at tro på SQL'en.)
revoke all    on function public.check_media_hook(text)      from public;
revoke all    on function public.claim_media(int)            from public;
revoke all    on function public.ack_media(bigint[])         from public;
revoke all    on function public.fail_media(bigint[], text)  from public;
revoke execute on function public.check_media_hook(text)     from anon, authenticated;
revoke execute on function public.claim_media(int)           from anon, authenticated;
revoke execute on function public.ack_media(bigint[])        from anon, authenticated;
revoke execute on function public.fail_media(bigint[], text) from anon, authenticated;
grant execute on function public.check_media_hook(text)     to service_role;
grant execute on function public.claim_media(int)           to service_role;
grant execute on function public.ack_media(bigint[])        to service_role;
grant execute on function public.fail_media(bigint[], text) to service_role;

-- Kalder fejeren, som app_hidden.notify_push kalder send-push.
create or replace function app_hidden.sweep_media()
returns void
language plpgsql
security definer
set search_path to 'app_hidden', 'extensions', 'public'
as $$
declare hook text; pending int;
begin
  select count(*) into pending from app_hidden.deleted_media where attempts < 8;
  if pending = 0 then return; end if;
  select secret into hook from app_hidden.media_hook limit 1;
  perform net.http_post(
    url := 'https://iduotqxkohuezxkveawc.supabase.co/functions/v1/media-sweeper',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-media-secret', hook),
    body := jsonb_build_object('source', 'cron')
  );
exception when others then
  return;
end;
$$;

revoke all on function app_hidden.sweep_media() from public;

commit;

-- ---- Kadencen (uden for transaktionen) ----
-- select cron.unschedule('sweep-media') where exists (select 1 from cron.job where jobname = 'sweep-media');
-- select cron.schedule('sweep-media', '*/5 * * * *', 'select app_hidden.sweep_media()');

-- =============================================================================
-- AFPRØVET MOD PRODUKTION
--   · cleanup_expired_stories i rollback-blok: 3 udløbne stories slettes, og
--     trigger'en lagde præcis 3 filer i køen.
--   · Hele fejer-kæden: en prøvesti i køen → sweep_media → edge-funktionen svarede
--     {"removed":1,"failed":0} → køen tom. Altså virker pg_net, hemmeligheden,
--     claim/ack-RPC'erne og selve Storage-sletningen.
--
-- STADIG UDESTÅENDE
--   · Den private bøtte til stories og chat-billeder, se
--     2026-07-21_private_media_bucket.sql (bøtten skal oprettes først).
--   · delete-account's egen list/remove med limit 1000 er nu overflødig, fordi
--     cascade udløser triggerne. Den skader ikke og kan ryddes ved lejlighed.
-- =============================================================================
