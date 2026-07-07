import { sb } from "./config.js";
import { me, state, ID2H } from "./store.js";
import { el, esc, avaHTML, user, toast } from "./helpers.js";
import { t } from "./i18n.js";
import { loadFeeds, loadPosts, setFeed, feedById, renderFeedbar, renderKredshead } from "./feed.js";
import { renderComposeDest } from "./compose.js";

/* ================= Ny kreds (sheet) ================= */
let fsSelected = {};
export function openFeedSheet(){
  fsSelected = {};
  el("fs-name").value = "";
  renderFsList();
  renderFsAll();
  fsCan();
  el("scrim").classList.add("on");
  el("fsheet").classList.add("on");
  setTimeout(function(){ el("fs-name").focus(); }, 260);
}
export function closeFeedSheet(){
  el("fsheet").classList.remove("on");
  if(!el("esheet").classList.contains("on") && !el("edsheet").classList.contains("on") && !el("msheet").classList.contains("on") && !el("asheet").classList.contains("on"))
    el("scrim").classList.remove("on");
}
function renderFsList(){
  if(!state.humanFriends.length){
    el("fs-list").innerHTML = '<div class="emptynote">'+t("fs.empty")+'</div>';
    return;
  }
  el("fs-list").innerHTML = state.humanFriends.map(function(h){
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
/* ---- "Vælg alle"/"Fravælg alle" (kun menneskelige venner listes) ---- */
function fsAllSelected(){
  return state.humanFriends.length > 0 && state.humanFriends.every(function(h){ return !!fsSelected[h]; });
}
function renderFsAll(){
  const b = el("fs-all");
  if(!state.humanFriends.length){ b.style.display = "none"; return; }
  b.style.display = "";
  b.textContent = fsAllSelected() ? t("fs.deselect_all") : t("fs.select_all");
}

/* ================= Medlemmer (sheet, åbnes fra kredshead) ================= */
let msFeedId = null;

export function openMemberSheet(){
  if(!me || state.currentFeed === "all" || !feedById(state.currentFeed)) return;
  msFeedId = state.currentFeed;
  el("ms-leave").style.display = "";
  el("ms-leave-confirm").style.display = "none";
  renderMemberSheet();
  el("scrim").classList.add("on");
  el("msheet").classList.add("on");
}
export function closeMemberSheet(){
  el("msheet").classList.remove("on");
  msFeedId = null;
  if(!el("fsheet").classList.contains("on") && !el("esheet").classList.contains("on") && !el("edsheet").classList.contains("on") && !el("asheet").classList.contains("on"))
    el("scrim").classList.remove("on");
}
function renderMemberSheet(){
  const f = feedById(msFeedId);
  if(!f){ closeMemberSheet(); return; }
  el("ms-title").textContent = f.name;
  el("ms-members").innerHTML = f.memberIds.map(function(id){
    const h = ID2H[id] || "?";
    const ownerTag = id === f.owner ? '<span class="ms-owner">'+t("ms.owner")+'</span>' : '';
    const btn = id !== me.id
      ? '<button class="ms-btn" data-rm="'+esc(id)+'">'+t("ms.remove")+'</button>'
      : '';
    return '<div class="listrow">'+
      avaHTML(h, 44)+
      '<div class="grow"><div class="l1">'+esc(user(h).name)+ownerTag+'</div><div class="l2">@'+esc(h)+'</div></div>'+
      btn+
    '</div>';
  }).join("");
  const cand = state.humanFriends.filter(function(h){
    const u = user(h);
    return u.id && f.memberIds.indexOf(u.id) < 0;
  });
  el("ms-friends").innerHTML = cand.length
    ? cand.map(function(h){
        return '<div class="listrow">'+
          avaHTML(h, 44)+
          '<div class="grow"><div class="l1">'+esc(user(h).name)+'</div><div class="l2">@'+esc(h)+'</div></div>'+
          '<button class="ms-btn add" data-add="'+esc(user(h).id)+'">'+t("ms.invite")+'</button>'+
        '</div>';
      }).join("")
    : '<div class="emptynote">'+t("ms.all_in")+'</div>';
}
/* Gen-render det åbne medlemmer-sheet (no-op hvis det er lukket) — kaldes også fra realtime */
export function refreshMemberSheet(){
  if(msFeedId != null && el("msheet").classList.contains("on")) renderMemberSheet();
}
/* Efter enhver vellykket governance-handling: hent feeds/posts igen, så pill + medlemmer opdaterer */
async function refreshAfterGov(){
  await loadFeeds();
  renderFeedbar();
  renderKredshead();
  renderComposeDest();
  refreshMemberSheet();
  loadPosts(); // en evt. ny afstemning (Ja/Nej-opslag) skal med i feedet
}
function govErrToast(m){
  if(m.indexOf("proposal_exists") >= 0) toast(t("gov.proposal_exists"));
  else if(m.indexOf("not_owner") >= 0) toast(t("gov.not_owner"));
  else if(m.indexOf("already_member") >= 0) toast(t("gov.already_member"));
  else if(m.indexOf("not_friend") >= 0) toast(t("gov.not_friend"));
  else toast(t("err.generic"));
}
async function msRemove(btn){
  const fid = msFeedId;
  const f = feedById(fid);
  if(!f || !me || btn.disabled) return;
  btn.disabled = true;
  const { error } = await sb.rpc("remove_kreds_member", { f: fid, tgt: btn.dataset.rm });
  if(error){
    console.error(error);
    btn.disabled = false;
    govErrToast(String(error.message || ""));
    return;
  }
  /* Serveren afgør direkte-vs-afstemning ud fra sit EGET medlemstal — aflæs resultatet
     efter refetch i stedet for at gætte ud fra det (muligvis forældede) lokale tal */
  await refreshAfterGov();
  const f2 = feedById(fid);
  if(!f2) return; // kredsen findes ikke længere for os — sheetet er allerede lukket
  toast(f2.memberIds.indexOf(btn.dataset.rm) < 0
    ? t("ms.removed", { name: user(ID2H[btn.dataset.rm] || "?").name })
    : t("ms.vote_created"));
}
async function msAdd(btn){
  const fid = msFeedId;
  const f = feedById(fid);
  if(!f || !me || btn.disabled) return;
  btn.disabled = true;
  /* Serveren sender nu ALTID en invitation (ingen direkte tilføjelse/afstemning her) */
  const { error } = await sb.rpc("add_kreds_member", { f: fid, u: btn.dataset.add });
  if(error){
    console.error(error);
    btn.disabled = false;
    govErrToast(String(error.message || ""));
    return;
  }
  btn.textContent = t("ms.invited"); // medlemslisten ændrer sig først, når invitationen accepteres
  toast(t("ms.invite_sent", { name: user(ID2H[btn.dataset.add] || "?").name }));
}

export function initKredse(){
el("fs-list").addEventListener("click", function(e){
  const r = e.target.closest(".listrow");
  if(!r || !r.dataset.h) return;
  fsSelected[r.dataset.h] = !fsSelected[r.dataset.h];
  r.classList.toggle("sel", !!fsSelected[r.dataset.h]);
  renderFsAll();
  fsCan();
});
el("fs-all").addEventListener("click", function(){
  const all = fsAllSelected();
  fsSelected = {};
  if(!all) state.humanFriends.forEach(function(h){ fsSelected[h] = true; });
  renderFsList();
  renderFsAll();
  fsCan();
});
el("fs-name").addEventListener("input", fsCan);
el("fs-create").addEventListener("click", async function(){
  const name = el("fs-name").value.trim();
  const ids = state.humanFriends
    .filter(function(h){ return fsSelected[h]; })
    .map(function(h){ return user(h).id; })
    .filter(Boolean);
  if(!name || !ids.length) return;
  this.disabled = true;
  const { data, error } = await sb.rpc("create_feed", { feed_name:name, member_ids:ids });
  this.disabled = false;
  if(error){
    const m = String(error.message || "");
    if(m.indexOf("blocked_content") >= 0) toast(t("err.blocked"));
    else if(m.indexOf("bad_name") >= 0) toast(t("fs.bad_name"));
    else if(m.indexOf("not_friend") >= 0 || m.indexOf("bad_members") >= 0) toast(t("fs.only_friends"));
    else toast(t("err.generic"));
    return;
  }
  closeFeedSheet();
  await loadFeeds();
  renderComposeDest();
  setFeed(data);
  toast(t("fs.created", { name: name }));
});
/* ---- Medlemmer-sheet ---- */
el("msheet").addEventListener("click", function(e){
  const rm = e.target.closest(".ms-btn[data-rm]");
  if(rm){ msRemove(rm); return; }
  const ad = e.target.closest(".ms-btn[data-add]");
  if(ad){ msAdd(ad); return; }
});
el("ms-leave").addEventListener("click", function(){
  el("ms-leave").style.display = "none";
  el("ms-leave-confirm").style.display = "";
});
el("ms-leave-cancel").addEventListener("click", function(){
  el("ms-leave").style.display = "";
  el("ms-leave-confirm").style.display = "none";
});
el("ms-leave2").addEventListener("click", async function(){
  if(!me || msFeedId == null) return;
  const btn = this;
  btn.disabled = true;
  const { error } = await sb.rpc("leave_kreds", { f: msFeedId });
  btn.disabled = false;
  if(error){
    console.error(error);
    toast(t("err.generic"));
    return;
  }
  closeMemberSheet();
  await loadFeeds();
  renderComposeDest();
  setFeed("all");
  toast(t("ms.left"));
});
}
