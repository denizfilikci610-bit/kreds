import { sb, OFFICIAL_HANDLE } from "./config.js";
import { me, state } from "./store.js";
import { el, esc, imgUrl, avaHTML, registerProfile, toast, fmtTime, user } from "./helpers.js";
import { t } from "./i18n.js";
import { renderStories, doBlockUser } from "./profile.js";
import { KREDS_SVG, feedById, setFeed, switchTab } from "./feed.js";

/* ================= Stories: data ================= */
/* Hent stories (RLS-filtreret: egen, venner uden kreds, eller kredse man er medlem af) +
   min set-status, grupperet pr. forfatter. Fylder state.storyGroups; rækken tegnes af renderStories. */
export async function loadStories(){
  if(!me){ state.storyGroups = []; return; }
  const { data: rows, error } = await sb.from("stories")
    .select("id, author, feed_id, image_path, video_path, created_at, profiles!stories_author_fkey(handle, name, avatar_path)")
    .order("created_at", { ascending: true });
  if(error || !rows){ state.storyGroups = []; return; }
  const seenSet = new Set();
  try{
    const { data: seen } = await sb.from("story_views").select("story_id");
    (seen || []).forEach(function(v){ seenSet.add(v.story_id); });
  }catch(_e){}
  // Kan der anmeldes? (samme mønster som blockReady: fejler kaldet, findes tabellen
  // ikke endnu, og anmeld-valget holdes skjult — web kan deployes FØR databasen.)
  try{
    const { error: rerr } = await sb.from("story_reports").select("story_id").limit(1);
    state.storyReportReady = !rerr;
  }catch(_e){ state.storyReportReady = false; }
  const byAuthor = new Map();
  rows.forEach(function(r){
    const p = r.profiles || {};
    if(p.handle) registerProfile({ id: r.author, handle: p.handle, name: p.name, avatar_path: p.avatar_path });
    if(!byAuthor.has(r.author)){
      byAuthor.set(r.author, {
        author: { id: r.author, handle: p.handle || "", name: p.name || "", avatar_path: p.avatar_path || null },
        items: [], isMe: r.author === me.id
      });
    }
    const isVideo = !!r.video_path;
    byAuthor.get(r.author).items.push({
      id: r.id, url: imgUrl(isVideo ? r.video_path : r.image_path), isVideo: isVideo,
      path: isVideo ? r.video_path : r.image_path, // rå sti (storage-oprydning ved sletning)
      feedId: r.feed_id, // kreds-story → kchip i vieweren (navnet slås op i state.feeds, RLS garanterer medlemskab)
      seen: seenSet.has(r.id)
    });
  });
  const groups = Array.from(byAuthor.values());
  groups.forEach(function(g){ g.allSeen = g.items.every(function(i){ return i.seen; }); });
  groups.sort(function(a, b){
    if(a.isMe !== b.isMe) return a.isMe ? -1 : 1;        // egen først
    return (a.allSeen ? 1 : 0) - (b.allSeen ? 1 : 0);    // uset før set
  });
  state.storyGroups = groups;
  renderStories();
}

/* ================= Stories: fuldskærms-viewer ================= */
const vw = { groups: [], gi: 0, ii: 0, timer: null };

export function openStoryViewer(handle){
  const groups = state.storyGroups || [];
  const gi = groups.findIndex(function(g){ return g.author.handle === handle; });
  if(gi < 0 || !groups[gi].items.length) return;
  vw.groups = groups; vw.gi = gi; vw.ii = 0;
  el("storyview").classList.add("on");
  document.body.classList.add("lb-lock");
  showItem();
}

function clearTimer(){ if(vw.timer){ clearTimeout(vw.timer); vw.timer = null; } }

