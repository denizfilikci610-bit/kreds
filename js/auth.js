import { sb, recoveryMode, setRecoveryMode } from "./config.js";
import { t, getLang, setLang, policyURL, termsURL } from "./i18n.js";
import { me, setMe, state, FRIEND_SINCE, pv, expandedCmts, clearComposers, setCfilePid } from "./store.js";
import { el, registerProfile, toast, getConsent, showConsentGate } from "./helpers.js";
import { loadFriends, loadFeeds, loadPosts, feedById, renderFeedbar, renderKredshead, renderFeed, switchTab, closePostEdit, closePostMenu, closeReportMenu, resetFeedbarSearch, resetTapState, resetBarHide, clearUnseenFeeds } from "./feed.js";
import { renderComposeDest, closeCompose, clearPendingImg, ta, updateRing, canPost, resetPoll } from "./compose.js";
import { setOwnUI, renderStories, resetDeleteUI, closeEditSheet, closeProfile, closeActivitySheet, closeListSheet, closeNativeListPage, resetSaved, closeUnfriendMenu, closeBlockMenu } from "./profile.js";
import { closeFeedSheet, closeMemberSheet } from "./kredse.js";
import { closeNativePostPage } from "./comments.js";
import { resetChat, refreshChatUnread } from "./chat.js";
import { closeLightbox } from "./lightbox.js";
import { ADS_LIVE } from "./ads.js";
import { subscribeRealtime, unsubscribeRealtime } from "./realtime.js";
import { refreshNotifDot } from "./notifications.js";
import { resetSearch } from "./search.js";

/* ================= Auth ================= */
/* Fejlkode -> i18n-nøgle (tekster i i18n.js) */
const SIGNUP_ERRORS = {
  bad_email: "auth.e.bad_email",
  bad_password: "auth.e.bad_password",
  bad_name: "auth.e.bad_name",
  bad_handle: "auth.e.bad_handle",
  handle_taken: "auth.e.handle_taken",
  email_taken: "auth.e.email_taken",
  signup_failed: "err.generic"
};
let authMode = "login";
let pendingConfirmEmail = ""; // e-mail til gensend-knappen på "Tjek din mail"-skærmen
export function setAuthMode(mode){
  authMode = mode;
  el("auth-login").style.display = mode === "login" ? "flex" : "none";
  el("auth-signup").style.display = mode === "signup" ? "flex" : "none";
  el("auth-reset").style.display = mode === "reset" ? "flex" : "none";
  el("auth-recover").style.display = mode === "recover" ? "flex" : "none";
  el("auth-confirm").style.display = mode === "confirm" ? "flex" : "none";
  el("auth-alt").style.display = (mode === "login" || mode === "signup") ? "" : "none";
  el("auth-alt-txt").textContent = mode === "login" ? t("auth.alt_login") : t("auth.alt_signup");
  el("auth-lang").textContent = getLang().split("-")[0].toUpperCase(); // pillen viser det AKTIVE sprog (vælgeren ligger usynligt ovenpå)
  el("auth-toggle").textContent = mode === "login" ? t("auth.toggle_login") : t("auth.toggle_signup");
  /* Politik-linjen under opret-knappen (kun statiske i18n-tekster — ingen brugerdata) */
  el("su-policy").innerHTML = t("signup.accept", {
    terms: '<a href="'+termsURL()+'" target="_blank" rel="noopener">'+t("signup.terms")+'</a>',
    link: '<a href="'+policyURL()+'" target="_blank" rel="noopener">'+t("signup.policy")+'</a>'
  });
  el("li-err").textContent = "";
  el("su-err").textContent = "";
  el("fp-err").textContent = "";
  el("fp-err").classList.remove("ok");
  el("rc-err").textContent = "";
  el("cf-err").textContent = "";
  el("cf-err").classList.remove("ok");
}
/* Gen-anvend teksterne for den aktuelle auth-tilstand (kaldes ved sprogskifte) */
export function refreshAuthMode(){ setAuthMode(authMode); }
// Fader boot-splashen væk, når appen står færdig (boot) eller auth-skærmen vises —
// så et reload aldrig blotter den tomme app-skal mens data hentes.
export function hideSplash(){
  const s = el("splash");
  if(s) s.classList.add("gone");
}
export function showAuth(msg){
  hideSplash();
  setAuthMode("login");
  el("authview").classList.add("on");
  el("li-err").textContent = msg || "";
  el("su-err").textContent = "";
}
export function showRecovery(){
  hideSplash();
  setAuthMode("recover");
  el("authview").classList.add("on");
}
export function hideAuth(){
  el("authview").classList.remove("on");
  el("li-pass").value = "";
  el("su-pass").value = "";
  el("rc-pass1").value = "";
  el("rc-pass2").value = "";
  el("fp-email").value = "";
  el("li-err").textContent = "";
  el("su-err").textContent = "";
  el("fp-err").textContent = "";
  el("fp-err").classList.remove("ok");
  el("rc-err").textContent = "";
}

