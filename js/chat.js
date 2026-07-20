import { sb } from "./config.js";
import { me, state, ID2H } from "./store.js";
import { el, esc, avaHTML, user, toast, fmtTime, imgUrl, registerProfile } from "./helpers.js";
import { t } from "./i18n.js";
import { feedById, findPost, postQuery, mapPost, switchTab, loadFeeds } from "./feed.js";
import { openPostView, openProfile, closeProfile } from "./profile.js";

/* ================= Kreds-chat (Messenger-agtig: hver kreds er en gruppetråd) =================
   Beskeder-fanen (#view-chat) viser en tråd pr. kreds med seneste besked som preview.
   En tråd (#chatview) glider ind fra højre som de andre sider: bobler (egne højre/røde,
   andres venstre m. avatar+navn), composer i bunden. Når et minde postes i en kreds,
   indsætter DB-triggeren automatisk en delings-besked (post_id) — den vises med en
   miniature af billedet og åbner opslaget ved tap. Realtime-INSERTs appendes live. */

const MSG_SELECT = "*, author_profile:profiles!author(*), post:posts(id, image_path, video_path)";

let chatFeed = null;   // åben tråds feed_id (null = lukket)
let msgs = [];         // den åbne tråds beskeder (ældste først)
let lastByFeed = {};   // feed_id -> seneste besked (listens previews)
let chatSeq = 0;       // supersession: kun nyeste åbning må skrive tråden
let reads = {};        // åben tråd: user_id -> last_read_at (set-kvitteringer)
let readsOk = false;   // false = kreds_chat_reads utilgængelig → kvitteringer skjules
let unreadAtId = null; // beskeden "Ulæste beskeder"-linjen står FØR (fryses ved åbning)
let myReadSent = 0;    // seneste last_read_at jeg selv har skrevet (ms) — mod dubletter
let myReads = {};      // feed_id -> mit læse-mærke (ms) på tværs af tråde (ulæst-prikker)
let myReadsOk = false; // om myReads er hentet — ellers vises ingen ulæst-prikker
let pendingShare = null; // { feed, post }: minde der sendes med som kontekst på næste besked

function mapMsg(r){
  if(r.author_profile) registerProfile(r.author_profile);
  const post = r.post || null;
  return {
    id: r.id,
    feed: r.feed_id,
    u: r.author_profile ? r.author_profile.handle : (ID2H[r.author] || "?"),
    authorId: r.author,
    text: r.text || "",
    postId: r.post_id || null,
    thumb: post && post.image_path ? imgUrl(post.image_path) : "",
    thumbVideo: post && !post.image_path && post.video_path ? imgUrl(post.video_path) : "",
    t: fmtTime(r.created_at),
    created: r.created_at
  };
}

/* Alle tråde = rigtige kredse + DM-tråde (kun Beskeder kender DM'erne) */
function allThreads(){ return state.feeds.concat(state.dms || []); }
function threadById(id){
  return feedById(id) || (state.dms || []).find(function(d){ return d.id === id; }) || null;
}
/* En DM-tråd hedder det den anden hedder */
function threadName(f){
  if(!f.isDm) return f.name;
  const other = f.members.filter(function(h){ return !me || h !== me.handle; })[0];
  return other ? (user(other).name || other) : f.name;
}

