import { sb, GENERIC_ERR } from "./config.js";
import { me, state } from "./store.js";
import { el, esc, avaHTML, user, toast, registerProfile, BADGE } from "./helpers.js";
import { loadFriends, loadPosts } from "./feed.js";
import { renderStories, openProfile } from "./profile.js";

/* ================= Søg ================= */
let globalResults = [], globalQ = "", searchTimer = null;
function matchFriends(q){
  return state.friends.filter(function(h){
    return !q || h.toLowerCase().indexOf(q) >= 0 || user(h).name.toLowerCase().indexOf(q) >= 0;
  });
}
export function renderSearch(){
  const q = (el("search-input").value || "").trim().toLowerCase();
  const list = matchFriends(q);
  /* Hele rækken kan tappes (åbner profilen) — som notifikations-rækkerne */
  let html = list.map(function(h){
    return '<div class="listrow tap" data-open="'+esc(h)+'">'+
             avaHTML(h, 44)+
             '<div class="grow"><div class="l1">'+esc(user(h).name)+' '+BADGE+'</div><div class="l2">@'+esc(h)+'</div></div>'+
           '</div>';
  }).join("");
  if(q && q === globalQ && globalResults.length){
    globalResults.forEach(function(p){
      html += '<div class="listrow tap" data-open="'+esc(p.handle)+'">'+
                avaHTML(p.handle, 44)+
                '<div class="grow"><div class="l1">'+esc(p.name || p.handle)+'</div>'+
                '<button class="addaction" data-add="'+esc(p.handle)+'">Tilføj @'+esc(p.handle)+' til din kreds</button></div>'+
              '</div>';
    });
  }
  if(!html){
    html = '<div class="emptynote">'+(q ? "Ingen i din kreds matcher." : "Din kreds er tom endnu. Søg efter dine venner her 🔍")+'</div>';
  }
  el("search-list").innerHTML = html;
}
async function runGlobalSearch(q){
  if(!me) return;
  const safe = q.replace(/[\\"]/g, "");
  if(!safe) return;
  const { data, error } = await sb.from("profiles").select("*")
    .or('handle.ilike."*'+safe+'*",name.ilike."*'+safe+'*"')
    .neq("id", me.id)
    .limit(10);
  if(error){ console.error(error); return; }
  const cur = (el("search-input").value || "").trim().toLowerCase();
  if(cur !== q) return;
  (data || []).forEach(registerProfile);
  globalResults = (data || []).filter(function(p){ return state.friends.indexOf(p.handle) < 0; });
  globalQ = q;
  renderSearch();
}
export function resetSearch(){ globalResults = []; globalQ = ""; }
/* Efter et ven-tilføj uden for søgevisningen (fx profilpanelets chip):
   fjern den nye ven fra de globale resultater og gentegn listen */
export function refreshSearchAfterFriendAdd(h){
  globalResults = globalResults.filter(function(p){ return p.handle !== h; });
  renderSearch();
}

export function initSearch(){
el("search-input").addEventListener("input", function(){
  const q = this.value.trim().toLowerCase();
  clearTimeout(searchTimer);
  if(q !== globalQ){ globalResults = []; globalQ = ""; }
  renderSearch();
  if(q){
    searchTimer = setTimeout(function(){ runGlobalSearch(q); }, 300);
  }
});
el("search-list").addEventListener("click", async function(e){
  /* "Tilføj …"-knappen håndteres FØRST og åbner IKKE profilen */
  const a = e.target.closest(".addaction");
  if(a){
    if(!me) return;
    const h = a.dataset.add;
    a.disabled = true;
    const { data, error } = await sb.rpc("add_friend", { friend_handle:h });
    if(error){
      a.disabled = false;
      const m = String(error.message || "");
      if(m.indexOf("not_found") >= 0) toast("Ingen bruger med det navn");
      else if(m.indexOf("self") >= 0) toast("Det er dig selv 😄");
      else toast(GENERIC_ERR);
      return;
    }
    if(data) registerProfile(data);
    el("search-input").value = "";
    globalResults = []; globalQ = "";
    await loadFriends();
    renderSearch();
    renderStories();
    loadPosts();
    toast(user(h).name + " er nu i din kreds");
    return;
  }
  /* Tap på selve rækken: åbn profilpanelet (venner OG globale resultater) */
  const r = e.target.closest(".listrow[data-open]");
  if(r && me) openProfile(r.dataset.open);
});
}