/* ================= Native notifikations-bro (kun i iOS-appen — no-op i browsere) =================
   Eksporteret: kaldes også ved sprogskifte, så native notifikationer følger sproget. */
export async function pushNativeCreds(){
  try{
    if(!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.vibefeed)) return;
    if(!me) return;
    const uid = me.id;
    let secret = localStorage.getItem("vf_device_secret");
    if(!secret){
      const { data, error } = await sb.rpc("issue_device_token");
      if(error || !data){ if(error) console.error(error); return; }
      // Log ud imens RPC'en var i luften? Gem/post ALDRIG et token for en død session
      // — ellers kan næste login genbruge den forrige brugers device-token.
      if(!me || me.id !== uid) return;
      secret = data;
      localStorage.setItem("vf_device_secret", secret);
    }
    if(me && me.id === uid) window.webkit.messageHandlers.vibefeed.postMessage({ type:"creds", secret:secret, userId: me.id, lang: getLang(), consent: getConsent() });
  }catch(_e){ /* aldrig lade broen vælte web-appen */ }
}
/* Best effort: tilbagekald token + giv appen besked. Kaldes FØR signOut (session i live)
   og igen fra resetApp (idempotent — nøglen er fjernet efter første kald). */
export function nativeLogout(){
  try{
    const secret = localStorage.getItem("vf_device_secret");
    if(secret){
      localStorage.removeItem("vf_device_secret");
      sb.rpc("revoke_device_token", { s: secret }).then(function(){}, function(){});
    }
    if(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.vibefeed)
      window.webkit.messageHandlers.vibefeed.postMessage({ type:"logout" });
  }catch(_e){}
}

