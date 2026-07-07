import { sb, GENERIC_ERR, BLOCKED_MSG, OFFICIAL_HANDLE } from "./config.js";
import { me, state, expandedCmts, pv, cstate, setCurTab, setCfilePid, ID2H, FRIEND_SINCE } from "./store.js";
import { el, esc, avaHTML, user, grad, likesLabel, toast, fmtTime, imgUrl, registerProfile, BADGE, HEART_SVG } from "./helpers.js";
import { cmtSectionHTML, toggleCmtSection, rerenderComposer, sendComment, toggleCmtLike, cInput, cKey, clearReply, clearCImg } from "./comments.js";
import { openFeedSheet, openMemberSheet } from "./kredse.js";
import { openProfile, closeProfile, renderMyPosts, renderStories, refreshPv } from "./profile.js";
import { renderSearch } from "./search.js";
import { loadNotifs, setNotifDot } from "./notifications.js";
import { scheduleRefetch } from "./realtime.js";
import { mapPoll, pollHTML, votePoll } from "./polls.js";
import { openLightbox } from "./lightbox.js";

export const POST_SELECT = "*, author_profile:profiles!author(*), comments(*, author_profile:profiles!author(*), comment_likes(user_id)), likes(user_id), poll_options(*, poll_votes(user_id))";

export function mapComment(c){
  if(c.author_profile) registerProfile(c.author_profile);
  const ls = c.comment_likes || [];
  return {
    id: c.id,
    u: c.author_profile ? c.author_profile.handle : (ID2H[c.author] || "?"),
    text: c.text || "",
    img: c.image_path ? imgUrl(c.image_path) : null,
    parent: c.parent_id != null ? c.parent_id : null,
    t: fmtTime(c.created_at),
    liked: !!(me && ls.some(function(l){ return l.user_id === me.id; })),
    likeCount: ls.length
  };
}
export function mapPost(row){
  if(row.author_profile) registerProfile(row.author_profile);
  const h = row.author_profile ? row.author_profile.handle : (ID2H[row.author] || "?");
  const likes = row.likes || [];
  const cmts = (row.comments || []).slice()
    .sort(function(a,b){ return new Date(a.created_at) - new Date(b.created_at); })
    .map(mapComment);
  return {
    id: row.id,
    u: h,
    created: row.created_at,
    t: fmtTime(row.created_at),
    text: row.text || undefined,
    img: row.image_path ? { src: imgUrl(row.image_path), alt: "Billede" } : undefined,
    video: row.video_path ? { src: imgUrl(row.video_path) } : undefined,
    liked: !!(me && likes.some(function(l){ return l.user_id === me.id; })),
    likeCount: likes.length,
    feed: row.feed_id || undefined,
    poll: mapPoll(row) || undefined,
    cmts: cmts
  };
}
/* Teasers fra private kredse (kreds_teasers-RPC — serveren sender ALDRIG indhold) */
/* Kredse med en optimistisk 'Anmodning sendt' der endnu ikke er bekræftet af serveren */
const pendingReq = new Set();
async function mapTeasers(rows){
  const unknown = [];
  rows.forEach(function(r){
    if(!ID2H[r.author] && unknown.indexOf(r.author) < 0) unknown.push(r.author);
  });
  if(unknown.length){
    const r = await sb.from("profiles").select("*").in("id", unknown);
    if(!r.error) (r.data || []).forEach(registerProfile);
  }
  return rows.map(function(r){
    const requested = !!r.requested || pendingReq.has(r.feed_id);
    if(r.requested) pendingReq.delete(r.feed_id); // serveren har bekræftet — override unødig
    return {
      teaser: true,
      id: "t" + r.post_id,
      u: ID2H[r.author] || "?",
      created: r.created_at,
      t: fmtTime(r.created_at),
      feedId: r.feed_id,
      feedName: r.feed_name || "",
      requested: requested
    };
  });
}

/* ================= Ikoner (tabbar) ================= */
const IC = {
  homeO:'<path class="stroke" d="M3.9 10.7 12 3.6l8.1 7.1V20a1 1 0 0 1-1 1h-4.7v-6.4H9.6V21H4.9a1 1 0 0 1-1-1Z"/>',
  homeF:'<path class="fillic" d="M3.9 10.7 12 3.6l8.1 7.1V20a1 1 0 0 1-1 1h-4.7v-6.4H9.6V21H4.9a1 1 0 0 1-1-1Z"/>',
  searchO:'<g class="stroke"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/></g>',
  searchF:'<g class="stroke" stroke-width="2.9"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/></g>',
  heartO:'<path class="stroke" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  heartF:'<path class="fillic" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  userO:'<g class="stroke"><circle cx="12" cy="8" r="3.7"/><path d="M5 20c.8-3.7 3.6-5.6 7-5.6s6.2 1.9 7 5.6"/></g>',
  userF:'<circle class="fillic" cx="12" cy="8" r="4"/><path class="fillic" d="M4.4 20.5c.8-4 3.9-6.1 7.6-6.1s6.8 2.1 7.6 6.1Z"/>'
};
export function setTabIcons(active){
  el("ic-home").innerHTML   = active === "feed"   ? IC.homeF   : IC.homeO;
  el("ic-search").innerHTML = active === "search" ? IC.searchF : IC.searchO;
  el("ic-bell").innerHTML   = active === "akt"    ? IC.heartF  : IC.heartO;
  el("ic-user").innerHTML   = active === "profil" ? IC.userF   : IC.userO;
  const av = el("tab-ava"), fallbackIc = el("ic-user");
  if(me){
    av.style.display = "flex";
    fallbackIc.style.display = "none";
    av.innerHTML = avaHTML(me.handle, 18);
    av.classList.toggle("on", active === "profil");
  } else {
    av.style.display = "none";
    fallbackIc.style.display = "";
  }
}

