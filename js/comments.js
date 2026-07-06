import { sb, GENERIC_ERR } from "./config.js";
import { me, expandedCmts, composers, cstate, cfilePid } from "./store.js";
import { el, esc, avaHTML, likesLabel, toast, uuid, HEART_SVG } from "./helpers.js";
import { findPost, findPostAll, allPostArrays, mapComment } from "./feed.js";

/* ================= Kommentartråd (inline) ================= */
const CMT_PREVIEW = 10;

function buildThread(p){
  const byId = {};
  p.cmts.forEach(function(c){ byId[c.id] = c; });
  const roots = [], kids = {};
  p.cmts.forEach(function(c){
    if(c.parent != null && byId[c.parent]){
      (kids[c.parent] = kids[c.parent] || []).push(c);
    } else {
      roots.push(c); // forældreløse (parent udenfor sættet) vises som top-niveau
    }
  });
  const flat = [], visited = new Set();
  function walk(c, lvl){
    if(visited.has(c.id)) return;
    visited.add(c.id);
    flat.push({ c:c, lvl:lvl, parentU: (c.parent != null && byId[c.parent]) ? byId[c.parent].u : null });
    (kids[c.id] || []).forEach(function(k){ walk(k, lvl + 1); });
  }
  roots.forEach(function(r){ walk(r, 0); });
  // Cyklisk/selv-refererende parent_id (dårlige data): vis som top-niveau i stedet for at skjule
  p.cmts.forEach(function(c){
    if(!visited.has(c.id)) walk(c, 0);
  });
  return flat;
}
function cmtRowHTML(item){
  const c = item.c;
  const lvl = Math.min(item.lvl, 3);
  const deep = item.lvl > 3 && item.parentU;
  const ind = lvl * 26;
  const prefix = deep ? '<span class="cat">@'+esc(item.parentU)+'</span> ' : '';
  return '<div class="crow'+(lvl > 0 ? " cnest" : "")+'"'+(ind ? ' style="margin-left:'+ind+'px"' : '')+' data-cid="'+c.id+'">'+
    avaHTML(c.u, 28)+
    '<div class="cbody">'+
      '<div class="ctext"><b>'+esc(c.u)+'</b>'+prefix+(c.text ? esc(c.text) : '')+'</div>'+
      (c.img ? '<img class="cimg" src="'+esc(c.img)+'" alt="Billede i kommentar">' : '')+
      '<div class="cmeta">'+
        '<span>'+esc(c.t)+'</span>'+
        '<span class="clc"'+(c.likeCount > 0 ? '' : ' style="display:none"')+'>'+likesLabel(c.likeCount)+'</span>'+
        '<button class="csvar" data-cid="'+c.id+'" data-u="'+esc(c.u)+'">Svar</button>'+
        '<button class="likec'+(c.liked ? " on" : "")+'" data-cid="'+c.id+'" aria-label="Like">'+HEART_SVG+'</button>'+
      '</div>'+
    '</div>'+
  '</div>';
}
export function threadHTML(p){
  const flat = buildThread(p);
  if(!flat.length) return '<div class="cthread" data-id="'+p.id+'"></div>';
  const expanded = expandedCmts.has(Number(p.id));
  const show = expanded ? flat : flat.slice(0, CMT_PREVIEW);
  let html = show.map(cmtRowHTML).join("");
  if(!expanded && flat.length > CMT_PREVIEW){
    html += '<button class="cmore" data-id="'+p.id+'">Se '+(flat.length - CMT_PREVIEW)+' kommentarer mere</button>';
  }
  return '<div class="cthread" data-id="'+p.id+'">'+html+'</div>';
}
export function composerHTML(pid){
  if(!me) return "";
  const s = cstate(pid);
  const chip = s.replyTo
    ? '<div class="cchiprow"><span class="cchip">Svarer @'+esc(s.replyTo.u)+'<button class="cchip-x" data-id="'+pid+'" aria-label="Annuller svar">✕</button></span></div>'
    : '';
  const prev = s.img
    ? '<div class="cprevrow"><span class="cprev"><img src="'+esc(s.img.url)+'" alt="Valgt billede"><button class="cprev-x" data-id="'+pid+'" aria-label="Fjern billede">✕</button></span></div>'
    : '';
  const dis = (!s.text.trim() && !s.img) ? " disabled" : "";
  return '<div class="cbox" data-id="'+pid+'">'+chip+prev+
    '<div class="ccomposer">'+
      avaHTML(me.handle, 28)+
      '<input class="cfield" data-id="'+pid+'" placeholder="Tilføj en kommentar ..." maxlength="280" value="'+esc(s.text)+'">'+
      '<button class="cimgb" data-id="'+pid+'" aria-label="Tilføj billede">'+
        '<svg viewBox="0 0 24 24"><g class="stroke"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.7" cy="8.7" r="1.7"/><path d="M21 15.3 16 10.3 5 21"/></g></svg>'+
      '</button>'+
      '<button class="csend" data-id="'+pid+'"'+dis+'>Send</button>'+
    '</div>'+
  '</div>';
}

export function rerenderPostCmts(pid){
  const p = findPost(pid);
  if(!p) return;
  document.querySelectorAll('.post[data-id="'+pid+'"]').forEach(function(node){
    const th = node.querySelector(".cthread");
    if(th) th.outerHTML = threadHTML(p);
    const box = node.querySelector(".cbox");
    if(box) box.outerHTML = composerHTML(p.id);
  });
}
export function updateSendState(pid){
  const s = cstate(pid);
  const ok = !!(s.text.trim() || s.img);
  document.querySelectorAll('.cbox[data-id="'+pid+'"] .csend').forEach(function(b){ b.disabled = !ok; });
}