/* ================= Boot ================= */
export async function boot(session){
  if(recoveryMode){ showRecovery(); return; }
  if(!session){ showAuth(); return; }
  const { data:prof, error } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  if(error){
    console.error(error);
    showAuth(t("auth.profile_failed"));
    return;
  }
  if(!prof){
    await sb.auth.signOut();
    showAuth(t("auth.retry_login"));
    return;
  }
  setMe(prof);
  registerProfile(me);
  setOwnUI();
  state.currentFeed = "all";
  expandedCmts.clear();
  // Hent venner + kredse først, så vi kender kredsene og kan gendanne den kreds
  // brugeren var i før et reload (kun hvis den stadig findes) — DERNÆST posts, så
  // loadPosts henter den rigtige kreds' opslag fra første frame (ingen flimren).
  await Promise.all([loadFriends(), loadFeeds()]);
  let savedFeed; try{ savedFeed = sessionStorage.getItem("vf_cur_feed"); }catch(_e){}
  if(savedFeed && savedFeed !== "all" && feedById(savedFeed)) state.currentFeed = savedFeed;
  await loadPosts();
  renderFeedbar();
  renderKredshead();
  renderComposeDest();
  renderStories();
  renderFeed();
  refreshChatUnread(); // fane-prikken på Beskeder kan lyse fra første frame (ingen await — blokerer ikke boot)
  // Gendan den fane brugeren var på før et reload (pull-to-refresh); tom/ugyldig → feed.
  // Alle data er hentet ovenfor, så det er sikkert at åbne enhver fane her.
  let savedTab; try{ savedTab = sessionStorage.getItem("vf_cur_tab"); }catch(_e){}
  switchTab(["feed", "search", "akt", "profil"].includes(savedTab) ? savedTab : "feed");
  subscribeRealtime();
  refreshNotifDot(); // tænd hjerte-prikken hvis nogen reagerede mens jeg var væk/logget ud
  hideAuth();
  hideSplash(); // appen står nu færdig på rette fane + kreds → fad splashen væk
  pushNativeCreds(); // fire-and-forget — kun i WKWebView'en
  // Reklame-valget: ark over feedet ved FØRSTE besøg efter login/oprettelse.
  // Vises KUN når reklamer faktisk er tændt (ADS_LIVE, den fælles kill-switch i
  // ads.js) — ellers ville vi bede om samtykke til noget der ikke findes.
  // Ingen await — arket er modalt (inert) og styrer sig selv.
  if(ADS_LIVE && !getConsent()) showConsentGate();
}
export function resetApp(){
  nativeLogout(); // no-op hvis allerede kaldt før signOut (nøglen er fjernet)
  unsubscribeRealtime();
  setMe(null);
  switchTab("feed");
  resetBarHide();
  el("tabdot").classList.remove("on");
  clearUnseenFeeds(); // kun in-memory — vf_feed_seen i localStorage er per enhed og bliver stående
  Object.keys(FRIEND_SINCE).forEach(function(k){ delete FRIEND_SINCE[k]; });
  state.friends = [];
  state.humanFriends = [];
  state.sentRequests = [];
  state.blockedIds = [];   // review-fund: må ikke lække til næste konto på samme enhed
  state.blockReady = false;
  state.posts = [];
  state.wholePosts = [];
  state.savedPosts = [];
  resetSaved(); // Gemte-fanen henter friskt for næste konto
  state.feeds = [];
  state.dms = [];
  state.currentFeed = "all";
  try{ sessionStorage.setItem("vf_cur_feed", "all"); }catch(_e){} // ryd valgt kreds ved logout
  pv.u = null;
  pv.posts = [];
  expandedCmts.clear();
  clearComposers();
  setCfilePid(null);
  el("cfile").value = "";
  resetDeleteUI();
  closeFeedSheet();
  closeMemberSheet();
  closeNativePostPage(); // en åben native opslags-side må ikke overleve et logout
  closeListSheet();
  closeNativeListPage();
  resetChat();
  closeEditSheet();
  closeActivitySheet();
  closePostEdit();
  closePostMenu();
  closeReportMenu();
  closeUnfriendMenu();
  closeBlockMenu();
  closeCompose();
  closeProfile();
  closeLightbox();
  resetTapState(); // annullerer et afventende enkelt-tryk, så lightboxen ikke genåbner efter logout
  resetFeedbarSearch(); // kreds-søgningen i feedbaren nulstilles ved logout
  clearPendingImg();
  ta.value = "";
  resetPoll();
  updateRing();
  canPost();
  el("feed").innerHTML = "";
  el("stories").innerHTML = "";
  el("feedbar").innerHTML = "";
  el("notifs").innerHTML = "";
  el("search-list").innerHTML = "";
  el("search-input").value = "";
  el("myposts").innerHTML = "";
  el("stat-posts").textContent = "0";
  el("stat-friends").textContent = "0";
  el("stat-kredse").textContent = "0";
  resetSearch();
  el("su-name").value = "";
  el("su-handle").value = "";
  el("su-email").value = "";
  el("fp-email").value = "";
  el("rc-pass1").value = "";
  el("rc-pass2").value = "";
  setAuthMode("login");
}

