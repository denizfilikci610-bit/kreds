import { sb } from "./config.js";
import { me, expandedCmts, composers, cstate, cfilePid } from "./store.js";
import { el, esc, avaHTML, toast, uuid, HEART_SVG, user, ini, grad, imgUrl } from "./helpers.js";
import { t, likesLabel } from "./i18n.js";
import { findPost, findPostAll, allPostArrays, mapComment } from "./feed.js";

/* ================= Kommentartråd (inline, sammenklappet som standard) ================= */
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
  // Kun ÉT indrykningsniveau: top-kommentar (0) og alle svar (1). Dybere svar
  // rykker ikke længere ind — @navn foran viser hvem svaret er rettet til.
  const lvl = item.lvl > 0 ? 1 : 0;
  const ind = lvl * 26;
  // Vis ALTID hvem svaret er rettet til (ikke kun ved dyb nesting)
  const prefix = item.parentU ? '<span class="cat">@'+esc(item.parentU)+'</span> ' : '';
  return '<div class="crow'+(lvl > 0 ? " cnest" : "")+'"'+(ind ? ' style="margin-left:'+ind+'px"' : '')+' data-cid="'+c.id+'">'+
    avaHTML(c.u, 28)+
    '<div class="cbody">'+
      '<div class="ctext"><b>'+esc(c.u)+'</b>'+prefix+(c.text ? esc(c.text) : '')+'</div>'+
      (c.img ? '<img class="cimg" src="'+esc(c.img)+'" alt="'+t("cmt.img_alt")+'">' : '')+
      '<div class="cmeta">'+
        '<span>'+esc(c.t)+'</span>'+
        '<span class="clc"'+(c.likeCount > 0 ? '' : ' style="display:none"')+'>'+likesLabel(c.likeCount)+'</span>'+
        '<button class="csvar" data-cid="'+c.id+'" data-u="'+esc(c.u)+'">'+t("cmt.reply")+'</button>'+
        (me && c.u === me.handle ? '<button class="cdel" data-cid="'+c.id+'">'+t("cmt.delete")+'</button>' : '')+
        '<button class="likec'+(c.liked ? " on" : "")+'" data-cid="'+c.id+'" aria-label="'+t("aria.like")+'">'+HEART_SVG+'</button>'+
      '</div>'+
    '</div>'+
  '</div>';
}
export function threadHTML(p){
  const flat = buildThread(p);
  return '<div class="cthread" data-id="'+p.id+'">'+flat.map(cmtRowHTML).join("")+'</div>';
}
function cmtSectionInner(p){
  const n = p.cmts.length;
  if(!expandedCmts.has(Number(p.id))){
    return n > 0 ? '<button class="cmt-toggle" data-id="'+p.id+'">'+t("cmt.show", { n:n })+'</button>' : '';
  }
  return (n > 0
      ? '<button class="cmt-toggle" data-id="'+p.id+'">'+t("cmt.hide")+'</button>'+threadHTML(p)
      : '')+
    composerHTML(p.id);
}
export function cmtSectionHTML(p){
  return '<div class="csec" data-id="'+p.id+'">'+cmtSectionInner(p)+'</div>';
}
export function toggleCmtSection(pid){
  pid = Number(pid);
  if(expandedCmts.has(pid)) expandedCmts.delete(pid);
  else expandedCmts.add(pid);
  rerenderPostCmts(pid);
  return expandedCmts.has(pid);
}
export function composerHTML(pid){
  if(!me) return "";
  const s = cstate(pid);
  const chip = s.replyTo
    ? '<div class="cchiprow"><span class="cchip">'+t("cmt.replying", { u: esc(s.replyTo.u) })+'<button class="cchip-x" data-id="'+pid+'" aria-label="'+t("cmt.cancel_reply")+'">✕</button></span></div>'
    : '';
  const prev = s.img
    ? '<div class="cprevrow"><span class="cprev"><img src="'+esc(s.img.url)+'" alt="'+t("attach.alt")+'"><button class="cprev-x" data-id="'+pid+'" aria-label="'+t("cmt.rm_img")+'">✕</button></span></div>'
    : '';
  const dis = (!s.text.trim() && !s.img) ? " disabled" : "";
  return '<div class="cbox" data-id="'+pid+'">'+chip+prev+
    '<div class="ccomposer">'+
      avaHTML(me.handle, 28)+
      '<input class="cfield" data-id="'+pid+'" placeholder="'+t("cmt.ph")+'" maxlength="280" value="'+esc(s.text)+'">'+
      '<button class="cimgb" data-id="'+pid+'" aria-label="'+t("cmt.add_img")+'">'+
        '<svg viewBox="0 0 24 24"><g class="stroke"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.7" cy="8.7" r="1.7"/><path d="M21 15.3 16 10.3 5 21"/></g></svg>'+
      '</button>'+
      '<button class="csend" data-id="'+pid+'"'+dis+'>'+t("cmt.send")+'</button>'+
    '</div>'+
  '</div>';
}

