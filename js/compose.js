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
  const t = ta.value.trim();
  el("compose-post").disabled = pollOn
    ? !(t && pollReady())
    : !(pendingImg || t.length > 0);
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
  ta.placeholder = pollOn ? "Stil et spørgsmål ..." : (f ? "Skriv til "+f.name+" …" : "Hvad sker der?");
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
  pollOpts.forEach(function(t, i){
    html += '<div class="pe-row">'+
      '<input class="pe-inp" data-i="'+i+'" maxlength="80" placeholder="Svarmulighed '+(i+1)+'" value="'+esc(t)+'">'+
      (pollOpts.length > 2 ? '<button class="pe-rm" data-i="'+i+'" aria-label="Fjern svarmulighed">✕</button>' : '')+
    '</div>';
  });
  if(pollOpts.length < 4) html += '<button class="pe-add">+ Tilføj svarmulighed</button>';
  html += '<button class="pe-off">Fjern meningsmåling</button>';
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
el("imgbtn").addEventListener("click", function(){
  if(pollOn){ toast("Fjern meningsmålingen først — et opslag kan ikke have både billede og meningsmåling"); return; }
  el("file-input").click();
});
el("pollbtn").addEventListener("click", function(){
  if(pollOn){ resetPoll(); canPost(); return; }
  if(pendingImg){ toast("Fjern billedet først — et opslag kan ikke have både billede og meningsmåling"); return; }
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
      toast(dfp ? "Delt i "+dfp.name : "Delt med hele kredsen");
    }catch(err){
      console.error(err);
      toast("Kunne ikke oprette meningsmålingen. Prøv igen.");
    }finally{
      btn.disabled = false;
      canPost();
    }
    return;
  }
  if(!pendingImg && !text) return;
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