export function initAuth(){
el("auth-toggle").addEventListener("click", function(){
  setAuthMode(authMode === "login" ? "signup" : "login");
});
el("li-forgot").addEventListener("click", function(){
  setAuthMode("reset");
  el("fp-email").value = el("li-email").value.trim();
});
/* Sprogskift på login-skærmen sker via select[data-langsel]-overlayet (i18n.js
   lytter selv); initI18n-callback'en (main.js) gen-render'er auth-teksterne. */
el("fp-back").addEventListener("click", function(){
  setAuthMode("login");
});
el("rc-back").addEventListener("click", function(){
  setRecoveryMode(false);
  history.replaceState(null, "", location.pathname);
  setAuthMode("login");
});
el("cf-back").addEventListener("click", function(){
  setAuthMode("login");
});
el("cf-resend").addEventListener("click", async function(){
  if(!pendingConfirmEmail) { setAuthMode("login"); return; }
  const btn = el("cf-resend");
  btn.disabled = true;
  el("cf-err").textContent = "";
  el("cf-err").classList.remove("ok");
  try{
    const { error } = await sb.auth.resend({ type: "signup", email: pendingConfirmEmail,
                                             options: { emailRedirectTo: window.location.origin } });
    if(error){
      // 429 = "Minimum interval per user" i Supabase (60 s) — bed brugeren vente lidt
      el("cf-err").textContent = (error.status === 429) ? t("auth.reset_rate") : t("err.generic");
      btn.disabled = false;
      return;
    }
    el("cf-err").textContent = t("auth.resent");
    el("cf-err").classList.add("ok");
    setTimeout(function(){ btn.disabled = false; }, 60000); // matcher server-intervallet
  }catch(err){
    console.error(err);
    el("cf-err").textContent = t("err.generic");
    btn.disabled = false;
  }
});
el("auth-reset").addEventListener("submit", async function(e){
  e.preventDefault();
  const email = el("fp-email").value.trim();
  if(!email) return;
  const btn = el("fp-btn");
  btn.disabled = true;
  el("fp-err").textContent = "";
  el("fp-err").classList.remove("ok");
  try{
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if(error){
      if(error.code === "email_address_invalid" || /invalid/i.test(error.message || "")){
        el("fp-err").textContent = t("auth.reset_bad_email");
      } else if(error.status === 429 || /rate|429/i.test(error.message || "")){
        el("fp-err").textContent = t("auth.reset_rate");
      } else {
        el("fp-err").textContent = t("err.generic");
      }
      return;
    }
    el("fp-err").classList.add("ok");
    el("fp-err").textContent = t("auth.reset_sent");
  }catch(err){
    console.error(err);
    el("fp-err").textContent = t("err.generic");
  }finally{
    btn.disabled = false;
  }
});
el("auth-recover").addEventListener("submit", async function(e){
  e.preventDefault();
  const p1 = el("rc-pass1").value;
  const p2 = el("rc-pass2").value;
  el("rc-err").textContent = "";
  if(p1.length < 6){ el("rc-err").textContent = t("auth.pw_short"); return; }
  if(p1 !== p2){ el("rc-err").textContent = t("auth.pw_mismatch"); return; }
  const btn = el("rc-btn");
  btn.disabled = true;
  try{
    const { error } = await sb.auth.updateUser({ password: p1 });
    if(error){
      if(error.code === "same_password" || /different from the old/i.test(error.message || ""))
        el("rc-err").textContent = t("auth.pw_same");
      else if(error.code === "weak_password" || /at least|weak/i.test(error.message || ""))
        el("rc-err").textContent = t("auth.pw_short");
      else if(error.name === "AuthSessionMissingError" || /auth session missing/i.test(error.message || "")){
        setRecoveryMode(false);
        history.replaceState(null, "", location.pathname);
        setAuthMode("login");
        showAuth(t("auth.link_expired"));
      }
      else
        el("rc-err").textContent = t("err.generic");
      return;
    }
    setRecoveryMode(false);
    history.replaceState(null, "", location.pathname);
    toast(t("auth.pw_updated"));
    const { data } = await sb.auth.getSession();
    if(data && data.session){
      await boot(data.session);
    }else{
      setAuthMode("login");
      showAuth();
    }
  }catch(err){
    console.error(err);
    el("rc-err").textContent = t("err.generic");
  }finally{
    btn.disabled = false;
  }
});
el("su-handle").addEventListener("input", function(){
  const v = this.value.toLowerCase().trim();
  if(v !== this.value) this.value = v;
});
el("auth-login").addEventListener("submit", async function(e){
  e.preventDefault();
  const email = el("li-email").value.trim();
  const pass = el("li-pass").value;
  if(!email || !pass) return;
  el("li-err").textContent = "";
  const btn = el("li-btn");
  btn.disabled = true;
  try{
    const { data, error } = await sb.auth.signInWithPassword({ email:email, password:pass });
    if(error){
      // Ubekræftet e-mail: vis "Tjek din mail"-skærmen med gensend-knap i stedet for en fejl
      if(error.code === "email_not_confirmed" || /not confirmed/i.test(error.message || "")){
        pendingConfirmEmail = email;
        setAuthMode("confirm");
        el("cf-err").textContent = t("auth.e.not_confirmed");
        return;
      }
      el("li-err").textContent = (error.code === "invalid_credentials" || /invalid/i.test(error.message || ""))
        ? t("auth.wrong_login")
        : t("err.generic");
      return;
    }
    await boot(data.session);
  }catch(err){
    console.error(err);
    el("li-err").textContent = t("err.generic");
  }finally{
    btn.disabled = false;
  }
});
el("auth-signup").addEventListener("submit", async function(e){
  e.preventDefault();
  const name = el("su-name").value.trim();
  const handle = el("su-handle").value.trim().toLowerCase();
  const email = el("su-email").value.trim();
  const pass = el("su-pass").value;
  el("su-err").textContent = "";
  const btn = el("su-btn");
  btn.disabled = true;
  try{
    const { error } = await sb.functions.invoke("signup", { body:{ email:email, password:pass, name:name, handle:handle } });
    if(error){
      let code = "", raw = "";
      try{
        raw = await error.context.text();
        code = (JSON.parse(raw).error) || "";
      }catch(_e){}
      el("su-err").textContent = (code.indexOf("blocked_content") >= 0 || raw.indexOf("blocked_content") >= 0)
        ? t("err.blocked")
        : t(SIGNUP_ERRORS[code] || "err.generic");
      return;
    }
    // E-mailbekræftelse: kontoen er oprettet UBEKRÆFTET (signup-edge-fn'en sender ingen mail
    // selv) — send bekræftelsesmailen og vis "Tjek din mail". Fejler gensend (fx rate limit)
    // vises skærmen alligevel; gensend-knappen kan bruges bagefter.
    pendingConfirmEmail = email;
    try{
      await sb.auth.resend({ type: "signup", email: email, options: { emailRedirectTo: window.location.origin } });
    }catch(_e){}
    setAuthMode("confirm");
  }catch(err){
    console.error(err);
    el("su-err").textContent = t("err.generic");
  }finally{
    btn.disabled = false;
  }
});
sb.auth.onAuthStateChange(function(event){
  if(event === "SIGNED_OUT"){
    setRecoveryMode(false);
    resetApp();
    showAuth();
  }
  if(event === "PASSWORD_RECOVERY"){
    setRecoveryMode(true);
    showRecovery();
  }
});
}
