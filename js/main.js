import { sb, recoveryMode, recoveryLinkError } from "./config.js";
import { me, curTab } from "./store.js";
import { el, toast, getConsent, setConsent } from "./helpers.js";
import { t, initI18n, setLang, hasStoredLang } from "./i18n.js";
import { initFeed, setTabIcons, switchTab, closePostEdit, renderFeedbar, renderKredshead, renderFeed, loadQuota } from "./feed.js";
import { initComments } from "./comments.js";
import { initKredse, closeFeedSheet, closeMemberSheet } from "./kredse.js";
import { initCompose, renderComposeDest } from "./compose.js";
import { initSearch, renderSearch } from "./search.js";
import { initProfile, closeEditSheet, closeActivitySheet, renderStories, renderMyPosts, refreshPv } from "./profile.js";
import { initNotifs, loadNotifs } from "./notifications.js";
import { initLightbox } from "./lightbox.js";
import { initRealtime, scheduleRefetch } from "./realtime.js";
import { initAuth, boot, showAuth, showRecovery, setAuthMode, refreshAuthMode, pushNativeCreds } from "./auth.js";
import { initRewarded } from "./rewarded.js";
import { initPullRefresh } from "./pullrefresh.js";

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
  loadQuota();
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
initRealtime();
initAuth();
initRewarded(); // rewarded-video-genvej + belønnings-bro (no-op i browsere)
initPullRefresh(); // ren pull-to-refresh for hele appen (erstatter native webview-bounce)

el("scrim").addEventListener("click", function(){ closeFeedSheet(); closeMemberSheet(); closeEditSheet(); closeActivitySheet(); closePostEdit(); });

document.querySelectorAll(".tabbar [data-view]").forEach(function(tab){
  tab.addEventListener("click", function(){ switchTab(tab.dataset.view); });
});
el("nosparkle").addEventListener("click", function(){
  toast(t("nosparkle.toast"));
});

/* ================= Fælles gate-hjælper (langview/consentview) =================
   Modal for alvor: appen bag porten gøres inert (fokus + a11y-træ), og fokus
   flyttes til portens primære knap. inert fjernes igen før resolve(). */
function showGate(viewId, focusSel, pickSel, onPickBtn){
  return new Promise(function(resolve){
    const gv = el(viewId);
    gv.classList.add("on");
    el("app").inert = true;
    const first = gv.querySelector(focusSel);
    if(first) first.focus();
    gv.addEventListener("click", function onPick(e){
      const b = e.target.closest(pickSel);
      if(!b) return;
      onPickBtn(b);
      gv.classList.remove("on");
      gv.removeEventListener("click", onPick);
      el("app").inert = false;
      resolve();
    });
  });
}

/* ================= Sprogvalg (kun første start — vf_lang mangler) ================= */
function showLangPicker(){
  return showGate("langview", "[data-lang]", "[data-lang]", function(b){
    setLang(b.dataset.lang);
  });
}

/* ================= Reklame-samtykke (vises én gang — vf_consent mangler) ================= */
function showConsentGate(){
  return showGate("consentview", "#consent-personal", "#consent-personal, #consent-limited", function(b){
    setConsent(b.id === "consent-personal" ? "personal" : "limited");
  });
}

/* ================= Init ================= */
window.addEventListener("hashchange", function(){
  if(/type=recovery|error_code=|access_token=/.test(location.hash)) location.reload();
});
setTabIcons("feed");
(async function init(){
  if(!hasStoredLang()) await showLangPicker(); // FØR auth/boot — intet skip
  if(!getConsent()) await showConsentGate();   // efter sprogvalget — ingen lukning uden valg
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