function showItem(){
  clearTimer();
  const g = vw.groups[vw.gi];
  if(!g){ closeStoryViewer(); return; }
  const it = g.items[vw.ii];
  if(!it){ gotoGroup(vw.gi + 1); return; }
  const bars = g.items.map(function(_it, i){
    const cls = i < vw.ii ? "done" : (i === vw.ii ? "active" : "");
    return '<div class="sv-bar ' + cls + '"><i></i></div>';
  }).join("");
  const media = it.isVideo
    ? '<video src="' + esc(it.url) + '" playsinline autoplay></video>'
    : '<img src="' + esc(it.url) + '" alt="">';
  // Kreds-story: samme kchip-pille som på feed-opslag (ikon + navn, tap = åbn kredsen)
  const kf = it.feedId ? feedById(it.feedId) : null;
  const kchip = kf
    ? '<button class="kchip" data-sv="kreds" data-feed="' + esc(kf.id) + '">' + KREDS_SVG + '<span>' + esc(kf.name) + '</span></button>'
    : '';
  el("storyview").innerHTML =
    '<div class="sv-media">' + media + '</div>' +
    '<div class="sv-bars">' + bars + '</div>' +
    '<div class="sv-head">' +
      '<span class="sv-ava">' + avaHTML(g.author.handle, 30) + '</span>' +
      '<span class="sv-hcol">' +
        '<span class="sv-name">' + esc(g.author.name || g.author.handle) + '</span>' + kchip +
      '</span>' +
      (g.isMe
        ? '<button class="sv-del" data-sv="del" aria-label="' + esc(t("story.delete")) + '">' +
            '<svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4.5 6.5h15M9.5 6V4.5h5V6M6.5 6.5l1 13h9l1-13M10 10.5v6M14 10.5v6"/></g></svg>' +
          '</button>'
        : (canModerate(g)
          ? '<button class="sv-more" data-sv="menu" aria-label="' + esc(t("aria.more")) + '">' +
              '<svg viewBox="0 0 24 24"><g fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></g></svg>' +
            '</button>'
          : '')) +
      '<button class="sv-close" data-sv="close" aria-label="Luk">✕</button>' +
    '</div>' +
    (g.isMe
      ? '<button class="sv-seen" data-sv="views" aria-label="' + esc(t("story.seenby", { n: "" })) + '">' + EYE_SVG + '<span class="sv-seen-n"></span></button>'
      : '') +
    '<button class="sv-tap sv-left" data-sv="prev" aria-label="Forrige"></button>' +
    '<button class="sv-tap sv-right" data-sv="next" aria-label="Næste"></button>';
  markSeen(it);
  if(g.isMe) loadViews(it);   // "Set af N" (kun egne stories)
  vw.timer = setTimeout(next, 6000);   // 6 sek pr. story (billede + video)
}

const EYE_SVG = '<svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.6"/></g></svg>';

/* Hent hvem der har set storyen (RLS: kun forfatteren kan læse andres visninger).
   Egen visning tælles ikke med (man "ser" selv storyen når vieweren åbner). */
async function loadViews(it){
  try{
    const { data } = await sb.from("story_views")
      .select("viewer, seen_at, profiles!story_views_viewer_fkey(handle, name, avatar_path)")
      .eq("story_id", it.id).neq("viewer", me.id)
      .order("seen_at", { ascending: false });
    it.viewsData = data || [];
    it.viewsData.forEach(function(v){
      const p = v.profiles || {};
      if(p.handle) registerProfile({ id: v.viewer, handle: p.handle, name: p.name, avatar_path: p.avatar_path });
    });
    // Er vi stadig på samme story? Ellers lander tallet på den forkerte.
    const g = vw.groups[vw.gi];
    if(!el("storyview").classList.contains("on") || !g || g.items[vw.ii] !== it) return;
    const n = el("storyview").querySelector(".sv-seen-n");
    if(n) n.textContent = String(it.viewsData.length);
  }catch(_e){}
}

/* Seer-listen (mørkt bundkort). Fremdriften står på pause mens den er åben;
   luk genopbygger den viste story (showItem) og starter forfra på de 6 sek. */
