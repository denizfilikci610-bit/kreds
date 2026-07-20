import { sb, OFFICIAL_HANDLE } from "./config.js";
import { me, state, FRIEND_SINCE, pv, curTab, expandedCmts } from "./store.js";
import { el, esc, avaHTML, user, toast, uuid, registerProfile, fmtTime, getConsent, setConsent, imgUrl, ini } from "./helpers.js";
import { t, setLang, getLang, policyURL } from "./i18n.js";
import { postHTML, postQuery, mapPost, setTabIcons, renderFeed, loadQuota, snapVideos, restoreVideos, loadFriends, loadPosts, clampMemCaps, applyFeedSound, switchTab, setFeed } from "./feed.js";
import { openNativePostPage, rerenderPostCmts } from "./comments.js";
import { openCompose, openStoryCamera } from "./compose.js";
import { openStoryViewer } from "./stories.js";
import { renderSearch, refreshSearchAfterFriendAdd } from "./search.js";
import { resetApp, showAuth, nativeLogout } from "./auth.js";

/* ================= Bobler-række ================= */
export function renderStories(){
  if(!me){ el("stories").innerHTML = ""; return; }
  const groups = state.storyGroups || [];
  const mine = groups.find(function(g){ return g.isMe; });
  const meRing = mine ? (mine.allSeen ? " seen" : " unseen") : "";
  let html =
    '<button class="story'+meRing+'" data-u="'+esc(me.handle)+'" data-me="1">'+
      '<div class="ringwrap"><div class="bub">'+avaHTML(me.handle, 56)+'</div>'+
      '<span class="plusb">+</span></div>'+
      '<span class="lbl">'+t("profile.you")+'</span>'+
    '</button>';
  groups.forEach(function(g){
    if(g.isMe) return;
    html +=
      '<button class="story '+(g.allSeen ? "seen" : "unseen")+'" data-u="'+esc(g.author.handle)+'">'+
        '<div class="ringwrap"><div class="bub">'+avaHTML(g.author.handle, 56)+'</div></div>'+
        '<span class="lbl">'+esc((g.author.name || g.author.handle).split(" ")[0])+'</span>'+
      '</button>';
  });
  el("stories").innerHTML = html;
}

/* ================= Egen profil ================= */
/* ---- Profil-tidslinje: toggle "Tanker" (kort, KUN tanker) / "Minder" (3-kolonne grid, KUN minder).
   Grid-tap på et minde → hele opslaget (likes/kommentarer) i samme container (genbruger timelineClick). ---- */
let myTab = "list", pvTab = "list"; // 'list' (Tanker) | 'grid' (Minder)
const P_GRID_ICON = '<svg viewBox="0 0 24 24" width="17" height="17"><g fill="currentColor"><rect x="3" y="3" width="7" height="7" rx="1.4"/><rect x="14" y="3" width="7" height="7" rx="1.4"/><rect x="3" y="14" width="7" height="7" rx="1.4"/><rect x="14" y="14" width="7" height="7" rx="1.4"/></g></svg>';
const P_LIST_ICON = '<svg viewBox="0 0 24 24" width="17" height="17"><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></g></svg>';
/* Et minde åbnes nu i en dedikeret fuldskærms-side (#memview), ikke inline i profilen. */
function timelineHTML(posts, tab, emptyHTML){
  const bar = '<div class="profbar">'+
    '<button class="profbar-btn'+(tab === "grid" ? " on" : "")+'" data-ptab="grid" aria-label="'+esc(t("prof.grid"))+'">'+P_GRID_ICON+'</button>'+
    '<button class="profbar-btn'+(tab === "list" ? " on" : "")+'" data-ptab="list" aria-label="'+esc(t("prof.list"))+'">'+P_LIST_ICON+'</button>'+
  '</div>';
  let body;
  if(tab === "grid"){
    const mems = posts.filter(function(p){ return p.kind === "memory" && (p.img || p.video); });
    body = mems.length
      ? '<div class="pgrid">'+mems.map(function(p){
          const m = p.video
            ? '<video src="'+esc(p.video.src)+'#t=0.1" muted playsinline preload="metadata"></video>'
            : '<img src="'+esc(p.img.src)+'" alt="" loading="lazy" draggable="false">';
          return '<button class="pgrid-item" data-mem="'+esc(p.id)+'">'+m+(p.video ? '<span class="pgrid-play"></span>' : '')+'</button>';
        }).join("")+'</div>'
      : '<div class="emptynote">'+t("memories.empty")+'</div>';
  } else {
    const thoughts = posts.filter(function(p){ return p.kind !== "memory"; }); // Tanker: minder vises IKKE her
    body = thoughts.length ? thoughts.map(postHTML).join("") : emptyHTML;
  }
  return bar + body;
}

/* Ét opslag i fuldskærms-siden #memview (glider ind fra højre). Genbruger den delte postHTML, så
   HELE kortet (header, medie, knapper, tekst, kommentarer) vises; alle interaktioner
   (like/kommentar/del/⋯/dobbelttryk/lightbox + det native kommentar-sheet) virker via feed.js'
   delegering, som også er bundet til #mv-body. Titlen følger opslags-typen (Minde/Opslag). */
function openMemView(p){
  if(!p) return;
  el("mv-title").textContent = t(p.kind === "memory" ? "memview.title" : "postview.title");
  el("mv-body").innerHTML = postHTML(p);
  clampMemCaps(el("mv-body"));
  applyFeedSound(); // lyd-prioriteten flytter til detalje-sidens kopi af videoen
  el("mv-body").scrollTop = 0;
  el("memview").classList.add("on");
}
/* Opslags-detaljesiden (X-agtig: opslaget øverst, kommentartråden under). I app'en med
   __vfPostPage åbnes den ÆGTE native fuldskærms-side (PostPageView.swift, web-drevet);
   browser + ældre builds får web-siden (#memview-skallen) med tråden foldet ud. */
export function openPostView(p){
  if(!p) return;
  if(p.kind !== "memory" && window.__vfNative && window.__vfPostPage){
    openNativePostPage(p.id);
    return;
  }
  if(p.kind !== "memory") expandedCmts.add(Number(p.id)); // tråd + composer synlige fra start
  openMemView(p);
}
export function closeMemView(){
  // Detalje-sidens udfoldede tråd deler expandedCmts med feedet (samme pid) — klap den
  // sammen igen ved luk, ellers stod hele tråden pludselig fremme i feedet bagved.
  const node = el("mv-body").querySelector(".post[data-id]");
  el("memview").classList.remove("on");
  el("mv-body").innerHTML = ""; // stop evt. videoafspilning + frigiv
  if(node){
    const pid = Number(node.dataset.id);
    if(expandedCmts.has(pid)){
      expandedCmts.delete(pid);
      rerenderPostCmts(pid);
    }
  }
  applyFeedSound(); // lyd-prioriteten tilbage til den aktive fanes kopi
}

