import { el, esc } from "./helpers.js";

/* ================= Fuldskærms-lightbox (billede + video) =================
   Side-zoom er slået fra (user-scalable=no i viewporten), så pinch-zoom,
   pan og dobbelttryk-zoom implementeres selv med Pointer Events — men KUN
   for billeder. Video vises med native controls og lyd, uden zoom-gestures.
   Transform: translate(tx,ty) scale(scale) — origin i midten af billedet. */

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

export function openLightbox(kind, src){
  const st = stage();
  pointers.clear(); pinch = null; pan = null; lastTapT = 0; moved = false;
  scale = 1; tx = 0; ty = 0;
  if(kind === "video"){
    imgEl = null;
    st.innerHTML = '<video src="' + esc(src) + '" controls playsinline autoplay loop></video>';
    // Eksplicit play(): kører under det videresendte gesture-token, så lyd-autoplay virker i mobil-Safari/WKWebView
    const v = st.querySelector("video");
    if(v) v.play().catch(function(){});
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
  el("lightbox").classList.remove("on");
  el("lightbox").setAttribute("aria-hidden", "true");
  stage().innerHTML = ""; // stopper videoen og fjerner elementets lyttere
  imgEl = null;
  pointers.clear(); pinch = null; pan = null;
  scale = 1; tx = 0; ty = 0;
  document.body.classList.remove("lb-lock");
  el("app").classList.remove("lb-lock");
}

export function initLightbox(){
  el("lb-close").addEventListener("click", closeLightbox);
  el("lightbox").addEventListener("click", function(e){
    // tap på baggrunden (ikke billedet/videoen) lukker også
    if(e.target === el("lightbox") || e.target === el("lb-stage")) closeLightbox();
  });
}
