import { sb, SB_URL, SB_KEY } from "./config.js";
import { me, state } from "./store.js";
import { el, esc, toast, uuid } from "./helpers.js";
import { t } from "./i18n.js";
import { feedById, setFeed, switchTab } from "./feed.js";
import { offerRewardAfterPost } from "./rewarded.js";

/* ================= Skriv ================= */
let pendingImg = null; // { blob, url }
let pendingVid = null; // { file, url }
export const ta = el("compose-field");
const MAXC = 280, CIRC = 56.55;
const MAX_VID_SEC = 6.4, MAX_VID_BYTES = 25 * 1024 * 1024;
const VID_EXT = { "video/mp4":"mp4", "video/quicktime":"mov", "video/webm":"webm" };

export function updateRing(){
  const len = ta.value.length;
  const off = CIRC * (1 - len/MAXC);
  el("charprog").style.strokeDashoffset = Math.max(0, off);
  const left = MAXC - len;
  const ring = el("charring");
  if(left <= 20){
    ring.classList.add("warn");
    el("charleft").textContent = left;
  } else {
    ring.classList.remove("warn");
  }
}
export function canPost(){
  const t = ta.value.trim();
  if(composeKind === "memory"){ el("compose-post").disabled = !(pendingImg || pendingVid); return; } // minde kræver medie
  el("compose-post").disabled = pollOn
    ? !(t && pollReady())
    : !(pendingImg || pendingVid || t.length > 0);
}
let composeDest = "all";
export function renderComposeDest(){
  let html = '<span class="dlabel">'+t("compose.dest")+'</span>'+
    '<button class="fpill'+(composeDest === "all" ? " on" : "")+'" data-d="all">'+t("feedbar.all")+'</button>';
  state.feeds.forEach(function(f){
    html += '<button class="fpill'+(composeDest === f.id ? " on" : "")+'" data-d="'+esc(f.id)+'">'+esc(f.name)+'</button>';
  });
  el("compose-dest").innerHTML = html;
  const f = feedById(composeDest);
  ta.placeholder = composeKind === "memory" ? t("compose.ph.memory")
    : (pollOn ? t("compose.ph.poll") : (f ? t("compose.ph.feed", { name: f.name }) : t("compose.ph.default")));
}

/* ---- Meningsmåling (poll-mode) ---- */
let pollOn = false;
let pollOpts = ["", ""];
function pollReady(){
  return pollOpts.filter(function(t){ return t.trim(); }).length >= 2;
}
function renderPollBox(){
  const box = el("pollbox");
  if(!pollOn){
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }
  let html = "";
  pollOpts.forEach(function(txt, i){
    html += '<div class="pe-row">'+
      '<input class="pe-inp" data-i="'+i+'" maxlength="80" placeholder="'+t("poll.opt_ph", { n: i+1 })+'" value="'+esc(txt)+'">'+
      (pollOpts.length > 2 ? '<button class="pe-rm" data-i="'+i+'" aria-label="'+t("poll.rm_aria")+'">✕</button>' : '')+
    '</div>';
  });
  if(pollOpts.length < 4) html += '<button class="pe-add">'+t("poll.add")+'</button>';
  html += '<button class="pe-off">'+t("poll.off")+'</button>';
  box.innerHTML = html;
  box.style.display = "block";
}
export function resetPoll(){
  pollOn = false;
  pollOpts = ["", ""];
  renderPollBox();
  renderComposeDest();
}
/* To opslagstyper: 'thought' (tanke, tekst i fokus) og 'memory' (minde, medie i fokus). */
let composeKind = "thought";
export function getComposeKind(){ return composeKind; }
function openComposeWith(kind){
  composeKind = (kind === "memory") ? "memory" : "thought";
  composeDest = state.currentFeed;
  clearPendingImg();          // frisk medie hver gang (vælgeren sidder nu FØR compose)
  ta.value = ""; updateRing();
  el("compose").classList.toggle("memory", composeKind === "memory");
  const title = document.querySelector("#compose .ctitle");
  if(title) title.textContent = composeKind === "memory" ? t("compose.title.memory") : t("compose.title");
  resetPoll();                // pollOn=false (minde har ingen afstemning) + renderComposeDest
  canPost();
  el("compose").classList.add("on");
  if(composeKind !== "memory") setTimeout(function(){ ta.focus(); }, 260); // minde: fokus stjæles ikke fra billed-valg
}
/* + → vælger (Post en tanke / Post et minde). Native glas-kort i app'en, CSS-modal i browseren. */
function openChooser(){
  if(window.__vfGlassCard && window.__vfSheetPost){
    window.__vfSheetPost({
      title: t("chooser.title"),
      buttons: [
        { label: t("chooser.thought"), action: "thought" },
        { label: t("chooser.memory"), action: "memory" },
        { label: t("common.cancel"), action: "__cancel", role: "cancel" }
      ]
    }, function(a){
      if(a === "memory" && window.__vfPhotoLib){ postMemoryGallery(); return; } // native IG-galleri
      if(a === "thought" || a === "memory") openComposeWith(a);
    });
    return;
  }
  el("composemenu").classList.add("on");
}
export function openCompose(){ openChooser(); }

