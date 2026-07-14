/* ================= Reklamer i feedet (kun i iOS-appen) =================
   Reklamer vises som "Sponsoreret"-kort MELLEM opslagene — ét efter hver
   AD_EVERY opslag. Web tegner kortet og reserverer et 300×250-hul; den native
   bro (Appodeal MREC) lægger en rigtig annonce oven på hullet ud fra hullets
   position, som vi rapporterer herfra.

   Alt her er no-op i en almindelig browser (ingen native bro), så vibefeed.dk
   som hjemmeside er upåvirket. */
import { t } from "./i18n.js";
import { el, getConsent } from "./helpers.js";

/* Hyppighed: første reklame efter AD_EVERY opslag, derefter for hver AD_EVERY.
   Ét sted at ændre kadencen. */
export const AD_EVERY = 3;

/* KILL-SWITCH: Appodeal serverer først rigtige annoncer når appen ER live på
   App Store og godkendt i deres dashboard. Indtil da ville Release-builds vise
   TOMME "Promovering"-kort (gråt hul uden annonce) — grimt for både TestFlight-
   brugere og Apple-review. false = ingen annonce-kort og ingen video-tilbud.
   TÆNDT 2026-07-14 EFTER LIVE i App Store: genererer annonce-anmodninger så
   AdMob/Appodeal kan gennemføre godkendelse (høne-og-æg). Nul rigtige brugere
   endnu, så tomme kort generer ingen. SLUK igen (false + deploy) hvis feedet
   viser tomme huller for de første venner, indtil fill kommer. */
export const ADS_LIVE = true;

function bridge(){
  return (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.vibefeed) || null;
}

/* Reklamer kører kun i appen (bro til stede) og når samtykke er givet.
   Begge samtykke-valg viser reklamer — kun personaliseringen adskiller sig. */
export function adsEnabled(){
  return ADS_LIVE && !!bridge() && !!getConsent();
}

/* Slot-markup: et OPSLAGS-lignende kort — profil-header (avatar + "Promovering" +
   tydeligt "Annonce"-mærke + @promovering) oven på det reserverede 300×250-hul, hvor
   den native MREC lægges. Kun skelettet er web; selve annoncen er den samme MREC som
   før. Headeren er ikke klikbar (ingen rigtig profil). data-ad-hole måles + rapporteres. */
export function adSlotHTML(i){
  return (
    '<article class="adslot" data-ad="'+i+'">'+
      '<div class="adhead2">'+
        '<span class="av adav" aria-hidden="true">'+
          '<svg viewBox="0 0 24 24" width="22" height="22"><path class="fillic" d="M4 9a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h1l4 3.2a.6.6 0 0 0 1-.47V6.27a.6.6 0 0 0-1-.47L5 9H4Zm13.5 3a3.5 3.5 0 0 0-2-3.16v6.32A3.5 3.5 0 0 0 17.5 12Z"/></svg>'+
        '</span>'+
        '<div class="adname">'+
          '<div class="adnrow"><b>Promovering</b><span class="adannonce">Annonce</span></div>'+
          '<div class="adhandle">@promovering</div>'+
        '</div>'+
      '</div>'+
      '<div class="adhole" data-ad-hole="'+i+'">'+
        '<div class="adskel" aria-hidden="true"></div>'+
      '</div>'+
    '</article>'
  );
}

/* ---- Positionsrapportering til native ---- */
let lastPayload = "";
let isScrolling = false;
let scrollEndTimer = null;
let rafPending = false;
let heartbeat = null;

/* Find de synlige, ikke-dækkede annonce-huller og deres rects (CSS px =
   WKWebView-points, målt fra viewportens øverste venstre hjørne). */
function collectSlots(){
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const holes = document.querySelectorAll('#feed .adhole');
  const slots = [];
  const M = 400; // rapportér også lidt uden for skærmen, så annoncen er klar
  holes.forEach(function(hole){
    const r = hole.getBoundingClientRect();
    if(r.height < 10 || r.width < 10) return;      // foldet sammen / skjult fane
    if(r.bottom < -M || r.top > vh + M) return;     // langt væk fra skærmen
    /* Er hullet faktisk øverst her? elementFromPoint fanger enhver overlay
       (lightbox, compose, sheet, menu, gate) uden at vi skal kende dem. */
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(Math.min(Math.max(r.top + r.height / 2, 1), vh - 1));
    const topEl = document.elementFromPoint(cx, cy);
    if(!topEl || !(hole === topEl || hole.contains(topEl))) return; // dækket af noget
    slots.push({
      id: String(hole.getAttribute('data-ad-hole')),
      x: Math.round(r.left), y: Math.round(r.top),
      w: Math.round(r.width), h: Math.round(r.height)
    });
  });
  return { vw: Math.round(vw), vh: Math.round(vh), slots: slots };
}

