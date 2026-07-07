/* ================= Pull-to-refresh for HELE appen (scroll-containeren #app) =================
   Overtræk i toppen → indholdet (cirkler + feed) glider et stykke ned med en spinner →
   slip forbi tærsklen → genindlæs. Erstatter det native webview-bounce, der viste et
   grimt sort hul + spinner og skubbede hele UI'et ned.

   Virker for alle faner, fordi de alle ligger i #app. No-op i browsere uden touch. */
import { el } from "./helpers.js";

const THRESHOLD = 72;   // px pull (efter dæmpning) før genindlæsning udløses
const MAX = 120;        // max pull-distance
const HOLD = 56;        // hvor langt kortet holdes nede mens der genindlæses

export function initPullRefresh(){
  const app = el("app");
  const phone = app ? app.parentNode : null;
  if(!app || !phone) return;

  // Spinner bag #app, øverst i .phone — synlig når #app glider ned.
  const spin = document.createElement("div");
  spin.className = "ptr";
  spin.innerHTML = '<div class="ptr-ring" aria-hidden="true"></div>';
  phone.insertBefore(spin, app);
  const ring = spin.querySelector(".ptr-ring");

  let startY = null, pulling = false, pullY = 0, refreshing = false;

  function blocked(){
    const scrim = el("scrim");
    return refreshing ||
      (scrim && scrim.classList.contains("on")) ||         // et ark/modal er åbent
      document.body.classList.contains("lb-lock") ||        // lightbox
      !!document.querySelector("#rwd-pop.on") ||             // rewarded-pop-up
      !!(document.activeElement && /^(input|textarea)$/i.test(document.activeElement.tagName));
  }

  function reset(){
    app.style.transition = "transform .25s ease";
    app.style.transform = "";
    spin.style.opacity = "0";
    spin.classList.remove("ready", "loading");
    setTimeout(function(){ app.style.transition = ""; }, 280);
    startY = null; pulling = false; pullY = 0;
  }

  app.addEventListener("touchstart", function(e){
    if(blocked() || e.touches.length !== 1 || app.scrollTop > 0){ startY = null; return; }
    startY = e.touches[0].clientY;
    pulling = false; pullY = 0;
    app.style.transition = "";
  }, { passive: true });

  app.addEventListener("touchmove", function(e){
    if(startY === null || refreshing) return;
    const dy = e.touches[0].clientY - startY;
    if(dy > 0 && app.scrollTop <= 0){
      pulling = true;
      pullY = Math.min(MAX, dy * 0.5);   // dæmpet træk
      e.preventDefault();                 // stop native scroll under trækket
      app.style.transform = "translateY(" + pullY + "px)";
      spin.style.opacity = String(Math.min(1, pullY / THRESHOLD));
      ring.style.transform = "rotate(" + Math.round(pullY * 3) + "deg)";
      spin.classList.toggle("ready", pullY >= THRESHOLD);
    } else if(pulling && dy <= 0){
      reset();
    }
  }, { passive: false });

  function end(){
    if(startY === null){ return; }
    if(pulling && pullY >= THRESHOLD){
      refreshing = true;
      spin.classList.remove("ready");
      spin.classList.add("loading");
      spin.style.opacity = "1";
      app.style.transition = "transform .2s ease";
      app.style.transform = "translateY(" + HOLD + "px)";
      setTimeout(function(){ location.reload(); }, 150);
    } else {
      reset();
    }
  }
  app.addEventListener("touchend", end, { passive: true });
  app.addEventListener("touchcancel", reset, { passive: true });
}