/* ================= Kommentarer (inline) ================= */
function findCommentAll(cid){
  cid = Number(cid);
  const out = [];
  allPostArrays().forEach(function(arr){
    arr.forEach(function(p){
      p.cmts.forEach(function(c){
        if(Number(c.id) === cid && out.indexOf(c) < 0) out.push(c);
      });
    });
  });
  return out;
}
function applyCmtLikeUI(cid){
  const cs = findCommentAll(cid);
  if(!cs.length) return;
  const c = cs[0];
  document.querySelectorAll('.crow[data-cid="'+cid+'"]').forEach(function(row){
    const b = row.querySelector(".likec");
    if(b) b.classList.toggle("on", c.liked);
    const lc = row.querySelector(".clc");
    if(lc){
      lc.textContent = likesLabel(c.likeCount);
      lc.style.display = c.likeCount > 0 ? "" : "none";
    }
  });
}
export async function toggleCmtLike(cid){
  if(!me) return;
  const cs = findCommentAll(cid);
  if(!cs.length) return;
  const on = !cs[0].liked;
  cs.forEach(function(c){ c.liked = on; c.likeCount = Math.max(0, (c.likeCount||0) + (on ? 1 : -1)); });
  applyCmtLikeUI(cid);
  let error = null;
  if(on){
    const r = await sb.from("comment_likes").insert({ comment_id:Number(cid), user_id:me.id });
    error = (r.error && r.error.code !== "23505") ? r.error : null;
  } else {
    const r = await sb.from("comment_likes").delete().eq("comment_id", Number(cid)).eq("user_id", me.id);
    error = r.error;
  }
  if(error){
    console.error(error);
    cs.forEach(function(c){ c.liked = !on; c.likeCount = Math.max(0, c.likeCount + (on ? -1 : 1)); });
    applyCmtLikeUI(cid);
    toast(GENERIC_ERR);
  }
}

export function rerenderComposer(pid){
  document.querySelectorAll('.cbox[data-id="'+pid+'"]').forEach(function(box){
    box.outerHTML = composerHTML(Number(pid));
  });
}
export function clearCImg(pid){
  const s = cstate(pid);
  if(s.img && s.img.url) URL.revokeObjectURL(s.img.url);
  s.img = null;
  rerenderComposer(pid);
}
export function clearReply(pid){
  cstate(pid).replyTo = null;
  rerenderComposer(pid);
}
export async function sendComment(pid){
  pid = Number(pid);
  if(!me) return;
  const s = cstate(pid);
  if(s.busy) return;
  const text = (s.text || "").trim();
  if(!text && !s.img) return;
  s.busy = true;
  document.querySelectorAll('.cbox[data-id="'+pid+'"] .csend').forEach(function(b){ b.disabled = true; });
  let path = null;
  try{
    if(s.img){
      path = me.id + "/" + uuid() + ".jpg";
      const up = await sb.storage.from("post-images").upload(path, s.img.blob, { contentType:"image/jpeg" });
      if(up.error) throw up.error;
      if(up.data && up.data.path) path = up.data.path;
    }
    const ins = await sb.from("comments").insert({
      post_id: pid,
      author: me.id,
      text: text || null,
      image_path: path,
      parent_id: s.replyTo ? s.replyTo.id : null
    }).select("*, author_profile:profiles!author(*)").single();
    if(ins.error) throw ins.error;
    const c = mapComment(ins.data);
    findPostAll(pid).forEach(function(post){
      if(!post.cmts.some(function(x){ return x.id === c.id; })) post.cmts.push(c);
    });
    if(s.img && s.img.url) URL.revokeObjectURL(s.img.url);
    composers.set(pid, { text:"", replyTo:null, img:null });
    expandedCmts.add(pid);
    rerenderPostCmts(pid);
  }catch(err){
    console.error(err);
    if(path){ sb.storage.from("post-images").remove([path]).catch(function(){}); }
    toast("Kunne ikke sende kommentaren. Prøv igen.");
    updateSendState(pid);
  }finally{
    s.busy = false;
  }
}
export function cInput(e){
  const f = e.target.closest(".cfield");
  if(!f) return;
  cstate(f.dataset.id).text = f.value;
  updateSendState(f.dataset.id);
}
export function cKey(e){
  const f = e.target.closest(".cfield");
  if(!f) return;
  if(e.key === "Enter" && !e.isComposing) sendComment(f.dataset.id);
}

export function initComments(){
el("cfile").addEventListener("change", function(){
  const file = this.files && this.files[0];
  const pid = cfilePid;
  if(!file || pid == null) return;
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = function(){
    const max = 1080;
    const s = Math.min(1, max/Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width*s));
    c.height = Math.max(1, Math.round(img.height*s));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    c.toBlob(function(blob){
      if(!blob){ toast("Kunne ikke læse billedet"); return; }
      const st = cstate(pid);
      if(st.img && st.img.url) URL.revokeObjectURL(st.img.url);
      st.img = { blob:blob, url:URL.createObjectURL(blob) };
      rerenderComposer(pid);
    }, "image/jpeg", 0.85);
  };
  img.onerror = function(){
    URL.revokeObjectURL(url);
    toast("Kunne ikke læse billedet");
  };
  img.src = url;
  this.value = "";
});
}
