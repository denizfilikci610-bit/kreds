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

/* ================= Live-status for MIN optagelses-afstemning =================
   Målpersonen kan ikke se selve afstemnings-opslaget (RLS), så vi henter en
   aggregeret live-status via RPC og viser den øverst i Notifikationer med en
   nedtælling. Afstemningen lukker efter 10 min (eller når alle har stemt). */
let admTimer = null, admTick = 0;
function admLeftLabel(s){
  s = Math.max(0, s | 0);
  const m = Math.floor(s / 60), ss = s % 60;
  return t("adm.closes_in", { t: m + ":" + (ss < 10 ? "0" : "") + ss });
}
function stopAdmTicker(){ if(admTimer){ clearInterval(admTimer); admTimer = null; } }
function startAdmTicker(){
  if(admTimer) return;
  admTick = 0;
  admTimer = setInterval(function(){
    if(curTab !== "akt"){ stopAdmTicker(); return; }        // kun aktiv mens man er på fanen
    admTick++;
    const cards = document.querySelectorAll("#admvotes .admvote[data-open='1']");
    if(!cards.length){ stopAdmTicker(); return; }
    let dueRefresh = false;
    cards.forEach(function(c){
      let left = (parseInt(c.dataset.left, 10) || 0) - 1;
      if(left <= 0){ left = 0; dueRefresh = true; }
      c.dataset.left = String(left);
      const cd = c.querySelector(".adm-countdown");
      if(cd) cd.textContent = admLeftLabel(left);
    });
    if(dueRefresh || admTick % 5 === 0) loadAdmissionVotes(); // frisk optælling / afslut ved frist
  }, 1000);
}
function renderAdmissionVotes(rows){
  const box = el("admvotes");
  if(!box) return;
  if(!rows.length){ box.innerHTML = ""; stopAdmTicker(); return; }
  box.innerHTML = rows.map(function(v){
    const total = (v.ja || 0) + (v.nej || 0);
    const pctJa = total ? Math.round((v.ja || 0) / total * 100) : 0;
    const open = !v.resolved;
    const status = v.resolved
      ? '<span class="adm-done '+(v.admitted ? "ok" : "no")+'">'+t(v.admitted ? "adm.admitted" : "adm.rejected")+'</span>'
      : '<span class="adm-countdown">'+admLeftLabel(v.seconds_left)+'</span>';
    return '<div class="admvote'+(v.resolved ? " done" : "")+'" data-open="'+(open ? 1 : 0)+'" data-left="'+(open ? (v.seconds_left | 0) : 0)+'">'+
      '<div class="adm-top"><b>'+t("adm.title", { k: esc(v.feed_name || "") })+'</b>'+status+'</div>'+
      '<div class="adm-tally">'+t("adm.tally", { ja: v.ja || 0, nej: v.nej || 0 })+'</div>'+
      '<div class="adm-bar"><span style="width:'+pctJa+'%"></span></div>'+
    '</div>';
  }).join("");
  if(rows.some(function(v){ return !v.resolved; })) startAdmTicker(); else stopAdmTicker();
}
async function loadAdmissionVotes(){
  const box = el("admvotes");
  if(!me || !box){ if(box) box.innerHTML = ""; stopAdmTicker(); return; }
  let rows = [];
  try{
    const { data, error } = await sb.rpc("my_admission_votes");
    if(!error && data) rows = data;
  }catch(_e){}
  renderAdmissionVotes(rows);
}
/* Kaldes fra realtime.js ved INSERTs på likes/comments/kreds_invites/kreds_requests.
   RLS har allerede filtreret synligheden — vi frasorterer kun egne handlinger. */