/* ---- Beskeder-fanen: én række pr. tråd, nyeste aktivitet øverst ---- */
export async function renderChatList(fetchLasts){
  if(!me) return;
  const box = el("chat-list");
  if(!allThreads().length){
    box.innerHTML = '<div class="emptynote">'+t("chat.empty")+'</div>';
    return;
  }
  if(fetchLasts !== false){
    // Seneste beskeder på tværs (RLS = kun mine tråde; første række pr. tråd er nyeste)
    // + mine egne læse-mærker, som driver ulæst-prikkerne
    const [mres, rres] = await Promise.all([
      sb.from("kreds_messages")
        .select(MSG_SELECT)
        .order("created_at", { ascending: false })
        .limit(120),
      sb.from("kreds_chat_reads").select("feed_id, last_read_at").eq("user_id", me.id)
    ]);
    if(mres.error){ console.error(mres.error); }
    else {
      lastByFeed = {};
      (mres.data || []).forEach(function(r){ if(!lastByFeed[r.feed_id]) lastByFeed[r.feed_id] = mapMsg(r); });
    }
    if(!rres.error){
      myReadsOk = true;
      myReads = {};
      (rres.data || []).forEach(function(r){ myReads[r.feed_id] = new Date(r.last_read_at).getTime(); });
    }
  }
  const feeds = allThreads().slice().sort(function(a, b){
    const ta = lastByFeed[a.id] ? new Date(lastByFeed[a.id].created).getTime() : 0;
    const tb = lastByFeed[b.id] ? new Date(lastByFeed[b.id].created).getTime() : 0;
    if(ta !== tb) return tb - ta;
    return new Date(a.created) - new Date(b.created);
  });
  box.innerHTML = feeds.map(chatRowHTML).join("");
}
/* Kredsens "ansigt" (Messenger-agtigt): én andens avatar, eller to stablede for grupper */
function chatAvaHTML(f, size){
  const others = f.members.filter(function(h){ return !me || h !== me.handle; });
  if(others.length === 0) return '<span class="chatava">'+avaHTML(me ? me.handle : "?", size)+'</span>';
  if(others.length === 1) return '<span class="chatava">'+avaHTML(others[0], size)+'</span>';
  const s2 = Math.round(size * 0.72);
  return '<span class="chatava chatava2" style="width:'+size+'px;height:'+size+'px">'+
    avaHTML(others[0], s2)+avaHTML(others[1], s2)+'</span>';
}
function chatRowHTML(f){
  const m = lastByFeed[f.id];
  let sub = t("chat.say_hi");
  if(m){
    const who = (me && m.authorId === me.id) ? t("chat.you") : (user(m.u).name || m.u).split(/\s+/)[0];
    sub = esc(who) + ": " + (m.postId ? "📷 " + t("chat.shared_memory") : esc(m.text)) + " · " + esc(m.t);
  }
  // Ulæst: nyeste besked er fra en anden og nyere end mit læse-mærke → fed + rød prik
  const unread = !!(m && myReadsOk && me && m.authorId !== me.id &&
                    new Date(m.created).getTime() > (myReads[f.id] || 0));
  return '<button class="chatrow'+(unread ? " unread" : "")+'" data-feed="'+esc(f.id)+'">'+
    chatAvaHTML(f, 52)+
    '<span class="lcol">'+
      '<span class="lnm">'+esc(threadName(f))+'</span>'+
      '<span class="lh">'+sub+'</span>'+
    '</span>'+
    (unread ? '<span class="cv-udot"></span>' : '')+
  '</button>';
}

/* ---- Én tråd (fuldskærms-siden #chatview) ---- */
export async function openKredsChat(feedId){
  const f = threadById(feedId);
  if(!f || !me){ toast(t("err.generic")); return; }
  if(pendingShare && pendingShare.feed !== feedId) pendingShare = null; // kontekst følger sin tråd
  chatFeed = feedId;
  el("cv-ava").innerHTML = chatAvaHTML(f, 36);
  el("cv-title").textContent = threadName(f);
  el("cv-sub").textContent = f.isDm
    ? "@" + (f.members.filter(function(h){ return h !== me.handle; })[0] || "")
    : (f.members.length === 1 ? t("list.member_one") : t("list.member_count", { n: f.members.length }));
  renderCtxBar();
  el("cv-body").innerHTML = '<div class="emptynote">'+t("common.loading")+'</div>';
  el("chatview").classList.add("on");
  const seq = ++chatSeq;
  // Beskeder + set-kvitteringer hentes parallelt. Kvitteringerne er fail-soft: findes
  // tabellen ikke endnu (migrationen kreds_chat_reads), vises tråden bare uden dem.
  const [mres, rr] = await Promise.all([
    sb.from("kreds_messages")
      .select(MSG_SELECT)
      .eq("feed_id", feedId)
      .order("created_at", { ascending: true })
      .limit(300),
    sb.from("kreds_chat_reads").select("user_id, last_read_at").eq("feed_id", feedId)
  ]);
  if(chatFeed !== feedId || seq !== chatSeq) return; // lukket/skiftet imens
  if(mres.error){
    console.error(mres.error);
    el("cv-body").innerHTML = '<div class="emptynote">'+t("err.generic")+'</div>';
    return;
  }
  msgs = (mres.data || []).map(mapMsg);
  reads = {}; readsOk = false; unreadAtId = null; myReadSent = 0;
  if(!rr.error){
    readsOk = true;
    (rr.data || []).forEach(function(r){ reads[r.user_id] = r.last_read_at; });
    myReadSent = reads[me.id] ? new Date(reads[me.id]).getTime() : 0;
    // "Ulæste beskeder"-linjen fryses ved åbning: første besked fra andre efter mit mærke
    const firstUnread = msgs.find(function(m){
      return m.authorId !== me.id && new Date(m.created).getTime() > myReadSent;
    });
    unreadAtId = firstUnread ? firstUnread.id : null;
  }
  renderThread(true);
  markThreadRead();
}