async function openViewers(){
  const g = vw.groups[vw.gi];
  const it = g && g.items[vw.ii];
  if(!g || !it || !g.isMe) return;
  clearTimer();
  const v = el("storyview").querySelector("video");
  if(v) v.pause();
  if(!it.viewsData) await loadViews(it);   // åbnet før hentningen blev færdig
  const rows = (it.viewsData || []).map(function(x){
    const p = x.profiles || {};
    return '<div class="sv-vrow">' + avaHTML(p.handle, 36) +
      '<span class="vname">' + esc(p.name || p.handle || "") + '</span>' +
      '<span class="vtime">' + fmtTime(x.seen_at) + '</span></div>';
  }).join("");
  const wrap = document.createElement("div");
  wrap.className = "sv-vwrap";
  wrap.innerHTML =
    '<div class="sv-vback" data-sv="vclose"></div>' +
    '<div class="sv-viewers">' +
      '<header><span>' + esc(t("story.seenby", { n: (it.viewsData || []).length })) + '</span>' +
      '<button class="sv-vx" data-sv="vclose" aria-label="Luk">✕</button></header>' +
      '<div class="sv-vlist">' + (rows || '<div class="sv-vempty">' + esc(t("story.noviews")) + '</div>') + '</div>' +
    '</div>';
  el("storyview").appendChild(wrap);
}
function closeViewers(){
  const w = el("storyview").querySelector(".sv-vwrap");
  if(!w) return;
  w.remove();
  showItem();
}

/* ================= Anmeld / blokér (kun ANDRES stories) =================
   Apple 1.2: alt brugerskabt indhold skal kunne anmeldes. Samme to-trins-flow og
   samme glas-kort som ⋯-menuen på opslag (feed.js openReportMenu). Fremdriften står
   på pause mens menuen er fremme — som seer-listen — og starter forfra ved annuller. */
function canReportStories(){ return !!state.storyReportReady; }
function canBlockAuthor(g){
  return !!state.blockReady && !!g && g.author.handle !== OFFICIAL_HANDLE;
}
function canModerate(g){
  return !!me && !g.isMe && (canReportStories() || canBlockAuthor(g));
}
/* Stil storyen i bero (menu/ark fremme). showItem() sætter den i gang igen. */
function pauseStory(){
  clearTimer();
  const v = el("storyview").querySelector("video");
  if(v) v.pause();
}
function storyPreview(g, it){
  const nm = g.author.name || g.author.handle;
  return {
    name: nm,
    snippet: it && it.isVideo ? t("story.one_video") : t("story.one"),
    initials: nm.trim().split(/\s+/).map(function(w){ return w.charAt(0); }).slice(0, 2).join("").toUpperCase(),
    avatarUrl: g.author.avatar_path ? imgUrl(g.author.avatar_path) : ""
  };
}
function openStoryMenu(){
  const g = vw.groups[vw.gi];
  const it = g && g.items[vw.ii];
  if(!g || !it || !canModerate(g)) return;
  const h = g.author.handle;
  pauseStory();
  // App'en: ægte native Liquid Glass-kort.
  if(window.__vfGlassCard && window.__vfSheetPost){
    const btns = [];
    if(canReportStories()) btns.push({ label: t("story.report"), action: "report", role: "destructive" });
    if(canBlockAuthor(g)) btns.push({ label: t("rm.block"), action: "block", role: "destructive" });
    btns.push({ label: t("common.cancel"), action: "__cancel", role: "cancel" });
    window.__vfSheetPost({ preview: storyPreview(g, it), buttons: btns }, function(a){
      if(a === "report"){
        window.__vfSheetPost({
          title: t("story.report_confirm"), message: t("rm.note"),
          buttons: [
            { label: t("rm.do"), action: "do", role: "destructive" },
            { label: t("common.cancel"), action: "__cancel", role: "cancel" }
          ]
        }, function(b){ if(b === "do") reportCurrentStory(); else showItem(); });
        return;
      }
      if(a === "block"){
        window.__vfSheetPost({
          title: t("block.confirm", { name: user(h).name }), message: t("block.note"),
          buttons: [
            { label: t("block.do"), action: "do", role: "destructive" },
            { label: t("common.cancel"), action: "__cancel", role: "cancel" }
          ]
        }, function(b){
          if(b === "do"){ closeStoryViewer(); doBlockUser(h); } else showItem();
        });
        return;
      }
      showItem(); // annulleret → storyen kører videre
    });
    return;
  }
  renderStoryMenu("main");
}
/* Browser-fallback: web-modalens glas-piller, tegnet INDE i vieweren (som seer-listen),
   ellers ville den ligge under fuldskærms-vieweren. */
