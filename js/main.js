import { sb, recoveryMode, recoveryLinkError } from "./config.js";
import { me, curTab } from "./store.js";
import { el, toast } from "./helpers.js";
import { t, initI18n, setLang, hasStoredLang } from "./i18n.js";
import { initFeed, setTabIcons, switchTab, closePostEdit, renderFeedbar, renderKredshead, renderFeed, setFeed, nativeKredsState } from "./feed.js";
import { initComments, nativeCommentsAction, nativePostPageAction } from "./comments.js";
import { initKredse, closeFeedSheet, closeMemberSheet, openFeedSheet, nativeFsheetAction, nativeMemberAction } from "./kredse.js";
import { initCompose, renderComposeDest, openCompose, openThought, openMemory, nativeMemoryPost, openMemoryFallback, nativeMemoryUploaded, nativeMemoryUploadFailed } from "./compose.js";
import { initSearch, renderSearch } from "./search.js";
import { initProfile, closeEditSheet, closeActivitySheet, closeListSheet, renderStories, renderMyPosts, refreshPv, nativeEsheetAction, nativeListPageAction, avatarStage, bannerStage } from "./profile.js";
import { initNotifs, loadNotifs, openFromPush } from "./notifications.js";
import { initLightbox } from "./lightbox.js";
import { initStories } from "./stories.js";
import { initRealtime, scheduleRefetch } from "./realtime.js";
import { initAuth, boot, showAuth, showRecovery, setAuthMode, refreshAuthMode, pushNativeCreds } from "./auth.js";
import { initPullRefresh } from "./pullrefresh.js";
import { initPinchZoom } from "./pinchzoom.js";
import { initMentions } from "./mentions.js";

/* ================= i18n =================
   Callback ved sprogskifte: statisk markup er allerede opdateret af setLang
   (applyStaticI18n) — her gen-renderes den dynamiske, synlige UI. */
initI18n(function(){
  refreshAuthMode(); // auth-skærmens JS-satte tekster følger den aktuelle tilstand
  if(!me) return;
  renderFeedbar();
  renderKredshead();
  renderStories();
  renderFeed();
  renderComposeDest();
  if(curTab === "akt") loadNotifs();
  if(curTab === "profil") renderMyPosts();
  if(el("view-search").classList.contains("active")) renderSearch();
  refreshPv();
  scheduleRefetch();   // relative tidsstempler m.m. genberegnes ved refetch
  pushNativeCreds();   // native notifikationer skifter sprog (no-op i browsere)
});

/* ================= Wiring (samme lyttere som før, samlet her) ================= */
initFeed();
initComments();
initKredse();
initCompose();
initSearch();
initProfile();
initNotifs();
initLightbox();
initStories();
initRealtime();
initMentions();
initAuth();
initPullRefresh(); // ren pull-to-refresh for hele appen (erstatter native webview-bounce)
initPinchZoom();   // live pinch-zoom på minde-billeder direkte i feedet (Instagram-agtigt)

el("scrim").addEventListener("click", function(){ closeFeedSheet(); closeMemberSheet(); closeEditSheet(); closeActivitySheet(); closeListSheet(); closePostEdit(); });

document.querySelectorAll(".tabbar [data-view]").forEach(function(tab){
  tab.addEventListener("click", function(){ switchTab(tab.dataset.view); });
});
el("nosparkle").addEventListener("click", function(){
  toast(t("nosparkle.toast"));
});

/* ================= Native tabbar-bro (KUN i app'en; window.__vfNative injiceres af Swift) =================
   Den native Liquid Glass-bar erstatter web-tabbaren i app'en. Native → web: window.vfTab(name).
   Web → native: vi poster {active, dot, compact, visible} så baren spejler appens tilstand og
   skjules når et ark/lightbox/profil ligger ovenpå. */
