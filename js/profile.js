import { sb, GENERIC_ERR } from "./config.js";
import { me, state, FRIEND_SINCE, pv, curTab } from "./store.js";
import { el, esc, avaHTML, user, toast, uuid, registerProfile } from "./helpers.js";
import { postHTML, postQuery, mapPost, setTabIcons, renderFeed, loadQuota } from "./feed.js";
import { openCompose } from "./compose.js";
import { renderSearch } from "./search.js";
import { resetApp, showAuth } from "./auth.js";

/* ================= Bobler-række ================= */
export function renderStories(){
  if(!me){ el("stories").innerHTML = ""; return; }
  let html =
    '<button class="story" data-u="'+esc(me.handle)+'" data-me="1">'+
      '<div class="ringwrap"><div class="bub">'+avaHTML(me.handle, 56)+'</div>'+
      '<span class="plusb">+</span></div>'+
      '<span class="lbl">Dig</span>'+
    '</button>';
  state.friends.forEach(function(h){
    html +=
      '<button class="story" data-u="'+esc(h)+'">'+
        '<div class="bub">'+avaHTML(h, 56)+'</div>'+
        '<span class="lbl">'+esc(user(h).name.split(" ")[0])+'</span>'+
      '</button>';
  });
  el("stories").innerHTML = html;
}

/* ================= Egen profil ================= */
export async function renderMyPosts(){
  if(!me) return;
  const mine = state.wholePosts.filter(function(p){ return p.u === me.handle; });
  el("stat-posts").textContent = mine.length;
  el("stat-friends").textContent = state.friends.length;
  el("myposts").innerHTML = mine.length
    ? mine.map(postHTML).join("")
    : '<div class="emptynote">Du har ikke delt noget endnu. Tryk på + og del et billede eller en tanke.</div>';
  loadQuota();
  const r = await sb.from("posts").select("id", { count:"exact", head:true }).eq("author", me.id).is("feed_id", null);
  if(!r.error && r.count != null && me) el("stat-posts").textContent = r.count;
}

export function setOwnUI(){
  el("own-ava").innerHTML = avaHTML(me.handle, 86);
  el("own-name").textContent = user(me.handle).name;
  el("own-handle").textContent = "@" + me.handle;
  const bio = (me.bio || "").trim();
  el("own-bio").textContent = bio;
  el("own-bio").style.display = bio ? "" : "none";
  el("compose-me-ava").innerHTML = avaHTML(me.handle, 44);
}

export function closeEditSheet(){
  el("esheet").classList.remove("on");
  if(!el("fsheet").classList.contains("on") && !el("edsheet").classList.contains("on"))
    el("scrim").classList.remove("on");
}
function epCan(){ el("ep-save").disabled = !el("ep-name").value.trim(); }

/* ---- Slet konto (popup) ---- */
export function resetDeleteUI(){
  el("delmodal").classList.remove("on");
  el("del-input").value = "";
  el("del-btn").disabled = true;
}

/* ================= Ven-profil ================= */
export async function openProfile(h){
  const u = user(h);
  if(!u.id){ toast("Kunne ikke finde profilen"); return; }
  pv.u = h;
  pv.posts = [];
  el("pv-name").textContent = u.name;
  el("pv-name2").textContent = u.name;
  el("pv-count").textContent = "";
  el("pv-handle").textContent = "@" + h;
  const bio = (u.bio || "").trim();
  el("pv-bio").textContent = bio;
  el("pv-bio").style.display = bio ? "" : "none";
  el("pv-stat-posts").textContent = "0";
  el("pv-stat-friends").textContent = "–";
  el("pv-ava").innerHTML = avaHTML(h, 86);
  el("pv-since").textContent = "I din kreds siden "+(FRIEND_SINCE[h] || u.since || "i dag")+" · Gensidig ven";
  el("pv-posts").innerHTML = '<div class="emptynote">Henter …</div>';
  el("pv-body").scrollTop = 0;
  el("profileview").classList.add("on");
  sb.rpc("friends_count_of", { u: u.id }).then(function(r){
    if(pv.u !== h) return;
    if(r.error){ console.error(r.error); return; }
    if(r.data != null) el("pv-stat-friends").textContent = r.data;
  });
  await loadPvPosts();
}
export async function loadPvPosts(){
  const h = pv.u;
  if(!h || !user(h).id) return;
  const { data, error } = await postQuery().eq("author", user(h).id).is("feed_id", null);
  if(pv.u !== h) return;
  if(error){
    console.error(error);
    el("pv-posts").innerHTML = '<div class="emptynote">Kunne ikke hente opslag. Prøv igen.</div>';
    return;
  }
  pv.posts = (data || []).map(mapPost);
  el("pv-count").textContent = pv.posts.length + " opslag";
  el("pv-stat-posts").textContent = pv.posts.length;
  el("pv-posts").innerHTML = pv.posts.length
    ? pv.posts.map(postHTML).join("")
    : '<div class="emptynote">Ingen opslag endnu.</div>';
}
export function closeProfile(){
  el("profileview").classList.remove("on");
}
export function refreshPv(){
  if(pv.u && el("profileview").classList.contains("on")){
    el("pv-count").textContent = pv.posts.length + " opslag";
    el("pv-stat-posts").textContent = pv.posts.length;
    el("pv-posts").innerHTML = pv.posts.length
      ? pv.posts.map(postHTML).join("")
      : '<div class="emptynote">Ingen opslag endnu.</div>';
    el("pv-ava").innerHTML = avaHTML(pv.u, 86);
  }
}

