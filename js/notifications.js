import { sb } from "./config.js";
import { me, expandedCmts, curTab } from "./store.js";
import { el, esc, avaHTML, user, fmtTime, toast, registerProfile } from "./helpers.js";
import { t } from "./i18n.js";
import { scheduleRefetch } from "./realtime.js";
import { switchTab, setFeed, resetBarHide } from "./feed.js";
import { rerenderPostCmts } from "./comments.js";
import { openProfile } from "./profile.js";

/* ================= Notifikations-prik (session-only, ingen persistens) ================= */
export function setNotifDot(on){
  el("tabdot").classList.toggle("on", !!on);
}
/* Kaldes fra realtime.js ved INSERTs på likes/comments/kreds_invites/kreds_requests.
   RLS har allerede filtreret synligheden — vi frasorterer kun egne handlinger. */
export function realtimeNotify(table, payload){
  if(!me || !payload || payload.eventType !== "INSERT") return;
  const row = payload.new;
  if(!row) return;
  if(table === "posts"){
    // Nye opslag (RLS har allerede begrænset til synlige) tænder kun prikken —
    // de optræder ikke i notifikationslisten, så ingen genindlæsning af den.
    if(row.author === me.id) return;
    if(curTab !== "akt") setNotifDot(true);
    return;
  }
  if(table === "kreds_invites"){
    if(row.user_id !== me.id) return; // kun invitationer TIL mig
  } else {
    const actor = row.user_id !== undefined ? row.user_id : row.author;
    if(actor === me.id) return; // egne likes/kommentarer/anmodninger tæller ikke
  }
  if(curTab === "akt"){
    // Fanen er åben: frisk liste i stedet for prik (gælder også invitationer).
    // Debounce som scheduleRefetch, så en byge af events ikke giver overlappende loads.
    clearTimeout(notifTimer);
    notifTimer = setTimeout(loadNotifs, 400);
    return;
  }
  setNotifDot(true);
}

/* ================= Notifikationer ================= */
/* Ulæste rækker: vf_notif_seen = ISO for seneste åbning af akt-fanen (per enhed).
   Sættes EFTER render, så fremhævningen er synlig under DETTE besøg og ryddet næste gang. */