if(window.__vfNative){
  document.body.classList.add("native"); // CSS skjuler web-tabbaren + kreds-baren
  window.vfTab = function(name){
    if(name === "compose"){ openCompose(); return; }              // (bevaret; browser-fallback)
    if(name === "compose-thought"){ openThought(); return; }      // flydende tanke-knap
    if(name === "compose-memory"){ openMemory(); return; }        // flydende minde-knap
    switchTab(name);
  };
  window.vfKreds = function(id){
    // Søgning håndteres nu 100% native (i den native kreds-bar) — kun feed-valg + opret her.
    if(id === "__new"){ openFeedSheet(); return; }
    setFeed(id);
  };
  /* --- Native Liquid Glass action-sheet-kort (ægte iOS 26-glas; kun builds med __vfGlassCard) ---
     Web ejer flowet: __vfSheetPost(spec, onAction) poster kort-specen (titel/besked/preview/knapper
     med lokaliseret tekst) til Swift og gemmer onAction. Swift kalder vfSheet(action) tilbage med den
     valgte knap; handleren kører logikken og poster ENTEN et opfølgende kort (fx slet-bekræftelsen)
     ELLER intet — i så fald lukkes kortet automatisk ({close:true}). Så kortet er 100% web-drevet. */
  const postSheet = function(msg){
    const mh = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.vibefeed;
    if(mh) mh.postMessage(Object.assign({ type: "sheet" }, msg));
  };
  let pendingSheet = null, sheetReplaced = false;
  window.__vfSheetPost = function(spec, onAction){
    pendingSheet = onAction || null;
    sheetReplaced = true; // et (nyt) kort vises nu
    postSheet(spec);
  };
  window.vfSheet = function(action){
    const h = pendingSheet;
    pendingSheet = null;
    sheetReplaced = false;
    try{
      if(h && action && action !== "__cancel") h(action);
    }finally{
      // Postede handleren ikke et opfølgende kort, er flowet slut → luk kortet.
      if(!sheetReplaced) postSheet({ close: true });
    }
  };
  /* --- Native Liquid Glass BOTTOM SHEETS (Ny kreds #fsheet / Medlemmer #msheet) — web-drevne ---
     kredse.js bygger en fuld snapshot og kalder __vfFsheetPush/__vfMemberPush; Swift tegner glasset
     og melder handlinger tilbage via window.vfFsheet/vfMember (routes i kredse.js). nativeSheetOpen
     skjuler de native tab-/kreds-barer mens et ark er åbent (arket har sit eget native scrim, så vi
     rejser IKKE web-#scrim → ingen dobbelt-dæmpning). */
  if(window.__vfFsheet) document.body.classList.add("nfs");     // CSS skjuler web-#fsheet i app'en
  if(window.__vfMemberSheet) document.body.classList.add("nms"); // CSS skjuler web-#msheet i app'en
  let nativeSheetOpen = false;
  const postPanel = function(type, msg){
    if(msg && msg.open) nativeSheetOpen = true;
    if(msg && msg.close) nativeSheetOpen = false;
    const mh = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.vibefeed;
    if(mh) mh.postMessage(Object.assign({ type: type }, msg));
  };
  window.__vfFsheetPush = function(msg){ postPanel("fsheet", msg); };
  window.__vfMemberPush = function(msg){ postPanel("msheet", msg); };
  window.vfFsheet = function(payload){ nativeFsheetAction(payload); };
  window.vfMember = function(payload){ nativeMemberAction(payload); };
  if(window.__vfEsheet) document.body.classList.add("nep"); // CSS skjuler web-#esheet i app'en
  window.__vfEsheetPush = function(msg){ postPanel("esheet", msg); };
  window.vfEsheet = function(payload){ nativeEsheetAction(payload); };
  window.vfAvatar = function(dataURL){ avatarStage(dataURL); }; // stager valgt foto til Gem
  window.vfBanner = function(dataURL){ bannerStage(dataURL); }; // stager valgt banner til Gem
  // Native Instagram-galleri → minde (native uploader direkte til Storage)
  window.vfMemory = function(obj){ nativeMemoryPost(obj); };
  window.vfMemoryUploaded = function(){ nativeMemoryUploaded(); };
  window.vfMemoryUploadFailed = function(){ nativeMemoryUploadFailed(); };
  window.vfMemoryCancel = function(){};
  window.vfMemoryFallback = function(){ openMemoryFallback(); };
  /* --- Native Liquid Glass KOMMENTAR-sheet (Instagram-agtigt; KUN minder) — web-drevet ---
     comments.js bygger en fuld snapshot (tråd + emoji-bar + labels) og kalder __vfCommentsPush;
     Swift tegner glasset og melder handlinger (send/like/svar/slet/dismiss) tilbage via
     window.vfComments (routes i comments.js → kører de eksisterende kommentar-funktioner). */
  window.__vfCommentsPush = function(msg){ postPanel("comments", msg); };
  window.vfComments = function(payload){ nativeCommentsAction(payload); };
  /* --- Native OPSLAGS-SIDE (X-agtig detalje-side; kun tanker) — web-drevet ---
     comments.js bygger snapshotten (opslag + tråd + labels) og kalder __vfPostPagePush;
     Swift tegner fuldskærms-siden (PostPageView.swift, swipe-tilbage) og melder handlinger
     tilbage via window.vfPostPage (routes i comments.js → eksisterende funktioner). */
  window.__vfPostPagePush = function(msg){ postPanel("postpage", msg); };
  window.vfPostPage = function(payload){ nativePostPageAction(payload); };
  /* --- Native LISTE-SIDE (Venner/Kredse på en profil, Instagram-agtig) — web-drevet ---
     profile.js bygger snapshotten (begge faner) og kalder __vfListPagePush; Swift tegner
     siden (faner, søgning, swipe-tilbage) og melder handlinger tilbage via vfListPage. */
  window.__vfListPagePush = function(msg){ postPanel("listpage", msg); };
  window.vfListPage = function(payload){ nativeListPageAction(payload); };
  /* --- Push-notifikations-tap (native didReceive → vfOpenNotif) — åbn det indholdet handler om.
     Payload {kind,pid,fid} = APNs custom keys (eller poll-notifikationens userInfo). Tom payload
     (ældre pushes uden keys) falder tilbage til akt-fanen; openFromPush venter selv på boot. */
  window.vfOpenNotif = function(payload){ openFromPush(payload || {}); };
  let lastTabKey = "", lastKredsKey = "";
  const syncNative = function(){
    const mh = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.vibefeed;
    if(!mh) return;
    const compact = document.body.classList.contains("hidebar");
    // Skjul barerne når noget ligger ovenpå ELLER vi ikke er på hoved-appen (boot-splash, login, gates)
    const blocked = nativeSheetOpen || !!document.querySelector(
        "#scrim.on, .compose.on, .profileview.on, .postview.on, #lightbox.on, #authview.on, #langview.on, #consentview.on"
      ) || document.body.classList.contains("lb-lock")
      || !!(el("splash") && !el("splash").classList.contains("gone"));
    const visible = !blocked;
    // --- Tabbar ---
    const av = document.querySelector(".view.active");
    const active = av ? av.id.replace("view-", "") : "feed";
    const dot = !!(el("tabdot") && el("tabdot").classList.contains("on"));
    const tabKey = active + "|" + dot + "|" + compact + "|" + visible;
    if(tabKey !== lastTabKey){
      lastTabKey = tabKey;
      mh.postMessage({ type: "tab", active: active, dot: dot, compact: compact, visible: visible });
    }
    // --- Kreds-bar (kun på feed-fanen; søgning er native, så baren bliver synlig hele tiden) ---
    const ks = nativeKredsState();
    const kvisible = visible && active === "feed";
    const kredsKey = JSON.stringify(ks.items) + "|" + compact + "|" + kvisible;
    if(kredsKey !== lastKredsKey){
      lastKredsKey = kredsKey;
      mh.postMessage({ type: "kreds", items: ks.items, compact: compact, visible: kvisible });
    }
  };
  setInterval(syncNative, 120);
  syncNative();
}