/* ---- Minde: native Instagram-galleri (app'en) ---- */
function vfmh(){ return window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.vibefeed; }
function postMemoryGallery(){
  const mh = vfmh();
  if(!mh){ openComposeWith("memory"); return; } // ingen bro → web-fallback
  mh.postMessage({
    type: "photolib", open: true, dest: state.currentFeed || "all",
    feeds: state.feeds.map(function(f){ return { id: f.id, name: f.name }; }),
    labels: {
      title: t("compose.title.memory"), next: t("memory.next"), cancel: t("common.cancel"), share: t("compose.post"),
      captionPlaceholder: t("compose.ph.memory"), destLabel: t("compose.dest"), allLabel: t("feedbar.all"),
      limited: t("photolib.limited"), manage: t("photolib.manage"), denied: t("photolib.denied"), settings: t("photolib.settings"),
      trimHint: t("memory.trim_hint")
    }
  });
}
function ackMemory(result){ const mh = vfmh(); if(mh) mh.postMessage({ type: "photolib", result: result }); }
/* Native → web: window.vfMemoryFallback() — brug web-compose (nægtet fotoadgang). */
export function openMemoryFallback(){ openComposeWith("memory"); }

/* Native uploader mediet DIREKTE til Supabase Storage (native URLSession er ikke bundet af web'ens
   CSP eller WKWebView-scheme-begrænsninger; virker for både billeder og store videoer). Flow:
   1) window.vfMemory({isVideo,caption,dest}) → web henter access-token + sender upload-URL+headers til native.
   2) native POST'er mediet til Storage → window.vfMemoryUploaded() → web opretter minde-opslaget. */
