-- ============================================================================
-- BLOKÉR BRUGER (Apple guideline 1.2) — DEL A: selvstændig migration
-- Kan køres uden at røre eksisterende funktioner. Kør i ÉN transaktion.
-- Design (Instagram-stil):
--   * Indhold (opslag, kommentarer, likes, mentions) skjules BEGGE veje via
--     RESTRICTIVE RLS-policies (AND'es med de eksisterende policies).
--   * Profiler skjules ÉN vej: den blokerede kan ikke se blokererens profil;
--     blokereren KAN stadig se den blokerede (søgning -> profil -> "Fjern
--     blokering" fungerer som administration).
--   * block_user() sletter venskab + venneanmodninger + kreds-invitationer
--     begge veje => venne-feed-synlighed og push-fanout via friendships
--     bortfalder uden at patche is_friend_with.
--   * Fælles kredse består (som gruppechats) — men indholdet på tværs af
--     blokeringen er skjult af posts/comments-policierne.
-- FORUDSÆTNING (verificeret i tidligere session-kortlægning): app_hidden-
-- skemaet findes, og authenticated har USAGE på det (posts_select bruger
-- allerede app_hidden.can_see_post). Verificér alligevel med:
--   select has_schema_privilege('authenticated','app_hidden','usage');
-- ============================================================================

begin;

-- ---------- Tabel ----------
create table if not exists public.blocked_users (
  blocker    uuid        not null references public.profiles(id) on delete cascade,
  blocked    uuid        not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);

-- Opslag den modsatte vej (has_blocked-helperen slår op på (blocker, blocked)
-- = PK; dette indeks dækker "hvem har blokeret mig"-retningen)
create index if not exists blocked_users_blocked_idx on public.blocked_users (blocked, blocker);

alter table public.blocked_users enable row level security;

-- Kun egne blokeringer kan læses (til "Blokerede brugere"-listen).
-- Skrivning sker KUN gennem block_user/unblock_user (ingen insert/delete-policy).
drop policy if exists blocked_users_select_own on public.blocked_users;
create policy blocked_users_select_own on public.blocked_users
  for select using (blocker = auth.uid());

-- ---------- Helpers (SECURITY DEFINER: policies må ikke løbe ind i
-- blocked_users' egen RLS, og kaldes af den forespørgende rolle) ----------
create or replace function app_hidden.has_blocked(blocker_ uuid, blocked_ uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocked_users
    where blocker = blocker_ and blocked = blocked_
  );
$$;

create or replace function app_hidden.is_blocked_between(a uuid, b uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.blocked_users
    where (blocker = a and blocked = b) or (blocker = b and blocked = a)
  );
$$;

revoke all on function app_hidden.has_blocked(uuid, uuid) from public;
revoke all on function app_hidden.is_blocked_between(uuid, uuid) from public;
-- anon er med som værn: skulle en fremtidig policy give anon læseadgang til en
-- gated tabel, skal gaten filtrere (false) — ikke smide 42501.
grant execute on function app_hidden.has_blocked(uuid, uuid) to authenticated, anon, service_role;
grant execute on function app_hidden.is_blocked_between(uuid, uuid) to authenticated, anon, service_role;

-- ---------- RPC'er ----------
create or replace function public.block_user(target uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if target is null or target = auth.uid() then
    raise exception 'bad_target';
  end if;
  if not exists (select 1 from public.profiles where id = target) then
    raise exception 'not_found';
  end if;
  -- Den officielle profil kan ikke blokeres (klienten skjuler valget; dette er server-værnet)
  if exists (select 1 from public.profiles where id = target and handle = 'vibefeed') then
    raise exception 'bad_target';
  end if;

  insert into public.blocked_users (blocker, blocked)
  values (auth.uid(), target)
  on conflict do nothing;

  -- Instagram-stil: relationen kappes begge veje
  delete from public.friendships
   where (user_id = auth.uid() and friend_id = target)
      or (user_id = target      and friend_id = auth.uid());
  delete from public.friend_requests
   where (from_id = auth.uid() and to_id = target)
      or (from_id = target      and to_id = auth.uid());
  delete from public.kreds_invites
   where (user_id = auth.uid() and invited_by = target)
      or (user_id = target      and invited_by = auth.uid());
  -- Pending kreds-join-anmodninger mellem parterne (ansøger <-> kreds-EJER) fjernes,
  -- så en netop blokeret ansøger ikke kan admittes ved et enkelt tap i akt-listen
  delete from public.kreds_requests kr
   using public.feeds f
   where kr.feed_id = f.id
     and ((kr.user_id = auth.uid() and f.owner = target)
       or (kr.user_id = target      and f.owner = auth.uid()));
end;
$$;

create or replace function public.unblock_user(target uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  delete from public.blocked_users
   where blocker = auth.uid() and blocked = target;
end;
$$;

revoke all on function public.block_user(uuid) from public;
revoke all on function public.unblock_user(uuid) from public;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;

-- ---------- RESTRICTIVE policies (AND'es med eksisterende PERMISSIVE) ----------
-- Egne rækker friholdes (kortslutter også definer-kaldet for de fleste rækker).
-- YDELSE (accepteret v. nuværende skala, review-fund F10): definer-helperne kan
-- ikke inlines af planneren => ét fn-kald pr. kandidat-række. Feed-queries er
-- limit 100 og blocked_users er PK-indekseret, så det er mikrosekunder i dag.
-- Revisit hvis brugertallet vokser markant (fx materialisér blokerede uuids i
-- en per-request-array via en initplan, eller flyt gaten ind i basispolicies).

drop policy if exists posts_block_gate on public.posts;
create policy posts_block_gate on public.posts
  as restrictive for select
  using (author = auth.uid() or not app_hidden.is_blocked_between(auth.uid(), author));

drop policy if exists comments_block_gate on public.comments;
create policy comments_block_gate on public.comments
  as restrictive for select
  using (author = auth.uid() or not app_hidden.is_blocked_between(auth.uid(), author));

drop policy if exists likes_block_gate on public.likes;
create policy likes_block_gate on public.likes
  as restrictive for select
  using (user_id = auth.uid() or not app_hidden.is_blocked_between(auth.uid(), user_id));

drop policy if exists comment_likes_block_gate on public.comment_likes;
create policy comment_likes_block_gate on public.comment_likes
  as restrictive for select
  using (user_id = auth.uid() or not app_hidden.is_blocked_between(auth.uid(), user_id));

drop policy if exists mentions_block_gate on public.mentions;
create policy mentions_block_gate on public.mentions
  as restrictive for select
  using (not app_hidden.is_blocked_between(auth.uid(), author));

drop policy if exists friend_requests_block_gate on public.friend_requests;
create policy friend_requests_block_gate on public.friend_requests
  as restrictive for select
  using (
    (from_id = auth.uid() and not app_hidden.is_blocked_between(auth.uid(), to_id))
    or
    (to_id = auth.uid() and not app_hidden.is_blocked_between(auth.uid(), from_id))
    or (from_id <> auth.uid() and to_id <> auth.uid())
  );

-- Profiler: ÉN vej — skjul P for V, hvis P har blokeret V.
-- (Blokereren beholder udsynet til den blokerede => unblock-UI.)
-- Den TREDJE arm er bærende (review-fund): er V SELV blokerer af P, skal V altid
-- kunne se P — ellers giver GENSIDIG blokering en permanent unblock-deadlock
-- (ingen af parterne kan nå profilen, og profilen ER unblock-administrationen).
drop policy if exists profiles_block_gate on public.profiles;
create policy profiles_block_gate on public.profiles
  as restrictive for select
  using (id = auth.uid()
      or app_hidden.has_blocked(auth.uid(), id)
      or not app_hidden.has_blocked(id, auth.uid()));

commit;

-- ---------- Verifikation (kør bagefter) ----------
-- 1) select count(*) from pg_policies where policyname like '%block_gate%';  -- forventet 7
-- 2) Som bruger A: select public.block_user('<B-uuid>');
--    * B's opslag/kommentarer/likes forsvinder fra A's feed — og omvendt.
--    * select * from friendships where ... -- ingen rækker mellem A og B.
--    * Som B: select * from profiles where id='<A-uuid>' -- 0 rækker.
--    * Som A: select * from profiles where id='<B-uuid>' -- 1 række (unblock-UI).
-- 3) select public.unblock_user('<B-uuid>'); -- indhold synligt igen (venskab
--    genoprettes IKKE automatisk — bevidst).