const NOTIF_SEEN_KEY = "vf_notif_seen";
function readNotifSeen(){
  try{ return localStorage.getItem(NOTIF_SEEN_KEY) || ""; }catch(_e){ return ""; }
}
function writeNotifSeen(iso){
  try{ localStorage.setItem(NOTIF_SEEN_KEY, iso); }catch(_e){}
}
let notifTimer = null, notifSeq = 0;
export async function loadNotifs(){
  if(!me) return;
  const seq = ++notifSeq; // sekvens-token: kun det nyeste kald må skrive resultatet
  el("notifs").innerHTML = '<div class="emptynote">'+t("common.loading")+'</div>';
  const seenIso = readNotifSeen();
  // Intet gemt tidsstempel (fanen aldrig åbnet på enheden) = alt er ulæst
  const seenMs = seenIso ? new Date(seenIso).getTime() : 0;
  function isUnread(at){ return new Date(at).getTime() > seenMs; }
  const H = '<svg viewBox="0 0 24 24"><path class="stroke" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
  const B = '<svg viewBox="0 0 24 24"><path class="stroke" d="M12 3.3a8.7 8.7 0 0 0-7.4 13.2L3.4 20.6l4.2-1.1A8.7 8.7 0 1 0 12 3.3Z"/></svg>';
  const P = '<svg viewBox="0 0 24 24"><g class="stroke"><circle cx="10" cy="8" r="3.4"/><path d="M3.8 19.5c.7-3.3 3.2-5 6.2-5s5.5 1.7 6.2 5"/><path d="M18.5 6.5v6M15.5 9.5h6"/></g></svg>';
  function row(icon, cls, u, text, snip, tm, attrs, unread){
    return '<div class="notif'+(unread ? " unread" : "")+'"'+(attrs || "")+'>'+
      (unread ? '<span class="udot"></span>' : '')+
      avaHTML(u, 32)+
      '<div class="grow">'+
        '<div class="ntext"><b>'+esc(user(u).name)+'</b> '+text+'. <span class="nt">'+esc(tm)+'</span></div>'+
        (snip ? '<div class="nsnip">'+esc(snip)+'</div>' : '')+
      '</div>'+
      '<div class="nicon '+cls+'">'+icon+'</div>'+
    '</div>';
  }
  /* Invitation til en kreds (Accepter/Afvis) — handlingskrævende, men deltager også i ulæst-visningen */
  function invRow(n){
    const un = isUnread(n.at);
    return '<div class="notif kinv'+(un ? " unread" : "")+'" data-invf="'+esc(n.f)+'" data-k="'+esc(n.k)+'">'+
      (un ? '<span class="udot"></span>' : '')+
      avaHTML(n.u, 32)+
      '<div class="grow">'+
        '<div class="ntext"><b>'+esc(user(n.u).name)+'</b> '+t("notif.invited", { k: esc(n.k) })+'. <span class="nt">'+esc(fmtTime(n.at))+'</span></div>'+
        '<div class="kbtns">'+
          '<button class="kbtn kacc">'+t("notif.accept")+'</button>'+
          '<button class="kbtn kdec">'+t("notif.decline")+'</button>'+
        '</div>'+
      '</div>'+
    '</div>';
  }
  /* Anmodning om at være med i en af mine kredse (kun kreds-ejeren ser disse rækker) */
  function kreqRow(n){
    const un = isUnread(n.at);
    return '<div class="notif kreq'+(un ? " unread" : "")+'" data-f="'+esc(n.f)+'" data-uid="'+esc(n.uid)+'" data-n="'+esc(user(n.u).name)+'" data-k="'+esc(n.k)+'">'+
      (un ? '<span class="udot"></span>' : '')+
      avaHTML(n.u, 32)+
      '<div class="grow">'+
        '<div class="ntext"><b>'+esc(user(n.u).name)+'</b> '+t("notif.request", { k: esc(n.k) })+'. <span class="nt">'+esc(fmtTime(n.at))+'</span></div>'+
        '<div class="kbtns">'+
          '<button class="kbtn kap">'+t("notif.approve")+'</button>'+
          '<button class="kbtn krej">'+t("notif.reject")+'</button>'+
        '</div>'+
      '</div>'+
    '</div>';
  }
  try{
    const mine = await sb.from("posts").select("id, text, image_path").eq("author", me.id);
    if(mine.error) throw mine.error;
    const ids = (mine.data || []).map(function(p){ return p.id; });
    const textById = {};
    (mine.data || []).forEach(function(p){ textById[p.id] = p.text || (p.image_path ? t("notif.photo") : ""); });

    const reqs = [
      sb.from("friendships").select("created_at, from_profile:profiles!user_id(*)").eq("friend_id", me.id),
      sb.from("kreds_requests").select("created_at, feed_id, user_id, requester:profiles!user_id(*), feed:feeds!feed_id(name)").neq("user_id", me.id),
      sb.from("kreds_invites").select("created_at, feed_id, feed:feeds!feed_id(name), inviter:profiles!invited_by(*)").eq("user_id", me.id)
    ];
    if(ids.length){
      reqs.push(sb.from("likes").select("created_at, post_id, liker:profiles!user_id(*)").in("post_id", ids).neq("user_id", me.id));
      reqs.push(sb.from("comments").select("created_at, post_id, text, image_path, author_profile:profiles!author(*)").in("post_id", ids).neq("author", me.id));
    }
    const res = await Promise.all(reqs);
    for(const r of res){ if(r.error) throw r.error; }

    const items = [];
    (res[0].data || []).forEach(function(r){
      if(r.from_profile){ registerProfile(r.from_profile); items.push({ type:"friend", u:r.from_profile.handle, at:r.created_at }); }
    });
    (res[1].data || []).forEach(function(r){
      if(r.requester){
        registerProfile(r.requester);
        items.push({ type:"kreq", u:r.requester.handle, at:r.created_at, f:r.feed_id, uid:r.user_id, k:(r.feed && r.feed.name) || "" });
      }
    });
    (res[2].data || []).forEach(function(r){
      if(r.inviter){
        registerProfile(r.inviter);
        items.push({ type:"inv", u:r.inviter.handle, at:r.created_at, f:r.feed_id, k:(r.feed && r.feed.name) || "" });
      }
    });
    if(ids.length){
      (res[3].data || []).forEach(function(r){
        if(r.liker){ registerProfile(r.liker); items.push({ type:"like", u:r.liker.handle, at:r.created_at, pid:r.post_id, snip:textById[r.post_id] || "" }); }
      });
      (res[4].data || []).forEach(function(r){
        if(r.author_profile){ registerProfile(r.author_profile); items.push({ type:"cmt", u:r.author_profile.handle, at:r.created_at, pid:r.post_id, snip:r.text || (r.image_path ? t("notif.photo") : "") }); }
      });
    }
    items.sort(function(a,b){ return new Date(b.at) - new Date(a.at); });
    /* Invitationer/anmodninger er handlingskrævende — de må aldrig ryge ud af 30-loftet */
    const acts = items.filter(function(n){ return n.type === "inv" || n.type === "kreq"; });
    const rest = items.filter(function(n){ return n.type !== "inv" && n.type !== "kreq"; })
      .slice(0, Math.max(0, 30 - acts.length));
    const top = acts.concat(rest);
    if(seq !== notifSeq) return; // et nyere kald er i gang — lad det vinde
    el("notifs").innerHTML = top.length
      ? top.map(function(n){
          if(n.type === "like")   return row(H, "heart",  n.u, t("notif.liked"), n.snip, fmtTime(n.at), ' data-pid="'+esc(n.pid)+'" data-type="like"', isUnread(n.at));
          if(n.type === "cmt")    return row(B, "bubble", n.u, t("notif.commented"),  n.snip, fmtTime(n.at), ' data-pid="'+esc(n.pid)+'" data-type="cmt"', isUnread(n.at));
          if(n.type === "kreq")   return kreqRow(n);
          if(n.type === "inv")    return invRow(n);
          return row(P, "friend", n.u, t("notif.friend"), "", fmtTime(n.at), ' data-friend="'+esc(n.u)+'"', isUnread(n.at));
        }).join("")
      : '<div class="emptynote">'+t("notif.empty")+'</div>';
    // EFTER render, og kun når akt-fanen faktisk er den aktive visning:
    // gem nu() — fremhævningen står under DETTE besøg og er ryddet ved næste
    if(curTab === "akt") writeNotifSeen(new Date().toISOString());
  }catch(err){
    console.error(err);
    if(seq !== notifSeq) return; // et forældet fejlsvar må ikke overskrive en frisk liste
    el("notifs").innerHTML = '<div class="emptynote">'+t("notif.load_failed")+'</div>';
  }
}

