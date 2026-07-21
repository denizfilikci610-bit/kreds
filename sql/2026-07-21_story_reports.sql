-- =============================================================================
-- Anmeldelse af stories (Apple guideline 1.2: ALT brugerskabt indhold skal kunne
-- anmeldes). Spejler posts/reports-modellen 1:1: én række pr. (story, anmelder),
-- storyen bliver straks usynlig for anmelderen, og ved 10 anmeldelser er den
-- skjult for alle. Forfatteren mister aldrig sin egen story.
-- Migrationer: story_reports + story_reports_grants_fix (kørt 2026-07-21)
--
-- Web-koden (js/stories.js) probe'r tabellen ved boot og skjuler anmeld-valget
-- hvis den ikke findes, så rækkefølgen deploy/migration er ligegyldig.
-- =============================================================================

begin;

create table if not exists public.story_reports (
  story_id   uuid        not null references public.stories(id)   on delete cascade,
  user_id    uuid        not null references public.profiles(id)  on delete cascade,
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

create index if not exists story_reports_user_idx on public.story_reports (user_id);

alter table public.story_reports enable row level security;

-- Kan jeg SE den story jeg vil anmelde? Spejler app_hidden.can_see_post og tager
-- bevidst IKKE anmeldelser med i betragtning. Det er afgørende: gjorde den det,
-- ville with_check'en nedenfor slå sig selv ihjel, fordi den nye række gør storyen
-- usynlig for gaten allerede i samme transaktion.
create or replace function app_hidden.can_see_story(s uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from stories
    where stories.id = s
      and stories.expires_at > now()
      and not app_hidden.is_blocked_between((select auth.uid()), stories.author)
      and (
        stories.author = (select auth.uid())
        or (stories.feed_id is null and exists (
              select 1 from friendships
              where user_id = (select auth.uid()) and friend_id = stories.author))
        or (stories.feed_id is not null and exists (
              select 1 from feed_members
              where feed_members.feed_id = stories.feed_id
                and feed_members.user_id = (select auth.uid())))
      )
  );
$$;

-- Ti anmeldelser skjuler for alle (som app_hidden.is_hidden_post).
create or replace function app_hidden.is_hidden_story(s uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select (select count(*) from story_reports where story_id = s) >= 10;
$$;

-- VIGTIGT (fejl fanget i test mod produktion): begge funktioner kaldes fra en
-- policy og køres derfor som DEN KALDENDE bruger. Uden EXECUTE til authenticated
-- fejler ENHVER læsning af stories med "permission denied for function".
-- Samme grants som app_hidden.can_see_post.
grant execute on function app_hidden.can_see_story(uuid)   to authenticated, service_role;
grant execute on function app_hidden.is_hidden_story(uuid) to authenticated, service_role;

-- Man ser, laver og fortryder kun sine EGNE anmeldelser, og man kan kun anmelde
-- en story man faktisk må se.
drop policy if exists story_reports_select_own on public.story_reports;
create policy story_reports_select_own on public.story_reports
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists story_reports_insert on public.story_reports;
create policy story_reports_insert on public.story_reports
  for insert to authenticated
  with check (user_id = (select auth.uid()) and app_hidden.can_see_story(story_id));

drop policy if exists story_reports_delete_own on public.story_reports;
create policy story_reports_delete_own on public.story_reports
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, delete on public.story_reports to authenticated;

-- Restriktiv gate oven på den eksisterende stories_select (restriktive policies
-- kombineres med AND, så synligheden kun indsnævres). Samme udtryk som anden
-- halvdel af posts_select, blot i sin egen policy for ikke at røre noget der virker.
drop policy if exists stories_report_gate on public.stories;
create policy stories_report_gate on public.stories
  as restrictive for select to authenticated
  using (
    author = (select auth.uid())
    or (
      not app_hidden.is_hidden_story(id)
      and not exists (
        select 1 from public.story_reports r
        where r.story_id = stories.id and r.user_id = (select auth.uid())
      )
    )
  );

commit;

-- =============================================================================
-- AFPRØVET MOD PRODUKTION (rollback-blok med simulerede JWT-claims), 9 af 9:
--   1 ven ser storyen · 2 anmeldelsen kan indsættes (with_check slår ikke sig selv
--   ihjel) · 3 storyen forsvinder for anmelderen · 4 anmelderen ser sin egen række
--   (så den kan fortrydes) · 5 fortrydelse bringer storyen tilbage · 6 forfatteren
--   beholder sin egen story selv hvis hun anmelder den · 7 en fremmed ser den ikke
--   · 8 en fremmed kan ikke anmelde den (42501) · 9 man kan ikke anmelde i en
--   andens navn (42501).
-- =============================================================================