export async function renderMyPosts(){
  if(!me) return;
  // Kun venne-opslag (feed_id null) — kreds-opslag hører til i kredsen, ikke på profilen
  const mine = state.wholePosts.filter(function(p){ return p.u === me.handle && !p.feed; });
  el("stat-posts").textContent = mine.length;
  el("stat-friends").textContent = state.humanFriends.length;
  el("stat-kredse").textContent = state.feeds.length;
  const vsnap = snapVideos(el("myposts"));
  el("myposts").innerHTML = timelineHTML(mine, myTab, '<div class="emptynote">'+t("myposts.empty")+'</div>');
  restoreVideos(el("myposts"), vsnap);
  applyFeedSound();
  clampMemCaps(el("myposts"));
  loadQuota();
  const r = await sb.from("posts").select("id", { count:"exact", head:true }).eq("author", me.id).is("feed_id", null);
  if(!r.error && r.count != null && me) el("stat-posts").textContent = r.count;
}

function renderBanner(id, path){
  const node = el(id);
  node.innerHTML = path ? '<img src="' + esc(imgUrl(path)) + '" alt="">' : "";
  node.classList.toggle("on", !!path);
  // Header-rækken lige under banneret får overlap-layoutet (avatar halvt ind over banneret)
  const head = node.nextElementSibling;
  if(head && head.classList.contains("phead-own")) head.classList.toggle("withban", !!path);
}
export function setOwnUI(){
  renderBanner("own-banner", me.banner_path);
  el("own-ava").innerHTML = avaHTML(me.handle, 86);
  el("own-name").textContent = user(me.handle).name;
  el("own-handle").textContent = "@" + me.handle;
  const bio = (me.bio || "").trim();
  el("own-bio").textContent = bio;
  el("own-bio").style.display = bio ? "" : "none";
  el("compose-me-ava").innerHTML = avaHTML(me.handle, 44);
}

export function closeEditSheet(){
  if(window.__vfEsheet){ epStagedAvatar = null; epStagedBanner = null; window.__vfEsheetPush({ close: true }); return; }
  el("esheet").classList.remove("on");
  if(!el("fsheet").classList.contains("on") && !el("edsheet").classList.contains("on") && !el("msheet").classList.contains("on") && !el("asheet").classList.contains("on"))
    el("scrim").classList.remove("on");
}
function epCan(){ el("ep-save").disabled = !el("ep-name").value.trim(); }

/* ---- Reklame-samtykke (Privatliv-chips i Rediger profil) ---- */
function syncAdsChips(){
  const c = getConsent();
  el("ads-personal").classList.toggle("on", c === "personal");
  el("ads-limited").classList.toggle("on", c === "limited");
}

/* ================= Rediger profil — native glas-sheet (app'en) =================
   "Gem gør alt": navn/bio/aktivitet/sprog/samtykke + et evt. valgt foto samles og
   committes FØRST når man trykker Gem. Web'en ejer alle mutationer; native staged'er. */
let epStagedAvatar = null; // data-URL for et valgt (endnu ikke gemt) profilbillede
let epStagedBanner = null; // data-URL for et valgt (endnu ikke gemt) profil-banner
let epToken = 0;

