import { sb, GENERIC_ERR, BLOCKED_MSG, recoveryMode, setRecoveryMode } from "./config.js";
import { me, setMe, state, FRIEND_SINCE, pv, expandedCmts, clearComposers, setCfilePid } from "./store.js";
import { el, registerProfile, toast } from "./helpers.js";
import { loadFriends, loadFeeds, loadPosts, renderFeedbar, renderKredshead, renderFeed, switchTab, loadQuota, closePostEdit, closePostMenu, closeReportMenu, resetFeedbarSearch, resetTapState, resetBarHide } from "./feed.js";
import { renderComposeDest, closeCompose, clearPendingImg, ta, updateRing, canPost, resetPoll } from "./compose.js";
import { setOwnUI, renderStories, resetDeleteUI, closeEditSheet, closeProfile, closeActivitySheet } from "./profile.js";
import { closeFeedSheet, closeMemberSheet } from "./kredse.js";
import { closeLightbox } from "./lightbox.js";
import { subscribeRealtime, unsubscribeRealtime } from "./realtime.js";
import { resetSearch } from "./search.js";

/* ================= Auth ================= */
const SIGNUP_ERRORS = {
  bad_email: "Skriv en gyldig e-mail",
  bad_password: "Adgangskoden skal være mindst 6 tegn",
  bad_name: "Navn: 1-40 tegn",
  bad_handle: "Brugernavn: 2-20 tegn — kun små bogstaver, tal, punktum og _",
  handle_taken: "Brugernavnet er taget",
  email_taken: "Der findes allerede en profil med den e-mail",
  signup_failed: "Noget gik galt. Prøv igen."
};
let authMode = "login";
export function setAuthMode(mode){
  authMode = mode;
  el("auth-login").style.display = mode === "login" ? "flex" : "none";
  el("auth-signup").style.display = mode === "signup" ? "flex" : "none";
  el("auth-reset").style.display = mode === "reset" ? "flex" : "none";
  el("auth-recover").style.display = mode === "recover" ? "flex" : "none";
  el("auth-alt").style.display = (mode === "login" || mode === "signup") ? "" : "none";
  el("auth-alt-txt").textContent = mode === "login" ? "Har du ikke en profil?" : "Har du allerede en profil?";
  el("auth-toggle").textContent = mode === "login" ? "Opret en" : "Log ind";
  el("li-err").textContent = "";
  el("su-err").textContent = "";
  el("fp-err").textContent = "";
  el("fp-err").classList.remove("ok");
  el("rc-err").textContent = "";
}
export function showAuth(msg){
  setAuthMode("login");
  el("authview").classList.add("on");
  el("li-err").textContent = msg || "";
  el("su-err").textContent = "";
}
export function showRecovery(){
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

/* ================= Native notifikations-bro (kun i iOS-appen — no-op i browsere) ================= */
async function pushNativeCreds(){
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
    if(me && me.id === uid) window.webkit.messageHandlers.vibefeed.postMessage({ type:"creds", secret:secret, userId: me.id });
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
    showAuth("Kunne ikke hente din profil. Tjek din forbindelse og prøv igen.");
    return;
  }
  if(!prof){
    await sb.auth.signOut();
    showAuth("Noget gik galt. Prøv at logge ind igen.");
    return;
  }
  setMe(prof);
  registerProfile(me);
  setOwnUI();
  state.currentFeed = "all";
  expandedCmts.clear();
  await Promise.all([loadFriends(), loadFeeds(), loadPosts()]);
  renderFeedbar();
  renderKredshead();
  renderComposeDest();
  renderStories();
  renderFeed();
  switchTab("feed");
  subscribeRealtime();
  loadQuota();
  hideAuth();
  pushNativeCreds(); // fire-and-forget — kun i WKWebView'en
}
export function resetApp(){
  nativeLogout(); // no-op hvis allerede kaldt før signOut (nøglen er fjernet)
  unsubscribeRealtime();
  setMe(null);
  switchTab("feed");
  resetBarHide();
  el("tabdot").classList.remove("on");
  Object.keys(FRIEND_SINCE).forEach(function(k){ delete FRIEND_SINCE[k]; });
  state.friends = [];
  state.humanFriends = [];
  state.posts = [];
  state.wholePosts = [];
  state.teasers = [];
  state.feeds = [];
  state.currentFeed = "all";
  pv.u = null;
  pv.posts = [];
  expandedCmts.clear();
  clearComposers();
  setCfilePid(null);
  el("cfile").value = "";
  el("qchip").classList.remove("on");
  el("qchip-n").textContent = "0";
  resetDeleteUI();
  closeFeedSheet();
  closeMemberSheet();
  closeEditSheet();
  closeActivitySheet();
  closePostEdit();
  closePostMenu();
  closeReportMenu();
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
  el("nik-saldo").innerHTML = "";
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
el("fp-back").addEventListener("click", function(){
  setAuthMode("login");
});
el("rc-back").addEventListener("click", function(){
  setRecoveryMode(false);
  history.replaceState(null, "", location.pathname);
  setAuthMode("login");
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
        el("fp-err").textContent = "Det ligner ikke en gyldig e-mailadresse.";
      } else if(error.status === 429 || /rate|429/i.test(error.message || "")){
        el("fp-err").textContent = "Vent lidt og prøv igen.";
      } else {
        el("fp-err").textContent = GENERIC_ERR;
      }
      return;
    }
    el("fp-err").classList.add("ok");
    el("fp-err").textContent = "Hvis der findes en profil med den e-mail, har vi sendt et link. Tjek din indbakke.";
  }catch(err){
    console.error(err);
    el("fp-err").textContent = GENERIC_ERR;
  }finally{
    btn.disabled = false;
  }
});
el("auth-recover").addEventListener("submit", async function(e){
  e.preventDefault();
  const p1 = el("rc-pass1").value;
  const p2 = el("rc-pass2").value;
  el("rc-err").textContent = "";
  if(p1.length < 6){ el("rc-err").textContent = "Adgangskoden skal være mindst 6 tegn."; return; }
  if(p1 !== p2){ el("rc-err").textContent = "Adgangskoderne er ikke ens."; return; }
  const btn = el("rc-btn");
  btn.disabled = true;
  try{
    const { error } = await sb.auth.updateUser({ password: p1 });
    if(error){
      if(error.code === "same_password" || /different from the old/i.test(error.message || ""))
        el("rc-err").textContent = "Den nye adgangskode skal være forskellig fra den gamle.";
      else if(error.code === "weak_password" || /at least|weak/i.test(error.message || ""))
        el("rc-err").textContent = "Adgangskoden skal være mindst 6 tegn.";
      else if(error.name === "AuthSessionMissingError" || /auth session missing/i.test(error.message || "")){
        setRecoveryMode(false);
        history.replaceState(null, "", location.pathname);
        setAuthMode("login");
        showAuth('Linket er udløbet. Prøv "Glemt adgangskode?" igen.');
      }
      else
        el("rc-err").textContent = GENERIC_ERR;
      return;
    }
    setRecoveryMode(false);
    history.replaceState(null, "", location.pathname);
    toast("Din adgangskode er opdateret");
    const { data } = await sb.auth.getSession();
    if(data && data.session){
      await boot(data.session);
    }else{
      setAuthMode("login");
      showAuth();
    }
  }catch(err){
    console.error(err);
    el("rc-err").textContent = GENERIC_ERR;
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
      el("li-err").textContent = (error.code === "invalid_credentials" || /invalid/i.test(error.message || ""))
        ? "Forkert e-mail eller adgangskode"
        : GENERIC_ERR;
      return;
    }
    await boot(data.session);
  }catch(err){
    console.error(err);
    el("li-err").textContent = GENERIC_ERR;
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
        ? BLOCKED_MSG
        : (SIGNUP_ERRORS[code] || GENERIC_ERR);
      return;
    }
    const si = await sb.auth.signInWithPassword({ email:email, password:pass });
    if(si.error){
      el("su-err").textContent = "Profilen er oprettet, men login fejlede. Prøv at logge ind.";
      return;
    }
    await boot(si.data.session);
  }catch(err){
    console.error(err);
    el("su-err").textContent = GENERIC_ERR;
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
