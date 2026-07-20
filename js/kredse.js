import { sb } from "./config.js";
import { me, state, ID2H } from "./store.js";
import { el, esc, avaHTML, user, toast, ini, imgUrl } from "./helpers.js";
import { t } from "./i18n.js";
import { loadFeeds, loadPosts, setFeed, feedById, renderFeedbar, renderKredshead, switchTab } from "./feed.js";
import { renderComposeDest } from "./compose.js";
import { openProfile } from "./profile.js";
import { closeKredsChat } from "./chat.js";

/* Tap på en person i medlems-arket: luk arket (og en evt. åben tråd, som profilen
   ellers ville ligge UNDER) og åbn profil-SIDEN med den normale tilbage-pil */
function openMemberProfile(h){
  if(!h) return;
  closeMemberSheet();
  if(el("chatview").classList.contains("on")) closeKredsChat();
  if(me && h === me.handle) switchTab("profil");
  else openProfile(h);
}

/* ================= Native glas-sheets (app'en) — fælles ================= */
/* Kort-data om en ven til de native glas-sheets (rå tekst; native tegner). */
function friendCard(h){
  const u = user(h);
  return {
    handle: h,
    name: u.name || h,
    avatarUrl: u.avatar_path ? imgUrl(u.avatar_path) : "",
    initials: ini(h),
    gradient: u.g || []
  };
}
let fsToken = 0, msToken = 0;