/* Svar-konteksten over composeren: hvilket minde svarer beskeden på? Vises så snart
   tråden er åbnet via et kommentar-ikon, og kan fjernes med krydset (så sendes beskeden
   uden vedhæftet minde). */
function renderCtxBar(){
  const box = el("cv-ctx");
  const p = (pendingShare && chatFeed === pendingShare.feed) ? findPost(pendingShare.post) : null;
  if(!p){ box.hidden = true; box.innerHTML = ""; return; }
  const thumb = p.img
    ? '<img class="cv-ctxthumb" src="'+esc(p.img.src)+'" alt="">'
    : p.video
    ? '<video class="cv-ctxthumb" src="'+esc(p.video.src)+'#t=0.1" muted playsinline preload="metadata"></video>'
    : '';
  box.innerHTML = thumb+
    '<span class="cv-ctxtxt">'+t("chat.replying", { n: esc(user(p.u).name || p.u) })+'</span>'+
    '<button class="cv-ctxx" aria-label="'+t("chat.ctx_close")+'">'+
      '<svg viewBox="0 0 24 24"><path class="stroke" d="M6 6l12 12M18 6 6 18"/></svg>'+
    '</button>';
  box.hidden = false;
}

/* Kommentar på et KREDS-minde fra feedet: åbn kredsens tråd med mindet som synlig
   kontekst på svaret */
export function openThreadWithPost(feedId, postId){
  pendingShare = { feed: feedId, post: postId };
  openKredsChat(feedId);
}

/* Hele kredsen-minde → tråden med forfatteren: en eksisterende tråd med præcis jer to
   (rigtig 2-personers kreds ELLER DM), ellers oprettes en kreds-løs DM-tråd via
   get_or_create_dm. Mindet sendes med som kontekst på det FØRSTE svar (pendingShare →
   post_id på beskeden), som når man svarer på en story i Messenger. */
export async function openDmWith(otherId, postId){
  if(!me || !otherId){ toast(t("err.generic")); return; }
  const f = allThreads().find(function(x){
    return x.memberIds.length === 2 &&
           x.memberIds.indexOf(me.id) >= 0 && x.memberIds.indexOf(otherId) >= 0;
  });
  let fid = f ? f.id : null;
  if(!fid){
    const r = await sb.rpc("get_or_create_dm", { other: otherId });
    if(r.error || !r.data){ console.error(r.error); toast(t("err.generic")); return; }
    fid = r.data;
    if(!threadById(fid)) await loadFeeds(); // ny tråd → ind i state.dms
  }
  pendingShare = postId != null ? { feed: fid, post: postId } : null;
  openKredsChat(fid);
}

/* Min egen kvittering: læst til og med tråden(s) nyeste besked. Ankres til beskedens
   server-tid (ikke klient-uret), skrives kun fremad og kun mens tråden faktisk er
   synlig — en tråd åben i baggrunden markerer ikke noget som læst. */
function markThreadRead(){
  if(!me || chatFeed == null || !readsOk || document.hidden) return;
  if(!el("chatview").classList.contains("on")) return;
  const real = msgs.filter(function(m){ return String(m.id).indexOf("tmp-") !== 0; });
  if(!real.length) return;
  const newest = real[real.length - 1].created;
  const ts = new Date(newest).getTime();
  if(ts <= myReadSent) return;
  myReadSent = ts;
  reads[me.id] = newest;
  myReads[chatFeed] = ts; // ulæst-prikken i listen slukker med det samme
  if(el("view-chat").classList.contains("active")) renderChatList(false);
  sb.from("kreds_chat_reads")
    .upsert({ feed_id: chatFeed, user_id: me.id, last_read_at: newest })
    .then(function(r){ if(r.error) console.error(r.error); }, function(){});
}
export function closeKredsChat(){
  chatFeed = null;
  pendingShare = null;
  renderCtxBar();
  el("cv-input").blur();
  unpinChat();
  el("chatview").classList.remove("on");
  el("cv-body").innerHTML = "";
}

