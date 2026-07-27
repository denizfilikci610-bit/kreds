-- 2026-07-27: Udvid ordfilteret til ogsaa at daekke chatbeskeder.
-- KOERT I PRODUKTION som migration `word_filter_on_chat_messages`.
--
-- FUNDET (under IARC-klassificeringen til Google Play, spoergsmaalet "Does the app
-- include chat moderation?"):
-- app_hidden.block_banned_content laa paa posts, comments, poll_options, profiles og
-- feeds, men IKKE paa kreds_messages. Chatten var dermed appens ENESTE uafskaermede
-- tekstflade, selv om vilkaarene (terms.html / vilkaar.html) allerede lover et
-- "automatisk ordfilter, der afviser stoedende ord i navne og tekster".
--
-- kreds_messages baerer BAADE kreds-chat og private DM-traade (en DM er et feed med
-- is_dm = true), saa den ene trigger daekker begge.
--
-- Formen er den samme som de fem oevrige: BEFORE INSERT OR UPDATE, saa en ren besked
-- ikke kan redigeres til noget forbudt bagefter (kreds_messages har edited_at).
--
-- Ordlisten er 38 moenstre (14 rene bogstavord, 24 regex), og contains_banned matcher
-- med ordgraenser (\m ... \M), saa et forbudt ord inde i et harmloest ord ikke rammer.
-- Almindelige bandeord er IKKE paa listen, den sigter mod grovere sprog.

create or replace function app_hidden.block_banned_content()
returns trigger
language plpgsql
security definer
set search_path to 'app_hidden', 'public'
as $function$
begin
  if tg_table_name = 'posts' or tg_table_name = 'comments'
     or tg_table_name = 'poll_options' or tg_table_name = 'kreds_messages' then
    if app_hidden.contains_banned(new.text) then
      raise exception 'blocked_content';
    end if;
  elsif tg_table_name = 'profiles' then
    if app_hidden.contains_banned(new.name)
       or app_hidden.contains_banned(new.bio)
       or app_hidden.contains_banned(new.handle) then
      raise exception 'blocked_content';
    end if;
  elsif tg_table_name = 'feeds' then
    if app_hidden.contains_banned(new.name) then
      raise exception 'blocked_content';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists kreds_messages_word_filter on public.kreds_messages;
create trigger kreds_messages_word_filter
  before insert or update on public.kreds_messages
  for each row execute function app_hidden.block_banned_content();

-- VERIFICERET 2026-07-27 gennem det rigtige REST-API som en almindelig bruger:
--   chatbesked, ren tekst ......... HTTP 201  (virker)
--   chatbesked, forbudt ord ....... HTTP 400, P0001 blocked_content  (NY afskaermning)
--   opslag, ren tekst ............. HTTP 201  (ingen regression)
--   opslag, forbudt ord ........... HTTP 400, P0001 blocked_content  (ingen regression)
--   kommentar, ren tekst .......... HTTP 201  (ingen regression)
-- Alle testraekker er ryddet op igen.
--
-- ⚠️ KENDT UX-DETALJE, ikke rettet: js/chat.js:1280 viser t("err.generic") ved fejl og
-- kender ikke "blocked_content", i modsaetning til feed.js, comments.js, compose.js,
-- profile.js, kredse.js og auth.js der alle viser t("err.blocked"). En afvist besked
-- giver derfor "noget gik galt" i stedet for "upassende indhold". Teksten gives tilbage
-- til inputfeltet, saa intet mistes. Rettelsen er én linje, men js/ deles med
-- iOS-appen i App Store og kraever derfor ejerens ok.
