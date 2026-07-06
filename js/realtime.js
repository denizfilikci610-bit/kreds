import { sb } from "./config.js";
import { me, pv } from "./store.js";
import { el } from "./helpers.js";
import { loadFriends, loadFeeds, loadPosts, renderFeedbar, renderKredshead, renderFeed, loadQuota } from "./feed.js";
import { renderComposeDest } from "./compose.js";
import { renderStories, loadPvPosts } from "./profile.js";
import { renderSearch } from "./search.js";

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
    .on("postgres_changes", { event:"*", schema:"public", table:"posts" }, scheduleRefetch)
    .on("postgres_changes", { event:"*", schema:"public", table:"comments" }, scheduleRefetch)
    .on("postgres_changes", { event:"*", schema:"public", table:"likes" }, scheduleRefetch)
    .subscribe();
}
export function unsubscribeRealtime(){
  if(channel){ sb.removeChannel(channel); channel = null; }
  clearTimeout(refetchTimer);
}

export function initRealtime(){
window.addEventListener("focus", function(){ if(me) scheduleRefetch(); });
}