function epheetSnapshot(){
  return {
    open: true,
    token: ++epToken,
    title: t("profile.edit"),
    picLabel: t("ep.pic"),
    nameLabel: t("ep.name"), namePlaceholder: t("ep.name_ph"), nameMaxLength: 40,
    handleLabel: t("ep.handle"), handle: me ? (me.handle || "") : "", // vises read-only (Brugernavn)
    bannerLabel: t("ep.banner"),
    bannerUrl: me && me.banner_path ? imgUrl(me.banner_path) : "",
    useLabel: t("ep.use"), // "Brug"-knappen i den native beskærings-flade
    bioLabel: t("ep.bio"), bioPlaceholder: t("ep.bio_ph"), bioMaxLength: 160,
    activityLabel: t("ep.activity"), shareLabel: t("ep.share"), shareNote: t("ep.share_note"),
    langLabel: t("ep.lang"), langDaLabel: "Dansk", langEnLabel: "English",
    privacyLabel: t("ep.privacy"), adsPersonalLabel: t("ep.ads_personal"), adsLimitedLabel: t("ep.ads_limited"),
    policyLabel: t("consent.policy"),
    // Absolut, sprogafhængig URL — native åbner den selv i Safari (window.open over broen
    // blokeres af WKWebView, og en navigation væk fra index.html ville dræbe SPA'en)
    policyUrl: location.origin + policyURL(),
    saveLabel: t("common.save"), deleteOpenLabel: t("del.title"),
    delSure: t("del.sure"), delText: t("del.text"), delBtn: t("del.btn"), cancelLabel: t("common.cancel"),
    avatar: meAvatarCard(),
    name: me ? (me.name || "") : "",
    bio: me ? (me.bio || "") : "",
    share: me ? (me.show_activity !== false) : true,
    lang: getLang(),
    consent: getConsent()
  };
}
function meAvatarCard(){
  if(!me) return { avatarUrl: "", initials: "?", gradient: [] };
  return { avatarUrl: me.avatar_path ? imgUrl(me.avatar_path) : "", initials: ini(me.handle), gradient: user(me.handle).g || [] };
}
/* Native → web: window.vfAvatar(dataURL) — stager billedet (uploades først ved Gem). */
export function avatarStage(dataURL){ epStagedAvatar = dataURL || null; }
export function bannerStage(dataURL){ epStagedBanner = dataURL || null; }
/* Native → web: window.vfEsheet(obj). Sprog/samtykke sendes KUN i 'save' (Gem gør alt). */
export function nativeEsheetAction(obj){
  if(!obj) return;
  switch(obj.kind){
    case "dismiss": closeEditSheet(); break;
    case "policy": window.open(policyURL(), "_blank"); break;
    case "save": nativeEsheetSave(obj); break;
    case "delete": nativeEsheetDelete(); break;
  }
}
/* Fælles avatar-pipeline (delt af web-fil-input og det native Gem). */
function imgFromSource(src){
  return new Promise(function(resolve, reject){
    const img = new Image();
    img.onload = function(){ resolve(img); };
    img.onerror = function(){ reject(new Error("img_load")); };
    img.src = src;
  });
}
function avatarBlobFromImage(img){
  return new Promise(function(resolve){
    const side = Math.min(img.width, img.height);
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    c.getContext("2d").drawImage(img, (img.width - side)/2, (img.height - side)/2, side, side, 0, 0, 512, 512);
    c.toBlob(function(blob){ resolve(blob); }, "image/jpeg", 0.85);
  });
}
/* Banner: cover-beskaering til 1280x432 (ca. 3:1, YouTube-agtigt) */
function bannerBlobFromImage(img){
  return new Promise(function(resolve){
    const W = 1280, H = 432;
    const scale = Math.max(W / img.width, H / img.height);
    const sw = W / scale, sh = H / scale;
    const sx = (img.width - sw) / 2, sy = (img.height - sh) / 2;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    c.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
    c.toBlob(function(blob){ resolve(blob); }, "image/jpeg", 0.85);
  });
}
async function uploadBannerBlob(blob){
  let path = me.id + "/banner-" + uuid() + ".jpg";
  const up = await sb.storage.from("post-images").upload(path, blob, { contentType: "image/jpeg" });
  if(up.error) throw up.error;
  return (up.data && up.data.path) ? up.data.path : path;
}
async function uploadAvatarBlob(blob){
  let path = me.id + "/avatar-" + uuid() + ".jpg";
  const up = await sb.storage.from("post-images").upload(path, blob, { contentType: "image/jpeg" });
  if(up.error) throw up.error;
  return (up.data && up.data.path) ? up.data.path : path;
}
/* Gem gør ALT: upload evt. staged foto → profil-felter (+ avatar) → sprog + samtykke → luk. */
async function nativeEsheetSave(obj){
  if(!me){ window.__vfEsheetPush({ update: true, saving: false }); return; }
  const name = (obj.name || "").trim();
  const bio = (obj.bio || "").trim().slice(0, 160);
  const share = obj.share !== false;
  if(!name){ window.__vfEsheetPush({ update: true, saving: false }); return; }
  try{
    let newPath = null; const oldPath = me.avatar_path;
    if(epStagedAvatar){
      const img = await imgFromSource(epStagedAvatar);
      const blob = await avatarBlobFromImage(img);
      if(!blob) throw new Error("img");
      newPath = await uploadAvatarBlob(blob);
    }
    let newBanner = null; const oldBanner = me.banner_path;
    if(epStagedBanner){
      const bimg = await imgFromSource(epStagedBanner);
      const bblob = await bannerBlobFromImage(bimg);
      if(!bblob) throw new Error("img");
      newBanner = await uploadBannerBlob(bblob);
    }
    const patch = { name: name, bio: bio || null, show_activity: share };
    if(newPath) patch.avatar_path = newPath;
    if(newBanner) patch.banner_path = newBanner;
    const { error } = await sb.from("profiles").update(patch).eq("id", me.id);
    if(error){
      if(newPath) sb.storage.from("post-images").remove([newPath]).catch(function(){});
      if(newBanner) sb.storage.from("post-images").remove([newBanner]).catch(function(){});
      throw error;
    }
    if(newPath && oldPath) sb.storage.from("post-images").remove([oldPath]).catch(function(){});
    if(newBanner && oldBanner) sb.storage.from("post-images").remove([oldBanner]).catch(function(){});
    me.name = name; me.bio = bio || null; me.show_activity = share;
    if(newPath) me.avatar_path = newPath;
    if(newBanner) me.banner_path = newBanner;
    registerProfile(me);
    const newConsent = obj.consent === "limited" ? "limited" : "personal";
    if(newConsent !== getConsent()) setConsent(newConsent); // per-enhed; poster til ad-broen
    epStagedAvatar = null;
    epStagedBanner = null;
    window.__vfEsheetPush({ close: true });
    setOwnUI(); renderFeed(); renderStories(); renderMyPosts(); setTabIcons(curTab); refreshPv();
    if(el("view-search").classList.contains("active")) renderSearch();
    const newLang = obj.lang === "en" ? "en" : "da";
    if(newLang !== getLang()) setLang(newLang); // kun ved faktisk skift: gen-renderer hele app'en
    toast(t("profile.updated"));
  }catch(err){
    console.error(err);
    toast(String((err && err.message) || "").indexOf("blocked_content") >= 0 ? t("err.blocked") : t("err.generic"));
    window.__vfEsheetPush({ update: true, saving: false });
  }
}
async function nativeEsheetDelete(){
  if(!me){ window.__vfEsheetPush({ update: true, deleting: false }); return; }
  try{
    const { data, error } = await sb.functions.invoke("delete-account", { body: {} });
    if(error || !data || !data.ok) throw (error || new Error("delete_failed"));
    nativeLogout();
    try{ await sb.auth.signOut(); }catch(_e){}
    closeEditSheet();
    resetApp();
    showAuth();
    toast(t("account.deleted"));
  }catch(err){
    console.error(err);
    toast(t("account.delete_failed"));
    window.__vfEsheetPush({ update: true, deleting: false });
  }
}

/* ================= Aktivitet (samtykke-styret visning af likes/kommentarer) ================= */
const ACT_H = '<svg viewBox="0 0 24 24"><path class="stroke" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
const ACT_B = '<svg viewBox="0 0 24 24"><path class="stroke" d="M12 3.3a8.7 8.7 0 0 0-7.4 13.2L3.4 20.6l4.2-1.1A8.7 8.7 0 1 0 12 3.3Z"/></svg>';

export function closeActivitySheet(){
  el("asheet").classList.remove("on");
  if(!el("fsheet").classList.contains("on") && !el("esheet").classList.contains("on") &&
     !el("edsheet").classList.contains("on") && !el("msheet").classList.contains("on"))
    el("scrim").classList.remove("on");
}
async function openActivitySheet(h){
  el("as-title").textContent = t("act.title", { name: user(h).name });
  el("as-list").innerHTML = '<div class="emptynote">'+t("common.loading")+'</div>';
  el("scrim").classList.add("on");
  el("asheet").classList.add("on");
  // Kun DAGENS aktivitet: send enhedens lokale midnat som nedre grænse.
  const since = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const { data, error } = await sb.rpc("activity_of", { u: user(h).id, since: since });
  if(!el("asheet").classList.contains("on")) return; // lukket imens
  if(error){
    console.error(error);
    el("as-list").innerHTML = '<div class="emptynote">'+t("act.load_failed")+'</div>';
    return;
  }
  const rows = data || [];
  el("as-list").innerHTML = rows.length
    ? rows.map(function(r){
        const like = r.kind === "like";
        const txt = t(like ? "act.liked" : "act.commented", { name: esc(r.target_name) })
          + (r.snippet ? ': “'+esc(r.snippet)+'”' : '');
        return '<div class="notif">'+
          '<div class="nicon '+(like ? "heart" : "bubble")+'">'+(like ? ACT_H : ACT_B)+'</div>'+
          '<div class="grow"><div class="ntext">'+txt+' <span class="nt">'+esc(fmtTime(r.created_at))+'</span></div></div>'+
        '</div>';
      }).join("")
    : '<div class="emptynote">'+t("act.empty")+'</div>';
}

