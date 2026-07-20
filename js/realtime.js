import { sb } from "./config.js";
import { me, pv } from "./store.js";
import { el } from "./helpers.js";
import { loadFriends, loadFeeds, loadPosts, renderFeedbar, renderKredshead, markFeedUnseenRT } from "./feed.js";
import { renderComposeDest } from "./compose.js";
import { refreshMemberSheet } from "./kredse.js";
import { loadPvPosts } from "./profile.js";
import { renderSearch } from "./search.js";
import { realtimeNotify, scheduleNotifDotRefresh } from "./notifications.js";
import { chatRealtime } from "./chat.js";

/* ================= Realtime + fokus ================= */
let channel = null, refetchTimer = null, pollTimer = null;

/* Sikkerhedsnet: realtime giver øjeblikkelige INSERTs, men et let poll hvert
   12. sekund (kun mens fanen er synlig) fanger også sletninger/redigeringer/
   unlikes og alt realtime måtte misse — så man aldrig behøver at genindlæse.
   loadPosts(false) gen-renderer kun ved reelle ændringer, så det er ikke synligt
   når intet er sket. */
function startPolling(){
  if(pollTimer) return;
  pollTimer = setInterval(function(){
    if(me && !document.hidden) scheduleRefetch();
  }, 12000);
}
function stopPolling(){ if(pollTimer){ clearInterval(pollTimer); pollTimer = null; } }
export function scheduleRefetch(){
  clearTimeout(refetchTimer);
  refetchTimer = setTimeout(doRefetch, 400);
}
async function doRefetch(){
  if(!me) return;
  const ae = document.activeElement;
  const composing = el("compose") && el("compose").classList.contains("on");
  if((ae && ae.classList && ae.classList.contains("cfield")) || composing){
    // Udskyd mens brugeren skriver en kommentar eller opretter et opslag — bevarer
    // fokus, caret, tastatur og valgt destination (gælder både realtime og poll).
    clearTimeout(refetchTimer);
    refetchTimer = setTimeout(doRefetch, 1500);
    return;
  }
  // false = baggrunds-refetch: rykker ikke NY-mærker til "set", og gen-renderer kun
  // feedet hvis noget faktisk ændrede sig (renderFeed/renderStories sker inde i loadPosts).
  await Promise.all([loadFriends(), loadFeeds(), loadPosts(false)]);
  renderFeedbar();
  renderKredshead();
  refreshMemberSheet();
  renderComposeDest();
  if(el("view-search").classList.contains("active")) renderSearch();
  if(el("profileview").classList.contains("on") && pv.u) await loadPvPosts();
}
export function subscribeRealtime(){
  if(channel) return;
  channel = sb.channel("db-changes")
    .on("postgres_changes", { event:"INSERT", schema:"public", table:"kreds_messages" }, function(payload){
      chatRealtime(payload); // nye chat-beskeder appendes live i en åben tråd + listen
    })
    .on("postgres_changes", { event:"*", schema:"public", table:"posts" }, function(payload){
      scheduleRefetch();
      realtimeNotify("posts", payload);  // nye opslag (ikke egne) tænder hjerte-prikken
      markFeedUnseenRT(payload);         // kreds-opslag tænder også prikken på kreds-pillen
      // Nye meningsmålinger: svarmulighederne indsættes efter opslaget og udløser
      // ingen egen realtime-hændelse — hent igen lidt senere, så de kommer med
      if(payload && payload.eventType === "INSERT") setTimeout(scheduleRefetch, 3000);
    })
    .on("postgres_changes", { event:"*", schema:"public", table:"comments" }, function(payload){
      scheduleRefetch();
      realtimeNotify("comments", payload);
    })
    .on("postgres_changes", { event:"*", schema:"public", table:"likes" }, function(payload){
      scheduleRefetch();
      realtimeNotify("likes", payload);
    })
    .on("postgres_changes", { event:"INSERT", schema:"public", table:"comment_likes" }, function(payload){
      // Ingen scheduleRefetch: kommentar-like-tal ses kun i udfoldet tråd (gen-renderes ved åbning);
      // en fuld feed-refetch pr. kommentar-like ville være unødigt tungt.
      realtimeNotify("comment_likes", payload);
    })
    .on("postgres_changes", { event:"*", schema:"public", table:"poll_votes" }, scheduleRefetch)
    .on("postgres_changes", { event:"*", schema:"public", table:"feed_members" }, scheduleRefetch)
    .on("postgres_changes", { event:"*", schema:"public", table:"feeds" }, scheduleRefetch)
    .on("postgres_changes", { event:"INSERT", schema:"public", table:"kreds_invites" }, function(payload){
      realtimeNotify("kreds_invites", payload);
    })
    .on("postgres_changes", { event:"INSERT", schema:"public", table:"kreds_requests" }, function(payload){
      realtimeNotify("kreds_requests", payload);
    })
    .on("postgres_changes", { event:"INSERT", schema:"public", table:"friend_requests" }, function(payload){
      realtimeNotify("friend_requests", payload); // en anmodning TIL mig tænder prikken
    })
    .on("postgres_changes", { event:"INSERT", schema:"public", table:"friendships" }, function(payload){
      scheduleRefetch();                          // nyt venskab (fx nogen accepterede mig) → frisk vennerne live
      realtimeNotify("friendships", payload);
    })
    .on("postgres_changes", { event:"INSERT", schema:"public", table:"mentions" }, function(payload){
      realtimeNotify("mentions", payload); // RLS leverer kun MINE mentions → pålidelig prik
    })
    .subscribe();
  startPolling();
}
export function unsubscribeRealtime(){
  if(channel){ sb.removeChannel(channel); channel = null; }
  clearTimeout(refetchTimer);
  stopPolling();
}

export function initRealtime(){
  // Fokus OG synlighed (mobil-faneskift udløser ikke altid focus) → frisk feedet.
  window.addEventListener("focus", function(){ if(me){ scheduleRefetch(); scheduleNotifDotRefresh(); } });
  document.addEventListener("visibilitychange", function(){
    if(!document.hidden && me){ scheduleRefetch(); scheduleNotifDotRefresh(); }
  });
}