/* ---- iOS-tastaturet: pin tråden til den synlige viewport (Messenger-adfærd) ----
   WKWebView/Safari ændrer ikke sidens layout når tastaturet åbner — den panorerer bare
   den visuelle viewport, så en absolut fuldskærms-side ender med kun composeren synlig
   over tastaturet. Mens tråden er åben følger #chatview derfor window.visualViewport
   (top + højde): headeren bliver stående, composeren klæber lige over tastaturet, og
   beskederne holder sig i bunden. Ved tastatur-ned/luk fjernes inline-målene igen. */
let kbRaf = 0, kbOpen = false;
function fitChatToViewport(){
  kbRaf = 0;
  const vv = window.visualViewport;
  const cv = el("chatview");
  const open = vv && cv.classList.contains("on") &&
               document.documentElement.clientHeight - vv.height > 60;
  if(!open){ if(kbOpen) unpinChat(); return; }
  // iOS kan scrolle selv overflow:hidden-containere for at vise det fokuserede felt —
  // nulstil .phone, ellers forskydes hele appen bag den pinnede tråd
  if(cv.parentElement && cv.parentElement.scrollTop) cv.parentElement.scrollTop = 0;
  // vv.pageTop = den synlige viewports topkant i dokumentet; .phone starter ved y=0,
  // så tallet kan bruges direkte som top i #chatview's absolutte koordinater
  cv.style.top = vv.pageTop + "px";
  cv.style.height = vv.height + "px";
  cv.style.bottom = "auto";
  cv.classList.add("kb");
  const body = el("cv-body");
  const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80;
  if(!kbOpen || nearBottom) body.scrollTop = body.scrollHeight;
  kbOpen = true;
}
function unpinChat(){
  kbOpen = false;
  const cv = el("chatview");
  cv.style.top = cv.style.height = cv.style.bottom = "";
  cv.classList.remove("kb");
  if(cv.parentElement && cv.parentElement.scrollTop) cv.parentElement.scrollTop = 0;
  window.scrollTo(0, 0); // ryd evt. rest-panorering fra tastaturet
}
function queueFit(){ if(!kbRaf) kbRaf = requestAnimationFrame(fitChatToViewport); }
export function resetChat(){
  closeKredsChat();
  msgs = [];
  lastByFeed = {};
  reads = {}; readsOk = false; unreadAtId = null; myReadSent = 0;
  myReads = {}; myReadsOk = false; pendingShare = null;
  el("chat-list").innerHTML = "";
  el("cv-input").value = "";
}

function renderThread(scrollBottom){
  const box = el("cv-body");
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const prevTop = box.scrollTop;
  const seenBy = readReceipts();
  // Læst/Ikke læst med småt under MIN sidste besked, når den er trådens nyeste
  // (læst = mindst ét andet medlem har sit læse-mærke ved eller efter den)
  let status = null;
  if(readsOk && me && msgs.length){
    const lastM = msgs[msgs.length - 1];
    if(lastM.authorId === me.id && String(lastM.id).indexOf("tmp-") !== 0){
      const ts = new Date(lastM.created).getTime();
      const seen = Object.keys(reads).some(function(uid){
        return uid !== me.id && new Date(reads[uid]).getTime() >= ts;
      });
      status = { id: lastM.id, seen: seen };
    }
  }
  // Messenger-agtig gruppering: beskeder i træk fra samme afsender klumpes — navn kun
  // øverst i gruppen, avatar og tid kun ved gruppens sidste boble. "Ulæste beskeder"-
  // linjen bryder en gruppe, så boblen efter linjen får navn/avatar igen.
  box.innerHTML = msgs.length
    ? msgs.map(function(m, i){
        const first = i === 0 || msgs[i - 1].authorId !== m.authorId || m.id === unreadAtId;
        const last = i === msgs.length - 1 || msgs[i + 1].authorId !== m.authorId ||
                     msgs[i + 1].id === unreadAtId;
        return (m.id === unreadAtId ? '<div class="cv-unread">'+t("chat.unread")+'</div>' : '')+
               msgHTML(m, first, last)+
               (seenBy[m.id] ? readsHTML(seenBy[m.id]) : '')+
               (status && status.id === m.id
                 ? '<span class="cv-status">'+t(status.seen ? "chat.read" : "chat.notread")+'</span>'
                 : '');
      }).join("")
    : '<div class="emptynote">'+t("chat.no_messages")+'</div>';
  box.scrollTop = (scrollBottom || nearBottom) ? box.scrollHeight : prevTop;
}
/* Set-kvitteringer: for hvert andet medlem findes den sidste besked (id) de har læst.
   Er ankeret medlemmets egen besked, vises ingen kvittering (som Messenger: at man
   selv har sendt den siger det hele). */
