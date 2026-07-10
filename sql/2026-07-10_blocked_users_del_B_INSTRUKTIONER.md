# BLOKÉR BRUGER — Del B: patches der KRÆVER live DB-adgang (Supabase MCP)

> **STATUS: UDFØRT 2026-07-10.** Alle punkter er anvendt i produktion:
> B1+B3 (migration `blocked_users_del_b1_b3_can_see_post_mentions`),
> B2 (`blocked_users_del_b2_push_fanout`), B4+B5+B6
> (`blocked_users_del_b4_b6_rpc_guards`), B7 = notif-poll **v31**.
> B1-noten om insert-vejene BEKRÆFTET: likes/comments/comment_likes'
> insert-policies kalder can_see_post (verificeret i pg_policies), så
> blokerede kan hverken se ELLER skrive. tg_push_like/comment/comment_like
> behøvede derfor ingen patch. Dokumentet bevares som reference.

Del A (`2026-07-10_blocked_users_del_A.sql`) er selvstændig og dækker al
klient-synlighed via RESTRICTIVE RLS. Del B lukker hullerne i de stier der
**bypasser RLS** (SECURITY DEFINER-funktioner og service_role). Rækkefølge:
kør Del A først, verificér, tag så Del B punkt for punkt.

**REGEL: Hent ALTID den eksisterende funktionskrop med `pg_get_functiondef`
FØR du skriver `create or replace` — nedenstående er indsatspunkter, ikke
færdige kroppe.** Fx:

```sql
select pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'app_hidden' and p.proname in
  ('can_see_post','is_friend_with','is_member_of','mention_can_see',
   'extract_mentions','mention_uids','notify_push');
-- og alle tg_push_*-triggerfunktioner:
select p.proname, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'app_hidden' and p.proname like 'tg_push%';
```

## B1. `app_hidden.can_see_post(...)` — bælte og seler
Tilføj i funktionens visibility-udtryk:
`and not app_hidden.is_blocked_between(<viewer>, <post_author>)`.
Dækker alle stier der bruger can_see_post uden om posts-RLS (bl.a.
mentions-RLS/`mention_can_see`). OBS: tjek parameternavne/rækkefølge i den
faktiske signatur.
**OBS (review-fund F3):** direkte INSERT af likes/kommentarer på tværs af en
blokering afvises formentlig allerede af de EKSISTERENDE insert-policies, hvis
de kræver can_see_post på opslaget — så lukker B1-patchen også skrivevejen.
VERIFICÉR med policy-listen (`select * from pg_policies where tablename in
('likes','comments','comment_likes')`); bruger insert-policierne IKKE
can_see_post, så tilføj restrictive WITH CHECK-gates mod opslagets forfatter.

## B2. Push-triggers (`app_hidden.tg_push_*`) — ingen pushes på tværs af blokering
`notify_push` får actor som NAVN (text), ikke uid — patch derfor HVER triggers
modtagerudvælgelse i stedet for notify_push selv:
- `tg_push_post` (fan-out til feed_members hhv. venner): tilføj
  `and not app_hidden.is_blocked_between(<recipient>, new.author)`.
  (Venne-fanout er reelt allerede død efter block_user sletter venskabet —
  kreds-fanout er den vigtige.)
- `tg_push_comment`, `tg_push_like` (likes), `tg_push_comment_like`,
  `tg_push_mention`: samme filter recipient vs. NEW-aktøren.
- `tg_push_friend_request`/`tg_push_friendship`/invite/kreq/admission:
  add_friend m.fl. skal afvises FØR (B4) — men tilføj filteret alligevel.

## B3. Mentions-triggers — mention-rækker må ikke OPRETTES på tværs
`app_hidden.mention_can_see` (eller extract_mentions): tilføj
`and not app_hidden.is_blocked_between(<author>, <mentioned>)`.
Så oprettes hverken række eller mention-push, og push-dedupe-logikken i
tg_push_comment/tg_push_post er upåvirket. (Del A's RLS skjuler kun læsning.)

## B4. Relations-RPC'er — afvis handlinger mod blokerede
- `public.add_friend(friend_handle)`: hvis `app_hidden.is_blocked_between(auth.uid(), target)`
  → `raise exception 'not_found'` (afslør IKKE blokeringen; klienten viser
  "bruger findes ikke"-toasten).
- `accept_friend_request(from_handle)`: samme guard (defensivt).
- `add_kreds_member(f, u)` / `create_feed(member_ids ...)`: medlemmer vælges
  blandt venner (blokerede er ikke venner længere) — verificér at server-
  validering også afviser: guard mod is_blocked_between(auth.uid(), u).
- `request_join_kreds(f)`: valgfrit — afvis hvis kredsens ejer har blokeret
  ansøgeren (`not_allowed`). ELLERS: en blokeret kan stadig anmode, og ejeren
  ser anmodningen (kendt kant, lav risiko).

## B5. `activity_of(u, since)` / `activity_allowed(u)`
`activity_allowed`: returnér `'target_off'` når
`app_hidden.is_blocked_between(auth.uid(), u)` (skjuler uden at afsløre).
Klienten når reelt aldrig hertil (profilen skjuler knappen), men RPC'en kan
kaldes direkte.

## B6. `kreds_teasers()` — teasere på tværs af blokering
Returnerer eksistens-metadata (author-uuid, feed_name) om opslag i kredse man
IKKE er med i. Tilføj `and not app_hidden.is_blocked_between(auth.uid(), p.author)`
i udvælgelsen.

## B7. `notif-poll` edge-funktion (service_role — bypasser RLS)
Hent kilden (`supabase functions`-MCP / dashboard), find event-selects
(likes/comments/mentions/posts) og filtrér par (recipient, actor) mod
blocked_users — enklest via en ny SECURITY DEFINER-RPC
`blocked_pairs_for(u uuid)` eller ved at genbruge is_blocked_between pr. event.
Deploy som ny version (nuværende: v30 — verificér versionen først).

## B8. Søgning
Klienten søger direkte i `profiles` → Del A's one-way-policy skjuler allerede
blokererens profil for den blokerede. Ingen server-patch nødvendig.

## B9. Verifikation (efter B1–B7)
1. To testbrugere A/B (venner + fælles kreds + kreds kun-B).
2. A blokerer B → tjek: feed (begge veje), kommentarer, likes, @-autocomplete,
   søgning (B kan ikke finde A; A finder B m. "Blokeret"), teasers, akt-fanen,
   PUSH (B liker A's gamle kreds-opslag → INGEN push til A), mention af A i
   B's opslag → ingen mentions-række/push.
3. A fjerner blokeringen → indhold tilbage; venskab er IKKE genoprettet.
4. `select * from pg_policies where policyname like '%block_gate%';` → 7 rækker.

## Husk bagefter
- Opdatér memory: `appstore-launch-plan.md` (+ evt. ny blocked-users-memory).
- Web-UI'et er allerede live men SKJULT (`state.blockReady` bliver true i
  samme øjeblik Del A er kørt — ingen web-deploy nødvendig).