/* ================= Venne- og kreds-lister (tap på tallene på en profil) =================
   Egen profil: alle venner og alle kredse (client-side). Andres profil: vennelisten via
   friends_of-RPC'en (blokerings-hygiejne i DB), og kredse viser KUN de kredse man deler,
   private kredses eksistens må aldrig lækkes (samme princip som teaser-fjernelsen). */
export function closeListSheet(){
  el("lsheet").classList.remove("on");
  if(!el("fsheet").classList.contains("on") && !el("esheet").classList.contains("on") &&
     !el("edsheet").classList.contains("on") && !el("msheet").classList.contains("on") &&
     !el("asheet").classList.contains("on"))
    el("scrim").classList.remove("on");
}
const LIST_KREDS_SVG = '<svg viewBox="0 0 24 24"><circle class="stroke" cx="12" cy="12" r="7.3"/><g class="fillic"><circle cx="12" cy="4.7" r="2.1"/><circle cx="5.7" cy="15.7" r="2.1"/><circle cx="18.3" cy="15.7" r="2.1"/></g></svg>';
function listRowFriend(h){
  const u = user(h);
  return '<button class="lrow" data-u="'+esc(h)+'">'+avaHTML(h, 40)+
    '<span class="lcol"><span class="lnm">'+esc(u.name)+'</span><span class="lh">@'+esc(h)+'</span></span>'+
  '</button>';
}
function listRowKreds(f){
  return '<button class="lrow" data-feed="'+esc(f.id)+'">'+
    '<span class="lki">'+LIST_KREDS_SVG+'</span>'+
    '<span class="lcol"><span class="lnm">'+esc(f.name)+'</span><span class="lh">'+t("list.member_count", { n: f.members.length })+'</span></span>'+
  '</button>';
}
function showListSheet(title){
  el("ls-title").textContent = title;
  el("ls-list").innerHTML = '<div class="emptynote">'+t("common.loading")+'</div>';
  el("scrim").classList.add("on");
  el("lsheet").classList.add("on");
}
async function openFriendsList(h){
  showListSheet(t("list.friends"));
  if(me && h === me.handle){
    const hs = state.humanFriends;
    el("ls-list").innerHTML = hs.length ? hs.map(listRowFriend).join("") : '<div class="emptynote">'+t("list.empty_friends")+'</div>';
    return;
  }
  const uid = user(h).id;
  if(!uid){ el("ls-list").innerHTML = '<div class="emptynote">'+t("err.generic")+'</div>'; return; }
  const { data, error } = await sb.rpc("friends_of", { u: uid });
  if(!el("lsheet").classList.contains("on")) return; // lukket imens
  if(error){
    console.error(error);
    el("ls-list").innerHTML = '<div class="emptynote">'+t("act.load_failed")+'</div>';
    return;
  }
  (data || []).forEach(registerProfile);
  const hs = (data || []).map(function(pr){ return pr.handle; })
    .filter(function(x){ return x && x !== OFFICIAL_HANDLE; })
    .sort();
  el("ls-list").innerHTML = hs.length ? hs.map(listRowFriend).join("") : '<div class="emptynote">'+t("list.empty_friends")+'</div>';
}
function openKredsList(h){
  const own = !!(me && h === me.handle);
  showListSheet(own ? t("list.kredse") : t("list.shared_kredse"));
  const uid = user(h).id;
  const feeds = own ? state.feeds : state.feeds.filter(function(f){ return uid && f.memberIds.indexOf(uid) >= 0; });
  let html = own ? "" : '<div class="lnote">'+t("list.shared_note")+'</div>';
  html += feeds.length
    ? feeds.map(listRowKreds).join("")
    : '<div class="emptynote">'+t(own ? "list.empty_kredse" : "list.empty_shared")+'</div>';
  el("ls-list").innerHTML = html;
}

/* ---- Native liste-SIDE (kun appen): Instagram-agtig fuldskærms-side med Venner/Kredse-
   faner, søgefelt og swipe-tilbage (ListPageView.swift). Web bygger snapshotten med BEGGE
   datasæt (fane-skift er rent nativt) og pusher; andres venneliste hentes async via
   friends_of og efter-pushes. Browser + ældre builds beholder web-sheetet (#lsheet). ---- */
let nativeListH = null; // handle for den åbne liste-side (null = lukket)
function friendCard(h){
  const u = user(h);
  return { handle: h, name: u.name || h, avatarUrl: u.avatar_path ? imgUrl(u.avatar_path) : "",
           initials: ini(h), gradient: u.g || [] };
}
function listPageSnapshot(h, tab, friendHandles){
  const own = !!(me && h === me.handle);
  const uid = user(h).id;
  const feeds = own ? state.feeds : state.feeds.filter(function(f){ return uid && f.memberIds.indexOf(uid) >= 0; });
  return {
    open: true,
    title: h,
    tab: tab === "kredse" ? "kredse" : "friends",
    friends: friendHandles ? friendHandles.map(friendCard) : null, // null = henter stadig
    kredse: feeds.map(function(f){ return { id: f.id, name: f.name, members: t("list.member_count", { n: f.members.length }) }; }),
    sharedNote: own ? "" : t("list.shared_note"),
    labels: {
      friendsTab: t("list.friends"),
      kredseTab: own ? t("list.kredse") : t("list.shared_kredse"),
      searchPh: t("list.search_ph"),
      emptyFriends: t("list.empty_friends"),
      emptyKredse: t(own ? "list.empty_kredse" : "list.empty_shared")
    }
  };
}
async function openNativeListPage(h, tab){
  nativeListH = h;
  const own = !!(me && h === me.handle);
  if(own){
    if(window.__vfListPagePush) window.__vfListPagePush(listPageSnapshot(h, tab, state.humanFriends));
    return;
  }
  // Andres profil: vis siden straks (venner spinner), hent så listen og efter-push
  if(window.__vfListPagePush) window.__vfListPagePush(listPageSnapshot(h, tab, null));
  const uid = user(h).id;
  if(!uid) return;
  const { data, error } = await sb.rpc("friends_of", { u: uid });
  if(nativeListH !== h) return; // lukket eller skiftet imens
  if(error){
    console.error(error);
    if(window.__vfListPagePush) window.__vfListPagePush(listPageSnapshot(h, tab, []));
    return;
  }
  (data || []).forEach(registerProfile);
  const hs = (data || []).map(function(pr){ return pr.handle; })
    .filter(function(x){ return x && x !== OFFICIAL_HANDLE; })
    .sort();
  if(window.__vfListPagePush) window.__vfListPagePush(listPageSnapshot(h, tab, hs));
}
export function closeNativeListPage(){
  if(nativeListH == null) return;
  nativeListH = null;
  if(window.__vfListPagePush) window.__vfListPagePush({ close: true });
}
export function nativeListPageAction(payload){
  if(!payload) return;
  if(payload.kind === "dismiss"){
    nativeListH = null;
    if(window.__vfListPagePush) window.__vfListPagePush({ close: true });
    return;
  }
  if(payload.kind === "profile"){
    const h = payload.handle;
    if(!h) return;
    closeNativeListPage();
    if(me && h === me.handle){ closeProfile(); switchTab("profil"); }
    else openProfile(h);
    return;
  }
  if(payload.kind === "kreds"){
    closeNativeListPage();
    closeProfile();
    switchTab("feed");
    setFeed(payload.id);
  }
}