function readReceipts(){
  const out = {}; // besked-id -> [handles]
  if(!readsOk || !msgs.length) return out;
  Object.keys(reads).forEach(function(uid){
    if(me && uid === me.id) return;
    const h = ID2H[uid];
    if(!h) return; // ukendt/blokeret profil → ingen kvittering
    const ts = new Date(reads[uid]).getTime();
    let mk = null;
    for(let i = msgs.length - 1; i >= 0; i--){
      if(new Date(msgs[i].created).getTime() <= ts){ mk = msgs[i]; break; }
    }
    if(!mk || mk.authorId === uid) return;
    (out[mk.id] = out[mk.id] || []).push(h);
  });
  return out;
}
function readsHTML(handles){
  return '<div class="cv-reads">'+handles.map(function(h){
    return '<span class="cv-read" title="'+esc(user(h).name || h)+'">'+avaHTML(h, 16)+'</span>';
  }).join("")+'</div>';
}
function msgHTML(m, first, last){
  const mine = !!(me && m.authorId === me.id);
  const share = m.postId
    ? '<button class="cv-share" data-post="'+esc(m.postId)+'">'+
        (m.thumb ? '<img class="cv-thumb" src="'+esc(m.thumb)+'" alt="">'
         : m.thumbVideo ? '<video class="cv-thumb" src="'+esc(m.thumbVideo)+'#t=0.1" muted playsinline preload="metadata"></video>'
         : '')+
        '<span class="cv-sharetxt">'+t("chat.shared_memory")+'</span>'+
      '</button>'
    : '';
  const avaCell = mine ? ''
    : (last
        ? '<button class="pavab cv-ava" data-u="'+esc(m.u)+'" aria-label="'+t("aria.profile")+'">'+avaHTML(m.u, 28)+'</button>'
        : '<span class="cv-avasp"></span>');
  return '<div class="cv-msg'+(mine ? " mine" : "")+(first ? " first" : "")+'" data-mid="'+esc(m.id)+'">'+
    avaCell+
    '<div class="cv-col">'+
      (!mine && first ? '<span class="cv-nm">'+esc(user(m.u).name)+'</span>' : '')+
      '<div class="cv-bubble">'+share+(m.text ? '<span class="cv-text">'+esc(m.text)+'</span>' : '')+'</div>'+
      (last ? '<span class="cv-time">'+esc(m.t)+'</span>' : '')+
    '</div>'+
  '</div>';
}

async function sendChatMsg(){
  if(!me || chatFeed == null) return;
  const inp = el("cv-input");
  const text = inp.value.trim();
  if(!text) return;
  inp.value = "";
  const feedId = chatFeed;
  // Svar på et minde: første besked i tråden bærer mindet som kontekst (post_id)
  const share = (pendingShare && pendingShare.feed === feedId) ? pendingShare : null;
  const sp = share ? findPost(share.post) : null;
  // Optimistisk: vis beskeden med det samme, byt til den rigtige række fra serveren
  const temp = { id: "tmp-" + Date.now(), feed: feedId, u: me.handle, authorId: me.id,
                 text: text, postId: share ? share.post : null,
                 thumb: sp && sp.img ? sp.img.src : "",
                 thumbVideo: sp && !sp.img && sp.video ? sp.video.src : "",
                 t: fmtTime(new Date().toISOString()), created: new Date().toISOString() };
  msgs.push(temp);
  renderThread(true);
  const { data, error } = await sb.from("kreds_messages")
    .insert({ feed_id: feedId, author: me.id, text: text,
              post_id: share ? Number(share.post) : null })
    .select(MSG_SELECT)
    .single();
  if(chatFeed !== feedId) return; // tråden blev lukket/skiftet imens
  msgs = msgs.filter(function(x){ return x.id !== temp.id; });
  if(error){
    console.error(error);
    renderThread(false);
    inp.value = text; // giv teksten tilbage, så intet mistes
    toast(t("err.generic"));
    return;
  }
  const real = mapMsg(data);
  if(share && pendingShare === share){ pendingShare = null; renderCtxBar(); } // konteksten er afleveret
  if(!msgs.some(function(x){ return x.id === real.id; })) msgs.push(real);
  lastByFeed[feedId] = real;
  renderThread(true);
  markThreadRead();
}

