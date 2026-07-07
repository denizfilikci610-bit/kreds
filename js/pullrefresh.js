/* ================= Pull-to-refresh — KUN indholdet glider =================
   Overtræk i toppen → den aktive fanes indhold (efter dens sticky-header) glider et
   stykke ned med en spinner → slip forbi tærsklen → genindlæs.

   VIGTIGT: kun selve indholdet flytter sig. `.topbar`, kreds-baren (`.feedbar` /
   `.searchhead`) og bund-`.tabbar` bliver stående HELT fast. Vi transformerer derfor
   den aktive views børn EFTER dens ledende sticky-header — ikke hele `#app`. Topbar og
   tabbar ligger uden for views (direkte i `#app`), så de rammes aldrig.

   Virker på alle faner (feed/søg/aktivitet/profil). No-op i browsere uden touch. */
import { el } from "./helpers.js";

const THRESHOLD = 72;   // px pull (efter dæmpning) før genindlæsning udløses
const MAX = 120;        // max pull-distance
const HOLD = 56;        // hvor langt indholdet holdes nede mens der genindlæses

export function initPullRefresh(){
  const app = el("app");
  const phone = app ? app.parentNode : null;
  if(!app || !phone) return;

  // Spinner over #app (z-index:2) — placeres lige under barerne, i indholdets top,
  // så den afsløres i mellemrummet når indholdet glider ned.
  const spin = document.createElement("div");
  spin.className = "ptr";
  spin.style.zIndex = "2";
  spin.innerHTML = '<div class="ptr-ring" aria-hidden="true"></div>';
  phone.insertBefore(spin, app);
  const ring = spin.querySelector(".ptr-ring");

  let startY = null, pulling = false, pullY = 0, refreshing = false;
  let targets = [];   // de elementer der glider (aktiv views indhold efter sticky-header)

  function blocked(){
    const scrim = el("scrim");
    return refreshing ||
      (scrim && scrim.classList.contains("on")) ||         // et ark/modal er åbent
      document.body.classList.contains("lb-lock") ||        // lightbox
      !!document.querySelector("#rwd-pop.on") ||             // rewarded-pop-up
      !!(document.activeElement && /^(input|textarea)$/i.test(document.activeElement.tagName));
  }

  // Den aktive views indhold: alle børn EFTER en ledende sticky-header (.feedbar/.searchhead).
  // Genberegnes hver gestus, da den aktive fane kan skifte.
  function collectTargets(){
    const view = document.querySelector(".view.active");
    if(!view) return [];
    const kids = Array.prototype.slice.call(view.children);
    if(kids.length && (kids[0].classList.contains("feedbar") || kids[0].classList.contains("searchhead"))){
      kids.shift();   // behold den sticky kreds-/søge-bar fast
    }
    return kids;
  }

  function setTransform(y){
    const v = y ? ("translateY(" + y + "px)") : "";
    for(let i = 0; i < targets.length; i++){ targets[i].style.transform = v; }
  }
  function setTransition(t){
    for(let i = 0; i < targets.length; i++){ targets[i].style.transition = t; }
  }

  // Placér spinneren lige under barerne = i toppen af det indhold der glider.
  function placeSpinner(){
    const phoneTop = phone.getBoundingClientRect().top;
    let top = null;
    if(targets.length){
      top = targets[0].getBoundingClientRect().top - phoneTop;
    }
    if(top == null || !isFinite(top)){
      const tb = document.querySelector(".topbar");
      top = tb ? (tb.getBoundingClientRect().bottom - phoneTop) : 60;
    }
    spin.style.top = Math.max(0, Math.round(top)) + "px";
  }

  function reset(){
    setTransition("transform .25s ease");
    setTransform(0);
    spin.style.opacity = "0";
    spin.classList.remove("ready", "loading");
    const t = targets.slice();
    setTimeout(function(){ for(let i = 0; i < t.length; i++){ t[i].style.transition = ""; } }, 280);
    startY = null; pulling = false; pullY = 0;
  }

  app.addEventListener("touchstart", function(e){
    if(blocked() || e.touches.length !== 1 || app.scrollTop > 0){ startY = null; return; }
    startY = e.touches[0].clientY;
    pulling = false; pullY = 0;
    targets = collectTargets();      // genberegn hver gestus (aktiv fane kan have skiftet)
    setTransition("");
    placeSpinner();
  }, { passive: true });

  app.addEventListener("touchmove", function(e){
    if(startY === null || refreshing) return;
    const dy = e.touches[0].clientY - startY;
    if(dy > 0 && app.scrollTop <= 0){
      pulling = true;
      pullY = Math.min(MAX, dy * 0.5);   // dæmpet træk
      e.preventDefault();                 // stop native scroll under trækket
      setTransform(pullY);
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
      setTransition("transform .2s ease");
      setTransform(HOLD);
      setTimeout(function(){ location.reload(); }, 150);
    } else {
      reset();
    }
  }
  app.addEventListener("touchend", end, { passive: true });
  app.addEventListener("touchcancel", reset, { passive: true });
}