/* ---- Slet konto (popup) ---- */
export function resetDeleteUI(){
  el("delmodal").classList.remove("on");
  el("del-input").value = "";
  el("del-btn").disabled = true;
}

/* ================= Ven-profil (og ikke-ven-profil) ================= */
function pvIsFriend(h){
  return !!(me && (h === me.handle || h === OFFICIAL_HANDLE || state.friends.indexOf(h) >= 0));
}
/* Relations-linjen: venner (og botten) ser "I din kreds siden …" + en lille grå
   "Fjern ven"-knap (aldrig på egen profil eller den officielle bot);
   ikke-venner ser en rød "Tilføj til din kreds"-chip i stedet */
function pvIsBlocked(h){
  const u = user(h);
  return !!(u.id && (state.blockedIds || []).indexOf(u.id) >= 0);
}
function renderPvRelation(h){
  const since = el("pv-since"), add = el("pv-add"), unf = el("pv-unfriend"),
        blk = el("pv-block"), unb = el("pv-unblock");
  const other = !!(me && h !== me.handle && h !== OFFICIAL_HANDLE);
  if(pvIsBlocked(h)){
    // Blokeret: kun "Fjern blokering" (administrationen ER profilen — Instagram-stil)
    since.style.display = "none";
    add.style.display = "none";
    unf.style.display = "none";
    blk.style.display = "none";
    unb.style.display = "";
    unb.disabled = false;
    return;
  }
  unb.style.display = "none";
  blk.style.display = (other && state.blockReady) ? "" : "none";
  if(pvIsFriend(h)){
    since.style.display = "";
    since.textContent = t("pv.since", { year: FRIEND_SINCE[h] || user(h).since || t("pv.today") });
    add.style.display = "none";
    unf.style.display = other ? "" : "none";
  } else {
    since.style.display = "none";
    add.style.display = "";
    add.disabled = false;
    unf.style.display = "none";
    // Har jeg allerede en udestående anmodning til denne person?
    const pending = state.sentRequests.indexOf(h) >= 0;
    add.classList.remove("done");
    add.classList.toggle("pending", pending);
    add.textContent = pending ? t("pv.requested") : t("pv.add");
  }
}