function renderStoryMenu(step){
  const g = vw.groups[vw.gi];
  const it = g && g.items[vw.ii];
  if(!g || !it) return;
  closeStoryMenu(false);
  const nm = esc(user(g.author.handle).name || g.author.handle);
  let inner;
  if(step === "report"){
    inner = '<div class="mgroup">' +
        '<div class="mtitle">' + esc(t("story.report_confirm")) + '</div>' +
        '<p class="mtext">' + esc(t("rm.note")) + '</p>' +
        '<button class="mrow danger" data-sv="mreport2">' + esc(t("rm.do")) + '</button>' +
      '</div>' +
      '<button class="mrow mcancel" data-sv="mcancel">' + esc(t("common.cancel")) + '</button>';
  } else if(step === "block"){
    inner = '<div class="mgroup">' +
        '<div class="mtitle">' + esc(t("block.confirm", { name: nm })) + '</div>' +
        '<p class="mtext">' + esc(t("block.note")) + '</p>' +
        '<button class="mrow danger" data-sv="mblock2">' + esc(t("block.do")) + '</button>' +
      '</div>' +
      '<button class="mrow mcancel" data-sv="mcancel">' + esc(t("common.cancel")) + '</button>';
  } else {
    inner = '<div class="mgroup">' +
        '<div class="mprev">' + avaHTML(g.author.handle, 34) +
          '<div class="mprev-txt"><span class="mprev-nm">' + nm + '</span>' +
          '<span class="mprev-snip">' + esc(it.isVideo ? t("story.one_video") : t("story.one")) + '</span></div>' +
        '</div>' +
        (canReportStories() ? '<button class="mrow danger" data-sv="mreport">' + esc(t("story.report")) + '</button>' : '') +
        (canBlockAuthor(g) ? '<button class="mrow danger" data-sv="mblock">' + esc(t("rm.block")) + '</button>' : '') +
      '</div>' +
      '<button class="mrow mcancel" data-sv="mcancel">' + esc(t("common.cancel")) + '</button>';
  }
  const wrap = document.createElement("div");
  wrap.className = "modal sheet sv-menu on";
  wrap.setAttribute("role", "dialog");
  wrap.setAttribute("aria-label", t("story.report"));
  wrap.innerHTML = '<div class="modal-card"><div class="mstep">' + inner + '</div></div>';
  el("storyview").appendChild(wrap);
}
/* resume=true: storyen kører videre (showItem starter de 6 sek forfra). */
function closeStoryMenu(resume){
  const w = el("storyview").querySelector(".sv-menu");
  if(w) w.remove();
  if(resume && w) showItem();
}
async function reportCurrentStory(){
  const g = vw.groups[vw.gi];
  const it = g && g.items[vw.ii];
  if(!g || !it || !me) return;
  closeStoryMenu(false);
  const { error } = await sb.from("story_reports").insert({ story_id: it.id, user_id: me.id });
  if(error && error.code !== "23505"){ // 23505 = allerede anmeldt — tæller som succes
    console.error(error);
    toast(t("err.generic"));
    showItem();
    return;
  }
  // Skjult for anmelderen (RLS-gaten gør det samme server-side ved næste hentning)
  g.items.splice(vw.ii, 1);
  toast(t("story.reported"));
  if(!g.items.length){
    vw.groups.splice(vw.gi, 1);
    if(!vw.groups.length){ closeStoryViewer(); loadStories(); return; }
    if(vw.gi >= vw.groups.length) vw.gi = vw.groups.length - 1;
    vw.ii = 0;
  } else if(vw.ii >= g.items.length){
    vw.ii = g.items.length - 1;
  }
  showItem();
  loadStories(); // rækken/ringene opdateres i baggrunden (loadStories tegner selv)
}

