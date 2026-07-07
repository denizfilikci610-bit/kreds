import { sb } from "./config.js";
import { me, pv } from "./store.js";
import { el } from "./helpers.js";
import { loadFriends, loadFeeds, loadPosts, renderFeedbar, renderKredshead, renderFeed, loadQuota, markFeedUnseenRT } from "./feed.js";
import { renderComposeDest } from "./compose.js";
import { refreshMemberSheet } from "./kredse.js";
import { renderStories, loadPvPosts } from "./profile.js";
import { renderSearch } from "./search.js";
import { realtimeNotify } from "./notifications.js";

/* ================= Realtime + fokus ================= */
let channel = null, refetchTimer = null;
export function scheduleRefetch(){
  clearTimeout(refetchTimer);
  refetchTimer = setTimeout(doRefetch, 400);
}
async function doRefetch(){
  if(!me) return;
  const ae = document.activeElement;
  if(ae && ae.classList && ae.classList.contains("cfield")){
    // Udskyd mens brugeren skriver en kommentar (bevarer fokus, caret og mobil-tastatur)
    clearTimeout(refetchTimer);
    refetchTimer = setTimeout(doRefetch, 1500);
    return;
  }
  await Promise.all([loadFriends(), loadFeeds(), loadPosts()]);
  renderFeedbar();
  renderKredshead();
  refreshMemberSheet();
  renderComposeDest();
  renderFeed();
  renderStories();
  if(el("view-search").classList.contains("active")) renderSearch();
  if(el("profileview").classList.contains("on") && pv.u) await loadPvPosts();
  loadQuota();
}
export function subscribeRealtime(){
  if(channel) return;
  channel = sb.channel("db-changes")
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
    .subscribe();
}
export function unsubscribeRealtime(){
  if(channel){ sb.removeChannel(channel); channel = null; }
  clearTimeout(refetchTimer);
}

export function initRealtime(){
window.addEventListener("focus", function(){ if(me) scheduleRefetch(); });
}