/* ================= Timeline (X-anatomi: avatar-kolonne + indholdskolonne) ================= */
const BIGHEART = '<div class="bigheart"><svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></div>';
function cntHTML(n){
  return '<span class="cnt"'+(n > 0 ? '' : ' style="display:none"')+'>'+n+'</span>';
}
export function postHTML(p){
  let media = '';
  if(p.video){
    media = '<div class="pmedia" data-id="'+p.id+'">'+
        '<video src="'+esc(p.video.src)+'" playsinline muted loop autoplay preload="metadata"></video>'+
        BIGHEART+
      '</div>';
  } else if(p.img){
    media = '<div class="pmedia" data-id="'+p.id+'">'+
        '<img src="'+esc(p.img.src)+'" alt="'+esc(p.img.alt||"")+'" draggable="false">'+
        BIGHEART+
      '</div>';
  }
  return (
    '<article class="post" data-id="'+p.id+'">'+
      '<button class="pavab" data-u="'+esc(p.u)+'" aria-label="Profil">'+
        avaHTML(p.u, 40)+
      '</button>'+
      '<div class="pcol">'+
        '<div class="phead">'+
          '<span class="nm">'+esc(user(p.u).name)+'</span>'+
          '<span class="badge">'+BADGE+'</span>'+
          '<span class="ph">@'+esc(p.u)+' · '+esc(p.t)+'</span>'+
          '<button class="dots" data-id="'+p.id+'" aria-label="Mere">'+
            '<svg viewBox="0 0 24 24"><g class="fillic"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></g></svg>'+
          '</button>'+
        '</div>'+
        (p.text ? '<div class="ptext">'+esc(p.text)+'</div>' : '')+
        media+
        pollHTML(p)+
        '<div class="pactions">'+
          '<button class="cmt-btn" data-id="'+p.id+'" aria-label="Kommentarer">'+
            '<svg viewBox="0 0 24 24"><path class="stroke" d="M12 3.3a8.7 8.7 0 0 0-7.4 13.2L3.4 20.6l4.2-1.1A8.7 8.7 0 1 0 12 3.3Z"/></svg>'+
            cntHTML(p.cmts.length)+
          '</button>'+
          '<button class="like-btn'+(p.liked ? " on" : "")+'" data-id="'+p.id+'" aria-pressed="'+p.liked+'" aria-label="Like">'+
            HEART_SVG+
            cntHTML(p.likeCount)+
          '</button>'+
          '<button class="share-btn" data-id="'+p.id+'" aria-label="Del">'+
            '<svg viewBox="0 0 24 24"><path class="stroke" d="M21.5 2.5 10.8 13.2M21.5 2.5l-6.8 19-3.9-8.3-8.3-3.9Z"/></svg>'+
          '</button>'+
        '</div>'+
        cmtSectionHTML(p)+
      '</div>'+
    '</article>'
  );
}

