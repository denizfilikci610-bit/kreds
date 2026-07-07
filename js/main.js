import { sb, recoveryMode, recoveryLinkError } from "./config.js";
import { me, curTab } from "./store.js";
import { el, toast } from "./helpers.js";
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

el("scrim").addEventListener("click", function(){ closeFeedSheet(); closeMemberSheet(); closeEditSheet(); closeActivitySheet(); closePostEdit(); });

document.querySelectorAll(".tabbar [data-view]").forEach(function(tab){
  tab.addEventListener("click", function(){ switchTab(tab.dataset.view); });
});
el("nosparkle").addEventListener("click", function(){
  toast(t("nosparkle.toast"));
});

/* ================= Sprogvalg (kun første start — vf_lang mangler) ================= */
function showLangPicker(){
  return new Promise(function(resolve){
    const lv = el("langview");
    lv.classList.add("on");
    lv.addEventListener("click", function onPick(e){
      const b = e.target.closest("[data-lang]");
      if(!b) return;
      setLang(b.dataset.lang);
      lv.classList.remove("on");
      lv.removeEventListener("click", onPick);
      resolve();
    });
  });
}

/* ================= Init ================= */
window.addEventListener("hashchange", function(){
  if(/type=recovery|error_code=|access_token=/.test(location.hash)) location.reload();
});
setTabIcons("feed");
(async function init(){
  if(!hasStoredLang()) await showLangPicker(); // FØR auth/boot — intet skip
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
