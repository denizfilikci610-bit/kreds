import { sb } from "./config.js";
import { me, state, ID2H } from "./store.js";
import { el, esc, avaHTML, user, toast, fmtTime, imgUrl, registerProfile } from "./helpers.js";
import { t } from "./i18n.js";
import { feedById, findPost, postQuery, mapPost, switchTab, loadFeeds } from "./feed.js";
import { openPostView, openProfile, closeProfile, doBlockUser } from "./profile.js";
import { openMemberSheet } from "./kredse.js";
import { openMemoryFor } from "./compose.js";

/* ================= Kreds-chat (Messenger-agtig: hver kreds er en gruppetråd) =================
   Beskeder-fanen (#view-chat) viser en tråd pr. kreds med seneste besked som preview.
   En tråd (#chatview) glider ind fra højre som de andre sider: bobler (egne højre/røde,
   andres venstre m. avatar+navn), composer i bunden. Når et minde postes i en kreds,
   indsætter DB-triggeren automatisk en delings-besked (post_id) — den vises med en
   miniature af billedet og åbner opslaget ved tap. Realtime-INSERTs appendes live. */

/* OBS: citatet (reply_to) indlejres BEVIDST IKKE — PostgREST's selv-reference-embed
   opløses upålideligt (gav tomme/omvendte citater). Citatet slås op LOKALT i den
   indlæste tråd ved rendering i stedet: altid friskt, og en slettet kilde forsvinder
   af sig selv. */
const MSG_SELECT = "*, author_profile:profiles!author(*), post:posts(id, image_path, video_path), " +
  "reactions:kreds_message_reactions(user_id, emoji)";

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
let pendingReply = null; // { id, u, text, media }: besked der citeres i næste besked
let editingMsg = null;   // besked-id under redigering (composeren sender da en UPDATE)
let prefs = {};          // feed_id -> { pinned, muted, markedUnread, clearedAt } (kun MINE)
let searchQ = "";        // aktiv søgning i Beskeder-listen
let searchTimer = 0;

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
    mimg: r.image_path ? imgUrl(r.image_path) : "",       // beskedens EGET billede
    mimgPath: r.image_path || null,                        // rå sti (storage-oprydning)
    mvideo: r.video_path ? imgUrl(r.video_path) : "",
    edited: !!r.edited_at,
    replyToId: r.reply_to != null ? r.reply_to : null,
    reacts: r.reactions || [],                             // [{user_id, emoji}]
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

function mapPref(r){
  return { pinned: !!r.pinned, muted: !!r.muted, markedUnread: !!r.marked_unread,
           clearedAt: r.cleared_at || null };
}
/* Skriv en tråd-præference (fastgør/mute/ulæst/ryd) — optimistisk + upsert */
function setPref(feedId, patch){
  const next = Object.assign({}, prefs[feedId] || {}, patch);
  prefs[feedId] = next;
  sb.from("kreds_chat_prefs").upsert({
    feed_id: feedId, user_id: me.id,
    pinned: !!next.pinned, muted: !!next.muted,
    marked_unread: !!next.markedUnread, cleared_at: next.clearedAt || null
  }).then(function(r){ if(r.error) console.error(r.error); }, function(){});
}
/* Trådens synlige "seneste besked" — ryddet historik (cleared_at) tæller ikke */
function lastVisible(f){
  const m = lastByFeed[f.id];
  const pf = prefs[f.id] || {};
  if(m && pf.clearedAt && new Date(m.created).getTime() <= new Date(pf.clearedAt).getTime()) return null;
  return m || null;
}

