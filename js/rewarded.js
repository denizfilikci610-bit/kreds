/* ================= Rewarded video → +20 like-kapacitet (kun i appen) =================
   Se en kort video → +20 plads i din like-saldo, så 20 flere rigtige personer kan
   like dine opslag (uden at du selv skal give 20 likes). Tilbydes som pop-up når du
   poster (max 1 gang i timen) og via hjerte-chippen øverst.

   Alt native-afhængigt er no-op i en browser (ingen bro) — dér bevarer hjerte-chippen
   bare den gamle saldo-toast. */
import { sb } from "./config.js";
import { me } from "./store.js";
import { el, toast } from "./helpers.js";
import { t, likesLabel } from "./i18n.js";
import { loadQuota } from "./feed.js";

const OFFER_KEY = "vf_reward_offer";          // sidste gang pop-up'en blev vist (ms)
const OFFER_COOLDOWN = 60 * 60 * 1000;        // 1 time

function bridge(){
  return (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.vibefeed) || null;
}
function available(){ return !!bridge() && !!me; }

let pending = false; // venter på belønnings-svar fra native

/* Bed native om at vise videoen. */
function watchVideo(){
  const b = bridge();
  if(!b || pending) return;
  pending = true;
  try{ b.postMessage({ type:"rewarded", action:"show" }); }
  catch(_e){ pending = false; }
}

/* Native → web: belønning optjent (true), eller ikke set færdig / ingen video (false). */
async function onReward(earned){
  pending = false;
  if(!earned){ toast(t("reward.none")); return; }
  try{
    const r = await sb.rpc("grant_like_bonus"); // +20 plads (beløbet er låst server-side)
    if(r.error) throw r.error;
    await loadQuota();                          // opdater hjerte-chippen (+20)
    toast(t("reward.granted"));
  }catch(err){ console.error(err); toast(t("reward.error")); }
}

const HEART = '<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path class="fillic" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';

function buildPopup(){
  if(el("rwd-pop")) return;
  const wrap = document.createElement("div");
  wrap.id = "rwd-pop";
  wrap.className = "rwdpop";
  wrap.innerHTML =
    '<div class="rwdcard" role="dialog" aria-modal="true" aria-labelledby="rwd-title">'+
      '<div class="rwdheart">'+HEART+'</div>'+
      '<div class="rwdtitle" id="rwd-title">'+t("reward.title")+'</div>'+
      '<div class="rwdsub">'+t("reward.sub")+'</div>'+
      '<div class="rwdhow">'+t("reward.how")+'</div>'+
      '<button class="rwdgo" id="rwd-go">'+t("reward.watch")+'</button>'+
      '<button class="rwdno" id="rwd-no">'+t("reward.no")+'</button>'+
    '</div>';
  document.body.appendChild(wrap);
  el("rwd-no").addEventListener("click", closePopup);
  el("rwd-go").addEventListener("click", function(){ closePopup(); watchVideo(); });
  wrap.addEventListener("click", function(e){ if(e.target === wrap) closePopup(); }); // klik udenfor = nej tak
}
function openPopup(){
  if(!available()) return;
  buildPopup();
  requestAnimationFrame(function(){ const p = el("rwd-pop"); if(p) p.classList.add("on"); });
}
function closePopup(){ const p = el("rwd-pop"); if(p) p.classList.remove("on"); }

/* Kaldes efter et opslag er oprettet. Max 1 gang i timen. */
export function offerRewardAfterPost(){
  if(!available()) return;
  let last = 0;
  try{ last = parseInt(localStorage.getItem(OFFER_KEY) || "0", 10) || 0; }catch(_e){}
  if(Date.now() - last < OFFER_COOLDOWN) return;      // tilbudt for nylig
  try{ localStorage.setItem(OFFER_KEY, String(Date.now())); }catch(_e){}
  setTimeout(openPopup, 350); // lad compose-arket lukke først
}

/* Hjerte-chippens klik: i appen → pop-up (genvej); i browseren → den gamle saldo-toast. */
function onChipClick(){
  if(available()){ openPopup(); return; }
  const n = parseInt(el("qchip-n").textContent, 10) || 0;
  toast(t("quota.toast", { likes: likesLabel(n) }));
}

/* Sæt op én gang (fra main.js). */
export function initRewarded(){
  const chip = el("qchip");
  if(chip) chip.addEventListener("click", onChipClick);
  if(!bridge()) return; // browser: kun chip-toasten ovenfor
  window.VibeFeedAds = window.VibeFeedAds || {};
  window.VibeFeedAds.rewardEarned = function(earned){ try{ onReward(!!earned); }catch(_e){ pending = false; } };
}
