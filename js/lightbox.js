import { el, esc, user, avaHTML, HEART_SVG, BADGE } from "./helpers.js";
import { me, expandedCmts } from "./store.js";
import { t } from "./i18n.js";
import { findPost, setLike, sharePost, openPostMenu, openReportMenu, muteFeedSound, switchTab } from "./feed.js";
import { openNativePostPage, rerenderPostCmts } from "./comments.js";
import { openKredsChat, openDmWith } from "./chat.js";
import { openPostView } from "./profile.js";

/* ================= Fuldskærms-lightbox (billede + video) =================
   Side-zoom er slået fra (user-scalable=no i viewporten), så pinch-zoom,
   pan og dobbelttryk-zoom implementeres selv med Pointer Events — men KUN
   for billeder. Video vises med native controls og lyd, uden zoom-gestures.
   Transform: translate(tx,ty) scale(scale) — origin i midten af billedet.
   X-agtig viewer: hører mediet til et opslag (pid), vises et info-overlay i
   bunden (forfatter, tekst, kommentar/like/del, kommentarfelt) + ⋯ øverst. */

const MIN_SCALE = 1, MAX_SCALE = 4, DBL_SCALE = 2.5, DBL_MS = 320;

let imgEl = null;               // aktivt <img> (null når der vises video)
let scale = 1, tx = 0, ty = 0;
const pointers = new Map();     // pointerId -> { x, y, sx, sy } (nu + start)
let pinch = null;               // snapshot ved pinch-start
let pan = null;                 // snapshot ved 1-finger-pan-start
let lastTapT = 0, moved = false;

function stage(){ return el("lb-stage"); }

function applyTransform(){
  if(imgEl) imgEl.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + scale + ")";
  // Zoomet ind = rent billede: overlay + ⋯ skjules (CSS på .zoomed) til man zoomer ud igen
  el("lightbox").classList.toggle("zoomed", scale > 1.02);
}
function resetTransform(){
  scale = 1; tx = 0; ty = 0;
  applyTransform();
}
/* Klem pan så billedet aldrig kan skubbes helt ud af skærmen.
   Er den skalerede side mindre end scenen, låses aksen til 0 —
   derfor gør pan intet ved scale 1. */