/* ---- Teaser-kort: sløret pladsholder + anmod-knap (ingen actions/kommentarer) ---- */
export function teaserHTML(p){
  const name = user(p.u).name;
  const btn = p.requested
    ? '<button class="treq sent" data-f="'+esc(p.feedId)+'" disabled>Anmodning sendt ✓</button>'
    : '<button class="treq" data-f="'+esc(p.feedId)+'">Anmod om at være med</button>';
  return (
    '<article class="post teaser" data-tid="'+esc(p.id)+'">'+
      '<button class="pavab" data-u="'+esc(p.u)+'" aria-label="Profil">'+
        avaHTML(p.u, 40)+
      '</button>'+
      '<div class="pcol">'+
        '<div class="phead">'+
          '<span class="nm">'+esc(name)+'</span>'+
          '<span class="badge">'+BADGE+'</span>'+
          '<span class="ph">@'+esc(p.u)+' · '+esc(p.t)+'</span>'+
        '</div>'+
        '<div class="pmedia tmedia">'+
          '<div class="tblur" style="background:'+esc(grad(p.u))+'"></div>'+
          '<div class="tlock">'+
            '<span class="tic" aria-hidden="true">🔒</span>'+
            '<span class="ttxt">'+esc(name)+' delte i den private kreds “'+esc(p.feedName)+'”</span>'+
            btn+
          '</div>'+
        '</div>'+
      '</div>'+
    '</article>'
  );
}
function setTeaserReqUI(f, on){
  state.teasers.forEach(function(x){ if(x.feedId === f) x.requested = on; });
  document.querySelectorAll('.treq[data-f="'+f+'"]').forEach(function(b){
    b.disabled = on;
    b.classList.toggle("sent", on);
    b.textContent = on ? "Anmodning sendt ✓" : "Anmod om at være med";
  });
}
async function requestJoin(f){
  if(!me || !f) return;
  pendingReq.add(f);
  setTeaserReqUI(f, true);
  const { error } = await sb.rpc("request_join_kreds", { f: f });
  if(!error) return;
  console.error(error);
  const m = String(error.message || "");
  if(m.indexOf("already_member") >= 0){
    pendingReq.delete(f); // teaseren forsvinder alligevel
    toast("Du er allerede med i kredsen 🎉");
    scheduleRefetch();
    return;
  }
  pendingReq.delete(f);
  setTeaserReqUI(f, false);
  toast(m.indexOf("not_allowed") >= 0 ? "Du kan ikke anmode om at være med i den kreds" : GENERIC_ERR);
}

/* Bevar video-position hen over re-render af timeline-HTML
   (feed-videoer er altid lydløse — lyd hører til i lightboxen) */
export function snapVideos(container){
  const snap = new Map();
  container.querySelectorAll(".pmedia video").forEach(function(vid){
    const m = vid.closest(".pmedia");
    if(!m || !m.dataset.id) return;
    snap.set(m.dataset.id, { time: vid.currentTime });
  });
  return snap;
}
export function restoreVideos(container, snap){
  if(!snap || !snap.size) return;
  container.querySelectorAll(".pmedia video").forEach(function(vid){
    const m = vid.closest(".pmedia");
    const saved = m && m.dataset.id ? snap.get(m.dataset.id) : null;
    if(!saved) return;
    try{ vid.currentTime = saved.time; }catch(_){}
  });
}

export function renderFeed(){
  let html = "";
  if(state.currentFeed === "all" && me && !state.humanFriends.length){
    html += '<div class="emptynote" style="padding:24px 20px;text-align:center">Din kreds er tom endnu.<br>Find dine venner under Søg 🔍</div>';
  }
  /* Fastgjorte opslag fra den officielle profil hejses op FØR teaser-flet (kun 'Hele kredsen') */
  let rest = state.posts, pinned = [];
  if(state.currentFeed === "all"){
    pinned = state.posts.filter(function(p){ return p.u === OFFICIAL_HANDLE; });
    rest = state.posts.filter(function(p){ return p.u !== OFFICIAL_HANDLE; });
  }
  const items = (state.currentFeed === "all" && state.teasers.length)
    ? rest.concat(state.teasers).sort(function(a,b){ return new Date(b.created) - new Date(a.created); })
    : rest;
  pinned.forEach(function(p){
    html += '<div class="pinlabel">📌 Fastgjort</div>' + postHTML(p);
  });
  if(items.length){
    html += items.map(function(p){ return p.teaser ? teaserHTML(p) : postHTML(p); }).join("");
  } else if(!pinned.length && !(state.currentFeed === "all" && me && !state.humanFriends.length)){
    html += '<div class="emptynote" style="padding:36px 20px;text-align:center">Ingen opslag i denne kreds endnu.<br>Vær den første ✍️</div>';
  }
  const f = document.activeElement && document.activeElement.closest ? document.activeElement.closest("#feed .cfield") : null;
  const fpid = f ? f.dataset.id : null, selS = f ? f.selectionStart : 0, selE = f ? f.selectionEnd : 0;
  const vsnap = snapVideos(el("feed"));
  el("feed").innerHTML = html;
  restoreVideos(el("feed"), vsnap);
  if(fpid){
    const nf = el("feed").querySelector('.cbox[data-id="'+fpid+'"] .cfield');
    if(nf){ nf.focus(); try{ nf.setSelectionRange(selS, selE); }catch(_){} }
  }
}