let pendingMemory = null;
export async function nativeMemoryPost(obj){
  if(!me || !obj){ ackMemory("err"); return; }
  try{
    const { data } = await sb.auth.getSession();
    const token = data && data.session ? data.session.access_token : null;
    if(!token) throw new Error("no_session");
    const dest = obj.dest || "all";
    const ext = obj.ext || (obj.isVideo ? "mp4" : "jpg");
    const path = me.id + "/" + uuid() + "." + ext;
    pendingMemory = { path: path, isVideo: !!obj.isVideo, caption: obj.caption || "", dest: dest };
    const mh = vfmh();
    if(!mh) throw new Error("no_bridge");
    mh.postMessage({ type: "photolib", upload: {
      url: SB_URL + "/storage/v1/object/post-images/" + path,
      token: token, apikey: SB_KEY, contentType: obj.mime || (obj.isVideo ? "video/mp4" : "image/jpeg")
    }});
  }catch(err){ console.error(err); pendingMemory = null; toast(t("compose.share_failed")); ackMemory("err"); }
}
/* Native → web: window.vfMemoryUploaded() — mediet er uploadet; opret opslaget. */
export async function nativeMemoryUploaded(){
  const m = pendingMemory; pendingMemory = null;
  if(!m || !me){ ackMemory("err"); return; }
  try{
    const ins = await sb.from("posts").insert({
      author: me.id,
      feed_id: m.dest === "all" ? null : m.dest,
      text: (m.caption || "").trim().slice(0, 280) || null,
      image_path: m.isVideo ? null : m.path,
      video_path: m.isVideo ? m.path : null,
      kind: "memory"
    });
    if(ins.error){ sb.storage.from("post-images").remove([m.path]).catch(function(){}); throw ins.error; }
    ackMemory("ok");
    switchTab("feed"); setFeed(m.dest);
    const df = feedById(m.dest);
    toast(df ? t("compose.shared_in", { name: df.name }) : t("compose.shared_all"));
    offerRewardAfterPost();
  }catch(err){
    console.error(err);
    toast(String((err && err.message) || "").indexOf("blocked_content") >= 0 ? t("err.blocked") : t("compose.share_failed"));
    ackMemory("err");
  }
}
/* Native → web: window.vfMemoryUploadFailed() — upload fejlede. */
export function nativeMemoryUploadFailed(){ pendingMemory = null; toast(t("compose.share_failed")); ackMemory("err"); }
export function closeCompose(){
  closeMediaMenu();
  el("compose").classList.remove("on");
  el("compose").classList.remove("memory");
  composeKind = "thought";
}

/* ---- Vedhæftning (billede/video, gensidigt udelukkende) ---- */
function syncAttach(){
  el("attach").classList.toggle("on", !!(pendingImg || pendingVid));
}
function clearImg(){
  if(pendingImg && pendingImg.url) URL.revokeObjectURL(pendingImg.url);
  pendingImg = null;
  el("attach-img").removeAttribute("src");
  el("attach-img").style.display = "none";
}
function clearVid(){
  if(pendingVid && pendingVid.url) URL.revokeObjectURL(pendingVid.url);
  pendingVid = null;
  const v = el("attach-vid");
  v.pause();
  v.removeAttribute("src");
  v.style.display = "none";
}
export function clearPendingImg(){ // rydder AL ventende medie (bruges også af resetApp)
  clearImg();
  clearVid();
  syncAttach();
  el("file-input").value = "";
  el("cam-photo").value = "";
  el("cam-video").value = "";
}

function handleImageFile(file){
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = function(){
    const max = 1440;
    const s = Math.min(1, max/Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width*s));
    c.height = Math.max(1, Math.round(img.height*s));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    c.toBlob(function(blob){
      if(!blob){ toast(t("img.read_failed")); return; }
      const hadVid = !!pendingVid;
      clearImg();
      clearVid();
      const purl = URL.createObjectURL(blob);
      pendingImg = { blob:blob, url:purl };
      el("attach-img").src = purl;
      el("attach-img").style.display = "block";
      syncAttach();
      if(hadVid) toast(t("compose.vid_removed"));
      canPost();
    }, "image/jpeg", 0.87);
  };
  img.onerror = function(){
    URL.revokeObjectURL(url);
    toast(t("img.read_failed"));
  };
  img.src = url;
}

function handleVideoFile(file){
  if(file.size > MAX_VID_BYTES){ toast(t("vid.too_big")); return; }
  const url = URL.createObjectURL(file);
  const probe = document.createElement("video");
  probe.preload = "metadata";
  probe.muted = true;
  function finish(dur){
    probe.ontimeupdate = null;
    probe.removeAttribute("src");
    if(!isFinite(dur)){
      URL.revokeObjectURL(url);
      toast(t("vid.read_failed"));
      return;
    }
    if(dur > MAX_VID_SEC){
      URL.revokeObjectURL(url);
      toast(t("vid.too_long"));
      return;
    }
    const hadImg = !!pendingImg;
    clearImg();
    clearVid();
    pendingVid = { file:file, url:url };
    const v = el("attach-vid");
    v.src = url;
    v.style.display = "block";
    v.play().catch(function(){});
    syncAttach();
    if(hadImg) toast(t("compose.img_removed"));
    canPost();
  }
  probe.onloadedmetadata = function(){
    if(probe.duration === Infinity){
      // MediaRecorder-WebM: varigheden mangler i headeren — tving den frem med et seek
      const timer = setTimeout(function(){ finish(NaN); }, 3000);
      probe.ontimeupdate = function(){
        clearTimeout(timer);
        finish(probe.duration);
      };
      probe.currentTime = 1e101;
      return;
    }
    finish(probe.duration);
  };
  probe.onerror = function(){
    probe.removeAttribute("src");
    URL.revokeObjectURL(url);
    toast(t("vid.read_failed"));
  };
  probe.src = url;
}