/* Feedets aktuelle scroll-offset (den indre #app-container er selve scrolleren). */
function scrollPos(){
  const app = el("app");
  return app ? Math.round(app.scrollTop) : 0;
}

function send(scrolling){
  const b = bridge();
  if(!b) return;
  const data = collectSlots();
  const payload = {
    type: "ads", action: "layout", scrolling: !!scrolling,
    vw: data.vw, vh: data.vh, scrollY: scrollPos(), slots: data.slots
  };
  const key = JSON.stringify(payload);
  if(key === lastPayload) return; // uændret → undgå unødig native-arbejde
  lastPayload = key;
  try{ b.postMessage(payload); }catch(_e){ /* broen må aldrig vælte web-appen */ }
}

/* Letvægts-rapport UNDER scroll: kun scroll-offset — ingen måling af huller. Så
   kan native lade den allerede-placerede annonce glide med feedet ved fuld
   billedrate i stedet for at træde bagefter de tungere layout-beskeder. */
function sendScroll(){
  const b = bridge();
  if(!b) return;
  try{ b.postMessage({ type: "ads", action: "scroll", scrollY: scrollPos() }); }catch(_e){}
}

/* Kaldes efter render, ved resize, faneskift osv. Under scroll nøjes vi med den
   billige scroll-besked (ingen re-layout → intet hop midt i et scroll). */
export function reportAdLayout(){
  if(!adsEnabled()) return;
  if(isScrolling) sendScroll(); else send(false);
}

/* rAF-throttlet rapport under scroll: kun scroll-offset, så annoncen glider med.
   Når scroll falder til ro sender vi en fuld layout (scrolling:false), hvorefter
   native låser annoncen præcist på plads igen. */
function onScroll(){
  if(!adsEnabled()) return;
  isScrolling = true;
  if(!rafPending){
    rafPending = true;
    requestAnimationFrame(function(){ rafPending = false; sendScroll(); });
  }
  clearTimeout(scrollEndTimer);
  scrollEndTimer = setTimeout(function(){
    isScrolling = false;
    send(false);
  }, 140);
}

/* Native → web: et slot fik en annonce (skjul skeleton) eller ej (fold kortet sammen,
   så der aldrig står en tom kasse). */
function setFill(id, filled){
  const sel = '#feed .adhole[data-ad-hole="' + (window.CSS && CSS.escape ? CSS.escape(String(id)) : String(id)) + '"]';
  const hole = document.querySelector(sel);
  if(!hole) return;
  const card = hole.closest('.adslot');
  if(filled){
    // Skeletten bliver liggende under den ugennemsigtige native-annonce (og
    // vises igen under scroll, hvor annoncen skjules) — så vi collapser blot ikke.
    if(card) card.classList.remove('collapsed');
  } else if(card){
    card.classList.add('collapsed');
  }
  /* Layout ændrede sig (skeleton→annonce eller sammenfoldning) → gen-rapportér. */
  requestAnimationFrame(reportAdLayout);
}

/* Sæt op én gang. No-op uden for appen. */
export function initAds(){
  if(!bridge()) return; // almindelig browser
  window.VibeFeedAds = window.VibeFeedAds || {};
  window.VibeFeedAds.fill = function(id, filled){ try{ setFill(id, !!filled); }catch(_e){} };

  const app = el("app"); // scroll-containeren
  if(app) app.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", reportAdLayout, { passive: true });
  window.addEventListener("orientationchange", reportAdLayout);

  /* Sikkerhedsnet: fanger faneskift, luk af modaler, billeder der loader og
     anden reflow som ikke udløser scroll. send() sender kun ved reelle ændringer. */
  if(!heartbeat) heartbeat = setInterval(reportAdLayout, 400);
}
/* cache-bust 7e9ed93 */
