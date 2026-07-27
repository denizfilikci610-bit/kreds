-- 2026-07-27: Luk det faelles rum paa den officielle kontos velkomstopslag.
-- KOERT I PRODUKTION som migration `official_broadcast_no_cross_talk`.
--
-- FUNDET (under IARC-klassificeringen til Google Play):
-- Alle nye konti bliver automatisk venner med @vibefeed ved oprettelse. Funktionen
-- app_hidden.can_see_post spoerger for opslag UDEN kreds kun "er JEG ven med FORFATTEREN",
-- ikke om laeserne kender hinanden. Den officielle kontos ene kredsloese opslag (id 523,
-- velkomstopslaget) var derfor synligt for samtlige brugere paa én gang.
--
-- Da comments_insert og likes_insert kun kraever can_see_post, betoed det at to VILKAARLIGE
-- FREMMEDE kunne skrive til hinanden dér, se hinandens kommentarer, klikke sig videre til
-- hinandens profiler, og @-naevne hinanden (mention_can_see stiller samme spoergsmaal om
-- MODTAGEREN og opslagets forfatter), hvilket udloeser en push. Det var appens eneste flade
-- med den egenskab. Maalt 2026-07-27: 38 af 40 profiler var venner med @vibefeed, og der var
-- praecis ét saadant opslag. Kapaciteten var ubrugt, 0 kommentarer og 0 likes.
--
-- RETTELSEN: opslaget kan stadig LAESES af alle, det er hele meningen med et velkomstopslag,
-- men kun forfatteren selv kan kommentere og like paa det. Ingen andre opslag beroeres, og
-- @vibefeeds opslag inde i kredse er urørte (de har feed_id, og der er medlemskab kraevet).
--
-- Alt ligger i databasen. Den delte js/-kode roeres IKKE, saa iOS-appen i App Store og
-- Android-appen paavirkes uden en ny udgivelse.

create or replace function app_hidden.is_official_broadcast(p bigint)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
      from posts po
      join profiles pr on pr.id = po.author
     where po.id = p
       and po.feed_id is null
       and pr.handle = 'vibefeed'
  );
$function$;

revoke all on function app_hidden.is_official_broadcast(bigint) from public;
grant execute on function app_hidden.is_official_broadcast(bigint) to authenticated;

drop policy if exists comments_official_broadcast_gate on public.comments;
create policy comments_official_broadcast_gate on public.comments
  as restrictive for insert to authenticated
  with check (
    not app_hidden.is_official_broadcast(post_id)
    or exists (select 1 from public.posts po
                where po.id = comments.post_id
                  and po.author = (select auth.uid()))
  );

drop policy if exists likes_official_broadcast_gate on public.likes;
create policy likes_official_broadcast_gate on public.likes
  as restrictive for insert to authenticated
  with check (
    not app_hidden.is_official_broadcast(post_id)
    or exists (select 1 from public.posts po
                where po.id = likes.post_id
                  and po.author = (select auth.uid()))
  );

-- VERIFICERET 2026-07-27 gennem det rigtige REST-API som en almindelig bruger (@googlereview):
--   kommentar paa opslag 523 .......... HTTP 403, 42501 row-level security policy
--   like paa opslag 523 ............... HTTP 403, 42501 row-level security policy
--   kommentar paa almindeligt opslag .. HTTP 201 (ingen regression, ryddet op igen)
--   like paa almindeligt opslag ....... HTTP 201 (ingen regression, ryddet op igen)
-- Og is_official_broadcast er maalt til true for PRAECIS opslag 523 og false for alle andre,
-- inklusive @vibefeeds egne opslag inde i kredse.
