-- =============================================================================
-- Privat bøtte til stories. Migration: private_media_bucket (kørt 2026-07-21)
--
-- PROBLEMET: alt medie lå i en OFFENTLIG bøtte (js/helpers.js imgUrl bruger
-- getPublicUrl), så kendte man stien, kunne man hente en story uden at være logget
-- ind. RLS beskytter databasen, ikke filerne.
--
-- STI-KONVENTION: filer i den private bøtte hedder 'priv/{auth.uid()}/{uuid}.ext',
-- og PRÆCIS den streng gemmes også i databasekolonnen. Så kan både klienten og
-- oprydningen se på stien alene hvilken bøtte filen bor i, uden ekstra kolonner,
-- og gamle stier uden præfiks bliver liggende i post-images og virker uændret.
-- Ingen migrering af eksisterende filer, ingen brudte billeder.
--
-- LÆSEREGLEN er den pæne del: Storage-API'et laver kun en signeret URL hvis
-- brugeren må lave select på filen, og select-policyen slår filen op i den række
-- der ejer den. Rækkens EGEN RLS gælder inde i det opslag, så synligheden på filen
-- bliver automatisk den samme som på storyen. Ingen dobbeltbogføring.
--
-- HVORFOR KUN STORIES: chat-beskeder har i dag ingen egne billeder (nul rækker med
-- image_path i kreds_messages; medier deles som minder via post_id), og minder og
-- tanker vises i feedet, hvor en signeret URL pr. billede ville koste for meget.
-- Reglen for kreds_messages står der allerede, så beskedbilleder kan tændes senere
-- uden en ny migration.
--
-- INGEN APP-OPDATERING: web'en bygger selv upload-URL'en og sender den til native
-- (js/compose.js nativeMemoryPost), så bøtteskiftet er en ren web-ændring.
-- =============================================================================

begin;

insert into storage.buckets (id, name, public)
values ('vf-private', 'vf-private', false)
on conflict (id) do update set public = false;

-- Upload kun i sin egen mappe under priv/
drop policy if exists vf_private_insert_own on storage.objects;
create policy vf_private_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'vf-private'
    and (storage.foldername(name))[1] = 'priv'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

drop policy if exists vf_private_delete_own on storage.objects;
create policy vf_private_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'vf-private'
    and (storage.foldername(name))[1] = 'priv'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

-- Læsning: må jeg se den række filen hører til?
drop policy if exists vf_private_read_owned_rows on storage.objects;
create policy vf_private_read_owned_rows on storage.objects
  for select to authenticated
  using (
    bucket_id = 'vf-private'
    and (
      (storage.foldername(name))[2] = (select auth.uid())::text   -- egne filer altid
      or exists (select 1 from public.stories s
                  where s.image_path = storage.objects.name
                     or s.video_path = storage.objects.name)
      or exists (select 1 from public.kreds_messages m
                  where m.image_path = storage.objects.name
                     or m.video_path = storage.objects.name)
    )
  );

-- ---- Oprydningen skal kende begge bøtter ----
create or replace function app_hidden.media_bucket(p_path text)
returns text
language sql
immutable
as $$ select case when p_path like 'priv/%' then 'vf-private' else 'post-images' end $$;

-- Ejer-segmentet i en sti: 'priv/{uid}/fil' eller '{uid}/fil'.
create or replace function app_hidden.media_owner(p_path text)
returns text
language sql
immutable
as $$ select case when p_path like 'priv/%' then split_part(p_path, '/', 2) else split_part(p_path, '/', 1) end $$;

-- enqueue_media hardcodede 'post-images'; nu udledes bøtten af stien.
create or replace function app_hidden.enqueue_media(p_path text)
returns void
language plpgsql
security definer
set search_path to 'app_hidden', 'public'
as $$
begin
  if p_path is null or btrim(p_path) = '' then return; end if;
  insert into app_hidden.deleted_media (bucket, path)
  values (app_hidden.media_bucket(p_path), p_path)
  on conflict (bucket, path) do nothing;
exception when others then
  return;
end;
$$;

-- Ejerskabs-værnet i tg_media_cleanup (se 2026-07-21_media_cleanup.sql) skal se
-- forbi priv-præfikset, ellers ville private filer ALDRIG blive ryddet op, fordi
-- værnet ville tro at ejeren hed 'priv'. Derfor app_hidden.media_owner i stedet for
-- split_part(old_path, '/', 1). Resten af funktionen er uændret.
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
      if new_path is not distinct from old_path then continue; end if;
    end if;

    if app_hidden.media_owner(old_path) is distinct from owner_id then continue; end if;

    perform app_hidden.enqueue_media(old_path);
  end loop;
  return null;
exception when others then
  return null;
end;
$$;

revoke all on function app_hidden.media_bucket(text)  from public;
revoke all on function app_hidden.media_owner(text)   from public;
revoke all on function app_hidden.enqueue_media(text) from public;
revoke all on function app_hidden.tg_media_cleanup()  from public;

commit;

-- =============================================================================
-- WEB-DELEN (bygget samme dag)
--   js/helpers.js  : PRIV_PREFIX, isPrivatePath, mediaBucket, signedUrls (ét kald
--                    for alle stier), removeMedia (sletter i den rigtige bøtte).
--   js/compose.js  : stories uploades til vf-private med priv/-præfiks; upload-URL
--                    bygges af web'en, så native ikke skal ændres.
--   js/stories.js  : loadStories henter signerede URL'er i ét kald (24 timer, en
--                    storys levetid); gamle offentlige stier hentes som før.
--
-- AFPRØVET MOD PRODUKTION (rollback-blok, 5 af 5):
--   1 ejeren ser sin egen private fil · 2 en ven ser filen, fordi hun må se storyen
--   · 3 en fremmed ser den ikke · 4 en fremmed kan ikke uploade i en andens mappe
--   · 5 en sti uden priv-præfiks afvises i den private bøtte.
-- =============================================================================
