/* ================= Live pinch-zoom på minde-billeder (Instagram-agtigt) =================
   To fingre på et minde-billede (feedet, profil-lister og detalje-siden — delegeret på
   document, så alle containere er dækket) skalerer billedet LIVE oven på alt andet og
   fjeder tilbage ved slip. Ingen viewer åbnes for minde-billeder.
   Teknik: en position:fixed KLON af billedet transformeres (originalen skjules imens) —
   det undgår alle stacking-context-fælder i feedet, og en dæmpet baggrund følger zoomet.
   Viewporten har user-scalable=no, så side-zoom kommer aldrig i vejen. */

let pz = null; // { img, clone, overlay, startMid } — aktivt pinch (null = intet)

function midAndDist(t1, t2){
  return {
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2,
    d: Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY) || 1
  };
}

function startPinch(img, e){
  const r = img.getBoundingClientRect();
  const m = midAndDist(e.touches[0], e.touches[1]);
  const overlay = document.createElement("div");
  overlay.className = "pz-dim";
  const clone = img.cloneNode(false);
  clone.className = "pz-clone";
  clone.style.top = r.top + "px";
  clone.style.left = r.left + "px";
  clone.style.width = r.width + "px";
  clone.style.height = r.height + "px";
  // Transform-origin i pinch-midtpunktet, så der zoomes MOD fingrene
  clone.style.transformOrigin = (m.x - r.left) + "px " + (m.y - r.top) + "px";
  document.body.appendChild(overlay);
  document.body.appendChild(clone);
  img.style.visibility = "hidden";
  pz = { img: img, clone: clone, overlay: overlay, startMid: m };
}

function movePinch(e){
  const m = midAndDist(e.touches[0], e.touches[1]);
  const s = Math.min(4, Math.max(1, m.d / pz.startMid.d));
  const dx = m.x - pz.startMid.x;
  const dy = m.y - pz.startMid.y;
  pz.clone.style.transform = "translate(" + dx + "px," + dy + "px) scale(" + s + ")";
  pz.overlay.style.opacity = Math.min(0.55, (s - 1) * 0.8);
}

function endPinch(){
  const p = pz;
  pz = null;
  // Fjeder tilbage til udgangspunktet og ryd op
  p.clone.style.transition = "transform .24s ease";
  p.overlay.style.transition = "opacity .24s ease";
  p.clone.style.transform = "";
  p.overlay.style.opacity = "0";
  setTimeout(function(){
    p.img.style.visibility = "";
    p.clone.remove();
    p.overlay.remove();
  }, 250);
}

export function initPinchZoom(){
  document.addEventListener("touchstart", function(e){
    if(pz || e.touches.length !== 2) return;
    const img = e.target.closest(".post.memory .pmedia img");
    if(!img) return;
    e.preventDefault(); // ingen scroll/andet mens pinch starter
    startPinch(img, e);
  }, { passive: false });
  document.addEventListener("touchmove", function(e){
    if(!pz) return;
    if(e.touches.length < 2){ endPinch(); return; }
    e.preventDefault(); // feedet må ikke scrolle under pinch
    movePinch(e);
  }, { passive: false });
  ["touchend", "touchcancel"].forEach(function(ev){
    document.addEventListener(ev, function(e){
      if(pz && e.touches.length < 2) endPinch();
    });
  });
}