/* ================= Data-hentning ================= */
export function postQuery(){
  return sb.from("posts").select(POST_SELECT)
    .order("created_at", { ascending:false })
    .order("created_at", { ascending:true, referencedTable:"comments" })
    .limit(100);
}
export async function loadPosts(){
  if(!me) return;
  try{
    const reqs = [ postQuery().is("feed_id", null) ];
    const cur = state.currentFeed;
    if(cur !== "all") reqs.push(postQuery().eq("feed_id", cur));
    else reqs.push(sb.rpc("kreds_teasers")); // kun i 'Hele kredsen'
    const res = await Promise.all(reqs);
    if(state.currentFeed !== cur) return;
    if(res[0].error) throw res[0].error;
    if(cur !== "all" && res[1].error) throw res[1].error;
    state.wholePosts = (res[0].data || []).map(mapPost);
    if(cur === "all"){
      state.posts = state.wholePosts;
      if(res[1].error){
        // Teasers er ren pynt — de må ikke vælte hele feedet
        console.error(res[1].error);
        state.teasers = [];
      } else {
        const t = await mapTeasers(res[1].data || []);
        if(state.currentFeed !== cur) return;
        state.teasers = t;
      }
    } else {
      state.teasers = [];
      state.posts = (res[1].data || []).map(mapPost);
    }
    renderFeed();
    renderStories();
    if(el("view-profil").classList.contains("active")) renderMyPosts();
  }catch(err){
    console.error(err);
    toast("Kunne ikke hente opslag. Prøv igen.");
  }
}
export async function loadFriends(){
  if(!me) return;
  const { data, error } = await sb.from("friendships")
    .select("created_at, friend_profile:profiles!friend_id(*)")
    .eq("user_id", me.id);
  if(error){ console.error(error); toast(GENERIC_ERR); return; }
  const hs = [];
  (data || []).forEach(function(r){
    if(r.friend_profile){
      registerProfile(r.friend_profile);
      FRIEND_SINCE[r.friend_profile.handle] = new Date(r.created_at).getFullYear();
      hs.push(r.friend_profile.handle);
    }
  });
  hs.sort();
  state.friends = hs;
  state.humanFriends = hs.filter(function(h){ return h !== OFFICIAL_HANDLE; });
  el("stat-friends").textContent = state.humanFriends.length;
}
export async function loadFeeds(){
  if(!me) return;
  const { data, error } = await sb.from("feeds").select("*, feed_members(user_id)");
  if(error){ console.error(error); toast(GENERIC_ERR); return; }
  const feeds = (data || []).map(function(f){
    return { id:f.id, name:f.name, owner:f.owner, created:f.created_at, memberIds:(f.feed_members||[]).map(function(m){ return m.user_id; }) };
  });
  feeds.sort(function(a,b){ return new Date(a.created) - new Date(b.created); });
  const unknown = [];
  feeds.forEach(function(f){
    f.memberIds.forEach(function(id){
      if(!ID2H[id] && unknown.indexOf(id) < 0) unknown.push(id);
    });
  });
  if(unknown.length){
    const r = await sb.from("profiles").select("*").in("id", unknown);
    if(!r.error) (r.data || []).forEach(registerProfile);
  }
  feeds.forEach(function(f){
    f.members = f.memberIds.map(function(id){ return ID2H[id]; }).filter(Boolean);
  });
  state.feeds = feeds;
}

/* ================= Kredse (egne feeds) ================= */
export function feedById(id){
  for(let i = 0; i < state.feeds.length; i++) if(state.feeds[i].id === id) return state.feeds[i];
  return null;
}
/* ---- Kreds-søgning i feedbaren (lup ved venstre kant) ---- */
const kseek = { on:false, q:"" };
export function resetFeedbarSearch(){
  kseek.on = false;
  kseek.q = "";
  el("feedbar").classList.remove("searching");
}
const SEEK_SVG = '<svg viewBox="0 0 24 24"><g class="stroke"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21"/></g></svg>';
const FBX_SVG = '<svg viewBox="0 0 24 24"><g class="stroke"><path d="M6 6l12 12M18 6 6 18"/></g></svg>';
function fbPillsHTML(){
  let html = '<button class="fpill'+(state.currentFeed === "all" ? " on" : "")+'" data-feed="all">Hele kredsen</button>';
  const q = kseek.q.trim().toLowerCase();
  const matches = state.feeds.filter(function(f){ return f.name.toLowerCase().indexOf(q) >= 0; });
  matches.forEach(function(f){
    html += '<button class="fpill'+(state.currentFeed === f.id ? " on" : "")+'" data-feed="'+esc(f.id)+'">'+esc(f.name)+'</button>';
  });
  if(q && !matches.length) html += '<span class="fbnone">Ingen kredse matcher</span>';
  return html;
}
export function renderFeedbar(){
  const bar = el("feedbar");
  bar.classList.toggle("searching", kseek.on);
  if(kseek.on){
    // Skriver brugeren i feltet (fx under en realtime-refetch), så bevar
    // fokus/caret og opdater kun pillerne
    const cur = el("fb-input");
    if(cur && document.activeElement === cur){
      el("fb-pills").innerHTML = fbPillsHTML();
      return;
    }
    bar.innerHTML =
      '<div class="fbsearch">'+SEEK_SVG+
        '<input id="fb-input" type="text" placeholder="Søg i dine kredse ..." autocomplete="off" autocapitalize="none">'+
        '<button class="fbx" id="fb-cancel" aria-label="Annuller søgning">'+FBX_SVG+'</button>'+
      '</div>'+
      '<span class="fbpills" id="fb-pills"></span>';
    el("fb-input").value = kseek.q;
    el("fb-pills").innerHTML = fbPillsHTML();
    return;
  }
  let html = '<button class="fbseek" aria-label="Søg i dine kredse">'+SEEK_SVG+'</button>';
  html += '<button class="fpill'+(state.currentFeed === "all" ? " on" : "")+'" data-feed="all">Hele kredsen</button>';
  state.feeds.forEach(function(f){
    html += '<button class="fpill'+(state.currentFeed === f.id ? " on" : "")+'" data-feed="'+esc(f.id)+'">'+esc(f.name)+'</button>';
  });
  html += '<button class="fpill new" data-feed="__new">+ Ny kreds</button>';
  bar.innerHTML = html;
}
export function renderKredshead(){
  const kh = el("kredshead");
  if(state.currentFeed === "all"){
    kh.style.display = "none";
    el("stories").style.display = "flex";
    return;
  }
  const f = feedById(state.currentFeed);
  if(!f){ kh.style.display = "none"; el("stories").style.display = "flex"; return; }
  el("stories").style.display = "none";
  const avs = f.members.map(function(m){
    return avaHTML(m, 30, "mav");
  }).join("");
  kh.innerHTML = '<div class="mstack">'+avs+'</div>'+
    '<div class="ktxt"><b>'+f.members.length+' medlemmer</b><br>Privat kreds — kun jer kan se og skrive her.</div>';
  kh.style.display = "flex";
}
export function setFeed(id){
  state.currentFeed = id;
  expandedCmts.clear();
  resetFeedbarSearch(); // kreds-søgningen lukkes/nulstilles ved feed-skift
  renderFeedbar();
  renderKredshead();
  el("feed").innerHTML = '<div class="emptynote" style="text-align:center">Henter …</div>';
  const done = loadPosts();
  el("app").scrollTop = 0;
  resetBarHide();
  return done; // kan awaites (fx notifikations-hop)
}

