-- =============================================================================
-- Privat bøtte til stories og billeder i beskeder (signerede URL'er).
-- Migration: private_media_bucket
--
-- I DAG er alt medie offentligt: js/helpers.js imgUrl() bruger getPublicUrl, og
-- der findes ikke ét createSignedUrl i koden. Kender man stien, kan man hente en
-- privat DM-besked eller en story uden at være logget ind. RLS beskytter kun
-- DATABASEN, ikke filerne. Det passer dårligt med at privat betyder privat.
--
-- Denne migration laver den private bøtte og dens adgangsregler. Læsereglen er
-- den pæne del: Storage-API'et laver kun en signeret URL hvis brugeren må lave
-- select på filen, og select-policyen slår filen op i den række der ejer den.
-- Rækkens EGEN RLS gælder inde i det opslag, så synligheden på filen bliver
-- automatisk den samme som på storyen/beskeden. Ingen dobbeltbogføring.
--
-- OPRYDNING ER ALLEREDE PÅ PLADS: køen i 2026-07-21_media_cleanup.sql har en
-- bucket-kolonne, og edge-funktionen media-sweeper grupperer efter bøtte, så
-- filer i vf-private ryddes uden ændringer i fejeren. Husk blot at
-- app_hidden.enqueue_media i dag hardcoder 'post-images': den skal have bøtten
-- med, når web-delen begynder at lægge stier i den private bøtte.
--
-- WEB-DELEN MANGLER STADIG (bevidst, se noten nederst).
-- =============================================================================

begin;

insert into storage.buckets (id, name, public)
values ('vf-private', 'vf-private', false)
on conflict (id) do update set public = false;

-- ---- Upload: kun i sin egen mappe ({auth.uid()}/...) ----
drop policy if exists vf_private_insert_own on storage.objects;
create policy vf_private_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'vf-private' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---- Sletning: kun sine egne filer (trigger'en i media_cleanup rydder resten) ----
drop policy if exists vf_private_delete_own on storage.objects;
create policy vf_private_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'vf-private' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---- Læsning: må jeg se den række filen hører til? ----
-- stories og kreds_messages har hver deres RLS, og den gælder inde i opslagene
-- her, så en signeret URL kun kan laves til medier man i forvejen må se.
drop policy if exists vf_private_read_owned_rows on storage.objects;
create policy vf_private_read_owned_rows on storage.objects
  for select to authenticated
  using (
    bucket_id = 'vf-private'
    and (
      (storage.foldername(name))[1] = auth.uid()::text   -- egne filer altid
      or exists (select 1 from public.stories s
                  where s.image_path = storage.objects.name
                     or s.video_path = storage.objects.name)
      or exists (select 1 from public.kreds_messages m
                  where m.image_path = storage.objects.name
                     or m.video_path = storage.objects.name)
    )
  );

commit;

-- =============================================================================
-- SÅDAN TAGES BØTTEN I BRUG (web-delen, næste skridt)
--
-- 1. Stier i den private bøtte gemmes i databasen med præfikset "priv/", så en
--    sti alene fortæller hvilken bøtte den bor i. Gamle stier uden præfiks
--    bliver liggende i post-images og virker uændret. Ingen migrering af
--    eksisterende filer, ingen brudte billeder.
-- 2. helpers.js får en signedUrl(path)-funktion ved siden af imgUrl(path):
--    "priv/"-stier → createSignedUrl (24 timer for stories, som deres levetid;
--    12 timer for beskeder), alt andet → getPublicUrl som nu.
-- 3. Upload-stederne der skal skifte bøtte: stories (compose.js) og billeder i
--    beskeder (chat.js). Opslag, kommentarer, profilbilleder og bannere BLIVER
--    i den offentlige bøtte: de deles i forvejen bredt, og en signeret URL i
--    feedet ville koste et kald pr. billede.
-- 4. Læsestederne er allerede asynkrone (loadStories og chattens beskedhentning),
--    så de kan hente signerede URL'er i én omgang pr. hentning.
--
-- Hvorfor ikke skrevet endnu: bøtten skal FØRST findes, ellers kan flowet ikke
-- afprøves, og en fejl i upload-vejen ville ramme rigtige brugeres stories og
-- beskeder med det samme. Kør denne migration, og web-delen bygges og testes
-- mod den rigtige bøtte.
-- =============================================================================
