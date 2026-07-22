-- =============================================================================
-- Lokalisering af de automatiske kreds-beskeder (afstemninger). ANVENDT 2026-07-22.
-- Migrationer: gov_proposals_structured_outcome, try_resolve_proposal_set_structured_outcome,
-- my_admission_results_use_passed.
--
-- HVORFOR: afstemnings-opslagene ("Afstemning: Skal Anna med i kredsen? — Vedtaget ✅")
-- blev gemt som fast DANSK tekst i posts.text. Men det SAMME opslag ses af flere medlemmer,
-- der kan have hvert sit app-sprog, så teksten kan aldrig gemmes rigtigt på ét sprog.
-- Løsningen: udfaldet gemmes som STRUKTURERET data, og klienten bygger teksten på hver
-- seers eget sprog (js/feed.js govText/govTextHTML/govPlainText via i18n gov.q_*/gov.res_*).
--
-- OMFANG (ejer-valg "kun nye"): kun FREMADRETTEDE afstemninger backfyldes IKKE. Gamle
-- afgjorte opslag har passed = NULL, og klienten falder da tilbage til den gemte danske
-- tekst for dem. Den danske ✅/❌-tekst beholdes derfor som neutral fallback.
--
-- Bonus: nye opslag renders uden tankestreg og uden ✅/❌-emoji (bygges rent via i18n,
-- separator er en middot). Det lukker den udestående "ingen tankestreger"-sag for
-- fremtidige afstemninger. Se [[ingen-tankestreger-tekster]], [[i18n-32-sprog]],
-- [[kreds-invites]].
-- =============================================================================

-- ---- Struktureret udfald på forslaget ----
-- passed      = blev forslaget vedtaget (add/remove) / fandtes en vinder (owner)
-- result_user = vinderen af et ejer-valg
alter table public.membership_proposals
  add column if not exists passed boolean;
alter table public.membership_proposals
  add column if not exists result_user uuid references public.profiles(id) on delete set null;

-- try_resolve_proposal sætter nu passed/result_user ved afgørelse (al eksisterende logik
-- uændret; den lokale variabel 'passed' er omdøbt til 'vote_ok' for at undgå at
-- "set passed = passed" bliver flertydigt med kolonnen). Den danske tekst beholdes.
-- Se den fulde krop i migrationen try_resolve_proposal_set_structured_outcome; kernen:
--   owner:   update membership_proposals set resolved=true, passed=(winner is not null), result_user=winner ...
--   add/rem: update membership_proposals set resolved=true, passed=true|false ...

-- my_admission_results bruger nu den strukturerede passed (tekst-fallback for gamle):
--   coalesce(mp.passed, (right(p.text,15) like '%Vedtaget%')) as admitted

-- =============================================================================
-- WEB-DELEN (samme dag): js/feed.js (POST_SELECT embed kind/target/created_by/passed/
--   result_user + mp_target:profiles!target; mapPost bygger poll.govData; govText/
--   govTextHTML/govPlainText renderer lokaliseret med fallback), js/comments.js
--   (postPageSnapshot bruger govPlainText til native opslags-sides segs), js/i18n.js
--   (gov.q_add/q_remove/q_request/q_owner + gov.res_passed/res_rejected/res_owner/
--   res_ended i DA+EN; resten falder til EN).
--
-- AFPRØVET MOD PRODUKTION (rollback, replica-mode): try_resolve_proposal sætter
--   passed=true for vedtaget add og passed=false for afvist remove, medlemskab korrekt.
-- WEB verificeret i preview: samme post-række renderes "Afstemning: Skal Anna med i
--   kredsen? · Vedtaget" (da) og "Vote: Should Anna join the circle? · Passed" (en);
--   gammelt opslag (passed=null) falder tilbage til den gemte danske tekst.
-- =============================================================================