/* ================= Like-saldo (chip + profil, én datakilde) ================= */
export async function fetchLikeBalance(){
  if(!me) return null;
  const res = await Promise.all([
    sb.from("likes").select("*", { count:"exact", head:true }).eq("user_id", me.id),
    sb.from("likes").select("*, posts!inner(author)", { count:"exact", head:true }).eq("posts.author", me.id)
  ]);
  for(const r of res){ if(r.error) throw r.error; }
  const given = res[0].count || 0;
  const received = res[1].count || 0;
  return { given: given, received: received, room: Math.max(0, given + 1 - received) };
}
let quotaSeq = 0;
export async function loadQuota(){
  if(!me){ el("qchip").classList.remove("on"); return; }
  const t = ++quotaSeq;
  try{
    const b = await fetchLikeBalance();
    if(t !== quotaSeq || !me || !b) return;
    el("qchip-n").textContent = b.room;
    el("qchip").classList.add("on");
    el("nik-saldo").innerHTML =
      '<div class="nik1">Likes: givet <b>'+b.given+'</b> · modtaget <b>'+b.received+'</b> · plads til <b>'+b.room+'</b></div>'+
      '<div class="nik2">Du kan modtage ét like mere, end du selv har givet.</div>';
  }catch(err){
    console.error(err);
  }
}

/* ================= Skjul topbar ved scroll ned (vis igen ved scroll op / nær toppen) ================= */
let barHidden = false, barLastY = 0, barDownAcc = 0, barUpAcc = 0;
export function resetBarHide(){
  barHidden = false;
  barDownAcc = 0;
  barUpAcc = 0;
  barLastY = el("app").scrollTop || 0;
  document.body.classList.remove("hidebar");
}
function appScrolled(){
  // Klem scrollTop fast i [0, max] — iOS-bounce rapporterer værdier udenfor og
  // ville ellers vise baren igen efter et fling til bunden.
  const a = el("app");
  const max = Math.max(0, a.scrollHeight - a.clientHeight);
  const y = Math.min(Math.max(a.scrollTop, 0), max);
  const dy = y - barLastY;
  barLastY = y;
  if(y < 40){
    // Topzonen (pull-to-refresh) viser altid baren
    barDownAcc = 0;
    barUpAcc = 0;
    if(barHidden){ barHidden = false; document.body.classList.remove("hidebar"); }
    return;
  }
  if(dy > 0){
    barUpAcc = 0;
    barDownAcc += dy;
    if(!barHidden && barDownAcc > 24){ barHidden = true; document.body.classList.add("hidebar"); }
  } else if(dy < 0){
    barDownAcc = 0;
    barUpAcc -= dy; // lille tærskel, så jitter ikke flipper baren
    if(barHidden && barUpAcc > 6){ barHidden = false; document.body.classList.remove("hidebar"); }
  }
}