export function initProfile(){
el("editprof").addEventListener("click", function(){
  if(!me) return;
  el("ep-name").value = me.name || "";
  el("ep-bio").value = me.bio || "";
  el("ep-ava").innerHTML = avaHTML(me.handle, 72);
  el("ep-file").value = "";
  resetDeleteUI();
  epCan();
  el("scrim").classList.add("on");
  el("esheet").classList.add("on");
  setTimeout(function(){ el("ep-name").focus(); }, 260);
});
el("ep-name").addEventListener("input", epCan);
el("ep-save").addEventListener("click", async function(){
  const name = el("ep-name").value.trim();
  const bio = el("ep-bio").value.trim().slice(0, 160);
  if(!name || !me) return;
  this.disabled = true;
  const { error } = await sb.from("profiles").update({ name:name, bio: bio || null }).eq("id", me.id);
  this.disabled = false;
  if(error){ console.error(error); toast(GENERIC_ERR); return; }
  me.name = name;
  me.bio = bio || null;
  registerProfile(me);
  setOwnUI();
  closeEditSheet();
  renderFeed();
  renderStories();
  renderMyPosts();
  toast("Profil opdateret");
});
/* ---- Profilbillede ---- */
el("ep-pic").addEventListener("click", function(){ el("ep-file").click(); });
el("ep-file").addEventListener("change", function(){
  const file = this.files && this.files[0];
  if(!file || !me) return;
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = function(){
    const side = Math.min(img.width, img.height);
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    c.getContext("2d").drawImage(img, (img.width - side)/2, (img.height - side)/2, side, side, 0, 0, 512, 512);
    URL.revokeObjectURL(url);
    c.toBlob(async function(blob){
      if(!blob){ toast("Kunne ikke læse billedet"); return; }
      if(!me) return;
      const old = me.avatar_path;
      let path = me.id + "/avatar-" + uuid() + ".jpg";
      try{
        const up = await sb.storage.from("post-images").upload(path, blob, { contentType:"image/jpeg" });
        if(up.error) throw up.error;
        if(up.data && up.data.path) path = up.data.path;
        const upd = await sb.from("profiles").update({ avatar_path: path }).eq("id", me.id);
        if(upd.error){
          sb.storage.from("post-images").remove([path]).catch(function(){});
          throw upd.error;
        }
      }catch(err){
        console.error(err);
        toast("Kunne ikke opdatere profilbilledet. Prøv igen.");
        el("ep-file").value = "";
        return;
      }
      if(old) sb.storage.from("post-images").remove([old]).catch(function(){});
      me.avatar_path = path;
      registerProfile(me);
      setOwnUI();
      el("ep-ava").innerHTML = avaHTML(me.handle, 72);
      setTabIcons(curTab);
      renderStories();
      renderFeed();
      renderMyPosts();
      refreshPv();
      if(el("view-search").classList.contains("active")) renderSearch();
      el("ep-file").value = "";
      toast("Profilbillede opdateret");
    }, "image/jpeg", 0.85);
  };
  img.onerror = function(){
    URL.revokeObjectURL(url);
    toast("Kunne ikke læse billedet");
  };
  img.src = url;
});
el("del-open").addEventListener("click", function(){
  el("del-input").value = "";
  el("del-btn").disabled = true;
  el("delmodal").classList.add("on");
  setTimeout(function(){ el("del-input").focus(); }, 60);
});
el("del-cancel").addEventListener("click", resetDeleteUI);
el("delmodal").addEventListener("click", function(e){
  if(e.target === el("delmodal")) resetDeleteUI();
});
el("del-input").addEventListener("input", function(){
  el("del-btn").disabled = this.value !== "SLET";
});
el("del-btn").addEventListener("click", async function(){
  if(this.disabled || !me) return;
  const btn = this;
  btn.disabled = true;
  try{
    const { data, error } = await sb.functions.invoke("delete-account", { body:{} });
    if(error || !data || !data.ok) throw (error || new Error("delete_failed"));
    try{ await sb.auth.signOut(); }catch(_e){}
    closeEditSheet();
    resetApp();
    showAuth();
    toast("Din konto er slettet");
  }catch(err){
    console.error(err);
    toast("Kunne ikke slette kontoen. Prøv igen.");
    btn.disabled = false;
  }
});

el("logoutbtn").addEventListener("click", async function(){
  const { error } = await sb.auth.signOut();
  if(error){ console.error(error); toast(GENERIC_ERR); }
});
el("pv-back").addEventListener("click", closeProfile);
/* ================= Bobler: klik ================= */
el("stories").addEventListener("click", function(e){
  const s = e.target.closest(".story");
  if(!s) return;
  if(s.dataset.me){ openCompose(); return; }
  openProfile(s.dataset.u);
});
}
