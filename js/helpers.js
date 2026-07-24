import { sb } from "./config.js";
import { USERS, ID2H } from "./store.js";
import { t, dateLocale } from "./i18n.js";

/* ================= Helpers ================= */
export function esc(s){
  return String(s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
export function el(id){ return document.getElementById(id); }

const FALLBACK = [["#5C7CF0","#8E5CF0"],["#F05C9E","#F08E5C"],["#2EB2A4","#5CCB7A"],["#E0708F","#B84DD6"]];

function fallbackGrad(h){
  let x = 0;
  for(let i = 0; i < h.length; i++) x = (x*31 + h.charCodeAt(i)) >>> 0;
  return FALLBACK[x % FALLBACK.length];
}
function okColor(c){ return /^#[0-9a-fA-F]{3,8}$/.test(c || ""); }
export function registerProfile(p){
  if(!p || !p.handle) return;
  let g = [p.color1, p.color2];
  if(!okColor(g[0]) || !okColor(g[1])) g = fallbackGrad(p.handle); // aldrig rå tekst i inline styles
  const prev = USERS[p.handle];
  USERS[p.handle] = {
    name: p.name || p.handle,
    g: g,
    since: p.created_at ? new Date(p.created_at).getFullYear() : "",
    id: p.id,
    avatar_path: p.avatar_path !== undefined ? p.avatar_path : (prev ? prev.avatar_path : null),
    banner_path: p.banner_path !== undefined ? p.banner_path : (prev ? prev.banner_path : null),
    bio: p.bio !== undefined ? p.bio : (prev ? prev.bio : null)
  };
  if(p.id) ID2H[p.id] = p.handle;
}
export function user(h){
  if(!USERS[h]) USERS[h] = { name: h, g: fallbackGrad(h), since: "" };
  return USERS[h];
}
export function grad(h){ const g = user(h).g; return "linear-gradient(140deg,"+g[0]+","+g[1]+")"; }
export function ini(h){
  const n = (user(h).name || h).trim().split(/\s+/);
  const a = (n[0] && n[0][0]) || (h && h[0]) || "?";
  return (a + (n[1] ? n[1][0] : "")).toUpperCase().replace(/[^\p{L}\p{M}\p{N}]/gu, "") || "?";
}
export function avaHTML(h, size, cls){
  const u = user(h);
  const c = "av" + (cls ? " " + cls : "");
  const style = "width:" + size + "px;height:" + size + "px;";
  if(u.avatar_path){
    // size × 3 = skarp på en retina-skærm; resten af den originale fil er spildte bytes
    return '<img class="'+c+'" src="'+esc(imgUrl(u.avatar_path, size * 3))+'" alt="" loading="lazy" decoding="async" style="'+style+'">';
  }
  const fs = Math.max(8, Math.round(size * 0.38));
  return '<span class="'+c+'" style="'+style+'font-size:'+fs+'px;background:'+esc(grad(h))+'">'+ini(h)+'</span>';
}
/* Escape + gør @handles klikbare. Kun handles der matcher en KENDT profil (USERS[h].id
   sættes kun af registerProfile) bliver markup — vilkårligt "@tekst" forbliver ren tekst.
   Præfiks-tjekket (ikke bogstav/./@ før @) undgår at ramme e-mail-adresser. "@Anna" (iOS
   auto-capitalization) lowercases; "tak @anna." dot-trimmes til 'anna' hvis 'anna.' ikke
   findes — SPEJLER DB'ens mention_uids, så highlight og notifikation altid følges ad.
   Bruges på opslags-tekst, minde-captions og kommentarer; ALDRIG på governance-tekst. */
export function richText(s){
  return esc(s).replace(/(^|[^a-zA-Z0-9_.@])@([a-zA-Z0-9_.]{2,20})/g, function(m, pre, h){
    let hh = h.toLowerCase(), rest = "";
    while(hh.length >= 2 && !(USERS[hh] && USERS[hh].id) && hh.slice(-1) === "."){
      hh = hh.slice(0, -1);
      rest = "." + rest;
    }
    if(!USERS[hh] || !USERS[hh].id) return m;
    return pre+'<button class="mention" data-u="'+hh+'">@'+hh+'</button>'+rest;
  });
}
/* ================= Reklame-samtykke (ark over feedet — første besøg efter login) =================
   Modal for alvor: appen bag arket gøres inert, og valget SKAL træffes før arket lukker.
   Flyttet fra førstegangs-gaten (før login) til efter boot — reklamerne starter først,
   når valget er truffet (AdsManager venter på consent). */
export function showConsentGate(){
  return new Promise(function(resolve){
    const gv = el("consentview");
    gv.classList.add("on");
    el("app").inert = true;
    const first = gv.querySelector("#consent-personal");
    if(first) first.focus();
    gv.addEventListener("click", function onPick(e){
      const b = e.target.closest("#consent-personal, #consent-limited");
      if(!b) return;
      setConsent(b.id === "consent-personal" ? "personal" : "limited");
      gv.classList.remove("on");
      gv.removeEventListener("click", onPick);
      el("app").inert = false;
      resolve();
    });
  });
}
export function fmtTime(iso){
  const d = new Date(iso);
  const s = Math.max(0, (Date.now() - d.getTime())/1000);
  if(s < 60) return t("time.now");
  if(s < 3600) return Math.floor(s/60)+t("time.m");
  if(s < 86400) return Math.floor(s/3600)+t("time.h");
  if(s < 7*86400) return Math.floor(s/86400)+t("time.d");
  return d.toLocaleDateString(dateLocale(), { day:"numeric", month:"long" });
}
/* Fuldt dato-stempel til minder ("et øjeblik") — fx "9. juli 2026" / "July 9, 2026". */
export function fmtDate(iso){
  return new Date(iso).toLocaleDateString(dateLocale(), { day:"numeric", month:"long", year:"numeric" });
}
/* ================= Medier: offentlig bøtte vs. privat bøtte =================
   Stier med præfikset "priv/" bor i den PRIVATE bøtte (vf-private) og kan kun
   hentes med en signeret URL, hvor RLS på storage afgør om den overhovedet kan
   laves. Alt andet ligger som før i post-images og hentes med en offentlig URL.
   Præfikset i stien er hele kendetegnet, så der ikke skal føres bog andre steder,
   og så gamle stier virker uændret. */
export const PRIV_PREFIX = "priv/";
export function isPrivatePath(p){ return typeof p === "string" && p.indexOf(PRIV_PREFIX) === 0; }
export function mediaBucket(p){ return isPrivatePath(p) ? "vf-private" : "post-images"; }

/* ================= Billed-transformationer (Supabase render/image) =================
   Et opslags billede blev hentet i sin ORIGINALE opløsning, uanset hvor lille det vises:
   en avatar på 34 px hentede den fulde fil. Med en bredde bygges i stedet en transform-URL
   (/storage/v1/render/image/public/… ?width=W&quality=70), som Supabase skalerer én gang og
   CDN'et derefter leverer cachet. Målt på ejerens egne filer: avatar 119 kB → 4 kB,
   profil-gitter 589 kB → 7 kB, feed-billeder ca. 79 % mindre.
   Uden bredde opfører funktionen sig præcis som før (rå original), så de mange kaldsteder,
   der ikke ved hvor stort mediet vises, er upåvirkede.

   ⚠️ KUN BILLEDER: render/image-endpointet svarer HTTP 400 på video-stier, og den SAMME
   imgUrl bruges til begge (fx chat, hvor beskeden kan bære et billede eller en video).
   Derfor to uafhængige lag: kaldstedet sender kun en bredde på sine billed-grene, OG
   funktionen her afviser selv video-endelser. Private stier (priv/) hentes med signerede
   URL'er og transformeres heller ikke.

   ⚠️⚠️ resize:"contain" ER OBLIGATORISK. Med KUN width sætter Supabase bredden og lader
   HØJDEN stå på originalens: en avatar på 512x512 kom tilbage som 102x512, altså klemt til
   en høj, smal strimmel, og profil-gitteret som 400x1350. (Feed-billeder så tilfældigvis
   rigtige ud, fordi 1080 er originalens egen bredde.) Målt mod ejerens egne filer med
   contain: 512x512 → 54x54 / 120x120, 1080x1350 → 400x500 / 720x900, banner 1278x432 →
   1080x365. Ingen udfyldning, og beder man om mere end originalen, kommer originalen igen. */
const VIDEO_RE = /\.(mp4|m4v|mov|qt|webm|avi|mkv|3gp)$/i;
export function isVideoPath(p){ return VIDEO_RE.test(String(p || "")); }
const IMG_QUALITY = 70;

export function imgUrl(path, width){
  const w = Math.round(Number(width) || 0);
  const store = sb.storage.from("post-images");
  if(w > 0 && !isVideoPath(path) && !isPrivatePath(path)){
    return store.getPublicUrl(path, {
      transform: { width: w, resize: "contain", quality: IMG_QUALITY }
    }).data.publicUrl;
  }
  return store.getPublicUrl(path).data.publicUrl;
}

/* Sikkerhedsnet: skulle et transformeret billede alligevel fejle (ukendt format, kvote,
   en video der slap igennem værnet ovenfor), hentes ORIGINALEN i stedet, så brugeren
   aldrig ser et tomt hul. Fejl på <img> bobler ikke, derfor capture-fasen. Ét forsøg:
   den rå URL indeholder ikke render-stien, så en fejl på DEN gør ingenting. */
const RENDER_SEG = "/storage/v1/render/image/public/";
const OBJECT_SEG = "/storage/v1/object/public/";
export function initImgFallback(){
  document.addEventListener("error", function(e){
    const n = e.target;
    if(!n || n.tagName !== "IMG") return;
    const s = n.getAttribute("src") || "";
    const i = s.indexOf(RENDER_SEG);
    if(i === -1) return;
    n.setAttribute("src", s.slice(0, i) + OBJECT_SEG + s.slice(i + RENDER_SEG.length).split("?")[0]);
  }, true);
}

/* Signerede URL'er til private stier, hentet i ét kald. Returnerer et Map fra sti
   til URL; stier der ikke kunne signeres (ingen adgang) udelades, så kaldstedet selv
   bestemmer hvad der så skal ske. secs default 24 timer = en storys levetid. */
export async function signedUrls(paths, secs){
  const list = (paths || []).filter(isPrivatePath);
  const out = new Map();
  if(!list.length) return out;
  try{
    const { data, error } = await sb.storage.from("vf-private")
      .createSignedUrls(list, secs || 60*60*24);
    if(error || !data) return out;
    data.forEach(function(r){
      if(r && r.path && r.signedUrl && !r.error) out.set(r.path, r.signedUrl);
    });
  }catch(_e){ /* uden URL vises mediet bare ikke */ }
  return out;
}

/* Sletter mediefiler i den rigtige bøtte. Fire-and-forget som før: databasens egen
   oprydningskø (app_hidden.deleted_media + edge-funktionen media-sweeper) er
   sikkerhedsnettet, så et fejlet kald her ikke længere efterlader filen for evigt. */
export function removeMedia(paths){
  const list = (paths || []).filter(Boolean);
  if(!list.length) return;
  const byBucket = {};
  list.forEach(function(p){
    const b = mediaBucket(p);
    (byBucket[b] = byBucket[b] || []).push(p);
  });
  Object.keys(byBucket).forEach(function(b){
    try{ sb.storage.from(b).remove(byBucket[b]).catch(function(){}); }catch(_e){}
  });
}
export function uuid(){
  if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c){
    const r = Math.random()*16|0;
    return (c === "x" ? r : (r&0x3|0x8)).toString(16);
  });
}

/* Funktion (ikke konstant): aria-label skal følge det aktive sprog */
export function BADGE(){
  return '<svg viewBox="0 0 24 24" aria-label="'+t("badge.aria")+'"><circle cx="12" cy="12" r="10" fill="#E0402F"/><path d="M17 9l-6.2 6.2L7 11.4" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
let toastTimer = null;
export function toast(msg){
  const t = el("toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.classList.remove("on"); }, 2100);
}

export const HEART_SVG = '<svg viewBox="0 0 24 24"><path class="stroke" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';

/* ================= Reklame-samtykke (per enhed, localStorage vf_consent) =================
   "personal" = personaliserede reklamer OK · "limited" = kun ikke-personlige.
   Ændringer postes til den native bro (kun i iOS-appen — no-op i browsere). */
const CONSENT_KEY = "vf_consent";
export function getConsent(){
  try{
    const v = localStorage.getItem(CONSENT_KEY);
    return (v === "personal" || v === "limited") ? v : null;
  }catch(_e){ return null; }
}
export function pushConsentToBridge(v){
  try{
    if(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.vibefeed)
      window.webkit.messageHandlers.vibefeed.postMessage({ type:"consent", value:v });
  }catch(_e){ /* broen må aldrig vælte web-appen */ }
}
export function setConsent(v){
  if(v !== "personal" && v !== "limited") return;
  try{ localStorage.setItem(CONSENT_KEY, v); }catch(_e){}
  pushConsentToBridge(v);
}