/* ================= Tabs ================= */
export function switchTab(name){
  setCurTab(name);
  document.querySelectorAll(".view").forEach(function(v){ v.classList.remove("active"); });
  el("view-"+name).classList.add("active");
  document.querySelectorAll(".tabbar [data-view]").forEach(function(b){
    b.classList.toggle("active", b.dataset.view === name);
  });
  setTabIcons(name);
  if(name === "search") renderSearch();
  if(name === "akt"){ loadNotifs(); setNotifDot(false); }
  if(name === "profil") renderMyPosts();
  el("app").scrollTop = 0;
  resetBarHide();
}

/* ================= Likes ================= */
export function allPostArrays(){ return [state.posts, state.wholePosts, pv.posts]; }
export function findPost(id){
  id = Number(id);
  const arrs = allPostArrays();
  for(let a = 0; a < arrs.length; a++){
    for(let i = 0; i < arrs[a].length; i++){
      if(Number(arrs[a][i].id) === id) return arrs[a][i];
    }
  }
  return null;
}
export function findPostAll(id){
  id = Number(id);
  const out = [];
  allPostArrays().forEach(function(arr){
    arr.forEach(function(p){
      if(Number(p.id) === id && out.indexOf(p) < 0) out.push(p);
    });
  });
  return out;
}
export function applyLikeUI(id, on){
  const p = findPost(id);
  document.querySelectorAll('.post[data-id="'+id+'"]').forEach(function(node){
    const btn = node.querySelector(".like-btn");
    if(!btn) return;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on);
    if(p){
      const c = btn.querySelector(".cnt");
      if(c){
        c.textContent = p.likeCount;
        c.style.display = p.likeCount > 0 ? "" : "none";
      }
    }
  });
}
export async function setLike(id, force){
  if(!me) return;
  const objs = findPostAll(id);
  if(!objs.length) return;
  const cur = objs[0].liked;
  const on = (force === undefined) ? !cur : !!force;
  if(on === cur) return;
  objs.forEach(function(p){ p.liked = on; p.likeCount = Math.max(0, (p.likeCount||0) + (on ? 1 : -1)); });
  applyLikeUI(id, on);
  let error = null;
  if(on){
    const r = await sb.from("likes").insert({ post_id:Number(id), user_id:me.id });
    error = (r.error && r.error.code !== "23505") ? r.error : null;
  } else {
    const r = await sb.from("likes").delete().eq("post_id", Number(id)).eq("user_id", me.id);
    error = r.error;
  }
  if(error){
    console.error(error);
    objs.forEach(function(p){ p.liked = cur; p.likeCount = Math.max(0, p.likeCount + (on ? -1 : 1)); });
    applyLikeUI(id, cur);
    if(on && String(error.message || "").indexOf("like_quota") >= 0){
      const fname = (user(objs[0].u).name || objs[0].u).trim().split(/\s+/)[0];
      toast(fname + " kan ikke modtage flere likes lige nu — de skal selv give likes for at få plads 😉");
    } else {
      toast(GENERIC_ERR);
    }
  }
  loadQuota();
}

/* ================= Egne opslag: menu, rediger, slet ================= */
let menuPid = null, editPid = null;

export function openPostMenu(id){
  menuPid = Number(id);
  el("pmenu-main").style.display = "";
  el("pmenu-confirm").style.display = "none";
  el("pmenu").classList.add("on");
}
export function closePostMenu(){
  el("pmenu").classList.remove("on");
  menuPid = null;
}

/* ================= Andres opslag: anmeld (⋯-menu) ================= */
let reportPid = null;

export function openReportMenu(id){
  reportPid = Number(id);
  el("rmenu-main").style.display = "";
  el("rmenu-confirm").style.display = "none";
  el("rmenu").classList.add("on");
}
export function closeReportMenu(){
  el("rmenu").classList.remove("on");
  reportPid = null;
}
async function reportPost(){
  const id = reportPid;
  if(id == null || !me) return;
  const btn = el("rm-report2");
  btn.disabled = true;
  const { error } = await sb.from("reports").insert({ post_id:id, user_id:me.id });
  btn.disabled = false;
  if(error && error.code !== "23505"){ // 23505 = allerede anmeldt — behandles som succes
    console.error(error);
    closeReportMenu();
    toast(GENERIC_ERR);
    return;
  }
  closeReportMenu();
  allPostArrays().forEach(function(arr){
    for(let i = arr.length - 1; i >= 0; i--){
      if(Number(arr[i].id) === id) arr.splice(i, 1);
    }
  });
  renderFeed();
  if(el("view-profil").classList.contains("active")) renderMyPosts();
  refreshPv();
  toast("Tak. Opslaget er anmeldt og skjult for dig.");
}

export function openPostEdit(id){
  const p = findPost(id);
  if(!p) return;
  editPid = Number(id);
  el("ed-field").value = p.text || "";
  el("ed-hint").style.display = "none";
  el("scrim").classList.add("on");
  el("edsheet").classList.add("on");
  setTimeout(function(){ el("ed-field").focus(); }, 260);
}
export function closePostEdit(){
  el("edsheet").classList.remove("on");
  editPid = null;
  if(!el("fsheet").classList.contains("on") && !el("esheet").classList.contains("on") && !el("msheet").classList.contains("on") && !el("asheet").classList.contains("on"))
    el("scrim").classList.remove("on");
}

