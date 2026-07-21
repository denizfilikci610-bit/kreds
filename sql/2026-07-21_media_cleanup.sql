-- =============================================================================
-- Server-side oprydning af mediefiler.
-- Migration: media_cleanup
--
-- PROBLEMET: databasen cascader pænt (alle tabeller peger på profiles(id) med
-- ON DELETE CASCADE), men FILERNE blev kun ryddet af klienten, fire-and-forget:
--   sb.storage.from("post-images").remove(...).catch(function(){})
-- Lukker brugeren appen midt i det, eller fejler kaldet, bliver filen liggende.
-- Ved kontosletning ryddede edge-funktionen delete-account kun de første 1000
-- filer under post-images/{user.id}/. Løftet om permanent sletning holdt altså
-- ikke for filerne.
--
-- LØSNINGEN HER: databasen rydder selv op. Når en række med en mediesti slettes
-- (eller stien udskiftes), fjerner en trigger den tilhørende storage-række, så
-- filen ikke længere kan hentes. Det gælder også når rækken forsvinder via
-- cascade fra "Slet konto", og det gælder uanset hvor mange filer der er, så
-- 1000-grænsen i delete-account er ikke længere afgørende.
--
-- BEMÆRK (ærlig afgrænsning): at slette rækken i storage.objects gør filen
-- utilgængelig gennem Storage-API'et med det samme, men selve bytesene i
-- backingstoren ryddes først af en efterfølgende fejer. Den fejer hører til en
-- edge-funktion med service-nøglen (kan kalde storage.remove for alvor) og
-- bygges som næste skridt. Klientens eksisterende .remove()-kald er bevidst
-- bevaret i web-koden: virker de, er filen væk med det samme, og trigger'en er
-- så bare et sikkerhedsnet.
-- =============================================================================

begin;

-- Fjerner en fil fra app'ens bøtter. security definer, fordi almindelige brugere
-- ikke må røre storage.objects direkte.
create or replace function app_hidden.drop_media(p_path text)
returns void
language plpgsql
security definer
set search_path = storage, pg_temp
as $$
begin
  if p_path is null or btrim(p_path) = '' then
    return;
  end if;
  delete from storage.objects
   where name = p_path
     and bucket_id in ('post-images', 'vf-private');
end;
$$;

revoke all on function app_hidden.drop_media(text) from public;

-- Én generisk trigger-funktion: kolonnenavnene med mediestier gives som
-- trigger-argumenter, så samme funktion dækker alle tabellerne.
create or replace function app_hidden.media_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  col      text;
  old_path text;
  new_path text;
begin
  foreach col in array tg_argv loop
    execute format('select ($1).%I', col) into old_path using old;
    if tg_op = 'UPDATE' then
      execute format('select ($1).%I', col) into new_path using new;
      -- Uændret sti: rør den ikke (ellers slettes filen ved enhver anden rettelse)
      if new_path is not distinct from old_path then
        continue;
      end if;
    end if;
    perform app_hidden.drop_media(old_path);
  end loop;
  return null;
end;
$$;

revoke all on function app_hidden.media_cleanup() from public;

-- ---- Opslag (billede + video) ----
drop trigger if exists posts_media_cleanup_del on public.posts;
create trigger posts_media_cleanup_del
  after delete on public.posts
  for each row execute function app_hidden.media_cleanup('image_path', 'video_path');

drop trigger if exists posts_media_cleanup_upd on public.posts;
create trigger posts_media_cleanup_upd
  after update of image_path, video_path on public.posts
  for each row execute function app_hidden.media_cleanup('image_path', 'video_path');

-- ---- Kommentarer (billede) ----
drop trigger if exists comments_media_cleanup_del on public.comments;
create trigger comments_media_cleanup_del
  after delete on public.comments
  for each row execute function app_hidden.media_cleanup('image_path');

drop trigger if exists comments_media_cleanup_upd on public.comments;
create trigger comments_media_cleanup_upd
  after update of image_path on public.comments
  for each row execute function app_hidden.media_cleanup('image_path');

-- ---- Stories (billede + video; forsvinder også når de 24 timer fejes) ----
drop trigger if exists stories_media_cleanup_del on public.stories;
create trigger stories_media_cleanup_del
  after delete on public.stories
  for each row execute function app_hidden.media_cleanup('image_path', 'video_path');

-- ---- Beskeder (billede + video i kreds-chat og DM) ----
drop trigger if exists kreds_messages_media_cleanup_del on public.kreds_messages;
create trigger kreds_messages_media_cleanup_del
  after delete on public.kreds_messages
  for each row execute function app_hidden.media_cleanup('image_path', 'video_path');

-- ---- Profil (profilbillede + banner; også ved skift af billede) ----
drop trigger if exists profiles_media_cleanup_del on public.profiles;
create trigger profiles_media_cleanup_del
  after delete on public.profiles
  for each row execute function app_hidden.media_cleanup('avatar_path', 'banner_path');

drop trigger if exists profiles_media_cleanup_upd on public.profiles;
create trigger profiles_media_cleanup_upd
  after update of avatar_path, banner_path on public.profiles
  for each row execute function app_hidden.media_cleanup('avatar_path', 'banner_path');

commit;