/* ---- Fjern ven (bekræftelses-popup — pmenu/modal-mønsteret) ---- */
let ufHandle = null;
function openUnfriendMenu(h){
  ufHandle = h;
  // App'en: ægte native Liquid Glass-kort i stedet for web-modalen.
  if(window.__vfGlassCard && window.__vfSheetPost){
    window.__vfSheetPost({
      title: t("pv.remove_confirm", { name: user(h).name }),
      buttons: [
        { label: t("pv.remove"), action: "unfriend", role: "destructive" },
        { label: t("common.cancel"), action: "__cancel", role: "cancel" }
      ]
    }, function(a){ if(a === "unfriend") doRemoveFriend(); });
    return;
  }
  el("uf-title").innerHTML = t("pv.remove_confirm", { name: esc(user(h).name) });
  el("uf-confirm").disabled = false;
  el("ufmenu").classList.add("on");
}
export function closeUnfriendMenu(){
  el("ufmenu").classList.remove("on");
  ufHandle = null;
}
async function doRemoveFriend(){
  const h = ufHandle;
  if(!me || !h) return;
  const btn = el("uf-confirm");
  if(btn.disabled) return;
  btn.disabled = true;
  const { error } = await sb.rpc("remove_friend", { friend_handle: h });
  btn.disabled = false;
  if(error){
    console.error(error);
    closeUnfriendMenu();
    toast(t("err.generic"));
    return;
  }
  closeUnfriendMenu();
  delete FRIEND_SINCE[h]; // væk begge veje — næste tilføjelse starter forfra
  await loadFriends();
  await loadPosts(); // vennens whole-kreds-opslag forsvinder (RLS) + bobler/feed gen-renderes
  renderStories();
  if(el("view-search").classList.contains("active")) renderSearch(); // søgelisten bag panelet uden den fjernede ven
  // Panelet gen-renderes til ikke-ven-tilstanden (profilen er stadig synlig — nu med Tilføj-chip)
  if(pv.u === h && el("profileview").classList.contains("on")) await openProfile(h);
  toast(t("friend.removed", { name: user(h).name }));
}
/* ---- Blokér bruger (Apple 1.2) — samme popup-mønster som Fjern ven ---- */
let bmHandle = null;
export function openBlockMenu(h){
  bmHandle = h;
  // App'en: ægte native Liquid Glass-kort i stedet for web-modalen.
  if(window.__vfGlassCard && window.__vfSheetPost){
    window.__vfSheetPost({
      title: t("block.confirm", { name: user(h).name }),
      message: t("block.note"),
      buttons: [
        { label: t("block.do"), action: "block", role: "destructive" },
        { label: t("common.cancel"), action: "__cancel", role: "cancel" }
      ]
    }, function(a){ if(a === "block") doBlockUser(h); });
    return;
  }
  el("bm-title").textContent = t("block.confirm", { name: user(h).name });
  el("bm-confirm").disabled = false;
  el("bmenu").classList.add("on");
}
export function closeBlockMenu(){
  el("bmenu").classList.remove("on");
  bmHandle = null;
}
export async function doBlockUser(h){
  if(!me || !h || !user(h).id || h === me.handle || h === OFFICIAL_HANDLE) return;
  const btn = el("bm-confirm");
  if(btn.disabled) return;
  btn.disabled = true;
  const { error } = await sb.rpc("block_user", { target: user(h).id });
  btn.disabled = false;
  closeBlockMenu();
  if(error){
    console.error(error);
    toast(t("err.generic"));
    return;
  }
  // Serveren har kappet venskab/anmodninger/invitationer — spejl det lokalt
  delete FRIEND_SINCE[h];
  const i = state.sentRequests.indexOf(h);
  if(i >= 0) state.sentRequests.splice(i, 1);
  if(el("memview").classList.contains("on")) closeMemView();
  await loadFriends();   // henter også blocked-listen (loadBlocks)
  await loadPosts();     // RLS fjerner indholdet begge veje
  renderStories();
  if(el("view-search").classList.contains("active")) renderSearch();
  // Profilen gen-renderes til blokeret-tilstand (med Fjern blokering-chip)
  if(pv.u === h && el("profileview").classList.contains("on")) await openProfile(h);
  toast(t("block.done", { name: user(h).name }));
}
export async function doUnblockUser(h){
  if(!me || !h || !user(h).id) return;
  const btn = el("pv-unblock");
  btn.disabled = true;
  const { error } = await sb.rpc("unblock_user", { target: user(h).id });
  btn.disabled = false;
  if(error){
    console.error(error);
    toast(t("err.generic"));
    return;
  }
  await loadFriends();
  await loadPosts();
  renderStories();
  if(el("view-search").classList.contains("active")) renderSearch();
  if(pv.u === h && el("profileview").classList.contains("on")) await openProfile(h);
  toast(t("block.undone"));
}
function pvEmptyNote(h){
  if(pvIsBlocked(h)) return '<div class="emptynote">'+t("pv.empty_blocked")+'</div>';
  return '<div class="emptynote">'+(pvIsFriend(h) ? t("pv.empty_friend") : t("pv.empty_stranger"))+'</div>';
}
export async function openProfile(h){
  if(!user(h).id){
    // Ikke-ven: profilen er måske ikke registreret endnu — hent den på handle
    const r = await sb.from("profiles").select("*").eq("handle", h).maybeSingle();
    if(r.error) console.error(r.error);
    if(r.data) registerProfile(r.data);
  }
  const u = user(h);
  if(!u.id){ toast(t("pv.not_found")); return; }
  pv.u = h;
  pv.posts = [];
  el("pv-name").textContent = u.name;
  el("pv-name2").textContent = u.name;
  el("pv-count").textContent = "";
  el("pv-handle").textContent = "@" + h;
  const bio = (u.bio || "").trim();
  el("pv-bio").textContent = bio;
  el("pv-bio").style.display = bio ? "" : "none";
  el("pv-stat-posts").textContent = "0";
  el("pv-stat-friends").textContent = "–";
  el("pv-stat-kredse").textContent = "–";
  el("pv-ava").innerHTML = avaHTML(h, 86);
  renderBanner("pv-banner", user(h).banner_path);
  renderPvRelation(h);
  /* "Se aktivitet" — skjules på egen profil, for den officielle bot og for blokerede */
  const act = el("pv-act");
  act.style.display = (me && h !== me.handle && h !== OFFICIAL_HANDLE && !pvIsBlocked(h)) ? "" : "none";
  act.disabled = false;
  el("pv-posts").innerHTML = '<div class="emptynote">'+t("common.loading")+'</div>';
  el("pv-body").scrollTop = 0;
  el("profileview").classList.add("on");
  sb.rpc("friends_count_of", { u: u.id }).then(function(r){
    if(pv.u !== h) return;
    if(r.error){ console.error(r.error); return; }
    if(r.data != null) el("pv-stat-friends").textContent = r.data;
  });
  sb.rpc("kreds_count_of", { u: u.id }).then(function(r){
    if(pv.u !== h) return;
    if(r.error){ console.error(r.error); return; }
    if(r.data != null) el("pv-stat-kredse").textContent = r.data;
  });
  await loadPvPosts();
}
export async function loadPvPosts(){
  const h = pv.u;
  if(!h || !user(h).id) return;
  pvTab = "list"; // frisk profil starter på Tanker
  const { data, error } = await postQuery().eq("author", user(h).id).is("feed_id", null);
  if(pv.u !== h) return;
  if(error){
    console.error(error);
    el("pv-posts").innerHTML = '<div class="emptynote">'+t("feed.load_failed")+'</div>';
    return;
  }
  pv.posts = (data || []).map(mapPost);
  el("pv-count").textContent = t("pv.count", { n: pv.posts.length });
  el("pv-stat-posts").textContent = pv.posts.length;
  const vsnap = snapVideos(el("pv-posts"));
  el("pv-posts").innerHTML = timelineHTML(pv.posts, pvTab, pvEmptyNote(h)); // RLS giver tom liste for ikke-venner
  restoreVideos(el("pv-posts"), vsnap);
  applyFeedSound();
  clampMemCaps(el("pv-posts"));
}
export function closeProfile(){
  el("profileview").classList.remove("on");
}
export function refreshPv(){
  if(pv.u && el("profileview").classList.contains("on")){
    el("pv-count").textContent = t("pv.count", { n: pv.posts.length });
    el("pv-stat-posts").textContent = pv.posts.length;
    const vsnap = snapVideos(el("pv-posts"));
    el("pv-posts").innerHTML = timelineHTML(pv.posts, pvTab, pvEmptyNote(pv.u));
    restoreVideos(el("pv-posts"), vsnap);
    applyFeedSound();
    clampMemCaps(el("pv-posts"));
    el("pv-ava").innerHTML = avaHTML(pv.u, 86);
    renderBanner("pv-banner", user(pv.u).banner_path);
  }
}

