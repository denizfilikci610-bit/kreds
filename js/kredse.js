import { sb, GENERIC_ERR } from "./config.js";
import { state } from "./store.js";
import { el, esc, avaHTML, user, toast } from "./helpers.js";
import { loadFeeds, setFeed } from "./feed.js";
import { renderComposeDest } from "./compose.js";

/* ================= Ny kreds (sheet) ================= */
let fsSelected = {};
export function openFeedSheet(){
  fsSelected = {};
  el("fs-name").value = "";
  renderFsList();
  fsCan();
  el("scrim").classList.add("on");
  el("fsheet").classList.add("on");
  setTimeout(function(){ el("fs-name").focus(); }, 260);
}
export function closeFeedSheet(){
  el("fsheet").classList.remove("on");
  if(!el("esheet").classList.contains("on"))
    el("scrim").classList.remove("on");
}
function renderFsList(){
  if(!state.friends.length){
    el("fs-list").innerHTML = '<div class="emptynote">Du har ingen venner endnu. Find dem under Søg 🔍</div>';
    return;
  }
  el("fs-list").innerHTML = state.friends.map(function(h){
    return '<div class="listrow'+(fsSelected[h] ? " sel" : "")+'" data-h="'+esc(h)+'">'+
      avaHTML(h, 44)+
      '<div class="grow"><div class="l1">'+esc(user(h).name)+'</div><div class="l2">@'+esc(h)+'</div></div>'+
      '<span class="mcheck"><svg viewBox="0 0 24 24"><path d="M20 6 9.5 16.5 4 11"/></svg></span>'+
    '</div>';
  }).join("");
}
function fsCan(){
  const any = Object.keys(fsSelected).some(function(k){ return fsSelected[k]; });
  el("fs-create").disabled = !(el("fs-name").value.trim() && any);
}

export function initKredse(){
el("fs-list").addEventListener("click", function(e){
  const r = e.target.closest(".listrow");
  if(!r || !r.dataset.h) return;
  fsSelected[r.dataset.h] = !fsSelected[r.dataset.h];
  r.classList.toggle("sel", !!fsSelected[r.dataset.h]);
  fsCan();
});
el("fs-name").addEventListener("input", fsCan);
el("fs-create").addEventListener("click", async function(){
  const name = el("fs-name").value.trim();
  const ids = state.friends
    .filter(function(h){ return fsSelected[h]; })
    .map(function(h){ return user(h).id; })
    .filter(Boolean);
  if(!name || !ids.length) return;
  this.disabled = true;
  const { data, error } = await sb.rpc("create_feed", { feed_name:name, member_ids:ids });
  this.disabled = false;
  if(error){
    const m = String(error.message || "");
    if(m.indexOf("bad_name") >= 0) toast("Ugyldigt kredsnavn");
    else if(m.indexOf("not_friend") >= 0 || m.indexOf("bad_members") >= 0) toast("Du kan kun vælge dine venner");
    else toast(GENERIC_ERR);
    return;
  }
  closeFeedSheet();
  await loadFeeds();
  renderComposeDest();
  setFeed(data);
  toast("Kredsen ”"+name+"” er oprettet");
});
}