/* ---- Beskeder-fanen: én række pr. tråd, fastgjorte øverst, så nyeste aktivitet ---- */
export async function renderChatList(fetchLasts){
  if(!me) return;
  const box = el("chat-list");
  if(!allThreads().length){
    box.innerHTML = '<div class="emptynote">'+t("chat.empty")+'</div>';
    return;
  }
  if(fetchLasts !== false){
    // Seneste beskeder på tværs (RLS = kun mine tråde; første række pr. tråd er nyeste)
    // + mine læse-mærker (ulæst-prikker) + mine tråd-præferencer (pin/mute/ryd)
    const [mres, rres, pres] = await Promise.all([
      sb.from("kreds_messages")
        .select(MSG_SELECT)
        .order("created_at", { ascending: false })
        .limit(120),
      sb.from("kreds_chat_reads").select("feed_id, last_read_at").eq("user_id", me.id),
      sb.from("kreds_chat_prefs").select("*").eq("user_id", me.id)
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
    if(!pres.error){
      prefs = {};
      (pres.data || []).forEach(function(r){ prefs[r.feed_id] = mapPref(r); });
    }
  }
  if(searchQ) return; // en aktiv søgning ejer listen
  const feeds = allThreads().filter(function(f){
    // En DM-tråd vises kun med indhold: tom eller ryddet ("Slet chatten") = ude af
    // listen, indtil en ny besked lander. Kredse vises altid (tråden ER kredsen).
    return !f.isDm || !!lastVisible(f);
  }).sort(function(a, b){
    const pa = (prefs[a.id] || {}).pinned ? 1 : 0, pb = (prefs[b.id] || {}).pinned ? 1 : 0;
    if(pa !== pb) return pb - pa; // fastgjorte øverst
    const ma = lastVisible(a), mb = lastVisible(b);
    const ta = ma ? new Date(ma.created).getTime() : 0;
    const tb = mb ? new Date(mb.created).getTime() : 0;
    if(ta !== tb) return tb - ta;
    return new Date(a.created) - new Date(b.created);
  });
  box.innerHTML = feeds.map(chatRowHTML).join("");
}
/* Kredsens "ansigt" (Messenger-agtigt): én andens avatar, eller to stablede for grupper.
   Private tråde (DM) får en lille lås på avataren, så man altid kan SE at tråden er
   låst til jer to og aldrig kan få flere medlemmer. */
const LOCK_SVG = '<svg viewBox="0 0 24 24"><g class="stroke"><rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7"/></g></svg>';
function chatAvaHTML(f, size){
  const lock = f.isDm ? '<span class="chatlock" aria-hidden="true">'+LOCK_SVG+'</span>' : '';
  const others = f.members.filter(function(h){ return !me || h !== me.handle; });
  if(others.length === 0) return '<span class="chatava">'+avaHTML(me ? me.handle : "?", size)+lock+'</span>';
  if(others.length === 1) return '<span class="chatava">'+avaHTML(others[0], size)+lock+'</span>';
  const s2 = Math.round(size * 0.72);
  return '<span class="chatava chatava2" style="width:'+size+'px;height:'+size+'px">'+
    avaHTML(others[0], s2)+avaHTML(others[1], s2)+'</span>';
}
const PIN_SVG = '<svg viewBox="0 0 24 24"><g class="stroke"><path d="M14.2 3.6 20.4 9.8M15.5 4.9 9.9 8.1 5.6 9.6l8.8 8.8 1.5-4.3 3.2-5.6"/><path d="M9.9 14.1 3.6 20.4"/></g></svg>';
const MUTE_SVG = '<svg viewBox="0 0 24 24"><g class="stroke"><path d="M18 13.5V10a6 6 0 0 0-9.6-4.8M6 10v3.5L4 17h13.5M10 20a2.4 2.4 0 0 0 4 0"/><path d="M4 4l16 16"/></g></svg>';
function chatRowHTML(f){
  const pf = prefs[f.id] || {};
  const m = lastVisible(f);
  let sub = t("chat.say_hi");
  if(m){
    const who = (me && m.authorId === me.id) ? t("chat.you") : (user(m.u).name || m.u).split(/\s+/)[0];
    const what = m.postId ? "📷 " + t("chat.shared_memory") : (m.text ? esc(m.text) : "📷");
    sub = esc(who) + ": " + what + " · " + esc(m.t);
  }
  // Ulæst: nyeste besked er fra en anden og nyere end mit læse-mærke, eller tråden er
  // markeret som ulæst manuelt → fed + rød prik
  const unread = !!pf.markedUnread || !!(m && myReadsOk && me && m.authorId !== me.id &&
                    new Date(m.created).getTime() > (myReads[f.id] || 0));
  return '<button class="chatrow'+(unread ? " unread" : "")+'" data-feed="'+esc(f.id)+'">'+
    chatAvaHTML(f, 52)+
    '<span class="lcol">'+
      '<span class="lnm">'+esc(threadName(f))+'</span>'+
      '<span class="lh">'+sub+'</span>'+
    '</span>'+
    (pf.muted ? '<span class="cv-flag">'+MUTE_SVG+'</span>' : '')+
    (pf.pinned ? '<span class="cv-flag">'+PIN_SVG+'</span>' : '')+
    (unread ? '<span class="cv-udot"></span>' : '')+
  '</button>';
}

/* ---- Én tråd (fuldskærms-siden #chatview) ---- */
export async function openKredsChat(feedId){
  const f = threadById(feedId);
  if(!f || !me){ toast(t("err.generic")); return; }
  if(pendingShare && pendingShare.feed !== feedId) pendingShare = null; // kontekst følger sin tråd
  pendingReply = null; editingMsg = null;
  chatFeed = feedId;
  el("cv-ava").innerHTML = chatAvaHTML(f, 36);
  el("cv-title").textContent = threadName(f);
  // Undertitlen gør trådens natur tydelig: privat (kan aldrig vokse) eller kreds
  el("cv-sub").textContent = f.isDm
    ? t("chat.only_two")
    : (f.members.length === 1 ? t("chat.kreds_sub_one") : t("chat.kreds_sub", { n: f.members.length }));
  renderCtxBar();
  joinTyping(feedId);
  el("cv-body").innerHTML = '<div class="emptynote">'+t("common.loading")+'</div>';
  // Plus-knappen: i en kreds åbner den minde-flowet; i en privat tråd er den dæmpet
  // (medier deles gennem en kreds — det er hele modellen)
  el("chatview").classList.toggle("dm", !!f.isDm);
  el("chatview").classList.add("on");
  // Tråden er sin egen side: alt bagved (feedet/besked-listen) skjules helt, så intet
  // skinner igennem, heller ikke mens tastaturet åbner/lukker
  document.body.classList.add("chat-open");
  const seq = ++chatSeq;
  // Beskeder + set-kvitteringer hentes parallelt. Kvitteringerne er fail-soft: findes
  // tabellen ikke endnu (migrationen kreds_chat_reads), vises tråden bare uden dem.
  const [mres, rr, pres] = await Promise.all([
    sb.from("kreds_messages")
      .select(MSG_SELECT)
      .eq("feed_id", feedId)
      .order("created_at", { ascending: true })
      .limit(300),
    sb.from("kreds_chat_reads").select("user_id, last_read_at").eq("feed_id", feedId),
    sb.from("kreds_chat_prefs").select("*").eq("feed_id", feedId).eq("user_id", me.id).maybeSingle()
  ]);
  if(chatFeed !== feedId || seq !== chatSeq) return; // lukket/skiftet imens
  if(mres.error){
    console.error(mres.error);
    el("cv-body").innerHTML = '<div class="emptynote">'+t("err.generic")+'</div>';
    return;
  }
  if(!pres.error && pres.data) prefs[feedId] = mapPref(pres.data);
  const pf = prefs[feedId] || {};
  msgs = (mres.data || []).map(mapMsg);
  // Ryddet historik ("Ryd/Slet chatten") gælder kun mig: skjul alt før mit mærke
  if(pf.clearedAt){
    const cl = new Date(pf.clearedAt).getTime();
    msgs = msgs.filter(function(m){ return new Date(m.created).getTime() > cl; });
  }
  // Åbning nulstiller en manuel "Markér som ulæst"
  if(pf.markedUnread) setPref(feedId, { markedUnread: false });
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

/* Konteksten over composeren: et minde der svares på, en besked der citeres, eller en
   besked under redigering. Krydset fortryder (beskeden sendes så uden kontekst). */
function renderCtxBar(){
  const box = el("cv-ctx");
  const closeBtn = '<button class="cv-ctxx" aria-label="'+t("chat.ctx_close")+'">'+
    '<svg viewBox="0 0 24 24"><path class="stroke" d="M6 6l12 12M18 6 6 18"/></svg>'+
  '</button>';
  if(editingMsg != null){
    box.innerHTML = '<span class="cv-ctxtxt">'+t("chat.editing")+'</span>'+closeBtn;
    box.hidden = false;
    return;
  }
  if(pendingReply){
    const th = pendingReply.thumb
      ? '<img class="cv-ctxthumb" src="'+esc(pendingReply.thumb)+'" alt="">'
      : pendingReply.vthumb
      ? '<video class="cv-ctxthumb" src="'+esc(pendingReply.vthumb)+'#t=0.1" muted playsinline preload="metadata"></video>'
      : '';
    box.innerHTML = th+'<span class="cv-ctxtxt"><b>'+t("chat.replying_to", { n: esc(user(pendingReply.u).name || pendingReply.u) })+'</b>'+
      (th ? '' : '<br>'+esc(snip(pendingReply.text, 70) || (pendingReply.media ? t("chat.q_media") : "")))+'</span>'+closeBtn;
    box.hidden = false;
    return;
  }
  const p = (pendingShare && chatFeed === pendingShare.feed) ? findPost(pendingShare.post) : null;
  if(!p){ box.hidden = true; box.innerHTML = ""; return; }
  const thumb = p.img
    ? '<img class="cv-ctxthumb" src="'+esc(p.img.src)+'" alt="">'
    : p.video
    ? '<video class="cv-ctxthumb" src="'+esc(p.video.src)+'#t=0.1" muted playsinline preload="metadata"></video>'
    : '';
  box.innerHTML = thumb+
    '<span class="cv-ctxtxt">'+t("chat.replying", { n: esc(user(p.u).name || p.u) })+'</span>'+
    closeBtn;
  box.hidden = false;
}
/* Swipe/menu-valget "Svar": citér beskeden i den næste */
function startReply(m){
  pendingReply = { id: m.id, u: m.u, text: m.text, media: !!(m.postId || m.mimg || m.mvideo),
                   thumb: m.mimg || m.thumb || "",
                   vthumb: (!m.mimg && m.mvideo) ? m.mvideo : (!m.thumb ? m.thumbVideo : "") };
  pendingShare = null;
  editingMsg = null;
  renderCtxBar();
  el("cv-input").focus();
}
/* Skrivefeltet vokser nedad med indholdet (op til CSS-max ~5 linjer) og krymper igen */
function growInput(){
  const inp = el("cv-input");
  inp.style.height = "auto";
  inp.style.height = Math.min(inp.scrollHeight, 118) + "px";
}
function clearCtx(){
  if(editingMsg != null){ el("cv-input").value = ""; growInput(); }
  pendingReply = null; pendingShare = null; editingMsg = null;
  renderCtxBar();
}
/* ---- "X skriver ..." via realtime broadcast (flygtigt, ingen database) ---- */
let typingCh = null, typingHideTimer = 0, typingSentAt = 0;
function joinTyping(feedId){
  leaveTyping();
  typingCh = sb.channel("typing-" + feedId);
  typingCh.on("broadcast", { event: "typing" }, function(p){
    const h = p && p.payload && p.payload.h;
    if(!h || (me && h === me.handle) || chatFeed !== feedId) return;
    const box = el("cv-typing");
    box.textContent = t("chat.typing", { n: (user(h).name || h).split(/\s+/)[0] });
    box.hidden = false;
    clearTimeout(typingHideTimer);
    typingHideTimer = setTimeout(function(){ box.hidden = true; }, 3500);
  }).subscribe();
}
function leaveTyping(){
  if(typingCh){ sb.removeChannel(typingCh); typingCh = null; }
  clearTimeout(typingHideTimer);
  el("cv-typing").hidden = true;
}
function sendTyping(){
  if(!typingCh || !me) return;
  const now = Date.now();
  if(now - typingSentAt < 2000) return; // højst én broadcast pr. 2 sek.
  typingSentAt = now;
  typingCh.send({ type: "broadcast", event: "typing", payload: { h: me.handle } });
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
  // KUN den låste DM-tråd tæller — aldrig en rigtig 2-personers kreds, for den kan
  // vokse senere, og så kunne et "privat" svar ende for øjnene af en tredje (ejer-krav)
  const f = (state.dms || []).find(function(x){
    return x.memberIds.indexOf(me.id) >= 0 && x.memberIds.indexOf(otherId) >= 0;
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
  pendingShare = null; pendingReply = null; editingMsg = null;
  renderCtxBar();
  leaveTyping();
  el("cv-input").blur();
  unpinChat();
  el("chatview").classList.remove("on");
  document.body.classList.remove("chat-open");
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
  myReads = {}; myReadsOk = false; pendingShare = null; pendingReply = null; editingMsg = null;
  prefs = {}; searchQ = "";
  el("chat-list").innerHTML = "";
  el("cv-input").value = "";
  el("cv-search").value = "";
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
               (seenBy[m.id] ? readsHTML(seenBy[m.id], m.id) : '')+
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
function readsHTML(handles, mid){
  // Højst 10 avatarer, derefter +N — tap åbner hele "Set af"-listen
  const show = handles.slice(0, 10);
  const more = handles.length - show.length;
  return '<div class="cv-reads" data-rmid="'+esc(mid)+'">'+show.map(function(h){
    return '<span class="cv-read" title="'+esc(user(h).name || h)+'">'+avaHTML(h, 16)+'</span>';
  }).join("")+(more > 0 ? '<span class="cv-rmore">+'+more+'</span>' : '')+'</div>';
}

/* Person-liste (fx "Set af" og reaktioner): native glas-kort i appen, web-ark ellers */
function openPeopleList(title, rows){
  if(!rows.length) return;
  if(window.__vfGlassCard && window.__vfSheetPost){
    window.__vfSheetPost({
      title: title,
      buttons: rows.map(function(r){
        return { label: (user(r.h).name || r.h) + (r.extra ? "   " + r.extra : ""), action: "__cancel" };
      }).concat([{ label: t("common.cancel"), action: "__cancel", role: "cancel" }])
    }, function(){});
    return;
  }
  menuMsg = null; threadMenuFeed = null;
  el("cmenu").classList.remove("anchor");
  el("cmenu-card").innerHTML = '<div class="mstep">'+
    '<div class="mgroup"><div class="mtitle">'+esc(title)+'</div>'+
    rows.map(function(r){
      return '<div class="cm-prow">'+avaHTML(r.h, 34)+
        '<span class="cm-pn">'+esc(user(r.h).name || r.h)+'</span>'+
        (r.extra ? '<span class="cm-pe">'+esc(r.extra)+'</span>' : '')+
      '</div>';
    }).join("")+'</div>'+
    '<button class="mrow mcancel" data-act="cancel">'+t("common.cancel")+'</button>'+
  '</div>';
  el("cmenu").classList.add("on");
}

/* ---- Besked-menuen (long-press/højreklik på en boble): reager, svar, kopiér,
   rediger (egen, < 15 min), fjern (egen), anmeld/blokér (andres — Apple 1.2) ---- */
const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
let menuMsg = null;   // beskeden menuen er åben for
let confirmDo = null; // handlingen bag bekræftelses-trinnet
/* iMessage-anatomi: emoji-pille øverst + hvidt kort m. ikon-rækker, forankret ved boblen */
const CM_IC = {
  reply: '<svg viewBox="0 0 24 24"><path class="stroke" d="M9.5 7 4.5 12l5 5M4.5 12H14a5.5 5.5 0 0 1 5.5 5.5v1"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><g class="stroke"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 5.5v-.5a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 5v8A1.5 1.5 0 0 0 6 14.5h.5"/></g></svg>',
  edit: '<svg viewBox="0 0 24 24"><path class="stroke" d="M4.5 19.5h4L20 8a2.1 2.1 0 0 0-3-3L5.5 16.5Zm9.5-12 3 3"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><g class="stroke"><path d="M4.5 6.5h15M9.5 6V4.5h5V6M6.5 6.5l1 13h9l1-13M10 10.5v6M14 10.5v6"/></g></svg>',
  flag: '<svg viewBox="0 0 24 24"><path class="stroke" d="M6 21V4.5M6 5h11.5l-2.5 3.5 2.5 3.5H6"/></svg>',
  block: '<svg viewBox="0 0 24 24"><g class="stroke"><circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/></g></svg>'
};
function openMsgMenu(mid, anchorEl){
  const m = msgs.find(function(x){ return x.id === mid; });
  if(!m || !me) return;
  const mine = m.authorId === me.id;
  const myReact = (m.reacts || []).find(function(r){ return r.user_id === me.id; });
  const canEdit = mine && m.text && !m.postId &&
    Date.now() - new Date(m.created).getTime() < 15 * 60 * 1000;
  // I appen: det ÆGTE native Liquid Glass-kort m. emoji-række (builds m. __vfSheetEmojis)
  if(window.__vfGlassCard && window.__vfSheetPost && window.__vfSheetEmojis){
    const buttons = [{ label: t("chat.menu_reply"), action: "reply" }];
    if(m.text) buttons.push({ label: t("chat.copy"), action: "copy" });
    if(canEdit) buttons.push({ label: t("chat.edit"), action: "edit" });
    if(mine) buttons.push({ label: t("chat.remove"), action: "remove", role: "destructive" });
    if(!mine){
      buttons.push({ label: t("chat.report"), action: "report", role: "destructive" });
      buttons.push({ label: t("rm.block"), action: "block", role: "destructive" });
    }
    buttons.push({ label: t("common.cancel"), action: "__cancel", role: "cancel" });
    window.__vfSheetPost({
      emojis: EMOJIS, selected: myReact ? myReact.emoji : "", buttons: buttons
    }, function(a){
      if(a && a.indexOf("emoji:") === 0){ setReaction(m.id, a.slice(6)); return; }
      if(a === "reply"){ startReply(m); return; }
      if(a === "copy"){
        try{ navigator.clipboard.writeText(m.text); toast(t("chat.copied")); }catch(_e){}
        return;
      }
      if(a === "edit"){
        editingMsg = m.id; pendingReply = null; pendingShare = null;
        el("cv-input").value = m.text;
        growInput();
        renderCtxBar();
        el("cv-input").focus();
        return;
      }
      if(a === "remove"){
        window.__vfSheetPost({ title: t("chat.remove_confirm"), buttons: [
          { label: t("chat.remove"), action: "do", role: "destructive" },
          { label: t("common.cancel"), action: "__cancel", role: "cancel" }
        ]}, function(b){ if(b === "do") doDeleteMsg(m); });
        return;
      }
      if(a === "report"){
        window.__vfSheetPost({ title: t("chat.report_confirm"), message: t("chat.report_note"), buttons: [
          { label: t("chat.report"), action: "do", role: "destructive" },
          { label: t("common.cancel"), action: "__cancel", role: "cancel" }
        ]}, function(b){ if(b === "do") doReportMsg(m); });
        return;
      }
      if(a === "block"){
        window.__vfSheetPost({ title: t("rm.block") + " @" + m.u + "?", message: t("block.note"), buttons: [
          { label: t("block.do"), action: "do", role: "destructive" },
          { label: t("common.cancel"), action: "__cancel", role: "cancel" }
        ]}, function(b){ if(b === "do"){ closeKredsChat(); doBlockUser(m.u); } });
      }
    });
    return;
  }
  menuMsg = mid;
  const rows =
    '<button class="cm-row" data-act="reply">'+CM_IC.reply+'<span>'+t("chat.menu_reply")+'</span></button>'+
    (m.text ? '<button class="cm-row" data-act="copy">'+CM_IC.copy+'<span>'+t("chat.copy")+'</span></button>' : '')+
    (canEdit ? '<button class="cm-row" data-act="edit">'+CM_IC.edit+'<span>'+t("chat.edit")+'</span></button>' : '')+
    (mine ? '<button class="cm-row danger" data-act="remove">'+CM_IC.trash+'<span>'+t("chat.remove")+'</span></button>' : '')+
    (!mine ? '<button class="cm-row danger" data-act="report">'+CM_IC.flag+'<span>'+t("chat.report")+'</span></button>' : '')+
    (!mine ? '<button class="cm-row danger" data-act="block">'+CM_IC.block+'<span>'+t("rm.block")+'</span></button>' : '');
  el("cmenu-card").innerHTML = '<div class="cmenu-pos'+(mine ? " mine" : "")+'" id="cmenu-pos">'+
    '<div class="cm-emojis">'+EMOJIS.map(function(e2){
      return '<button class="cm-emoji'+(myReact && myReact.emoji === e2 ? " on" : "")+'" data-e="'+esc(e2)+'">'+e2+'</button>';
    }).join("")+'</div>'+
    '<div class="cm-card">'+rows+'</div>'+
  '</div>';
  el("cmenu").classList.add("anchor");
  el("cmenu").classList.add("on");
  placeMsgMenu(anchorEl, mine);
}
/* Placér menuen ved den holdte boble (emoji-rækken lige over), klemt inden for skærmen */
function placeMsgMenu(anchorEl, mine){
  const pos = el("cmenu-pos");
  const phoneEl = document.querySelector(".phone");
  if(!pos || !phoneEl) return;
  const phone = phoneEl.getBoundingClientRect();
  let top = 110;
  let side = 12;
  if(anchorEl){
    const b = anchorEl.querySelector(".cv-bubble") || anchorEl;
    const r = b.getBoundingClientRect();
    top = r.top - phone.top - 62; // emoji-pillen lige over boblen
    side = mine ? Math.max(10, phone.right - r.right) : Math.max(10, r.left - phone.left);
  }
  const card = pos.querySelector(".cm-card");
  const total = 54 + 10 + (card ? card.childElementCount * 47 : 200) + 8;
  top = Math.max(64, Math.min(top, phone.height - total - 14));
  pos.style.top = top + "px";
  if(mine){ pos.style.right = side + "px"; pos.style.left = "auto"; }
  else { pos.style.left = side + "px"; pos.style.right = "auto"; }
}
function closeMsgMenu(){
  el("cmenu").classList.remove("on");
  el("cmenu").classList.remove("anchor");
  menuMsg = null; confirmDo = null;
}
/* Bekræftelses-trin (Fjern/Anmeld/Blokér/Ryd): klassisk centreret glas-kort */
function confirmStep(title, note, btnLabel, onDo){
  confirmDo = onDo;
  el("cmenu").classList.remove("anchor");
  el("cmenu-card").innerHTML = '<div class="mstep">'+
    '<div class="mgroup"><div class="mtitle">'+title+'</div>'+
    (note ? '<p class="mtext">'+note+'</p>' : '')+
    '<button class="mrow danger" data-act="__do">'+btnLabel+'</button></div>'+
    '<button class="mrow mcancel" data-act="cancel">'+t("common.cancel")+'</button>'+
  '</div>';
}

/* Søgeresultater i Beskeder-listen: tråde hvis navn matcher, VENNER der matcher
   (tap åbner/opretter jeres tråd — som at søge venner på liste-siden), og beskeder
   hvis indhold matcher */
function renderSearchResults(q, msgRows){
  const box = el("chat-list");
  const ql = q.toLowerCase();
  const matched = allThreads().filter(function(f){
    return threadName(f).toLowerCase().indexOf(ql) >= 0;
  });
  const threadRows = matched.map(chatRowHTML).join("");
  // Venner der allerede er dækket af en matchende 2-personers tråd vises ikke dobbelt
  const covered = new Set();
  matched.forEach(function(f){
    if(me && f.memberIds.length === 2){
      f.memberIds.forEach(function(id){ if(id !== me.id) covered.add(id); });
    }
  });
  const friendRows = (state.humanFriends || []).filter(function(h){
    const uu = user(h);
    return ((uu.name || h).toLowerCase().indexOf(ql) >= 0 || h.toLowerCase().indexOf(ql) >= 0)
      && !covered.has(uu.id);
  }).map(function(h){
    return '<button class="chatrow" data-friend="'+esc(h)+'">'+
      '<span class="chatava">'+avaHTML(h, 52)+'</span>'+
      '<span class="lcol">'+
        '<span class="lnm">'+esc(user(h).name || h)+'</span>'+
        '<span class="lh">@'+esc(h)+'</span>'+
      '</span>'+
    '</button>';
  }).join("");
  const msgsHtml = (msgRows || []).map(function(r){
    const f = threadById(r.feed_id);
    if(!f) return "";
    const mm = mapMsg(r);
    return '<button class="chatrow" data-feed="'+esc(f.id)+'">'+
      chatAvaHTML(f, 52)+
      '<span class="lcol">'+
        '<span class="lnm">'+esc(threadName(f))+'</span>'+
        '<span class="lh">'+esc(snip(mm.text, 60))+' · '+esc(mm.t)+'</span>'+
      '</span>'+
    '</button>';
  }).join("");
  const html = threadRows +
    (friendRows ? '<div class="sectionlabel">'+t("stats.friends")+'</div>'+friendRows : "") +
    (msgsHtml ? '<div class="sectionlabel">'+t("chat.search_msgs")+'</div>'+msgsHtml : "");
  box.innerHTML = html || '<div class="emptynote">'+t("chat.search_none")+'</div>';
}

/* ---- Tråd-menuen (⋯ i headeren eller long-press på en liste-række):
   medlemmer, fastgør, mute, markér som ulæst, ryd/slet, blokér (DM) ---- */
let threadMenuFeed = null;
/* Handlinger delt mellem web-menuen og det native glas-kort */
function threadMenuDirect(fid, act){
  const f = threadById(fid);
  if(!f) return;
  const pf = prefs[fid] || {};
  if(act === "members"){ openMemberSheet(fid); return; }
  if(act === "pin"){ setPref(fid, { pinned: !pf.pinned }); renderChatList(false); return; }
  if(act === "mute"){
    const nowMuted = !pf.muted;
    setPref(fid, { muted: nowMuted });
    renderChatList(false);
    toast(t(nowMuted ? "chat.muted_toast" : "chat.unmuted_toast")); // gør resultatet utvetydigt
    return;
  }
  if(act === "unreadmark"){ setPref(fid, { markedUnread: true }); renderChatList(false); }
}
function doClearThread(f){
  setPref(f.id, { clearedAt: new Date().toISOString(), markedUnread: false });
  if(chatFeed === f.id){
    if(f.isDm) closeKredsChat();
    else { msgs = []; renderThread(false); }
  }
  renderChatList(false);
}
function openThreadMenu(feedId){
  const f = threadById(feedId);
  if(!f || !me) return;
  const pf = prefs[feedId] || {};
  const other = f.isDm ? f.members.filter(function(h){ return h !== me.handle; })[0] : null;
  // I appen: det ÆGTE native Liquid Glass-kort (samme som opslags-menuerne)
  if(window.__vfGlassCard && window.__vfSheetPost){
    const buttons = [];
    if(!f.isDm) buttons.push({ label: t("chat.members"), action: "members" });
    buttons.push({ label: t(pf.pinned ? "chat.unpin" : "chat.pin"), action: "pin" });
    buttons.push({ label: t(pf.muted ? "chat.unmute" : "chat.mute"), action: "mute" });
    buttons.push({ label: t("chat.mark_unread"), action: "unreadmark" });
    buttons.push({ label: t(f.isDm ? "chat.del_thread" : "chat.clear_thread"), action: "clear", role: "destructive" });
    if(other) buttons.push({ label: t("rm.block"), action: "block", role: "destructive" });
    buttons.push({ label: t("common.cancel"), action: "__cancel", role: "cancel" });
    window.__vfSheetPost({ buttons: buttons }, function(a){
      if(a === "clear"){
        window.__vfSheetPost({
          title: t(f.isDm ? "chat.del_confirm" : "chat.clear_confirm"),
          message: t("chat.clear_note"),
          buttons: [
            { label: t(f.isDm ? "chat.do_del" : "chat.do_clear"), action: "do", role: "destructive" },
            { label: t("common.cancel"), action: "__cancel", role: "cancel" }
          ]
        }, function(b){ if(b === "do") doClearThread(f); });
        return;
      }
      if(a === "block" && other){
        window.__vfSheetPost({
          title: t("rm.block") + " @" + other + "?",
          message: t("block.note"),
          buttons: [
            { label: t("block.do"), action: "do", role: "destructive" },
            { label: t("common.cancel"), action: "__cancel", role: "cancel" }
          ]
        }, function(b){ if(b === "do"){ closeKredsChat(); doBlockUser(other); } });
        return;
      }
      threadMenuDirect(feedId, a);
    });
    return;
  }
  // Browser-fallback: web-glas-arket (ens, centrerede rækker)
  threadMenuFeed = feedId;
  menuMsg = null; // menuen genbruger #cmenu-kortet
  el("cmenu-card").innerHTML = '<div class="mstep">'+
    '<div class="mgroup">'+
      (!f.isDm ? '<button class="mrow" data-tact="members">'+t("chat.members")+'</button>' : '')+
      '<button class="mrow" data-tact="pin">'+t(pf.pinned ? "chat.unpin" : "chat.pin")+'</button>'+
      '<button class="mrow" data-tact="mute">'+t(pf.muted ? "chat.unmute" : "chat.mute")+'</button>'+
      '<button class="mrow" data-tact="unreadmark">'+t("chat.mark_unread")+'</button>'+
      '<button class="mrow danger" data-tact="clear">'+t(f.isDm ? "chat.del_thread" : "chat.clear_thread")+'</button>'+
      (other ? '<button class="mrow danger" data-tact="block">'+t("rm.block")+'</button>' : '')+
    '</div>'+
    '<button class="mrow mcancel" data-act="cancel">'+t("common.cancel")+'</button>'+
  '</div>';
  el("cmenu").classList.add("on");
}
function threadMenuAct(act){
  const fid = threadMenuFeed;
  const f = threadById(fid);
  threadMenuFeed = null;
  if(!f) { closeMsgMenu(); return; }
  if(act === "clear"){
    confirmStep(t(f.isDm ? "chat.del_confirm" : "chat.clear_confirm"), t("chat.clear_note"),
      t(f.isDm ? "chat.do_del" : "chat.do_clear"), function(){ doClearThread(f); });
    return;
  }
  if(act === "block"){
    const other = f.members.filter(function(h){ return h !== me.handle; })[0];
    confirmStep(t("rm.block") + " @" + esc(other) + "?", t("block.note"), t("block.do"), function(){
      closeKredsChat();
      doBlockUser(other);
    });
    return;
  }
  closeMsgMenu();
  threadMenuDirect(fid, act);
}

/* Reaktion: én pr. bruger — samme emoji fjerner, ny erstatter (optimistisk + realtime) */
function setReaction(mid, emoji){
  const m = msgs.find(function(x){ return x.id === mid; });
  if(!m || !me) return;
  const cur = (m.reacts || []).find(function(r){ return r.user_id === me.id; });
  m.reacts = (m.reacts || []).filter(function(r){ return r.user_id !== me.id; });
  if(cur && cur.emoji === emoji){
    sb.from("kreds_message_reactions").delete()
      .eq("message_id", Number(mid)).eq("user_id", me.id)
      .then(function(r){ if(r.error) console.error(r.error); }, function(){});
  } else {
    m.reacts.push({ user_id: me.id, emoji: emoji });
    sb.from("kreds_message_reactions").upsert({ message_id: Number(mid), user_id: me.id, emoji: emoji })
      .then(function(r){ if(r.error) console.error(r.error); }, function(){});
  }
  renderThread(false);
}
/* Slettes/anmeldes trådens nyeste besked, skal listens preview følge med */
function refreshLastFromThread(){
  if(chatFeed == null) return;
  const real = msgs.filter(function(x){ return String(x.id).indexOf("tmp-") !== 0; });
  if(real.length) lastByFeed[chatFeed] = real[real.length - 1];
  else delete lastByFeed[chatFeed];
  if(el("view-chat").classList.contains("active")) renderChatList(false);
}
async function doDeleteMsg(m){
  msgs = msgs.filter(function(x){ return x.id !== m.id; });
  renderThread(false); // citater slås op lokalt, så en slettet kilde forsvinder af sig selv
  refreshLastFromThread();
  const { error } = await sb.from("kreds_messages").delete().eq("id", Number(m.id));
  if(error){ console.error(error); toast(t("err.generic")); return; }
  if(m.mimgPath) sb.storage.from("post-images").remove([m.mimgPath]).catch(function(){});
}
async function doReportMsg(m){
  const { error } = await sb.from("message_reports").insert({ message_id: Number(m.id), user_id: me.id });
  if(error){ console.error(error); toast(t("err.generic")); return; }
  msgs = msgs.filter(function(x){ return x.id !== m.id; }); // skjult for anmelderen (RLS-gate)
  renderThread(false);
  refreshLastFromThread();
  toast(t("chat.reported"));
}
function snip(s, n){ return s && s.length > n ? s.slice(0, n - 1) + "…" : (s || ""); }
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
  // Beskedens eget billede/video (uden boble-baggrund når det står alene, som Messenger)
  const media = m.mimg
    ? '<img class="cv-mimg" src="'+esc(m.mimg)+'" alt="">'
    : m.mvideo
    ? '<video class="cv-mimg" src="'+esc(m.mvideo)+'" controls playsinline preload="metadata"></video>'
    : '';
  const bare = media && !m.text && !share;
  // Citat-svar (Messenger-agtigt): etiket "Svar til Navn" + den citerede besked som
  // tydelig chip m. evt. miniature — tap hopper til beskeden. Kilden slås op LOKALT i
  // tråden (rm), så citatet altid er friskt, og en slettet kilde forsvinder af sig selv.
  let quote = "";
  if(m.replyToId != null){
    const rm = msgs.find(function(x){ return x.id === m.replyToId; });
    if(rm){
      const rname = esc((user(rm.u).name || rm.u).split(/\s+/)[0]);
      const rimg = rm.mimg || rm.thumb;
      const rvid = rimg ? "" : (rm.mvideo || rm.thumbVideo);
      const rthumb = rimg
        ? '<img class="cv-qthumb" src="'+esc(rimg)+'" alt="">'
        : rvid
        ? '<video class="cv-qthumb" src="'+esc(rvid)+'#t=0.1" muted playsinline preload="metadata"></video>'
        : '';
      // Med miniature vises KUN billedet — aldrig tekst/billedtekst ved siden af
      const rtxt = rthumb ? "" : esc(snip(rm.text, 64) ||
        ((rm.postId || rm.mimg || rm.mvideo) ? t("chat.q_media") : ""));
      if(rname || rtxt || rthumb){
        quote = '<div class="cv-qwrap">'+
          '<span class="cv-qlabel">'+
            '<svg viewBox="0 0 24 24"><path class="stroke" d="M9.5 7 4.5 12l5 5M4.5 12H14a5.5 5.5 0 0 1 5.5 5.5v1"/></svg>'+
            t("chat.replying_to", { n: rname })+
          '</span>'+
          '<button class="cv-quote" data-q="'+esc(m.replyToId)+'">'+
            rthumb+(rtxt ? '<span class="cv-qtxt">'+rtxt+'</span>' : '')+
          '</button>'+
        '</div>';
      }
    }
  }
  // Reaktioner: pille under boblens hjørne — højst 3 emojis (hyppigste først) + samlet
  // tal; tap åbner listen over hvem der har reageret med hvad
  const counts = {};
  (m.reacts || []).forEach(function(r){ counts[r.emoji] = (counts[r.emoji] || 0) + 1; });
  const rkeys = Object.keys(counts).sort(function(a, b){ return counts[b] - counts[a]; });
  const rtotal = (m.reacts || []).length;
  const reacts = rkeys.length
    ? '<button class="cv-reacts" data-rx="'+esc(m.id)+'">'+
        rkeys.slice(0, 3).map(esc).join("")+
        (rtotal > 1 ? '<b>'+rtotal+'</b>' : '')+
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
      quote+
      '<div class="cv-bubble'+(bare ? " cv-bare" : "")+'">'+share+media+(m.text ? '<span class="cv-text">'+esc(m.text)+'</span>' : '')+'</div>'+
      reacts+
      (last ? '<span class="cv-time">'+esc(m.t)+(m.edited ? ' · '+t("chat.edited") : '')+'</span>' : '')+
    '</div>'+
  '</div>';
}

async function sendChatMsg(){
  if(!me || chatFeed == null) return;
  const inp = el("cv-input");
  const text = inp.value.trim();
  // Redigerings-tilstand: composeren opdaterer den valgte besked i stedet for at sende
  if(editingMsg != null){
    if(!text) return;
    const mid = editingMsg;
    const feedId = chatFeed;
    editingMsg = null;
    inp.value = "";
    growInput();
    renderCtxBar();
    const { data, error } = await sb.from("kreds_messages")
      .update({ text: text }).eq("id", mid).select(MSG_SELECT).single();
    if(chatFeed !== feedId) return;
    if(error || !data){
      console.error(error);
      toast(t("err.generic"));
      return;
    }
    const upd = mapMsg(data);
    msgs = msgs.map(function(x){ return x.id === upd.id ? upd : x; });
    if(lastByFeed[feedId] && lastByFeed[feedId].id === upd.id) lastByFeed[feedId] = upd;
    renderThread(false);
    return;
  }
  if(!text) return;
  inp.value = "";
  growInput();
  const feedId = chatFeed;
  // Kontekst: et minde (post_id) eller et citat-svar (reply_to)
  const share = (pendingShare && pendingShare.feed === feedId) ? pendingShare : null;
  const reply = pendingReply;
  const sp = share ? findPost(share.post) : null;
  // Optimistisk: vis beskeden med det samme, byt til den rigtige række fra serveren
  const temp = { id: "tmp-" + Date.now(), feed: feedId, u: me.handle, authorId: me.id,
                 text: text, postId: share ? share.post : null,
                 thumb: sp && sp.img ? sp.img.src : "",
                 thumbVideo: sp && !sp.img && sp.video ? sp.video.src : "",
                 mimg: "", mvideo: "", edited: false, reacts: [],
                 replyToId: reply ? reply.id : null,
                 t: fmtTime(new Date().toISOString()), created: new Date().toISOString() };
  msgs.push(temp);
  renderThread(true);
  const { data, error } = await sb.from("kreds_messages")
    .insert({ feed_id: feedId, author: me.id, text: text,
              post_id: share ? Number(share.post) : null,
              reply_to: reply ? Number(reply.id) : null })
    .select(MSG_SELECT)
    .single();
  if(chatFeed !== feedId) return; // tråden blev lukket/skiftet imens
  msgs = msgs.filter(function(x){ return x.id !== temp.id; });
  if(error){
    console.error(error);
    renderThread(false);
    inp.value = text; // giv teksten tilbage, så intet mistes
    growInput();
    toast(t("err.generic"));
    return;
  }
  const real = mapMsg(data);
  if(share && pendingShare === share) pendingShare = null; // konteksten er afleveret
  if(reply && pendingReply === reply) pendingReply = null;
  renderCtxBar();
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

/* Realtime på beskeder: INSERT appender, UPDATE (redigering) bytter rækken ud, DELETE
   (fjernet besked) fjerner den. INSERT/UPDATE genhentes m. MSG_SELECT (payload har
   ingen joins; RLS afgør synlighed); DELETE bærer kun beskedens id. */
export function chatRealtime(payload){
  if(!me || !payload) return;
  if(payload.eventType === "DELETE"){
    const oldId = payload.old && payload.old.id;
    if(oldId == null) return;
    if(msgs.some(function(x){ return x.id === oldId; })){
      msgs = msgs.filter(function(x){ return x.id !== oldId; });
      if(el("chatview").classList.contains("on")) renderThread(false);
      refreshLastFromThread();
      return;
    }
    // Var den slettede besked et liste-preview, hentes previews friskt
    let stale = false;
    Object.keys(lastByFeed).forEach(function(fid){
      if(lastByFeed[fid] && lastByFeed[fid].id === oldId){ delete lastByFeed[fid]; stale = true; }
    });
    if(stale && el("view-chat").classList.contains("active")) renderChatList(true);
    return;
  }
  const row = payload.new;
  if(!row || !row.id) return;
  sb.from("kreds_messages").select(MSG_SELECT).eq("id", row.id).maybeSingle().then(function(r){
    if(r.error || !r.data) return;
    const m = mapMsg(r.data);
    if(payload.eventType === "UPDATE"){
      if(chatFeed === m.feed && el("chatview").classList.contains("on")){
        msgs = msgs.map(function(x){ return x.id === m.id ? m : x; });
        renderThread(false);
      }
      if(lastByFeed[m.feed] && lastByFeed[m.feed].id === m.id){
        lastByFeed[m.feed] = m;
        if(el("view-chat").classList.contains("active")) renderChatList(false);
      }
      return;
    }
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

/* Realtime på reaktioner: flyt emoji-pillerne live i en åben tråd */
export function chatReactsRealtime(payload){
  if(!me || !payload) return;
  const row = payload.eventType === "DELETE" ? payload.old : payload.new;
  if(!row || row.message_id == null || !row.user_id) return;
  const m = msgs.find(function(x){ return x.id === row.message_id; });
  if(!m || !el("chatview").classList.contains("on")) return;
  m.reacts = (m.reacts || []).filter(function(r){ return r.user_id !== row.user_id; });
  if(payload.eventType !== "DELETE" && row.emoji) m.reacts.push({ user_id: row.user_id, emoji: row.emoji });
  renderThread(false);
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
    // Krydset fortryder konteksten (minde/citat/redigering)
    if(e.target.closest(".cv-ctxx")) clearCtx();
  });
  // Plus-knappen: i en KREDS-tråd åbner den minde-flowet (galleriet fra feedet) med
  // kredsen som destination — mindet postes i kredsen og lander i tråden som deling.
  // I en PRIVAT tråd er knappen dæmpet: medier deles kun gennem en kreds.
  el("cv-plus").addEventListener("click", function(){
    if(chatFeed == null) return;
    const f = threadById(chatFeed);
    if(!f) return;
    if(f.isDm){ toast(t("chat.media_dm")); return; }
    openMemoryFor(chatFeed);
  });
  el("cv-send").addEventListener("click", sendChatMsg);
  el("cv-input").addEventListener("input", function(){ growInput(); sendTyping(); });
  el("cv-input").addEventListener("keydown", function(e){
    // Enter sender (shift+enter = ny linje på desktop); preventDefault så textarea'en
    // ikke også indsætter et linjeskift
    if(e.key === "Enter" && !e.shiftKey && !e.isComposing){
      e.preventDefault();
      sendChatMsg();
    }
  });
  // Tråd-menuen: ⋯ i headeren, long-press (eller højreklik) på en liste-række
  el("cv-hmenu").addEventListener("click", function(){
    if(chatFeed != null) openThreadMenu(chatFeed);
  });
  let rowLpTimer = 0, rowLpFired = false;
  el("chat-list").addEventListener("touchstart", function(e){
    const r = e.target.closest(".chatrow");
    rowLpFired = false;
    if(!r || e.touches.length !== 1) return;
    const fid = r.dataset.feed;
    rowLpTimer = setTimeout(function(){ rowLpFired = true; openThreadMenu(fid); }, 450);
  }, { passive: true });
  el("chat-list").addEventListener("touchmove", function(){ clearTimeout(rowLpTimer); }, { passive: true });
  el("chat-list").addEventListener("touchend", function(){ clearTimeout(rowLpTimer); });
  el("chat-list").addEventListener("contextmenu", function(e){
    const r = e.target.closest(".chatrow");
    if(!r) return;
    e.preventDefault();
    openThreadMenu(r.dataset.feed);
  });
  el("chat-list").addEventListener("click", function(e){
    if(rowLpFired){ rowLpFired = false; return; }
    const r = e.target.closest(".chatrow");
    if(!r) return;
    // En ven fra søgningen: åbn (eller opret) jeres tråd
    if(r.dataset.friend){ openDmWith(user(r.dataset.friend).id); return; }
    openKredsChat(r.dataset.feed);
  });
  // Søgning: tråd-navne filtreres med det samme, besked-indhold søges i databasen
  el("cv-search").addEventListener("input", function(){
    searchQ = this.value.trim();
    clearTimeout(searchTimer);
    if(!searchQ){ renderChatList(false); return; }
    renderSearchResults(searchQ, []);
    const q = searchQ;
    searchTimer = setTimeout(function(){
      sb.from("kreds_messages").select(MSG_SELECT)
        .ilike("text", "%" + q + "%")
        .order("created_at", { ascending: false })
        .limit(30)
        .then(function(r){
          if(searchQ !== q || r.error) return;
          renderSearchResults(q, r.data || []);
        }, function(){});
    }, 350);
  });
  el("cv-body").addEventListener("click", function(e){
    if(lpFired){ lpFired = false; return; } // long-press må ikke også udløse et tap
    const qw = e.target.closest(".cv-qwrap");
    const q = qw ? qw.querySelector(".cv-quote") : e.target.closest(".cv-quote");
    if(q){
      // Tap på citatet hopper til den citerede besked og fremhæver den
      const tEl = el("cv-body").querySelector('.cv-msg[data-mid="'+q.dataset.q+'"]');
      if(tEl){
        tEl.scrollIntoView({ behavior: "smooth", block: "center" });
        const bEl = tEl.querySelector(".cv-bubble") || tEl; // kun selve boblen lyser op
        bEl.classList.add("flash");
        setTimeout(function(){ bEl.classList.remove("flash"); }, 1300);
      }
      return;
    }
    const rx = e.target.closest(".cv-reacts");
    if(rx){
      // Hele reaktions-listen: hvem reagerede med hvad
      const mm = msgs.find(function(x){ return x.id === Number(rx.dataset.rx); });
      if(mm && mm.reacts && mm.reacts.length){
        openPeopleList(t("chat.reactions"), mm.reacts.map(function(r){
          const h = ID2H[r.user_id];
          return h ? { h: h, extra: r.emoji } : null;
        }).filter(Boolean));
      }
      return;
    }
    const rd = e.target.closest(".cv-reads");
    if(rd && rd.dataset.rmid){
      // Hele "Set af"-listen
      const handles = readReceipts()[Number(rd.dataset.rmid)] || [];
      openPeopleList(t("chat.seen_by"), handles.map(function(h){ return { h: h }; }));
      return;
    }
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

  /* Long-press åbner besked-menuen; vandret swipe mod midten = Svar (Messenger-gesten).
     Lodret bevægelse vinder altid (scroll), og en udløst long-press sluger det
     efterfølgende klik. Højreklik (desktop) åbner også menuen. */
  const body = el("cv-body");
  let lpTimer = 0, sx = 0, sy = 0, swipeEl = null, swipeMid = 0, swiping = false, lpFired = false;
  body.addEventListener("touchstart", function(e){
    lpFired = false; swiping = false; swipeEl = null;
    if(e.touches.length !== 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    const msgEl = e.target.closest(".cv-msg");
    if(!msgEl) return;
    swipeEl = msgEl; swipeMid = Number(msgEl.dataset.mid);
    lpTimer = setTimeout(function(){
      lpFired = true; swipeEl = null;
      openMsgMenu(swipeMid, msgEl);
    }, 420);
  }, { passive: true });
  body.addEventListener("touchmove", function(e){
    const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
    // (swipe-ned-for-tastatur håndteres globalt i main.js — gælder hele appen)
    if(lpTimer && (Math.abs(dx) > 8 || Math.abs(dy) > 8)){ clearTimeout(lpTimer); lpTimer = 0; }
    if(!swipeEl) return;
    const dir = swipeEl.classList.contains("mine") ? -1 : 1; // træk mod midten
    const d = dx * dir;
    if(!swiping){
      if(d > 14 && Math.abs(dx) > Math.abs(dy) * 1.2) swiping = true;
      else if(Math.abs(dy) > 12){ swipeEl = null; return; } // lodret scroll vinder
      else return;
    }
    const off = Math.max(0, Math.min(64, d - 8));
    swipeEl.style.transform = "translateX(" + (off * dir) + "px)";
    swipeEl.classList.toggle("swiped", off > 44);
  }, { passive: true });
  body.addEventListener("touchend", function(){
    clearTimeout(lpTimer); lpTimer = 0;
    if(swipeEl && swiping){
      const hit = swipeEl.classList.contains("swiped");
      const sEl = swipeEl, mid = swipeMid;
      sEl.style.transition = "transform .18s ease";
      sEl.style.transform = "";
      sEl.classList.remove("swiped");
      setTimeout(function(){ sEl.style.transition = ""; }, 200);
      if(hit){
        const m = msgs.find(function(x){ return x.id === mid; });
        if(m) startReply(m);
      }
    }
    swipeEl = null; swiping = false;
  });
  body.addEventListener("contextmenu", function(e){
    const msgEl = e.target.closest(".cv-msg");
    if(!msgEl) return;
    e.preventDefault();
    openMsgMenu(Number(msgEl.dataset.mid), msgEl);
  });

  /* Besked-menuens valg (inkl. bekræftelses-trin for Fjern/Anmeld/Blokér) */
  el("cmenu").addEventListener("click", function(e){
    const em = e.target.closest(".cm-emoji");
    if(em){ const mid = menuMsg; closeMsgMenu(); setReaction(mid, em.dataset.e); return; }
    const tr = e.target.closest("[data-tact]");
    if(tr){ threadMenuAct(tr.dataset.tact); return; }
    const row = e.target.closest("[data-act]");
    if(!row){
      // Tap uden for kortet/emoji-pillen lukker (også i den forankrede tilstand)
      if(!e.target.closest(".cm-card") && !e.target.closest(".cm-emojis") &&
         !e.target.closest(".mgroup")) closeMsgMenu();
      return;
    }
    const act = row.dataset.act;
    if(act === "cancel"){ closeMsgMenu(); return; }
    if(act === "__do"){ const f = confirmDo; closeMsgMenu(); if(f) f(); return; }
    const m = msgs.find(function(x){ return x.id === menuMsg; });
    if(!m){ closeMsgMenu(); return; }
    if(act === "reply"){ closeMsgMenu(); startReply(m); }
    else if(act === "copy"){
      closeMsgMenu();
      try{ navigator.clipboard.writeText(m.text); toast(t("chat.copied")); }catch(_e){}
    }
    else if(act === "edit"){
      closeMsgMenu();
      editingMsg = m.id; pendingReply = null; pendingShare = null;
      el("cv-input").value = m.text;
      growInput();
      renderCtxBar();
      el("cv-input").focus();
    }
    else if(act === "remove"){
      confirmStep(t("chat.remove_confirm"), null, t("chat.remove"), function(){ doDeleteMsg(m); });
    }
    else if(act === "report"){
      confirmStep(t("chat.report_confirm"), t("chat.report_note"), t("chat.report"), function(){ doReportMsg(m); });
    }
    else if(act === "block"){
      confirmStep(t("rm.block") + " @" + esc(m.u) + "?", t("block.note"), t("block.do"), function(){
        closeKredsChat(); // tråden med den blokerede skal ikke stå åben bagved
        doBlockUser(m.u);
      });
    }
  });
}
