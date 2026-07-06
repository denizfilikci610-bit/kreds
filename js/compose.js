import { sb } from "./config.js";
import { me, state } from "./store.js";
import { el, esc, toast, uuid } from "./helpers.js";
import { feedById, setFeed, switchTab } from "./feed.js";

/* ================= Skriv ================= */
let pendingImg = null; // { blob, url }
export const ta = el("compose-field");
const MAXC = 280, CIRC = 56.55;

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
  el("compose-post").disabled = !(pendingImg || ta.value.trim().length > 0);
}
let composeDest = "all";
export function renderComposeDest(){
  let html = '<span class="dlabel">Del til:</span>'+
    '<button class="fpill'+(composeDest === "all" ? " on" : "")+'" data-d="all">Hele kredsen</button>';
  state.feeds.forEach(function(f){
    html += '<button class="fpill'+(composeDest === f.id ? " on" : "")+'" data-d="'+esc(f.id)+'">'+esc(f.name)+'</button>';
  });
  el("compose-dest").innerHTML = html;
  const f = feedById(composeDest);
  ta.placeholder = f ? "Skriv til "+f.name+" …" : "Hvad sker der?";
}
export function openCompose(){
  composeDest = state.currentFeed;
  renderComposeDest();
  el("compose").classList.add("on");
  setTimeout(function(){ ta.focus(); }, 260);
}
export function closeCompose(){ el("compose").classList.remove("on"); }

export function clearPendingImg(){
  if(pendingImg && pendingImg.url) URL.revokeObjectURL(pendingImg.url);
  pendingImg = null;
  el("attach").classList.remove("on");
  el("attach-img").removeAttribute("src");
  el("file-input").value = "";
}

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
el("imgbtn").addEventListener("click", function(){ el("file-input").click(); });
el("file-input").addEventListener("change", function(){
  const file = this.files && this.files[0];
  if(!file) return;
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
      if(!blob){ toast("Kunne ikke læse billedet"); return; }
      clearPendingImg();
      const purl = URL.createObjectURL(blob);
      pendingImg = { blob:blob, url:purl };
      el("attach-img").src = purl;
      el("attach").classList.add("on");
      canPost();
    }, "image/jpeg", 0.87);
  };
  img.onerror = function(){
    URL.revokeObjectURL(url);
    toast("Kunne ikke læse billedet");
  };
  img.src = url;
});
el("attach-remove").addEventListener("click", function(){
  clearPendingImg();
  canPost();
});
el("compose-post").addEventListener("click", async function(){
  if(!me) return;
  const text = ta.value.trim();
  if(!pendingImg && !text) return;
  const dest = composeDest;
  const btn = this;
  btn.disabled = true;
  let path = null;
  try{
    if(pendingImg){
      path = me.id + "/" + uuid() + ".jpg";
      const up = await sb.storage.from("post-images").upload(path, pendingImg.blob, { contentType:"image/jpeg" });
      if(up.error) throw up.error;
      if(up.data && up.data.path) path = up.data.path;
    }
    const ins = await sb.from("posts").insert({
      author: me.id,
      feed_id: dest === "all" ? null : dest,
      text: text || null,
      image_path: path
    });
    if(ins.error) throw ins.error;

    clearPendingImg();
    ta.value = "";
    updateRing();
    closeCompose();
    switchTab("feed");
    setFeed(dest);
    const df = feedById(dest);
    toast(df ? "Delt i "+df.name : "Delt med hele kredsen");
  }catch(err){
    console.error(err);
    if(path){ sb.storage.from("post-images").remove([path]).catch(function(){}); }
    toast("Kunne ikke dele. Prøv igen.");
  }finally{
    btn.disabled = false;
    canPost();
  }
});
}