/* ---- Tap på en notifikation: hop til opslaget (eller profilen) ---- */
async function openNotifPost(pid, isCmt){
  const { data, error } = await sb.from("posts").select("id, feed_id").eq("id", pid).maybeSingle();
  if(error){ console.error(error); toast(t("err.generic")); return; }
  if(!data){ toast(t("notif.post_gone")); return; }
  switchTab("feed");
  await setFeed(data.feed_id || "all");
  if(isCmt){
    // Fold kommentartråden ud, så svarene er synlige når vi lander
    expandedCmts.add(Number(pid));
    rerenderPostCmts(pid);
  }
  const node = document.querySelector('#feed .post[data-id="'+data.id+'"]');
  if(!node){ toast(t("notif.post_not_visible")); return; }
  node.scrollIntoView({ block:"center" });
  resetBarHide(); // programmatisk hop må ikke skjule topbaren — genstart fra landingspositionen
  node.classList.add("flash");
  setTimeout(function(){ node.classList.remove("flash"); }, 1600);
}

/* ---- Fjern en række og vis evt. tom-tilstand ---- */
function removeNotifRow(row){
  row.remove();
  if(!el("notifs").querySelector(".notif, .emptynote"))
    el("notifs").innerHTML = '<div class="emptynote">'+t("notif.empty")+'</div>';
}