function clampPan(){
  if(!imgEl) return;
  const st = stage();
  const maxX = Math.max(0, (imgEl.clientWidth * scale - st.clientWidth) / 2);
  const maxY = Math.max(0, (imgEl.clientHeight * scale - st.clientHeight) / 2);
  tx = Math.min(maxX, Math.max(-maxX, tx));
  ty = Math.min(maxY, Math.max(-maxY, ty));
}
function midOf(){
  const pts = Array.from(pointers.values());
  return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
}
function distOf(){
  const pts = Array.from(pointers.values());
  return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
}
function stageCenter(){
  const r = stage().getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
/* Zoom mod et skærmpunkt (px,py): punktet i billedet bliver under fingeren */
function zoomAt(px, py, s1){
  const c = stageCenter();
  const vx = (px - c.x - tx) / scale;
  const vy = (py - c.y - ty) / scale;
  scale = s1;
  tx = px - c.x - s1 * vx;
  ty = py - c.y - s1 * vy;
  clampPan();
  applyTransform();
}

function onPointerDown(e){
  if(!imgEl) return;
  e.preventDefault();
  try{ imgEl.setPointerCapture(e.pointerId); }catch(_){}
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
  if(pointers.size === 2){
    pan = null;
    moved = true; // to fingre = aldrig et "tap"
    const m = midOf();
    pinch = { dist: distOf(), scale: scale, tx: tx, ty: ty, mx: m.x, my: m.y };
  } else if(pointers.size === 1){
    moved = false;
    pan = { x: e.clientX, y: e.clientY, tx: tx, ty: ty };
  }
}
function onPointerMove(e){
  if(!imgEl || !pointers.has(e.pointerId)) return;
  const prev = pointers.get(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: prev.sx, sy: prev.sy });
  if(Math.hypot(e.clientX - prev.sx, e.clientY - prev.sy) > 8) moved = true;
  if(pointers.size === 2 && pinch){
    const m = midOf();
    const c = stageCenter();
    const s1 = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinch.scale * (distOf() / pinch.dist)));
    // anker ca. i pinch-midtpunktet (startmidtpunktets billedpunkt følger fingrene)
    const vx = (pinch.mx - c.x - pinch.tx) / pinch.scale;
    const vy = (pinch.my - c.y - pinch.ty) / pinch.scale;
    scale = s1;
    tx = m.x - c.x - s1 * vx;
    ty = m.y - c.y - s1 * vy;
    clampPan();
    applyTransform();
  } else if(pointers.size === 1 && pan && scale > 1){
    tx = pan.tx + (e.clientX - pan.x);
    ty = pan.ty + (e.clientY - pan.y);
    clampPan();
    applyTransform();
  }
}
function onPointerUp(e){
  if(!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if(pointers.size === 1){
    // fra pinch til én finger: fortsæt som pan uden hop
    const p = Array.from(pointers.values())[0];
    pinch = null;
    pan = { x: p.x, y: p.y, tx: tx, ty: ty };
  } else if(pointers.size === 0){
    pinch = null;
    pan = null;
    if(!moved && e.type === "pointerup"){
      const now = Date.now();
      if(now - lastTapT < DBL_MS){
        lastTapT = 0;
        // dobbelttryk: skift mellem 1x og 2.5x (mod trykpunktet)
        if(scale > 1) resetTransform();
        else zoomAt(e.clientX, e.clientY, DBL_SCALE);
      } else {
        lastTapT = now;
      }
    }
  }
}

/* ---- Lyd i video-vieweren (til som standard; valget huskes til næste video i sessionen) ---- */
let lbSoundOn = true;
export const SOUND_ON_SVG = '<svg viewBox="0 0 24 24"><g class="stroke"><path d="M4.5 9.5v5h3.2l4.6 4v-13l-4.6 4Z"/><path d="M15.3 9.2a4.4 4.4 0 0 1 0 5.6"/><path d="M17.8 6.8a8 8 0 0 1 0 10.4"/></g></svg>';
export const SOUND_OFF_SVG = '<svg viewBox="0 0 24 24"><g class="stroke"><path d="M4.5 9.5v5h3.2l4.6 4v-13l-4.6 4Z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></g></svg>';
function syncSoundIcon(){
  el("lb-sound").innerHTML = lbSoundOn ? SOUND_ON_SVG : SOUND_OFF_SVG;
}
function toggleSound(){
  lbSoundOn = !lbSoundOn;
  const v = stage().querySelector("video");
  if(v){
    v.muted = !lbSoundOn;
    if(lbSoundOn) v.play().catch(function(){}); // genstart hvis autoplay-fallback satte den på pause
  }
  syncSoundIcon();
}

/* ---- X-agtigt info-overlay (kun når mediet hører til et opslag) ---- */
let lbPid = null;

const LB_CMT_SVG = '<svg viewBox="0 0 24 24"><path class="stroke" d="M12 3.3a8.7 8.7 0 0 0-7.4 13.2L3.4 20.6l4.2-1.1A8.7 8.7 0 1 0 12 3.3Z"/></svg>';
const LB_SHARE_SVG = '<svg viewBox="0 0 24 24"><path class="stroke" d="M21.5 2.5 10.8 13.2M21.5 2.5l-6.8 19-3.9-8.3-8.3-3.9Z"/></svg>';

function lbCnt(n){ return n > 0 ? '<span class="lb-cnt">'+n+'</span>' : ''; }
function renderLbInfo(){
  const box = el("lb-info");
  const p = lbPid != null ? findPost(lbPid) : null;
  el("lb-dots").style.display = (p && me) ? "" : "none";
  if(!p){ box.style.display = "none"; box.innerHTML = ""; return; }
  const u = user(p.u);
  box.style.display = "";
  box.innerHTML =
    '<div class="lb-author">'+avaHTML(p.u, 32)+
      '<span class="lb-nm">'+esc(u.name)+'</span><span class="badge">'+BADGE()+'</span>'+
      '<span class="lb-h">@'+esc(p.u)+'</span>'+
    '</div>'+
    (p.text ? '<div class="lb-cap">'+esc(p.text)+'</div>' : '')+
    '<div class="lb-actions">'+
      '<button class="lb-chip" data-lb="cmt" aria-label="'+t("aria.comments")+'">'+LB_CMT_SVG+lbCnt(p.cmts.length)+'</button>'+
      '<button class="lb-chip'+(p.liked ? " on" : "")+'" data-lb="like" aria-pressed="'+p.liked+'" aria-label="'+t("aria.like")+'">'+HEART_SVG+lbCnt(p.likeCount)+'</button>'+
      (p.feed ? '' : '<button class="lb-chip" data-lb="share" aria-label="'+t("aria.share")+'">'+LB_SHARE_SVG+'</button>')+
    '</div>'+
    (me ? '<button class="lb-reply" data-lb="reply">'+t("cmt.ph")+'</button>' : '');
}
/* Datasync mens vieweren er åben (likes/kommentarer/realtime). Forsvinder opslaget
   (slettet/anmeldt/blokeret), lukkes hele vieweren — mediet må ikke blive hængende. */
export function lbSync(){
  if(!el("lightbox").classList.contains("on")) return;
  if(lbPid != null && !findPost(lbPid)){ closeLightbox(); return; }
  renderLbInfo();
}
/* Kommentar-tap i vieweren: i appen lægger sheetet (minde) eller den native side (tanke)
   sig NATIVT OVEN PÅ vieweren — mediet bliver synligt bagved, som på X. I browseren
   ligger web-siderne UNDER vieweren (z 90/120 < 300), så dér lukkes vieweren først. */
function openLbComments(){
  const p = findPost(lbPid);
  if(!p) return;
  // Minder kommenteres i Beskeder-tråden (kreds-tråd eller DM m. forfatteren) — luk
  // vieweren først, tråden (z-85) ligger under den (z-300)
  if(p.kind === "memory"){
    closeLightbox();
    if(p.feed){ openKredsChat(p.feed); return; }
    if(me && p.u === me.handle){ switchTab("chat"); return; }
    openDmWith(user(p.u).id, p.id);
    return;
  }
  if(window.__vfNative && window.__vfPostPage && p.kind !== "memory"){ openNativePostPage(p.id); return; }
  closeLightbox();
  expandedCmts.add(Number(p.id));
  // Står vi allerede på web-detaljesiden med dette opslag, skal den ikke genåbnes (scroll bevares)
  const node = el("mv-body").querySelector('.post[data-id="'+p.id+'"]');
  if(node && el("memview").classList.contains("on")) rerenderPostCmts(p.id);
  else openPostView(p);
}
function lbMenu(){
  const p = findPost(lbPid);
  if(!p || !me) return;
  // Kun de native glas-kort kan åbne HENOVER vieweren — web-modalerne (z 120) ligger bagved
  if(!(window.__vfGlassCard && window.__vfSheetPost)) closeLightbox();
  if(p.u === me.handle) openPostMenu(p.id);
  else openReportMenu(p.id);
}

export function openLightbox(kind, src, pid){
  const st = stage();
  lbPid = pid != null ? Number(pid) : null;
  muteFeedSound(); // vieweren ejer lyden — en feed-video med lyd bagved ville give dobbelt-lyd
  renderLbInfo();
  pointers.clear(); pinch = null; pan = null; lastTapT = 0; moved = false;
  scale = 1; tx = 0; ty = 0;
  if(kind === "video"){
    imgEl = null;
    // Ingen native controls — videoen looper bare (som feedet, men MED lyd). Lyd-knappen
    // øverst th. slår til/fra; i appen overdøver lyden telefonens lydløs-kontakt
    // (AVAudioSession .playback sættes native — kræver app-build).
    st.innerHTML = '<video src="' + esc(src) + '" playsinline autoplay loop></video>';
    const v = st.querySelector("video");
    v.muted = !lbSoundOn;
    el("lb-sound").style.display = "";
    syncSoundIcon();
    // Eksplicit play(): kører under det videresendte gesture-token, så lyd-autoplay virker
    // i mobil-Safari/WKWebView. Blokeres lyd-autoplay alligevel (fx desktop-browser uden
    // interaktion), falder vi tilbage til lydløs afspilning — knappen slår så lyden til.
    v.play().catch(function(){
      v.muted = true;
      lbSoundOn = false;
      syncSoundIcon();
      v.play().catch(function(){});
    });
  } else {
    st.innerHTML = '<img src="' + esc(src) + '" alt="" draggable="false">';
    imgEl = st.querySelector("img");
    applyTransform();
    // Zoom-gestures kobles KUN på billeder — video beholder native controls
    imgEl.addEventListener("pointerdown", onPointerDown);
    imgEl.addEventListener("pointermove", onPointerMove);
    imgEl.addEventListener("pointerup", onPointerUp);
    imgEl.addEventListener("pointercancel", onPointerUp);
  }
  el("lightbox").classList.add("on");
  el("lightbox").setAttribute("aria-hidden", "false");
  document.body.classList.add("lb-lock");
  el("app").classList.add("lb-lock");
}
export function closeLightbox(){
  el("lightbox").classList.remove("on", "zoomed");
  el("lightbox").setAttribute("aria-hidden", "true");
  stage().innerHTML = ""; // stopper videoen og fjerner elementets lyttere
  el("lb-info").innerHTML = "";
  el("lb-info").style.display = "none";
  el("lb-dots").style.display = "none";
  el("lb-sound").style.display = "none";
  lbPid = null;
  imgEl = null;
  pointers.clear(); pinch = null; pan = null;
  scale = 1; tx = 0; ty = 0;
  document.body.classList.remove("lb-lock");
  el("app").classList.remove("lb-lock");
}

export function initLightbox(){
  el("lb-close").addEventListener("click", closeLightbox);
  el("lb-dots").addEventListener("click", lbMenu);
  el("lb-sound").addEventListener("click", toggleSound);
  el("lb-info").addEventListener("click", function(e){
    const b = e.target.closest("[data-lb]");
    if(!b || lbPid == null) return;
    if(b.dataset.lb === "like"){
      setLike(lbPid);   // optimistisk tilstand er sat synkront før første await
      renderLbInfo();
      return;
    }
    if(b.dataset.lb === "share"){ sharePost(lbPid); return; }
    openLbComments();   // cmt + reply-feltet
  });
  el("lightbox").addEventListener("click", function(e){
    // tap på baggrunden (ikke billedet/videoen) lukker også
    if(e.target === el("lightbox") || e.target === el("lb-stage")) closeLightbox();
  });
}
