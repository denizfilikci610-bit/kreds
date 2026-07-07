import { sb } from "./config.js";
import { me, state } from "./store.js";
import { el, esc, toast, uuid } from "./helpers.js";
import { t } from "./i18n.js";
import { feedById, setFeed, switchTab } from "./feed.js";

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
  ta.placeholder = pollOn ? t("compose.ph.poll") : (f ? t("compose.ph.feed", { name: f.name }) : t("compose.ph.default"));
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
export function openCompose(){
  composeDest = state.currentFeed;
  renderComposeDest();
  el("compose").classList.add("on");
  setTimeout(function(){ ta.focus(); }, 260);
}
export function closeCompose(){
  closeMediaMenu();
  el("compose").classList.remove("on");
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
el("pollbtn").addEventListener("click", function(){
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
      video_path: vidPath
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
