import { sb, GENERIC_ERR, recoveryMode, recoveryLinkError } from "./config.js";
import { el, toast } from "./helpers.js";
import { initFeed, setTabIcons, switchTab } from "./feed.js";
import { initComments } from "./comments.js";
import { initKredse, closeFeedSheet } from "./kredse.js";
import { initCompose } from "./compose.js";
import { initSearch } from "./search.js";
import { initProfile, closeEditSheet } from "./profile.js";
import { initRealtime } from "./realtime.js";
import { initAuth, boot, showAuth, showRecovery, setAuthMode } from "./auth.js";

/* ================= Wiring (samme lyttere som før, samlet her) ================= */
initFeed();
initComments();
initKredse();
initCompose();
initSearch();
initProfile();
initRealtime();
initAuth();

el("scrim").addEventListener("click", function(){ closeFeedSheet(); closeEditSheet(); });

document.querySelectorAll(".tabbar [data-view]").forEach(function(t){
  t.addEventListener("click", function(){ switchTab(t.dataset.view); });
});
el("nosparkle").addEventListener("click", function(){
  toast("Ingen algoritme her. Feedet er altid kronologisk.");
});

/* ================= Init ================= */
window.addEventListener("hashchange", function(){
  if(/type=recovery|error_code=|access_token=/.test(location.hash)) location.reload();
});
setTabIcons("feed");
(async function init(){
  if(recoveryLinkError){
    history.replaceState(null, "", location.pathname);
    setAuthMode("login");
    showAuth('Linket er udløbet eller allerede brugt. Prøv "Glemt adgangskode?" igen.');
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
    showAuth(GENERIC_ERR);
  }
})();