export function realtimeNotify(table, payload){
  if(!me || !payload || payload.eventType !== "INSERT") return;
  const row = payload.new;
  if(!row) return;
  if(table === "posts"){
    // Kun KREDS-opslag (feed_id) fra andre er notifikationer — venners almindelige
    // opslag tæller ikke. Åben fane → frisk listen med det samme; ellers tænd prikken.
    if(row.author === me.id || !row.feed_id) return;
    if(curTab === "akt"){
      clearTimeout(notifTimer);
      notifTimer = setTimeout(loadNotifs, 400);
    } else {
      setNotifDot(true);
    }
    return;
  }
  // Reaktioner (like/kommentar/kommentar-like): actor-tjekket fjerner egne handlinger,
  // MEN payloaden afslører ikke om målet (opslag/kommentar) er MIT — RLS leverer også
  // reaktioner på andres synlige indhold. Derfor må prikken afgøres af et ejerskabs-tjek
  // (hasUnseenNotifs), ikke tændes blindt (ellers lyste en like på en vens opslag prikken).
  const isReaction = (table === "likes" || table === "comments" || table === "comment_likes");
  if(table === "kreds_invites"){
    if(row.user_id !== me.id) return; // kun invitationer TIL mig
  } else if(table === "friend_requests"){
    if(row.to_id !== me.id) return;   // kun ven-anmodninger TIL mig
  } else if(table === "friendships"){
    // Kun når nogen tilføjer/accepterer MIG (rækken hvor jeg er friend_id) — ikke mine egne handlinger
    if(row.friend_id !== me.id || row.user_id === me.id) return;
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
  if(isReaction) scheduleNotifDotRefresh(); // ejerskabs-tjekket prik
  else setNotifDot(true);                    // pålideligt: payload/RLS bekræfter relevans
}

/* ---- Live prik: tændes for USETE reaktioner/anmodninger på MIT indhold. Bruges både af
   realtime (reaktioner, hvor payloaden ikke afslører ejerskab) OG ved app-fokus/boot, så
   reaktioner der landede mens app'en var i baggrunden (realtime-socket droppet) også fanges.
   Let count-probe (head:true → ingen rækker hentes); tænder kun — rydder aldrig (akt rydder). */
let dotTimer = null;
export function scheduleNotifDotRefresh(){
  clearTimeout(dotTimer);
  dotTimer = setTimeout(refreshNotifDot, 500);
}
export async function refreshNotifDot(){
  if(!me || curTab === "akt") return;
  if(await hasUnseenNotifs()) setNotifDot(true);
}
async function hasUnseenNotifs(){
  if(!me) return false;
  // Samme "set"-grænse som listen (seenSinceMs) → prik og liste kan aldrig være uenige.
  const seenMs = seenSinceMs();
  const sinceIso = new Date(seenMs).toISOString();                                    // handlinger: uset uanset alder
  // Reaktioner tæller kun for I DAG (samme grænse som listen), så prik og liste er enige.
  const reactIso = new Date(Math.max(seenMs, new Date().setHours(0, 0, 0, 0))).toISOString();
  const [mp, mc] = await Promise.all([
    sb.from("posts").select("id").eq("author", me.id),
    sb.from("comments").select("id").eq("author", me.id)
  ]);
  if(mp.error || mc.error) return false;
  const ids = (mp.data || []).map(function(p){ return p.id; });
  const cids = (mc.data || []).map(function(c){ return c.id; });
  const head = { count: "exact", head: true };
  // Overlap mellem probes er ligegyldigt — vi spørger kun "findes der NOGET uset?".
  const probes = [
    sb.from("friend_requests").select("*", head).eq("to_id", me.id).gt("created_at", sinceIso),
    sb.from("kreds_invites").select("*", head).eq("user_id", me.id).gt("created_at", sinceIso),
    // Kreds-opslag fra andre (RLS viser kun mine kredse) → prikken følger listen (kun i dag)
    sb.from("posts").select("*", head).not("feed_id", "is", null).neq("author", me.id).gt("created_at", reactIso)
  ];
  if(ids.length){
    probes.push(sb.from("likes").select("*", head).in("post_id", ids).neq("user_id", me.id).gt("created_at", reactIso));
    probes.push(sb.from("comments").select("*", head).in("post_id", ids).neq("author", me.id).gt("created_at", reactIso));
  }
  if(cids.length){
    probes.push(sb.from("comments").select("*", head).in("parent_id", cids).neq("author", me.id).gt("created_at", reactIso));
    probes.push(sb.from("comment_likes").select("*", head).in("comment_id", cids).neq("user_id", me.id).gt("created_at", reactIso));
  }
  const res = await Promise.all(probes);
  return res.some(function(r){ return !r.error && (r.count || 0) > 0; });
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
/* ÉN fælles definition af "set" — så prikken (hasUnseenNotifs) og listen (isUnread) ALDRIG
   er uenige. Intet gemt tidsstempel (akt-fanen aldrig åbnet på enheden) = alt er uset (0). */
function seenSinceMs(){
  const iso = readNotifSeen();
  return iso ? new Date(iso).getTime() : 0;
}
let notifTimer = null, notifSeq = 0;
export async function loadNotifs(){
  if(!me) return;
  loadAdmissionVotes(); // live-status for min egen optagelses-afstemning (øverst, egen boks)
  const seq = ++notifSeq; // sekvens-token: kun det nyeste kald må skrive resultatet
  el("notifs").innerHTML = '<div class="emptynote">'+t("common.loading")+'</div>';
  const seenMs = seenSinceMs();
  // Kun DAGENS notifikationer: reaktioner (likes/kommentarer/kreds-opslag) fra før i dag
  // midnat (enhedens lokale tid) vises ikke. Uafsluttede handlinger (invitationer/anmodninger)
  // beholdes uanset alder, så man altid kan besvare dem.
  const dayStartIso = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  function isUnread(at){ return new Date(at).getTime() > seenMs; }
  const H = '<svg viewBox="0 0 24 24"><path class="stroke" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
  const B = '<svg viewBox="0 0 24 24"><path class="stroke" d="M12 3.3a8.7 8.7 0 0 0-7.4 13.2L3.4 20.6l4.2-1.1A8.7 8.7 0 1 0 12 3.3Z"/></svg>';
  const P = '<svg viewBox="0 0 24 24"><g class="stroke"><circle cx="10" cy="8" r="3.4"/><path d="M3.8 19.5c.7-3.3 3.2-5 6.2-5s5.5 1.7 6.2 5"/><path d="M18.5 6.5v6M15.5 9.5h6"/></g></svg>';
  const K = '<svg viewBox="0 0 24 24"><g class="stroke"><circle cx="9" cy="9" r="3.1"/><path d="M3.6 19c.6-3 2.6-4.6 5.4-4.6s4.8 1.6 5.4 4.6"/><circle cx="17.2" cy="8" r="2.3"/><path d="M15.7 13.2c2.5.1 4.2 1.5 4.7 3.9"/></g></svg>';
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
  /* Ven-anmodning TIL mig (Accepter/Afvis) — handlingskrævende */
  function freqRow(n){
    const un = isUnread(n.at);
    return '<div class="notif freq'+(un ? " unread" : "")+'" data-freqf="'+esc(n.u)+'">'+
      (un ? '<span class="udot"></span>' : '')+
      avaHTML(n.u, 32)+
      '<div class="grow">'+
        '<div class="ntext"><b>'+esc(user(n.u).name)+'</b> '+t("notif.friend_request")+'. <span class="nt">'+esc(fmtTime(n.at))+'</span></div>'+
        '<div class="kbtns">'+
          '<button class="kbtn kfacc">'+t("notif.accept")+'</button>'+
          '<button class="kbtn kfdec">'+t("notif.decline")+'</button>'+
        '</div>'+
      '</div>'+
    '</div>';
  }
  try{
    // Mine opslag + mine kommentar-id'er (så svar PÅ mine kommentarer kan findes)
    const [mine, myCmts] = await Promise.all([
      sb.from("posts").select("id, text, image_path").eq("author", me.id),
      sb.from("comments").select("id").eq("author", me.id)
    ]);
    if(mine.error) throw mine.error;
    if(myCmts.error) throw myCmts.error;
    const ids = (mine.data || []).map(function(p){ return p.id; });
    const myCmtIds = (myCmts.data || []).map(function(c){ return c.id; });
    const textById = {};
    (mine.data || []).forEach(function(p){ textById[p.id] = p.text || (p.image_path ? t("notif.photo") : ""); });

    const reqs = [
      sb.from("friendships").select("created_at, from_profile:profiles!user_id(*)").eq("friend_id", me.id).gte("created_at", dayStartIso),
      sb.from("kreds_requests").select("created_at, feed_id, user_id, requester:profiles!user_id(*), feed:feeds!feed_id(name)").neq("user_id", me.id),
      sb.from("kreds_invites").select("created_at, feed_id, feed:feeds!feed_id(name), inviter:profiles!invited_by(*)").eq("user_id", me.id),
      sb.from("friend_requests").select("created_at, from_profile:profiles!from_id(*)").eq("to_id", me.id),
      // Kreds-opslag i mine kredse (ikke egne). RLS begrænser til synlige kredse.
      sb.from("posts").select("id, created_at, text, image_path, feed_id, author_profile:profiles!author(*), feed:feeds!feed_id(name)")
        .not("feed_id", "is", null).neq("author", me.id).gte("created_at", dayStartIso).order("created_at", { ascending:false }).limit(30)
    ];
    let iLikes = -1, iCmts = -1, iReplies = -1, iClikes = -1;
    if(ids.length){
      iLikes = reqs.push(sb.from("likes").select("created_at, post_id, liker:profiles!user_id(*)").in("post_id", ids).neq("user_id", me.id).gte("created_at", dayStartIso)) - 1;
      iCmts  = reqs.push(sb.from("comments").select("id, created_at, post_id, text, image_path, author_profile:profiles!author(*)").in("post_id", ids).neq("author", me.id).gte("created_at", dayStartIso)) - 1;
    }
    if(myCmtIds.length){
      iReplies = reqs.push(sb.from("comments").select("id, created_at, post_id, text, image_path, author_profile:profiles!author(*)").in("parent_id", myCmtIds).neq("author", me.id).gte("created_at", dayStartIso)) - 1;
      // Likes PÅ mine kommentarer (comment_likes → comment.post_id for at kunne åbne opslaget)
      iClikes = reqs.push(sb.from("comment_likes").select("created_at, comment:comments!comment_id(post_id), liker:profiles!user_id(*)").in("comment_id", myCmtIds).neq("user_id", me.id).gte("created_at", dayStartIso)) - 1;
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
    (res[3].data || []).forEach(function(r){
      if(r.from_profile){ registerProfile(r.from_profile); items.push({ type:"freq", u:r.from_profile.handle, at:r.created_at }); }
    });
    // Kreds-opslag: "postede i {kreds}" + selve teksten, klikbar → åbner opslaget
    (res[4].data || []).forEach(function(r){
      if(r.author_profile){
        registerProfile(r.author_profile);
        // Governance-afstemninger (server-tekst "Afstemning: Skal …") får deres egen tydelige type
        const isVote = typeof r.text === "string" && r.text.indexOf("Afstemning: Skal ") === 0;
        items.push({ type: isVote ? "kvote" : "kpost", u:r.author_profile.handle, at:r.created_at, pid:r.id,
                     k:(r.feed && r.feed.name) || "", snip: isVote ? "" : (r.text || (r.image_path ? t("notif.photo") : "")) });
      }
    });
    // Svar PÅ mine kommentarer først — så deres id'er kan udelukkes fra "kommentar på dit opslag"
    const replyIds = new Set();
    if(iReplies >= 0){
      (res[iReplies].data || []).forEach(function(r){
        if(r.author_profile){
          registerProfile(r.author_profile);
          replyIds.add(r.id);
          items.push({ type:"reply", u:r.author_profile.handle, at:r.created_at, pid:r.post_id, snip:r.text || (r.image_path ? t("notif.photo") : "") });
        }
      });
    }
    if(iLikes >= 0){
      (res[iLikes].data || []).forEach(function(r){
        if(r.liker){ registerProfile(r.liker); items.push({ type:"like", u:r.liker.handle, at:r.created_at, pid:r.post_id, snip:textById[r.post_id] || "" }); }
      });
    }
    if(iCmts >= 0){
      (res[iCmts].data || []).forEach(function(r){
        // Et svar på MIN kommentar (på mit eget opslag) vises som "svarede dig", ikke dobbelt
        if(r.author_profile && !replyIds.has(r.id)){
          registerProfile(r.author_profile);
          items.push({ type:"cmt", u:r.author_profile.handle, at:r.created_at, pid:r.post_id, snip:r.text || (r.image_path ? t("notif.photo") : "") });
        }
      });
    }
    if(iClikes >= 0){
      (res[iClikes].data || []).forEach(function(r){
        if(r.liker && r.comment){
          registerProfile(r.liker);
          items.push({ type:"clike", u:r.liker.handle, at:r.created_at, pid:r.comment.post_id });
        }
      });
    }
    items.sort(function(a,b){ return new Date(b.at) - new Date(a.at); });
    /* Invitationer/anmodninger er handlingskrævende — de må aldrig ryge ud af 30-loftet */
    const isAct = function(n){ return n.type === "inv" || n.type === "kreq" || n.type === "freq"; };
    const acts = items.filter(isAct);
    const rest = items.filter(function(n){ return !isAct(n); })
      .slice(0, Math.max(0, 30 - acts.length));
    const top = acts.concat(rest);
    if(seq !== notifSeq) return; // et nyere kald er i gang — lad det vinde
    el("notifs").innerHTML = top.length
      ? top.map(function(n){
          if(n.type === "like")   return row(H, "heart",  n.u, t("notif.liked"), n.snip, fmtTime(n.at), ' data-pid="'+esc(n.pid)+'" data-type="like"', isUnread(n.at));
          if(n.type === "clike")  return row(H, "heart",  n.u, t("notif.liked_comment"), "", fmtTime(n.at), ' data-pid="'+esc(n.pid)+'" data-type="cmt"', isUnread(n.at));
          if(n.type === "reply")  return row(B, "bubble", n.u, t("notif.replied"),   n.snip, fmtTime(n.at), ' data-pid="'+esc(n.pid)+'" data-type="cmt"', isUnread(n.at));
          if(n.type === "cmt")    return row(B, "bubble", n.u, t("notif.commented"),  n.snip, fmtTime(n.at), ' data-pid="'+esc(n.pid)+'" data-type="cmt"', isUnread(n.at));
          if(n.type === "kvote")  return row(K, "kvote",  n.u, t("notif.vote_kreds", { k: esc(n.k) }), "", fmtTime(n.at), ' data-pid="'+esc(n.pid)+'" data-type="post"', isUnread(n.at));
          if(n.type === "kpost")  return row(K, "kpost",  n.u, t("notif.posted_kreds", { k: esc(n.k) }), n.snip, fmtTime(n.at), ' data-pid="'+esc(n.pid)+'" data-type="post"', isUnread(n.at));
          if(n.type === "kreq")   return kreqRow(n);
          if(n.type === "inv")    return invRow(n);
          if(n.type === "freq")   return freqRow(n);
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
    loadAdmissionVotes(); // vis live-afstemnings-kortet med det samme (uden at forlade fanen)
  }
}

/* ---- Accepter/afvis ven-anmodning ---- */
async function handleFriendReq(row, accept){
  const h = row.dataset.freqf;
  row.querySelectorAll(".kbtn").forEach(function(x){ x.disabled = true; });
  const { error } = await sb.rpc(accept ? "accept_friend_request" : "decline_friend_request", { from_handle: h });
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
  if(accept){
    toast(t("friend.added", { name: user(h).name }));
    scheduleRefetch(); // venner + feed (den nye vens opslag) opdateres straks
  } else {
    toast(t("friend.req_declined"));
  }
}

/* ---- Godkend/afvis kreds-anmodning (kun ejeren ser knapperne) ---- */
async function notifClick(e){
  const fq = e.target.closest(".kfacc, .kfdec");
  if(fq){
    if(fq.disabled || !me) return;
    const frow = fq.closest(".notif");
    if(!frow || !frow.dataset.freqf) return;
    handleFriendReq(frow, fq.classList.contains("kfacc"));
    return;
  }
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