async function savePostEdit(){
  const id = editPid;
  if(id == null || !me) return;
  const p = findPost(id);
  const text = el("ed-field").value.trim();
  if(!text && !(p && (p.img || p.video))){
    el("ed-hint").style.display = "";
    return;
  }
  const btn = el("ed-save");
  btn.disabled = true;
  const { error } = await sb.from("posts").update({ text: text || null }).eq("id", id);
  btn.disabled = false;
  if(error){
    console.error(error);
    toast(String(error.message || "").indexOf("blocked_content") >= 0 ? BLOCKED_MSG : GENERIC_ERR);
    return;
  }
  findPostAll(id).forEach(function(q){ q.text = text || undefined; });
  closePostEdit();
  renderFeed();
  if(el("view-profil").classList.contains("active")) renderMyPosts();
  toast("Opslaget er opdateret");
}

async function deleteOwnPost(){
  const id = menuPid;
  if(id == null || !me) return;
  const btn = el("pm-del2");
  btn.disabled = true;
  try{
    const r = await sb.from("posts").select("image_path, video_path").eq("id", id).maybeSingle();
    const paths = [];
    if(!r.error && r.data){
      if(r.data.image_path) paths.push(r.data.image_path);
      if(r.data.video_path) paths.push(r.data.video_path);
    }
    const del = await sb.from("posts").delete().eq("id", id);
    if(del.error) throw del.error;
    if(paths.length) sb.storage.from("post-images").remove(paths).catch(function(){});
    closePostMenu();
    await loadPosts();
    if(el("view-profil").classList.contains("active")) renderMyPosts();
    toast("Opslaget er slettet");
  }catch(err){
    console.error(err);
    toast("Kunne ikke slette opslaget. Prøv igen.");
  }finally{
    btn.disabled = false;
  }
}

/* ---- Deling (kun opslag til hele kredsen) ---- */
export function sharePost(id){
  const p = findPost(id);
  if(!p) return;
  if(p.feed){ toast("Privat kreds — ingen deling udenfor 🤫"); return; }
  const name = user(p.u).name || p.u;
  const text = name + " på VibeFeed" + (p.text ? ": " + p.text.slice(0, 120) : "");
  const url = "https://vibefeed.dk";
  if(navigator.share){
    navigator.share({ title:"VibeFeed", text:text, url:url }).catch(function(err){
      if(!err || err.name !== "AbortError"){
        console.error(err);
        toast(GENERIC_ERR);
      }
    });
    return;
  }
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text + " " + url).then(function(){
      toast("Kopieret til udklipsholderen");
    }, function(){
      toast(GENERIC_ERR);
    });
  } else {
    toast(GENERIC_ERR);
  }
}

/* ---- Klik i timeline ---- */
let lastTap = { id:null, t:0 };
let tapTimer = null; // afventende enkelt-tryk (åbn lightbox efter dobbelttryk-vinduet)
export function resetTapState(){
  clearTimeout(tapTimer);
  tapTimer = null;
  lastTap = { id:null, t:0 };
}
function timelineClick(e){
  const tq = e.target.closest(".treq");
  if(tq){ if(!tq.disabled) requestJoin(tq.dataset.f); return; }
  const like = e.target.closest(".like-btn");
  if(like){ setLike(like.dataset.id); return; }
  const vt = e.target.closest("[data-vote]");
  if(vt){ votePoll(vt.dataset.pid, vt.dataset.vote); return; }
  const lk = e.target.closest(".likec");
  if(lk){ toggleCmtLike(lk.dataset.cid); return; }
  const sv = e.target.closest(".csvar");
  if(sv){
    const node = sv.closest(".post");
    if(!node) return;
    const pid = node.dataset.id;
    cstate(pid).replyTo = { id:Number(sv.dataset.cid), u:sv.dataset.u };
    rerenderComposer(pid);
    const f = node.querySelector(".cfield");
    if(f) f.focus();
    return;
  }
  const cx = e.target.closest(".cchip-x");
  if(cx){ clearReply(cx.dataset.id); return; }
  const px = e.target.closest(".cprev-x");
  if(px){ clearCImg(px.dataset.id); return; }
  const ib = e.target.closest(".cimgb");
  if(ib){ setCfilePid(Number(ib.dataset.id)); el("cfile").click(); return; }
  const sd = e.target.closest(".csend");
  if(sd){ sendComment(sd.dataset.id); return; }
  const tg = e.target.closest(".cmt-toggle");
  if(tg){ toggleCmtSection(tg.dataset.id); return; }
  const cmt = e.target.closest(".cmt-btn");
  if(cmt){
    const opened = toggleCmtSection(cmt.dataset.id);
    if(opened){
      const node = cmt.closest(".post");
      const f = node && node.querySelector(".cfield");
      if(f) f.focus();
    }
    return;
  }
  const sh = e.target.closest(".share-btn");
  if(sh){ sharePost(sh.dataset.id); return; }
  const d = e.target.closest(".dots");
  if(d){
    const p = findPost(d.dataset.id);
    if(!me || !p) return;
    if(p.u === me.handle) openPostMenu(p.id);
    else openReportMenu(p.id);
    return;
  }
  const pr = e.target.closest(".pavab");
  if(pr && pr.dataset.u){
    if(me && pr.dataset.u === me.handle){ closeProfile(); switchTab("profil"); }
    else openProfile(pr.dataset.u);
    return;
  }
  const media = e.target.closest(".pmedia");
  if(media && media.dataset.id){
    const id = media.dataset.id;
    const now = Date.now();
    if(lastTap.id === id && now - lastTap.t < 320){
      // Dobbelttryk = like — det afventende enkelt-tryk (lightbox) annulleres
      clearTimeout(tapTimer);
      tapTimer = null;
      setLike(id, true);
      const bh = media.querySelector(".bigheart");
      bh.classList.remove("go");
      void bh.offsetWidth;
      bh.classList.add("go");
      lastTap = { id:null, t:0 };
    } else {
      lastTap = { id:id, t:now };
      // Enkelt-tryk = fuldskærm — men først når dobbelttryk-vinduet er udløbet
      const vid = media.querySelector("video");
      const img = media.querySelector("img");
      clearTimeout(tapTimer);
      tapTimer = setTimeout(function(){
        tapTimer = null;
        if(vid) openLightbox("video", vid.currentSrc || vid.src);
        else if(img) openLightbox("img", img.currentSrc || img.src);
      }, 330);
    }
  }
}

