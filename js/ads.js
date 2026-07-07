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

function bridge(){
  return (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.vibefeed) || null;
}

/* Reklamer kører kun i appen (bro til stede) og når samtykke er givet.
   Begge samtykke-valg viser reklamer — kun personaliseringen adskiller sig. */
export function adsEnabled(){
  return !!bridge() && !!getConsent();
}

/* Slot-markup: et opslags-lignende kort med tydelig "Reklame · Sponsoreret"-header
   og et reserveret 300×250-hul (med skeleton-shimmer indtil annoncen ligger ovenpå).
   data-ad-hole er det element vi måler og rapporterer til native. */
export function adSlotHTML(i){
  return (
    '<article class="post adslot" data-ad="'+i+'">'+
      '<div class="adcol">'+
        '<div class="adhead">'+
          '<span class="adtag">'+t("ad.label")+'</span>'+
          '<span class="adspon">'+t("ad.sponsored")+'</span>'+
        '</div>'+
        '<div class="adhole" data-ad-hole="'+i+'">'+
          '<div class="adskel" aria-hidden="true"></div>'+
        '</div>'+
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

function send(scrolling){
  const b = bridge();
  if(!b) return;
  const data = collectSlots();
  const payload = {
    type: "ads", action: "layout", scrolling: !!scrolling,
    vw: data.vw, vh: data.vh, slots: data.slots
  };
  const key = JSON.stringify(payload);
  if(key === lastPayload) return; // uændret → undgå unødig native-arbejde
  lastPayload = key;
  try{ b.postMessage(payload); }catch(_e){ /* broen må aldrig vælte web-appen */ }
}

/* Kaldes efter render, ved resize, faneskift osv. */
export function reportAdLayout(){
  if(!adsEnabled()) return;
  send(isScrolling);
}

/* rAF-throttlet rapport under scroll; når scroll falder til ro sender vi
   scrolling:false, hvorefter native placerer og viser annoncen. */
function onScroll(){
  if(!adsEnabled()) return;
  isScrolling = true;
  if(!rafPending){
    rafPending = true;
    requestAnimationFrame(function(){ rafPending = false; send(true); });
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