/* Delings-besked → åbn selve opslaget (hent det hvis det ikke er i de lokale arrays) */
async function openSharedPost(pid){
  let p = findPost(pid);
  if(!p){
    const { data, error } = await postQuery().eq("id", Number(pid));
    if(error || !data || !data.length){ toast(t("notif.post_gone")); return; }
    p = mapPost(data[0]);
  }
  openPostView(p); // minde-siden (z-90) lægger sig OVER chatten (z-85)
}

/* Realtime-INSERT: hent den fulde række (payload har ingen joins; RLS afgør synlighed) */
export function chatRealtime(payload){
  if(!me || !payload || payload.eventType !== "INSERT") return;
  const row = payload.new;
  if(!row || !row.id) return;
  sb.from("kreds_messages").select(MSG_SELECT).eq("id", row.id).maybeSingle().then(function(r){
    if(r.error || !r.data) return;
    const m = mapMsg(r.data);
    lastByFeed[m.feed] = m;
    const proceed = function(){
      if(el("view-chat").classList.contains("active")) renderChatList(false);
      if(chatFeed === m.feed && el("chatview").classList.contains("on")){
        if(!msgs.some(function(x){ return x.id === m.id; })){
          msgs.push(m);
          renderThread(true);
          markThreadRead(); // tråden er åben og synlig → den nye besked er læst
        }
      }
    };
    // Besked i en tråd vi ikke kender endnu (fx en NY DM-tråd startet af den anden,
    // eller en auto-deling fra et hele kredsen-minde) → hent trådene først
    if(!threadById(m.feed)) loadFeeds().then(proceed, proceed);
    else proceed();
  }, function(){});
}

/* Realtime på kvitteringer (egen kanal i realtime.js): flyt avatarerne live i en åben tråd */
export function chatReadsRealtime(payload){
  if(!me || !payload) return;
  const row = payload.new;
  if(!row || !row.feed_id || !row.user_id || !row.last_read_at) return;
  const ts = new Date(row.last_read_at).getTime();
  if(row.user_id === me.id){
    // Mit eget mærke (fx fra en anden enhed) → slukker også ulæst-prikken i listen
    if(ts > (myReads[row.feed_id] || 0)){
      myReads[row.feed_id] = ts;
      if(el("view-chat").classList.contains("active")) renderChatList(false);
    }
  }
  if(chatFeed !== row.feed_id || !el("chatview").classList.contains("on")) return;
  readsOk = true; // tabellen svarer — kvitteringer kan vises
  const prev = reads[row.user_id] ? new Date(reads[row.user_id]).getTime() : 0;
  if(ts <= prev) return;
  reads[row.user_id] = row.last_read_at;
  if(row.user_id === me.id){ if(ts > myReadSent) myReadSent = ts; return; }
  renderThread(false);
}

export function initChat(){
  // Tastaturet ind/ud + iOS' panorering af den visuelle viewport → genplacér tråden
  if(window.visualViewport){
    window.visualViewport.addEventListener("resize", queueFit);
    window.visualViewport.addEventListener("scroll", queueFit);
  }
  // Tilbage i forgrunden med en åben tråd → det sete er nu læst
  document.addEventListener("visibilitychange", function(){
    if(!document.hidden) markThreadRead();
  });
  el("cv-back").addEventListener("click", closeKredsChat);
  el("cv-ctx").addEventListener("click", function(e){
    // Krydset fjerner svar-konteksten — beskeden sendes så uden vedhæftet minde
    if(e.target.closest(".cv-ctxx")){ pendingShare = null; renderCtxBar(); }
  });
  el("cv-send").addEventListener("click", sendChatMsg);
  el("cv-input").addEventListener("keydown", function(e){
    if(e.key === "Enter" && !e.isComposing) sendChatMsg();
  });
  el("chat-list").addEventListener("click", function(e){
    const r = e.target.closest(".chatrow");
    if(r) openKredsChat(r.dataset.feed);
  });
  el("cv-body").addEventListener("click", function(e){
    const sh = e.target.closest(".cv-share");
    if(sh){ openSharedPost(sh.dataset.post); return; }
    const av = e.target.closest(".pavab");
    if(av && av.dataset.u){
      // Profilen (z-70) ligger UNDER chatten (z-85) — luk tråden først
      closeKredsChat();
      if(me && av.dataset.u === me.handle){ closeProfile(); switchTab("profil"); }
      else openProfile(av.dataset.u);
    }
  });
}