/* ---- Accepter/afvis kreds-invitation ---- */
async function handleInvite(row, accept){
  const k = row.dataset.k;
  row.querySelectorAll(".kbtn").forEach(function(x){ x.disabled = true; });
  const { data, error } = await sb.rpc(accept ? "accept_kreds_invite" : "decline_kreds_invite", { f: row.dataset.invf });
  if(error){
    console.error(error);
    const m = String(error.message || "");
    if(m.indexOf("no_invite") >= 0){
      removeNotifRow(row);
      toast(t("notif.invite_gone"));
      return;
    }
    if(m.indexOf("already_member") >= 0){
      removeNotifRow(row);
      toast(t("notif.already_member", { k: k }));
      scheduleRefetch();
      return;
    }
    row.querySelectorAll(".kbtn").forEach(function(x){ x.disabled = false; });
    toast(t("err.generic"));
    return;
  }
  removeNotifRow(row);
  if(!accept){
    toast(t("notif.invite_declined"));
    return;
  }
  if(data === "member"){
    toast(t("notif.now_member", { k: k }));
    scheduleRefetch(); // feeds + opslag skal med det samme afspejle medlemskabet
  } else {
    toast(t("notif.vote_pending"));
  }
}

/* ---- Godkend/afvis kreds-anmodning (kun ejeren ser knapperne) ---- */
async function notifClick(e){
  const iv = e.target.closest(".kacc, .kdec");
  if(iv){
    if(iv.disabled || !me) return;
    const irow = iv.closest(".notif");
    if(!irow || !irow.dataset.invf) return;
    handleInvite(irow, iv.classList.contains("kacc"));
    return;
  }
  const b = e.target.closest(".kap, .krej");
  if(!b){
    // Tap på selve rækken (ikke Godkend/Afvis): åbn opslag eller profil
    const n = e.target.closest(".notif");
    if(!n || !me) return;
    if(n.dataset.pid){ openNotifPost(n.dataset.pid, n.dataset.type === "cmt"); return; }
    if(n.dataset.friend){ openProfile(n.dataset.friend); return; }
    return;
  }
  if(b.disabled || !me) return;
  const row = b.closest(".notif");
  if(!row || !row.dataset.f) return;
  const approve = b.classList.contains("kap");
  row.querySelectorAll(".kbtn").forEach(function(x){ x.disabled = true; });
  const { error } = await sb.rpc(approve ? "approve_kreds_request" : "reject_kreds_request", { f: row.dataset.f, u: row.dataset.uid });
  if(error){
    console.error(error);
    if(String(error.message || "").indexOf("no_request") >= 0){
      removeNotifRow(row);
      toast(t("notif.request_gone"));
      return;
    }
    row.querySelectorAll(".kbtn").forEach(function(x){ x.disabled = false; });
    toast(t("err.generic"));
    return;
  }
  removeNotifRow(row);
  toast(approve ? t("notif.approved", { name: row.dataset.n, k: row.dataset.k }) : t("notif.request_rejected"));
  if(approve) scheduleRefetch(); // medlemslisten i kredshead/compose skal med
}

export function initNotifs(){
  el("notifs").addEventListener("click", notifClick);
}