function next(){
  const g = vw.groups[vw.gi];
  if(g && vw.ii < g.items.length - 1){ vw.ii++; showItem(); }
  else gotoGroup(vw.gi + 1);
}
function prev(){
  if(vw.ii > 0){ vw.ii--; showItem(); }
  else gotoGroup(vw.gi - 1, true);
}
function gotoGroup(gi, last){
  if(gi < 0){ vw.ii = 0; showItem(); return; }
  if(gi >= vw.groups.length){ closeStoryViewer(); return; }
  vw.gi = gi;
  vw.ii = last ? Math.max(0, vw.groups[gi].items.length - 1) : 0;
  showItem();
}

export function closeStoryViewer(){
  clearTimer();
  el("storyview").classList.remove("on");
  el("storyview").innerHTML = "";
  document.body.classList.remove("lb-lock");
  renderStories();   // opdater ringene (set-status)
}

async function markSeen(it){
  if(it.seen) return;
  it.seen = true;
  const g = vw.groups[vw.gi];
  if(g) g.allSeen = g.items.every(function(x){ return x.seen; });
  try{
    await sb.from("story_views").upsert({ story_id: it.id, viewer: me.id }, { onConflict: "story_id,viewer", ignoreDuplicates: true });
  }catch(_e){}
}

/* Slet den viste story (kun egne — RLS håndhæver det også). To-trins: første tryk
   armerer knappen ("Slet?") og sætter fremdriften på pause, andet tryk sletter. */
async function deleteCurrentStory(){
  const g = vw.groups[vw.gi];
  const it = g && g.items[vw.ii];
  if(!g || !it || !g.isMe) return;
  clearTimer();
  const { error } = await sb.from("stories").delete().eq("id", it.id);
  if(error){ console.error(error); toast(t("err.generic")); showItem(); return; }
  if(it.path) sb.storage.from("post-images").remove([it.path]).catch(function(){});
  g.items.splice(vw.ii, 1);
  toast(t("story.deleted"));
  if(!g.items.length){
    vw.groups.splice(vw.gi, 1);
    if(!vw.groups.length){ closeStoryViewer(); loadStories().then(renderStories); return; }
    if(vw.gi >= vw.groups.length) vw.gi = vw.groups.length - 1;
    vw.ii = 0;
  } else if(vw.ii >= g.items.length){
    vw.ii = g.items.length - 1;
  }
  showItem();
  loadStories().then(renderStories); // rækken/ringene opdateres i baggrunden
}

export function initStories(){
  el("storyview").addEventListener("click", function(e){
    // Klik på menuens baggrund (uden for kortet) = annuller, som web-modalerne
    if(e.target.classList.contains("sv-menu")){ closeStoryMenu(true); return; }
    const b = e.target.closest("[data-sv]");
    if(!b) return;
    const a = b.dataset.sv;
    if(a === "menu"){ openStoryMenu(); return; }
    if(a === "mcancel"){ closeStoryMenu(true); return; }
    if(a === "mreport"){ renderStoryMenu("report"); return; }
    if(a === "mblock"){ renderStoryMenu("block"); return; }
    if(a === "mreport2"){ reportCurrentStory(); return; }
    if(a === "mblock2"){
      const g = vw.groups[vw.gi];
      const h = g && g.author.handle;
      closeStoryMenu(false);
      closeStoryViewer();
      if(h) doBlockUser(h);
      return;
    }
    if(a === "close") closeStoryViewer();
    else if(a === "next") next();
    else if(a === "prev") prev();
    else if(a === "views") openViewers();
    else if(a === "vclose") closeViewers();
    else if(a === "kreds"){
      // Som kchip på feedet: hop til kredsen (vieweren lukkes først)
      const fid = b.dataset.feed;
      closeStoryViewer();
      switchTab("feed");
      setFeed(fid);
    }
    else if(a === "del"){
      if(!b.classList.contains("arm")){
        b.classList.add("arm");
        b.textContent = t("story.del_confirm");
        clearTimer(); // stå stille mens man beslutter sig
        const v = el("storyview").querySelector("video");
        if(v) v.pause();
        return;
      }
      deleteCurrentStory();
    }
  });
}