/* ---- Medie-menu (popup) ---- */
function openMediaMenu(){ el("mediamenu").classList.add("on"); }
function closeMediaMenu(){ el("mediamenu").classList.remove("on"); }

export function initCompose(){
el("compose-dest").addEventListener("click", function(e){
  const p = e.target.closest(".fpill");
  if(!p) return;
  composeDest = p.dataset.d;
  renderComposeDest();
});
el("tab-compose").addEventListener("click", openCompose);
el("compose-cancel").addEventListener("click", closeCompose);

ta.addEventListener("input", function(){ updateRing(); canPost(); });
el("imgbtn").addEventListener("click", function(){
  if(pollOn){ toast(t("compose.conflict_media")); return; }
  openMediaMenu();
});
el("mediamenu").addEventListener("click", function(e){
  if(e.target === el("mediamenu")) closeMediaMenu();
});
el("mm-cancel").addEventListener("click", closeMediaMenu);
el("mm-photo").addEventListener("click", function(){ closeMediaMenu(); el("cam-photo").click(); });
el("mm-video").addEventListener("click", function(){ closeMediaMenu(); el("cam-video").click(); });
el("mm-lib").addEventListener("click", function(){ closeMediaMenu(); el("file-input").click(); });
/* Opslags-type-vælger (browser-fallback for det native glas-kort) */
el("cm-thought").addEventListener("click", function(){ el("composemenu").classList.remove("on"); openComposeWith("thought"); });
el("cm-memory").addEventListener("click", function(){ el("composemenu").classList.remove("on"); openComposeWith("memory"); });
el("cm-cancel").addEventListener("click", function(){ el("composemenu").classList.remove("on"); });
el("composemenu").addEventListener("click", function(e){ if(e.target === el("composemenu")) el("composemenu").classList.remove("on"); });
el("pollbtn").addEventListener("click", function(){
  if(composeKind === "memory") return; // et minde har ingen afstemning
  if(pollOn){ resetPoll(); canPost(); return; }
  if(pendingImg){ toast(t("compose.conflict_img")); return; }
  if(pendingVid){ toast(t("compose.conflict_vid")); return; }
  pollOn = true;
  renderPollBox();
  renderComposeDest();
  canPost();
});
el("pollbox").addEventListener("input", function(e){
  const inp = e.target.closest(".pe-inp");
  if(!inp) return;
  pollOpts[Number(inp.dataset.i)] = inp.value;
  canPost();
});
el("pollbox").addEventListener("click", function(e){
  const rm = e.target.closest(".pe-rm");
  if(rm){
    if(pollOpts.length > 2){
      pollOpts.splice(Number(rm.dataset.i), 1);
      renderPollBox();
      canPost();
    }
    return;
  }
  if(e.target.closest(".pe-add")){
    if(pollOpts.length < 4){
      pollOpts.push("");
      renderPollBox();
      canPost();
      const inps = el("pollbox").querySelectorAll(".pe-inp");
      if(inps.length) inps[inps.length - 1].focus();
    }
    return;
  }
  if(e.target.closest(".pe-off")){
    resetPoll();
    canPost();
  }
});
function onFilePicked(input){
  const file = input.files && input.files[0];
  input.value = "";
  if(!file) return;
  const t = (file.type || "").toLowerCase();
  let isVideo;
  if(t.indexOf("video/") === 0) isVideo = true;
  else if(t.indexOf("image/") === 0) isVideo = false;
  else isVideo = /\.(mp4|mov|m4v|webm)$/i.test(file.name || "");
  if(isVideo) handleVideoFile(file);
  else handleImageFile(file);
}
el("file-input").addEventListener("change", function(){ onFilePicked(this); });
el("cam-photo").addEventListener("change", function(){ onFilePicked(this); });
el("cam-video").addEventListener("change", function(){ onFilePicked(this); });
el("attach-remove").addEventListener("click", function(){
  clearPendingImg();
  canPost();
});
el("compose-post").addEventListener("click", async function(){
  if(!me) return;
  const text = ta.value.trim();
  const dest = composeDest;
  const btn = this;
  if(pollOn){
    const opts = pollOpts.map(function(t){ return t.trim(); }).filter(Boolean);
    if(!text || opts.length < 2) return;
    btn.disabled = true;
    try{
      const ins = await sb.from("posts").insert({
        author: me.id,
        feed_id: dest === "all" ? null : dest,
        text: text,
        image_path: null
      }).select("id").single();
      if(ins.error) throw ins.error;
      const rows = opts.map(function(t, i){ return { post_id: ins.data.id, idx: i, text: t }; });
      const oi = await sb.from("poll_options").insert(rows);
      if(oi.error){
        try{ await sb.from("posts").delete().eq("id", ins.data.id); }catch(_e){}
        throw oi.error;
      }
      ta.value = "";
      updateRing();
      resetPoll();
      closeCompose();
      switchTab("feed");
      setFeed(dest);
      const dfp = feedById(dest);
      toast(dfp ? t("compose.shared_in", { name: dfp.name }) : t("compose.shared_all"));
      offerRewardAfterPost(); // tilbyd video for +20 like-plads (max 1/time)
    }catch(err){
      console.error(err);
      toast(String((err && err.message) || "").indexOf("blocked_content") >= 0
        ? t("err.blocked")
        : t("poll.create_failed"));
    }finally{
      btn.disabled = false;
      canPost();
    }
    return;
  }
  if(!pendingImg && !pendingVid && !text) return;
  btn.disabled = true;
  let path = null;
  try{
    let imgPath = null, vidPath = null;
    if(pendingImg){
      path = me.id + "/" + uuid() + ".jpg";
      const up = await sb.storage.from("post-images").upload(path, pendingImg.blob, { contentType:"image/jpeg" });
      if(up.error) throw up.error;
      if(up.data && up.data.path) path = up.data.path;
      imgPath = path;
    } else if(pendingVid){
      const type = pendingVid.file.type || "";
      const m = /\.(mp4|mov|m4v|webm)$/i.exec(pendingVid.file.name || "");
      const ext = VID_EXT[type] || (m ? m[1].toLowerCase() : "bin");
      path = me.id + "/" + uuid() + "." + ext;
      const up = await sb.storage.from("post-images").upload(path, pendingVid.file, { contentType: type || "application/octet-stream" });
      if(up.error) throw up.error;
      if(up.data && up.data.path) path = up.data.path;
      vidPath = path;
    }
    const ins = await sb.from("posts").insert({
      author: me.id,
      feed_id: dest === "all" ? null : dest,
      text: text || null,
      image_path: imgPath,
      video_path: vidPath,
      kind: composeKind
    });
    if(ins.error) throw ins.error;

    clearPendingImg();
    ta.value = "";
    updateRing();
    closeCompose();
    switchTab("feed");
    setFeed(dest);
    const df = feedById(dest);
    toast(df ? t("compose.shared_in", { name: df.name }) : t("compose.shared_all"));
    offerRewardAfterPost(); // tilbyd video for +20 like-plads (max 1/time)
  }catch(err){
    console.error(err);
    if(path){ sb.storage.from("post-images").remove([path]).catch(function(){}); }
    toast(String((err && err.message) || "").indexOf("blocked_content") >= 0
      ? t("err.blocked")
      : t("compose.share_failed"));
  }finally{
    btn.disabled = false;
    canPost();
  }
});
}