export function initProfile(){
/* Profil-tidslinje: toggle (Alt/Minder) + grid-tap → åbn opslaget. Delegeret pr. container;
   post-interaktioner håndteres separat af feed.js timelineClick, så de to lever fint sammen. */
function profTimelineClick(e, isPv){
  const tb = e.target.closest(".profbar-btn");
  if(tb){
    const tab = tb.dataset.ptab === "grid" ? "grid" : "list";
    if(isPv){ pvTab = tab; refreshPv(); }
    else { myTab = tab; renderMyPosts(); }
    return;
  }
  const gi = e.target.closest(".pgrid-item");
  if(gi){
    // Åbn mindet i den dedikerede fuldskærms-side (#memview)
    const id = gi.dataset.mem;
    const list = isPv ? pv.posts : state.wholePosts.filter(function(p){ return p.u === me.handle && !p.feed; });
    const p = list.find(function(x){ return String(x.id) === String(id); });
    if(p) openMemView(p);
  }
}
/* ---- Tap på Venner/Kredse-tallene -> liste-sheetet ---- */
function statTap(e, h){
  if(!h) return;
  const st = e.target.closest(".stat[data-l]");
  if(!st) return;
  const tab = st.dataset.l === "friends" ? "friends" : "kredse";
  if(window.__vfNative && window.__vfListPage){ openNativeListPage(h, tab); return; }
  if(tab === "friends") openFriendsList(h);
  else openKredsList(h);
}
el("own-stats").addEventListener("click", function(e){ statTap(e, me ? me.handle : null); });
el("pv-stats").addEventListener("click", function(e){ statTap(e, pv.u); });
el("ls-list").addEventListener("click", function(e){
  const fr = e.target.closest(".lrow[data-u]");
  if(fr){
    closeListSheet();
    const h = fr.dataset.u;
    if(me && h === me.handle){ closeProfile(); switchTab("profil"); }
    else openProfile(h);
    return;
  }
  const kr = e.target.closest(".lrow[data-feed]");
  if(kr){
    closeListSheet();
    closeProfile();
    switchTab("feed");
    setFeed(kr.dataset.feed);
  }
});
el("myposts").addEventListener("click", function(e){ profTimelineClick(e, false); });
el("pv-posts").addEventListener("click", function(e){ profTimelineClick(e, true); });
el("editprof").addEventListener("click", function(){
  if(!me) return;
  // App'en: ægte native Liquid Glass-sheet i stedet for web-sheet'et.
  if(window.__vfEsheet){ epStagedAvatar = null; epStagedBanner = null; window.__vfEsheetPush(epheetSnapshot()); return; }
  el("ep-name").value = me.name || "";
  el("ep-bio").value = me.bio || "";
  el("ep-share").checked = me.show_activity !== false;
  el("ep-ava").innerHTML = avaHTML(me.handle, 72);
  el("ep-file").value = "";
  el("ep-bprev").innerHTML = me.banner_path ? '<img src="' + esc(imgUrl(me.banner_path)) + '" alt="">' : "";
  el("ep-bfile").value = "";
  syncAdsChips();
  resetDeleteUI();
  epCan();
  el("scrim").classList.add("on");
  el("esheet").classList.add("on");
  setTimeout(function(){ el("ep-name").focus(); }, 260);
});
el("ep-name").addEventListener("input", epCan);
el("ep-save").addEventListener("click", async function(){
  const name = el("ep-name").value.trim();
  const bio = el("ep-bio").value.trim().slice(0, 160);
  const share = el("ep-share").checked;
  if(!name || !me) return;
  this.disabled = true;
  const { error } = await sb.from("profiles").update({ name:name, bio: bio || null, show_activity: share }).eq("id", me.id);
  this.disabled = false;
  if(error){
    console.error(error);
    toast(String(error.message || "").indexOf("blocked_content") >= 0 ? t("err.blocked") : t("err.generic"));
    return;
  }
  me.name = name;
  me.bio = bio || null;
  me.show_activity = share;
  registerProfile(me);
  setOwnUI();
  closeEditSheet();
  renderFeed();
  renderStories();
  renderMyPosts();
  toast(t("profile.updated"));
});
/* ---- Sprog (per enhed — gemmes i localStorage, ikke i profilen) ---- */
el("lang-da").addEventListener("click", function(){ setLang("da"); });
el("lang-en").addEventListener("click", function(){ setLang("en"); });
/* ---- Reklame-samtykke (per enhed — setConsent poster også til den native bro) ---- */
el("ads-personal").addEventListener("click", function(){ setConsent("personal"); syncAdsChips(); });
el("ads-limited").addEventListener("click", function(){ setConsent("limited"); syncAdsChips(); });
/* ---- Profil-banner (browser: uploades straks ved valg, som profilbilledet) ---- */
el("ep-banner").addEventListener("click", function(){ el("ep-bfile").click(); });
el("ep-bfile").addEventListener("change", function(){
  const file = this.files && this.files[0];
  if(!file || !me) return;
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = function(){
    URL.revokeObjectURL(url);
    bannerBlobFromImage(img).then(async function(blob){
      if(!blob){ toast(t("img.read_failed")); return; }
      if(!me) return;
      const old = me.banner_path;
      try{
        const path = await uploadBannerBlob(blob);
        const upd = await sb.from("profiles").update({ banner_path: path }).eq("id", me.id);
        if(upd.error){
          sb.storage.from("post-images").remove([path]).catch(function(){});
          throw upd.error;
        }
        if(old) sb.storage.from("post-images").remove([old]).catch(function(){});
        me.banner_path = path;
        registerProfile(me);
        setOwnUI();
        el("ep-bprev").innerHTML = '<img src="' + esc(imgUrl(path)) + '" alt="">';
        refreshPv();
        toast(t("profile.updated"));
      }catch(err){
        console.error(err);
        toast(t("err.generic"));
      }
      el("ep-bfile").value = "";
    });
  };
  img.onerror = function(){
    URL.revokeObjectURL(url);
    toast(t("img.read_failed"));
  };
  img.src = url;
});
/* ---- Profilbillede ---- */
el("ep-pic").addEventListener("click", function(){ el("ep-file").click(); });
el("ep-file").addEventListener("change", function(){
  const file = this.files && this.files[0];
  if(!file || !me) return;
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = function(){
    const side = Math.min(img.width, img.height);
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    c.getContext("2d").drawImage(img, (img.width - side)/2, (img.height - side)/2, side, side, 0, 0, 512, 512);
    URL.revokeObjectURL(url);
    c.toBlob(async function(blob){
      if(!blob){ toast(t("img.read_failed")); return; }
      if(!me) return;
      const old = me.avatar_path;
      let path = me.id + "/avatar-" + uuid() + ".jpg";
      try{
        const up = await sb.storage.from("post-images").upload(path, blob, { contentType:"image/jpeg" });
        if(up.error) throw up.error;
        if(up.data && up.data.path) path = up.data.path;
        const upd = await sb.from("profiles").update({ avatar_path: path }).eq("id", me.id);
        if(upd.error){
          sb.storage.from("post-images").remove([path]).catch(function(){});
          throw upd.error;
        }
      }catch(err){
        console.error(err);
        toast(t("avatar.failed"));
        el("ep-file").value = "";
        return;
      }
      if(old) sb.storage.from("post-images").remove([old]).catch(function(){});
      me.avatar_path = path;
      registerProfile(me);
      setOwnUI();
      el("ep-ava").innerHTML = avaHTML(me.handle, 72);
      setTabIcons(curTab);
      renderStories();
      renderFeed();
      renderMyPosts();
      refreshPv();
      if(el("view-search").classList.contains("active")) renderSearch();
      el("ep-file").value = "";
      toast(t("avatar.updated"));
    }, "image/jpeg", 0.85);
  };
  img.onerror = function(){
    URL.revokeObjectURL(url);
    toast(t("img.read_failed"));
  };
  img.src = url;
});
el("del-open").addEventListener("click", function(){
  el("del-input").value = "";
  el("del-btn").disabled = true;
  el("delmodal").classList.add("on");
  setTimeout(function(){ el("del-input").focus(); }, 60);
});
el("del-cancel").addEventListener("click", resetDeleteUI);
el("delmodal").addEventListener("click", function(e){
  if(e.target === el("delmodal")) resetDeleteUI();
});
el("del-input").addEventListener("input", function(){
  el("del-btn").disabled = this.value !== "SLET";
});
el("del-btn").addEventListener("click", async function(){
  if(this.disabled || !me) return;
  const btn = this;
  btn.disabled = true;
  try{
    const { data, error } = await sb.functions.invoke("delete-account", { body:{} });
    if(error || !data || !data.ok) throw (error || new Error("delete_failed"));
    nativeLogout(); // tilbagekald device-token + besked til appen FØR sessionen ryddes
    try{ await sb.auth.signOut(); }catch(_e){}
    closeEditSheet();
    resetApp();
    showAuth();
    toast(t("account.deleted"));
  }catch(err){
    console.error(err);
    toast(t("account.delete_failed"));
    btn.disabled = false;
  }
});

el("logoutbtn").addEventListener("click", async function(){
  nativeLogout(); // tilbagekald device-token + besked til appen FØR sessionen ryddes
  const { error } = await sb.auth.signOut();
  if(error){ console.error(error); toast(t("err.generic")); }
});
el("pv-back").addEventListener("click", closeProfile);
el("mv-back").addEventListener("click", closeMemView); // luk minde-siden
/* ---- "Se aktivitet": samtykke-tjek via RPC, derefter fladt bottom sheet ---- */
el("pv-act").addEventListener("click", async function(){
  const h = pv.u;
  if(!me || !h || this.disabled) return;
  const u = user(h);
  if(!u.id) return;
  const btn = this;
  btn.disabled = true;
  const { data, error } = await sb.rpc("activity_allowed", { u: u.id });
  btn.disabled = false;
  if(error){ console.error(error); toast(t("err.generic")); return; }
  if(data === "self_off"){ toast(t("act.self_off")); return; }
  if(data === "target_off"){ toast(t("act.target_off", { name: u.name })); return; }
  if(data !== "ok"){ toast(t("err.generic")); return; }
  if(pv.u !== h) return;
  openActivitySheet(h);
});
/* ---- Ven: "Fjern ven" (lille grå tekst-knap -> bekræftelses-popup) ---- */
el("pv-unfriend").addEventListener("click", function(){
  const h = pv.u;
  if(!me || !h || h === me.handle || h === OFFICIAL_HANDLE) return;
  openUnfriendMenu(h);
});
el("ufmenu").addEventListener("click", function(e){
  if(e.target === el("ufmenu")) closeUnfriendMenu();
});
el("uf-cancel").addEventListener("click", closeUnfriendMenu);
el("uf-confirm").addEventListener("click", doRemoveFriend);
/* ---- Blokér/fjern blokering (profilvisningen) ---- */
el("pv-block").addEventListener("click", function(){
  const h = pv.u;
  if(!me || !h || h === me.handle || h === OFFICIAL_HANDLE) return;
  openBlockMenu(h);
});
el("pv-unblock").addEventListener("click", function(){
  const h = pv.u;
  if(!me || !h || this.disabled) return;
  doUnblockUser(h);
});
el("bmenu").addEventListener("click", function(e){
  if(e.target === el("bmenu")) closeBlockMenu();
});
el("bm-cancel").addEventListener("click", closeBlockMenu);
el("bm-confirm").addEventListener("click", function(){
  const h = bmHandle;
  if(h) doBlockUser(h);
});
/* ---- Ikke-ven: "Tilføj til din kreds" sender en anmodning; tryk igen fortryder ---- */
el("pv-add").addEventListener("click", async function(){
  const h = pv.u;
  if(!me || !h || this.disabled) return;
  const btn = this;
  // Udestående anmodning → tryk fortryder den
  if(state.sentRequests.indexOf(h) >= 0){
    btn.disabled = true;
    const { error } = await sb.rpc("cancel_friend_request", { to_handle: h });
    if(error){
      console.error(error);
      if(pv.u === h) btn.disabled = false;
      toast(t("err.generic"));
      return;
    }
    const i = state.sentRequests.indexOf(h);
    if(i >= 0) state.sentRequests.splice(i, 1);
    if(pv.u === h) renderPvRelation(h);
    refreshSearchAfterFriendAdd(h);
    toast(t("friend.request_cancelled", { name: user(h).name }));
    return;
  }
  // Send anmodning (optimistisk "Anmodning sendt")
  btn.disabled = true;
  btn.classList.add("pending");
  btn.textContent = t("pv.requested");
  const { data, error } = await sb.rpc("add_friend", { friend_handle: h });
  if(error){
    console.error(error);
    if(pv.u === h){
      btn.disabled = false;
      btn.classList.remove("pending");
      btn.textContent = t("pv.add");
    }
    const m = String(error.message || "");
    if(m.indexOf("not_found") >= 0) toast(t("friend.not_found"));
    else if(m.indexOf("self") >= 0) toast(t("friend.self"));
    else toast(t("err.generic"));
    return;
  }
  const prof = data && data.profile;
  if(prof) registerProfile(prof);
  if(data && data.status === "friends"){
    // Allerede venner (fx accepteret et andet sted) — vis venskabet
    await loadFriends();
    refreshSearchAfterFriendAdd(h);
    renderStories();
    loadPosts();
    if(pv.u === h){ renderPvRelation(h); loadPvPosts(); }
    toast(t("friend.added", { name: user(h).name }));
    return;
  }
  if(state.sentRequests.indexOf(h) < 0) state.sentRequests.push(h);
  if(pv.u === h){
    btn.disabled = false; // "Anmodning sendt" kan trykkes for at fortryde
    renderPvRelation(h);
  }
  refreshSearchAfterFriendAdd(h);
  toast(t("friend.request_sent", { name: user(h).name }));
});
/* ================= Bobler: klik ================= */
el("stories").addEventListener("click", function(e){
  const s = e.target.closest(".story");
  if(!s) return;
  if(s.dataset.me){
    // + → tilføj en story; ellers (hvis jeg har en aktiv story) → se min egen
    const mine = (state.storyGroups || []).find(function(g){ return g.isMe; });
    if(!e.target.closest(".plusb") && mine){ openStoryViewer(me.handle); return; }
    if(window.__vfComposeCamera) openStoryCamera(); else openCompose();
    return;
  }
  openStoryViewer(s.dataset.u);   // se en vens story
});
}
