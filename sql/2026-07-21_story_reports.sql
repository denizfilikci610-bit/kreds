-- =============================================================================
-- Anmeldelse af stories (Apple guideline 1.2: ALT brugerskabt indhold skal kunne
-- anmeldes). Spejler posts-modellen: én række pr. (story, anmelder), storyen bliver
-- straks usynlig for anmelderen, og ved 10 anmeldelser er den skjult for alle.
-- Migration: story_reports
--
-- OBS: web-koden (js/stories.js) probe'r tabellen ved boot og skjuler anmeld-valget
-- hvis den ikke findes, så rækkefølgen deploy/migration er ligegyldig.
-- =============================================================================

begin;

create table public.story_reports (
  story_id   uuid        not null references public.stories(id)   on delete cascade,
  user_id    uuid        not null references public.profiles(id)  on delete cascade,
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

alter table public.story_reports enable row level security;

-- Man ser, laver og fortryder kun sine EGNE anmeldelser (ingen ser andres)
create policy story_reports_select on public.story_reports
  for select to authenticated
  using (user_id = auth.uid());

create policy story_reports_insert on public.story_reports
  for insert to authenticated
  with check (user_id = auth.uid());

create policy story_reports_delete_own on public.story_reports
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, delete on public.story_reports to authenticated;

-- Tælleren må IKKE afhænge af den enkeltes RLS-syn (policyen ovenfor viser kun
-- egne rækker), så optællingen sker i en security definer-funktion — samme
-- mønster som app_hidden.is_blocked_between for blokeringer.
create or replace function app_hidden.story_report_state(sid uuid, uid uuid)
returns table (mine boolean, total bigint)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    coalesce(bool_or(r.user_id = uid), false) as mine,
    count(*)                                  as total
  from public.story_reports r
  where r.story_id = sid;
$$;

revoke all on function app_hidden.story_report_state(uuid, uuid) from public;
grant execute on function app_hidden.story_report_state(uuid, uuid) to authenticated;

-- Restriktiv gate: lægges OVEN PÅ de eksisterende select-policies på stories
-- (restriktive policies kombineres med AND), så synligheden kun indsnævres.
-- Forfatteren ser altid sin egen story.
create policy stories_report_gate on public.stories
  as restrictive for select to authenticated
  using (
    author = auth.uid()
    or not exists (
      select 1 from app_hidden.story_report_state(stories.id, auth.uid()) s
      where s.mine or s.total >= 10
    )
  );

commit;