/* ================= Init ================= */
window.addEventListener("hashchange", function(){
  if(/type=recovery|error_code=|access_token=/.test(location.hash)) location.reload();
});
setTabIcons("feed");
(async function init(){
  // Sproget gættes fra enheden (dansk enhed → dansk, ellers engelsk) — ingen gate-side.
  // Kan skiftes med DA/EN-knappen på login-skærmen og i Rediger profil.
  // (Reklame-samtykket vises som ark ved FØRSTE feed-besøg efter login — se boot() i auth.js.)
  if(!hasStoredLang()) setLang(/^da/i.test(navigator.language || "") ? "da" : "en");
  // Universal-link-landing: mail-links peger direkte på vibefeed.dk/?token_hash=…&type=…
  // (så iOS kan åbne APPEN i stedet for Safari). Tokenet veksles med verifyOtp — virker i
  // enhver browser/app-kontekst, uafhængigt af hvor mailen blev bestilt.
  const q = new URLSearchParams(location.search);
  const tokenHash = q.get("token_hash");
  if(tokenHash){
    const linkType = q.get("type");
    history.replaceState(null, "", location.pathname); // engangstoken ud af URL/historik
    try{
      const { data, error } = await sb.auth.verifyOtp({
        token_hash: tokenHash,
        type: linkType === "recovery" ? "recovery" : "signup"
      });
      if(error){
        console.error(error);
        setAuthMode("login");
        showAuth(t("auth.link_used"));
        return;
      }
      if(linkType === "recovery"){ showRecovery(); return; }
      toast(t("auth.email_confirmed"));
      await boot(data.session);
      return;
    }catch(err){
      console.error(err);
      setAuthMode("login");
      showAuth(t("err.generic"));
      return;
    }
  }
  if(recoveryLinkError){
    history.replaceState(null, "", location.pathname);
    setAuthMode("login");
    showAuth(t("auth.link_used"));
    return;
  }
  if(recoveryMode){
    showRecovery();
    return;
  }
  try{
    const { data } = await sb.auth.getSession();
    if(data && data.session) await boot(data.session);
    else showAuth();
  }catch(err){
    console.error(err);
    showAuth(t("err.generic"));
  }
})();