export function rerenderPostCmts(pid){
  const p = findPost(pid);
  if(!p) return;
  document.querySelectorAll('.csec[data-id="'+pid+'"]').forEach(function(node){
    node.innerHTML = cmtSectionInner(p);
  });
  document.querySelectorAll('.post[data-id="'+pid+'"] .cmt-btn .cnt').forEach(function(c){
    c.textContent = p.cmts.length;
    c.style.display = p.cmts.length > 0 ? "" : "none";
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
  pushNativeComments(); // hold det native sheet i sync (optimistisk)
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
    pushNativeComments(); // rul like tilbage i det native sheet
    toast(t("err.generic"));
  }
}

/* ================= Slet kommentar (kun forfatteren) ================= */
// Kommentaren OG dens svar-undertræd (DB'en cascade-sletter parent_id-børn, Instagram-stil).
function descendantIds(p, rootId){
  const kids = {};
  p.cmts.forEach(function(c){
    if(c.parent != null){ (kids[c.parent] = kids[c.parent] || []).push(Number(c.id)); }
  });
  const out = new Set(), stack = [Number(rootId)];
  while(stack.length){
    const id = stack.pop();
    if(out.has(id)) continue;
    out.add(id);
    (kids[id] || []).forEach(function(k){ stack.push(k); });
  }
  return out;
}
export async function deleteComment(cid){
  cid = Number(cid);
  if(!me) return;
  const cs = findCommentAll(cid);
  if(!cs.length || cs[0].u !== me.handle) return; // kun egen kommentar (RLS håndhæver også dette)
  // Hent evt. billedsti til oprydning i storage, slet så rækken.
  let paths = [];
  const r = await sb.from("comments").select("image_path").eq("id", cid).maybeSingle();
  if(!r.error && r.data && r.data.image_path) paths.push(r.data.image_path);
  const del = await sb.from("comments").delete().eq("id", cid);
  if(del.error){ console.error(del.error); toast(t("err.generic")); return; }
  if(paths.length) sb.storage.from("post-images").remove(paths).catch(function(){});
  // Fjern kommentaren + dens svar lokalt (matcher DB-cascade) og gen-render de ramte tråde.
  const affected = new Set();
  allPostArrays().forEach(function(arr){
    arr.forEach(function(p){
      const remove = descendantIds(p, cid);
      const before = p.cmts.length;
      p.cmts = p.cmts.filter(function(x){ return !remove.has(Number(x.id)); });
      if(p.cmts.length !== before) affected.add(p.id);
    });
  });
  affected.forEach(function(pid){ rerenderPostCmts(pid); });
  pushNativeComments(); // opdatér det native sheet efter sletning
  toast(t("cmt.deleted"));
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
    toast(String((err && err.message) || "").indexOf("blocked_content") >= 0
      ? t("err.blocked")
      : t("cmt.send_failed"));
    updateSendState(pid);
  }finally{
    s.busy = false;
    pushNativeComments(); // opdatér det native sheet (ny kommentar vist, eller input frigivet ved fejl)
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

/* ================= Native kommentar-sheet (KUN i app'en; kun minder) =================
   Web bygger en fuld snapshot af tråden (navn/avatar resolveret) og poster den til Swift via
   window.__vfCommentsPush; Swift tegner det native Liquid Glass-sheet og melder handlinger tilbage
   via window.vfComments → nativeCommentsAction. Web forbliver kilden til sandhed: handlingerne kører
   de EKSISTERENDE kommentar-funktioner (sendComment/toggleCmtLike/deleteComment) og et friskt
   snapshot skubbes tilbage (pushNativeComments), så sheet'et holdes i sync — også ved realtime. */
const CMT_EMOJI = ["❤️","🙌","🔥","👏","🤍","😍","😭","🥹"];
let nativeCmtPid = null; // hvilket opslag det native sheet viser lige nu (null = lukket)

function cmtSnapshot(pid){
  const p = findPost(pid);
  if(!p) return null;
  const comments = buildThread(p).map(function(item){
    const c = item.c, u = user(c.u);
    return {
      id: String(c.id),
      handle: c.u,
      name: u.name || c.u,
      avatarUrl: u.avatar_path ? imgUrl(u.avatar_path) : "",
      initials: ini(c.u),
      gradient: grad(c.u),
      text: c.text || "",
      img: c.img || "",
      replyTo: item.parentU || "",   // handle svaret er rettet til ("" = top-niveau)
      indent: item.lvl > 0 ? 1 : 0,
      time: c.t,
      liked: !!c.liked,
      likeCount: c.likeCount || 0,
      mine: !!(me && c.u === me.handle)
    };
  });
  return {
    open: true,
    postId: String(pid),
    title: t("cmt.title"),
    canPost: !!me,
    emoji: CMT_EMOJI,
    comments: comments,
    labels: {
      empty: t("cmt.empty"),
      placeholder: t("cmt.ph"),
      send: t("cmt.send"),
      reply: t("cmt.reply"),
      cancelReply: t("cmt.cancel_reply"),
      replyingTo: t("cmt.replying", { u: "{u}" }), // Swift indsætter {u} → handle
      del: t("cmt.delete"),
      delConfirm: t("cmt.delete_confirm")
    }
  };
}
export function openNativeComments(pid, focusCid){
  pid = Number(pid);
  const snap = cmtSnapshot(pid);
  if(!snap) return;
  // focus = scroll til/fremhæv denne kommentar (deep-link fra en notifikation).
  // KUN i åbnings-snapshottet — senere syncs (pushNativeComments) må ikke gen-scrolle.
  if(focusCid != null) snap.focus = String(focusCid);
  nativeCmtPid = pid;
  if(window.__vfCommentsPush) window.__vfCommentsPush(snap);
}
export function pushNativeComments(){
  if(nativeCmtPid == null) return;
  const snap = cmtSnapshot(nativeCmtPid);
  if(snap && window.__vfCommentsPush) window.__vfCommentsPush(snap);
}
export function nativeCommentsAction(payload){
  if(!payload) return;
  const kind = payload.kind;
  if(kind === "dismiss"){
    nativeCmtPid = null;
    if(window.__vfCommentsPush) window.__vfCommentsPush({ close: true }); // nulstil native-bar-tilstand
    return;
  }
  const pid = Number(payload.postId != null ? payload.postId : nativeCmtPid);
  if(!pid) return;
  if(kind === "send"){
    const s = cstate(pid);
    s.text = payload.text || "";
    s.replyTo = payload.replyTo ? { id: Number(payload.replyTo), u: payload.replyToU || "" } : null;
    s.img = null;
    sendComment(pid); // upload/insert + rerender + pushNativeComments til sidst
    return;
  }
  if(kind === "like"){ toggleCmtLike(payload.commentId); return; }
  if(kind === "delete"){ deleteComment(payload.commentId); return; }
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
      if(!blob){ toast(t("img.read_failed")); return; }
      const st = cstate(pid);
      if(st.img && st.img.url) URL.revokeObjectURL(st.img.url);
      st.img = { blob:blob, url:URL.createObjectURL(blob) };
      rerenderComposer(pid);
    }, "image/jpeg", 0.85);
  };
  img.onerror = function(){
    URL.revokeObjectURL(url);
    toast(t("img.read_failed"));
  };
  img.src = url;
  this.value = "";
});
}
