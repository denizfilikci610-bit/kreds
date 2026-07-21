-- =============================================================================
-- Rettelser fra det fulde funktionseftersyn 2026-07-21 (70 agenter, hvert fund
-- efterprøvet to gange mod produktion). Her er de KRITISKE + ALVORLIGE, alle kørt
-- som migrationer og afprøvet med rollback-blokke. De web-side rettelser ligger i
-- js/. Migrationsnavne i Supabase (list_migrations) i parentes.
--
-- 1) preserve_circles_on_account_delete  (KRITISK)
--    feeds.owner -> profiles.id var ON DELETE CASCADE, så en kreds-ejer der slettede
--    sin konto tog HELE kredsen med sig for alle andre. Ny BEFORE DELETE-trigger på
--    profiles (app_hidden.reassign_before_profile_delete) flytter ejerskabet til det
--    ældste tilbageblevne medlem (eller sletter en tom kreds) FØR kaskaden, og
--    rydder DM-tråde helt. Efterprøvet: sletning af en ejer bevarer kredsen med ny
--    ejer og alle andres opslag/beskeder.
--
-- 2) fix_block_gate_kreds_messages  (Apple 1.2)
--    Den blokerede kunne stadig læse blokererens beskeder. Policyen kmsg_select_members
--    havde en INLINE blokerings-underforespørgsel på blocked_users, som selv er
--    underlagt blocked_users' RLS (man ser kun sine EGNE block-rækker), så den
--    blokerede ikke kunne "se" blokeringen mod sig. Nu bruges security definer-helperen
--    app_hidden.is_blocked_between som alle andre block-gates. LÆRE: brug ALTID den
--    helper i en block-gate, aldrig en rå underforespørgsel på blocked_users.
--
-- 3) lock_post_update_columns
--    posts_update havde kun "author = auth.uid()" i with_check, så et API-kald kunne
--    flytte sit eget opslag ind i en fremmed lukket kreds (feed_id), skubbe created_at
--    eller bytte mediesti. Nu kræver with_check medlemskab (som posts_insert), og en
--    BEFORE UPDATE-trigger fastfryser created_at/feed_id/kind/author. En redigering kan
--    kun røre teksten.
--
-- 4) guard_media_path_ownership
--    En bruger kunne registrere en ANDENS mediesti på sin egen række (story/opslag/
--    kommentar/besked) og derved både få adgang til den private fil og forhindre at
--    den nogensinde ryddes. BEFORE INSERT/UPDATE-trigger kræver nu at stien ligger i
--    rækkens egen ejers mappe (app_hidden.media_owner), samme regel som oprydningen.
--
-- 5) lock_dm_out_of_kreds_rpcs
--    En privat DM kunne brydes op via kreds-RPC'erne (fjern den ene, luk en tredje ind).
--    add/remove/accept_invite/approve_request/request_join/leave afviser nu med
--    'dm_locked', hvis feed'et er en DM. DM'er styres kun fra chatten.
--
-- 6) fix_vote_resolution_owner_and_invite
--    a) En invitation blev auto-AFVIST efter 10 min uden stemmer (ja>nej med 0-0 =
--       falsk). For 'add' er reglen nu ja>=nej (ingen indvending = optag); 'remove'
--       kræver stadig ægte flertal.
--    b) Blev EJEREN stemt ud (remove), blev han stående som feeds.owner. Nu flyttes
--       ejerskabet til det ældste tilbageblevne medlem, som ved leave_kreds.
--
-- Fuld SQL for hver: se den tilsvarende migration i Supabase. Kernen er gengivet
-- herunder for de nye triggere/funktioner (policy- og RPC-ændringer udeladt for
-- kortheds skyld — de står i migrationerne).
-- =============================================================================

-- (1) Kernen i beskyttelsen mod at kredse forsvinder ved kontosletning:
create or replace function app_hidden.reassign_before_profile_delete(p_uid uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare f record; nyt_medlem uuid;
begin
  delete from feeds fe where fe.is_dm
     and exists (select 1 from feed_members m where m.feed_id = fe.id and m.user_id = p_uid);
  for f in select id from feeds where owner = p_uid and not is_dm loop
    select user_id into nyt_medlem from feed_members
      where feed_id = f.id and user_id <> p_uid order by created_at, user_id limit 1;
    if nyt_medlem is null then delete from feeds where id = f.id;
    else update feeds set owner = nyt_medlem where id = f.id; end if;
  end loop;
end; $$;
-- + BEFORE DELETE-trigger på public.profiles der kalder den.