/* ================= Ny kreds (sheet) ================= */
let fsSelected = {};
let fsGov = "vote"; // styreform for den nye kreds: 'vote' | 'owner'
function renderFsGov(){
  document.querySelectorAll("#fs-gov .fs-govbtn").forEach(function(b){
    b.classList.toggle("on", b.dataset.gov === fsGov);
  });
}
/* Fuld snapshot til det native "Ny kreds"-glas-kort (native ejer navn/valg/styring lokalt). */
function fsheetSnapshot(){
  return {
    open: true,
    token: ++fsToken,
    title: t("fs.title"),
    namePlaceholder: t("fs.name_ph"),
    nameMaxLength: 30,
    govLabel: t("fs.gov_label"),
    govVoteLabel: t("fs.gov_vote"),
    govOwnerLabel: t("fs.gov_owner"),
    pickLabel: t("fs.pick"),
    createLabel: t("fs.create"),
    emptyLabel: t("fs.empty"),
    selectAllLabel: t("fs.select_all"),
    deselectAllLabel: t("fs.deselect_all"),
    friends: state.humanFriends.map(friendCard)
  };
}
export function openFeedSheet(){
  fsSelected = {};
  fsGov = "vote";
  // App'en: ægte native Liquid Glass-sheet i stedet for web-sheet'et.
  if(window.__vfFsheet){ window.__vfFsheetPush(fsheetSnapshot()); return; }
  el("fs-name").value = "";
  renderFsList();
  renderFsAll();
  renderFsGov();
  fsCan();
  el("scrim").classList.add("on");
  el("fsheet").classList.add("on");
  setTimeout(function(){ el("fs-name").focus(); }, 260);
}
export function closeFeedSheet(){
  if(window.__vfFsheet){ window.__vfFsheetPush({ close: true }); return; }
  el("fsheet").classList.remove("on");
  if(!el("esheet").classList.contains("on") && !el("edsheet").classList.contains("on") && !el("msheet").classList.contains("on") && !el("asheet").classList.contains("on"))
    el("scrim").classList.remove("on");
}
/* Native "Ny kreds"-handlinger (Swift → window.vfFsheet → her). */
export function nativeFsheetAction(obj){
  if(!obj) return;
  if(obj.kind === "dismiss"){ closeFeedSheet(); return; }
  if(obj.kind === "create"){ createFeedNative(obj); return; }
}
async function createFeedNative(obj){
  const name = (obj.name || "").trim();
  const ids = (obj.handles || []).map(function(h){ return user(h).id; }).filter(Boolean);
  const gov = obj.governance === "owner" ? "owner" : "vote";
  if(!name || !ids.length){ window.__vfFsheetPush({ update: true, busy: false }); return; }
  const { data, error } = await sb.rpc("create_feed", { feed_name: name, member_ids: ids, governance: gov });
  if(error){
    const m = String(error.message || "");
    if(m.indexOf("blocked_content") >= 0) toast(t("err.blocked"));
    else if(m.indexOf("bad_name") >= 0) toast(t("fs.bad_name"));
    else if(m.indexOf("not_friend") >= 0 || m.indexOf("bad_members") >= 0) toast(t("fs.only_friends"));
    else toast(t("err.generic"));
    window.__vfFsheetPush({ update: true, busy: false }); // sluk spinner, hold arket åbent
    return;
  }
  window.__vfFsheetPush({ close: true });
  await loadFeeds();
  renderComposeDest();
  setFeed(data);
  toast(t("fs.created", { name: name }));
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
let msInvited = new Map(); // user_id → invited_by (afventende invitationer til den viste kreds)
let msInvSeq = 0;          // generations-token: kun den NYESTE hentning må skrive msInvited

/* Hent afventende invitationer for kredsen. RLS tillader medlemmer at læse
   kreds_invites for deres egne kredse, så inviteren kan se hvem der er inviteret.
   Vi henter invited_by med, så kun inviteren/ejeren får en "Fortryd"-knap. */
async function loadMsInvites(fid){
  const seq = ++msInvSeq;
  const { data, error } = await sb.from("kreds_invites").select("user_id, invited_by").eq("feed_id", fid);
  if(error){ console.error(error); return; }
  if(msFeedId !== fid || seq !== msInvSeq) return; // lukket/skiftet — eller en nyere hentning vandt
  msInvited = new Map((data || []).map(function(r){ return [r.user_id, r.invited_by]; }));
}

export async function openMemberSheet(){
  if(!me || state.currentFeed === "all" || !feedById(state.currentFeed)) return;
  msFeedId = state.currentFeed;
  const fid = msFeedId;
  msInvited = new Map();
  // App'en: ægte native Liquid Glass-sheet (renderMemberSheet poster snapshot'en).
  if(window.__vfMemberSheet){
    renderMemberSheet();
    await loadMsInvites(fid);
    if(msFeedId === fid) renderMemberSheet();
    return;
  }
  el("ms-leave").style.display = "";
  el("ms-leave-confirm").style.display = "none";
  renderMemberSheet();
  el("scrim").classList.add("on");
  el("msheet").classList.add("on");
  await loadMsInvites(fid);                     // afventende invitationer → "Invitation sendt"
  if(msFeedId === fid) renderMemberSheet();
}
export function closeMemberSheet(){
  if(window.__vfMemberSheet){ msFeedId = null; window.__vfMemberPush({ close: true }); return; }
  el("msheet").classList.remove("on");
  msFeedId = null;
  if(!el("fsheet").classList.contains("on") && !el("esheet").classList.contains("on") && !el("edsheet").classList.contains("on") && !el("asheet").classList.contains("on"))
    el("scrim").classList.remove("on");
}
/* Fuld snapshot til det native medlemmer-glas-sheet (samme data som DOM-render). */
function memberSnapshot(f, canManage, ownerMode){
  const members = f.memberIds.map(function(id){
    const c = friendCard(ID2H[id] || "?");
    c.id = id;
    c.isOwner = id === f.owner;
    c.removable = id !== me.id && canManage;
    return c;
  });
  let invitable = [];
  if(canManage){
    invitable = state.humanFriends.filter(function(h){
      const u = user(h); return u.id && f.memberIds.indexOf(u.id) < 0;
    }).map(function(h){
      const uid = user(h).id;
      const c = friendCard(h);
      c.id = uid;
      c.invited = msInvited.has(uid);
      c.cancelable = c.invited && (msInvited.get(uid) === me.id || f.owner === me.id);
      return c;
    });
  }
  return {
    open: true,
    token: ++msToken,
    feedId: String(msFeedId),
    title: f.name,
    canManage: canManage,
    governanceNote: ownerMode ? t("ms.owner_governed") : "",
    showInviteSection: canManage,
    emptyInvitable: t("ms.all_in"),
    members: members,
    invitable: invitable,
    labels: {
      members: t("ms.members"),
      inviteLabel: t("ms.invite_label"),
      owner: t("ms.owner"),
      remove: t("ms.remove"),
      invite: t("ms.invite"),
      invited: t("ms.invited"),
      inviteCancel: t("ms.invite_cancel"),
      leave: t("ms.leave"),
      leaveConfirm: t("ms.leave_confirm"),
      leaveYes: t("ms.leave_yes"),
      cancel: t("common.cancel")
    }
  };
}
function renderMemberSheet(){
  const f = feedById(msFeedId);
  if(!f){ closeMemberSheet(); return; }
  const ownerMode = f.governance === "owner";
  const canManage = !ownerMode || f.owner === me.id;   // owner-tilstand: kun ejeren administrerer
  // App'en: post snapshot til det native glas-sheet i stedet for at skrive DOM.
  if(window.__vfMemberSheet){ window.__vfMemberPush(memberSnapshot(f, canManage, ownerMode)); return; }
  el("ms-title").textContent = f.name;
  const govNote = ownerMode ? '<div class="ms-govnote">'+t("ms.owner_governed")+'</div>' : '';
  el("ms-members").innerHTML = govNote + f.memberIds.map(function(id){
    const h = ID2H[id] || "?";
    const ownerTag = id === f.owner ? '<span class="ms-owner">'+t("ms.owner")+'</span>' : '';
    const btn = (id !== me.id && canManage)
      ? '<button class="ms-btn" data-rm="'+esc(id)+'">'+t("ms.remove")+'</button>'
      : '';
    return '<div class="listrow tap" data-h="'+esc(h)+'">'+
      avaHTML(h, 44)+
      '<div class="grow"><div class="l1">'+esc(user(h).name)+ownerTag+'</div><div class="l2">@'+esc(h)+'</div></div>'+
      btn+
    '</div>';
  }).join("");
  // Invitér-sektionen kun for dem der må administrere medlemmer (owner-tilstand: kun ejeren)
  const lbl = el("ms-invite-label");
  if(lbl) lbl.style.display = canManage ? "" : "none";
  if(!canManage){ el("ms-friends").innerHTML = ""; return; }
  const cand = state.humanFriends.filter(function(h){
    const u = user(h);
    return u.id && f.memberIds.indexOf(u.id) < 0;
  });
  el("ms-friends").innerHTML = cand.length
    ? cand.map(function(h){
        const uid = user(h).id;
        let action;
        if(msInvited.has(uid)){
          // Allerede inviteret → tydeligt "Invitation sendt ✓". Inviteren/ejeren kan fortryde.
          const canCancel = msInvited.get(uid) === me.id || f.owner === me.id;
          action = '<span class="ms-sent">'+t("ms.invited")+'</span>'+
            (canCancel ? '<button class="ms-btn cancel" data-cancel="'+esc(uid)+'">'+t("ms.invite_cancel")+'</button>' : '');
        } else {
          action = '<button class="ms-btn add" data-add="'+esc(uid)+'">'+t("ms.invite")+'</button>';
        }
        return '<div class="listrow tap" data-h="'+esc(h)+'">'+
          avaHTML(h, 44)+
          '<div class="grow"><div class="l1">'+esc(user(h).name)+'</div><div class="l2">@'+esc(h)+'</div></div>'+
          action+
        '</div>';
      }).join("")
    : '<div class="emptynote">'+t("ms.all_in")+'</div>';
}
/* Gen-render det åbne medlemmer-sheet (no-op hvis det er lukket) — kaldes også fra realtime */
export function refreshMemberSheet(){
  // Åben = msFeedId sat (native, hvor #msheet aldrig får .on) ELLER web-sheet'et er .on.
  const open = msFeedId != null && (window.__vfMemberSheet || el("msheet").classList.contains("on"));
  if(open){
    const fid = msFeedId;
    renderMemberSheet();
    loadMsInvites(fid).then(function(){ if(msFeedId === fid) renderMemberSheet(); }); // hold "sendt"-status frisk
  }
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
/* uid-baserede kerner — delt af web-knapperne og de native handlinger.
   Ingen btn-afhængighed: web-wrappere styrer btn.disabled; native styrer sit eget `pending`
   og ryddes af næste snapshot. Ved fejl re-render/re-post vi, så native-rækken låses op. */
async function doMsRemove(uid){
  const fid = msFeedId;
  const f = feedById(fid);
  if(!f || !me) return;
  const { error } = await sb.rpc("remove_kreds_member", { f: fid, tgt: uid });
  if(error){ console.error(error); govErrToast(String(error.message || "")); renderMemberSheet(); return; }
  /* Serveren afgør direkte-vs-afstemning ud fra sit EGET medlemstal — aflæs resultatet
     efter refetch i stedet for at gætte ud fra det (muligvis forældede) lokale tal */
  await refreshAfterGov();
  const f2 = feedById(fid);
  if(!f2) return; // kredsen findes ikke længere for os — sheetet er allerede lukket
  toast(f2.memberIds.indexOf(uid) < 0
    ? t("ms.removed", { name: user(ID2H[uid] || "?").name })
    : t("ms.vote_created"));
}
async function doMsAdd(uid){
  const fid = msFeedId;
  const f = feedById(fid);
  if(!f || !me) return;
  /* Serveren sender nu ALTID en invitation (ingen direkte tilføjelse/afstemning her) */
  const { error } = await sb.rpc("add_kreds_member", { f: fid, u: uid });
  if(error){ console.error(error); govErrToast(String(error.message || "")); renderMemberSheet(); return; }
  msInvited.set(uid, me.id); // medlemslisten ændrer sig først når invitationen accepteres
  toast(t("ms.invite_sent", { name: user(ID2H[uid] || "?").name }));
  renderMemberSheet(); // personen vises nu vedvarende som "Invitation sendt ✓"
}
async function doMsCancel(uid){
  const fid = msFeedId;
  const f = feedById(fid);
  if(!f || !me) return;
  const { error } = await sb.rpc("cancel_kreds_invite", { f: fid, u: uid });
  if(error){ console.error(error); govErrToast(String(error.message || "")); renderMemberSheet(); return; }
  msInvited.delete(uid);
  toast(t("ms.invite_cancelled", { name: user(ID2H[uid] || "?").name }));
  renderMemberSheet(); // personen kan nu inviteres igen ("Invitér")
}
async function doLeave(){
  if(!me || msFeedId == null) return;
  const { error } = await sb.rpc("leave_kreds", { f: msFeedId });
  if(error){ console.error(error); toast(t("err.generic")); renderMemberSheet(); return; }
  closeMemberSheet();
  await loadFeeds();
  renderComposeDest();
  setFeed("all");
  toast(t("ms.left"));
}
/* Web-knap-wrappere (browser): btn styrer double-submit; kernen gør resten. */
async function msRemove(btn){ if(btn.disabled) return; btn.disabled = true; await doMsRemove(btn.dataset.rm); btn.disabled = false; }
async function msAdd(btn){ if(btn.disabled) return; btn.disabled = true; await doMsAdd(btn.dataset.add); btn.disabled = false; }
async function msCancel(btn){ if(btn.disabled) return; btn.disabled = true; await doMsCancel(btn.dataset.cancel); btn.disabled = false; }
/* Native medlemmer-handlinger (Swift → window.vfMember → her). */
export function nativeMemberAction(obj){
  if(!obj) return;
  if(obj.feedId != null && msFeedId != null && String(msFeedId) !== String(obj.feedId)) return; // forældet
  switch(obj.kind){
    case "profile": openMemberProfile(obj.h); break;
    case "remove": doMsRemove(obj.uid); break;
    case "invite": doMsAdd(obj.uid); break;
    case "cancelInvite": doMsCancel(obj.uid); break;
    case "leaveConfirm": doLeave(); break;
    case "dismiss": closeMemberSheet(); break;
  }
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
el("fs-gov").addEventListener("click", function(e){
  const b = e.target.closest(".fs-govbtn");
  if(!b) return;
  fsGov = b.dataset.gov;
  renderFsGov();
});
el("fs-create").addEventListener("click", async function(){
  const name = el("fs-name").value.trim();
  const ids = state.humanFriends
    .filter(function(h){ return fsSelected[h]; })
    .map(function(h){ return user(h).id; })
    .filter(Boolean);
  if(!name || !ids.length) return;
  this.disabled = true;
  const { data, error } = await sb.rpc("create_feed", { feed_name:name, member_ids:ids, governance: fsGov });
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
  const cx = e.target.closest(".ms-btn[data-cancel]");
  if(cx){ msCancel(cx); return; }
  // Tap på selve personen (ikke en knap) → profil-siden
  const row = e.target.closest(".listrow[data-h]");
  if(row) openMemberProfile(row.dataset.h);
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
  const btn = this;
  if(btn.disabled) return;
  btn.disabled = true;
  await doLeave();
  btn.disabled = false;
});
}