export function initFeed(){
el("app").addEventListener("scroll", appScrolled, { passive:true });
el("feedbar").addEventListener("click", function(e){
  if(e.target.closest(".fbseek")){
    kseek.on = true;
    kseek.q = "";
    renderFeedbar();
    const i = el("fb-input");
    if(i) i.focus();
    return;
  }
  if(e.target.closest("#fb-cancel")){
    resetFeedbarSearch();
    renderFeedbar();
    return;
  }
  const p = e.target.closest(".fpill");
  if(!p) return;
  if(p.dataset.feed === "__new"){ openFeedSheet(); return; }
  setFeed(p.dataset.feed); // nulstiller også søgetilstanden (alle piller tilbage)
});
el("feedbar").addEventListener("input", function(e){
  if(e.target && e.target.id === "fb-input"){
    kseek.q = e.target.value;
    const fp = el("fb-pills");
    if(fp) fp.innerHTML = fbPillsHTML();
  }
});
el("qchip").addEventListener("click", function(){
  const n = parseInt(el("qchip-n").textContent, 10) || 0;
  toast("Du kan modtage "+likesLabel(n)+" mere. Giv likes til andre for at få plads til flere.");
});
["feed","myposts","pv-posts"].forEach(function(id){
  el(id).addEventListener("click", timelineClick);
  el(id).addEventListener("input", cInput);
  el(id).addEventListener("keydown", cKey);
  el(id).addEventListener("focusout", function(e){ if(e.target.closest(".cfield") && me) scheduleRefetch(); });
});
/* ---- Egne opslag: menu-popup + rediger-sheet ---- */
el("pmenu").addEventListener("click", function(e){
  if(e.target === el("pmenu")) closePostMenu();
});
el("pm-cancel").addEventListener("click", closePostMenu);
el("pm-edit").addEventListener("click", function(){
  const id = menuPid;
  closePostMenu();
  if(id != null) openPostEdit(id);
});
el("pm-delete").addEventListener("click", function(){
  el("pmenu-main").style.display = "none";
  el("pmenu-confirm").style.display = "";
});
el("pm-del-cancel").addEventListener("click", closePostMenu);
el("pm-del2").addEventListener("click", deleteOwnPost);
/* ---- Andres opslag: anmeld-popup ---- */
el("rmenu").addEventListener("click", function(e){
  if(e.target === el("rmenu")) closeReportMenu();
});
el("rm-cancel").addEventListener("click", closeReportMenu);
el("rm-cancel2").addEventListener("click", closeReportMenu);
el("rm-report").addEventListener("click", function(){
  el("rmenu-main").style.display = "none";
  el("rmenu-confirm").style.display = "";
});
el("rm-report2").addEventListener("click", reportPost);
/* ---- Kreds-medlemmer: sheet åbnes fra kredshead ---- */
el("kredshead").addEventListener("click", function(){ openMemberSheet(); });
el("kredshead").addEventListener("keydown", function(e){
  if(e.key === "Enter" || e.key === " "){ e.preventDefault(); openMemberSheet(); }
});
el("ed-save").addEventListener("click", savePostEdit);
el("ed-field").addEventListener("input", function(){
  el("ed-hint").style.display = "none";
});
}
