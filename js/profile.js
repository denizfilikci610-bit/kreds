import { sb, GENERIC_ERR, BLOCKED_MSG, OFFICIAL_HANDLE } from "./config.js";
import { me, state, FRIEND_SINCE, pv, curTab } from "./store.js";
import { el, esc, avaHTML, user, toast, uuid, registerProfile, fmtTime } from "./helpers.js";
import { postHTML, postQuery, mapPost, setTabIcons, renderFeed, loadQuota, snapVideos, restoreVideos, loadFriends, loadPosts } from "./feed.js";
import { openCompose } from "./compose.js";
import { renderSearch, refreshSearchAfterFriendAdd } from "./search.js";
import { resetApp, showAuth, nativeLogout } from "./auth.js";

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
  el("stat-friends").textContent = state.humanFriends.length;
  el("stat-kredse").textContent = state.feeds.length;
  const vsnap = snapVideos(el("myposts"));
  el("myposts").innerHTML = mine.length
    ? mine.map(postHTML).join("")
    : '<div class="emptynote">Du har ikke delt noget endnu. Tryk på + og del et billede eller en tanke.</div>';
  restoreVideos(el("myposts"), vsnap);
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
  if(!el("fsheet").classList.contains("on") && !el("edsheet").classList.contains("on") && !el("msheet").classList.contains("on") && !el("asheet").classList.contains("on"))
    el("scrim").classList.remove("on");
}
function epCan(){ el("ep-save").disabled = !el("ep-name").value.trim(); }

/* ================= Aktivitet (samtykke-styret visning af likes/kommentarer) ================= */
const ACT_H = '<svg viewBox="0 0 24 24"><path class="stroke" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
const ACT_B = '<svg viewBox="0 0 24 24"><path class="stroke" d="M12 3.3a8.7 8.7 0 0 0-7.4 13.2L3.4 20.6l4.2-1.1A8.7 8.7 0 1 0 12 3.3Z"/></svg>';

export function closeActivitySheet(){
  el("asheet").classList.remove("on");
  if(!el("fsheet").classList.contains("on") && !el("esheet").classList.contains("on") &&
     !el("edsheet").classList.contains("on") && !el("msheet").classList.contains("on"))
    el("scrim").classList.remove("on");
}
async function openActivitySheet(h){
  el("as-title").textContent = user(h).name + "s aktivitet";
  el("as-list").innerHTML = '<div class="emptynote">Henter …</div>';
  el("scrim").classList.add("on");
  el("asheet").classList.add("on");
  const { data, error } = await sb.rpc("activity_of", { u: user(h).id });
  if(!el("asheet").classList.contains("on")) return; // lukket imens
  if(error){
    console.error(error);
    el("as-list").innerHTML = '<div class="emptynote">Kunne ikke hente aktiviteten. Prøv igen.</div>';
    return;
  }
  const rows = data || [];
  el("as-list").innerHTML = rows.length
    ? rows.map(function(r){
        const like = r.kind === "like";
        const txt = like
          ? 'Likede '+esc(r.target_name)+'s opslag'+(r.snippet ? ': “'+esc(r.snippet)+'”' : '')
          : 'Kommenterede hos '+esc(r.target_name)+(r.snippet ? ': “'+esc(r.snippet)+'”' : '');
        return '<div class="notif">'+
          '<div class="nicon '+(like ? "heart" : "bubble")+'">'+(like ? ACT_H : ACT_B)+'</div>'+
          '<div class="grow"><div class="ntext">'+txt+' <span class="nt">'+esc(fmtTime(r.created_at))+'</span></div></div>'+
        '</div>';
      }).join("")
    : '<div class="emptynote">Ingen aktivitet endnu.</div>';
}

/* ---- Slet konto (popup) ---- */
export function resetDeleteUI(){
  el("delmodal").classList.remove("on");
  el("del-input").value = "";
  el("del-btn").disabled = true;
}

/* ================= Ven-profil (og ikke-ven-profil) ================= */
function pvIsFriend(h){
  return !!(me && (h === me.handle || h === OFFICIAL_HANDLE || state.friends.indexOf(h) >= 0));
}
/* Relations-linjen: venner (og botten) ser "I din kreds siden …";
   ikke-venner ser en rød "Tilføj til din kreds"-chip i stedet */
function renderPvRelation(h){
  const since = el("pv-since"), add = el("pv-add");
  if(pvIsFriend(h)){
    since.style.display = "";
    since.textContent = "I din kreds siden "+(FRIEND_SINCE[h] || user(h).since || "i dag")+" · Gensidig ven";
    add.style.display = "none";
  } else {
    since.style.display = "none";
    add.style.display = "";
    add.disabled = false;
    add.classList.remove("done");
    add.textContent = "Tilføj til din kreds";
  }
}
function pvEmptyNote(h){
  return '<div class="emptynote">'+(pvIsFriend(h) ? "Ingen opslag endnu." : "Bliv venner for at se opslag")+'</div>';
}
export async function openProfile(h){
  if(!user(h).id){
    // Ikke-ven: profilen er måske ikke registreret endnu — hent den på handle
    const r = await sb.from("profiles").select("*").eq("handle", h).maybeSingle();
    if(r.error) console.error(r.error);
    if(r.data) registerProfile(r.data);
  }
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
  el("pv-stat-kredse").textContent = "–";
  el("pv-ava").innerHTML = avaHTML(h, 86);
  renderPvRelation(h);
  /* "Se aktivitet" — skjules på egen profil og for den officielle bot */
  const act = el("pv-act");
  act.style.display = (me && h !== me.handle && h !== OFFICIAL_HANDLE) ? "" : "none";
  act.disabled = false;
  el("pv-posts").innerHTML = '<div class="emptynote">Henter …</div>';
  el("pv-body").scrollTop = 0;
  el("profileview").classList.add("on");
  sb.rpc("friends_count_of", { u: u.id }).then(function(r){
    if(pv.u !== h) return;
    if(r.error){ console.error(r.error); return; }
    if(r.data != null) el("pv-stat-friends").textContent = r.data;
  });
  sb.rpc("kreds_count_of", { u: u.id }).then(function(r){
    if(pv.u !== h) return;
    if(r.error){ console.error(r.error); return; }
    if(r.data != null) el("pv-stat-kredse").textContent = r.data;
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
  const vsnap = snapVideos(el("pv-posts"));
  el("pv-posts").innerHTML = pv.posts.length
    ? pv.posts.map(postHTML).join("")
    : pvEmptyNote(h); // RLS giver tom liste for ikke-venner
  restoreVideos(el("pv-posts"), vsnap);
}
export function closeProfile(){
  el("profileview").classList.remove("on");
}
export function refreshPv(){
  if(pv.u && el("profileview").classList.contains("on")){
    el("pv-count").textContent = pv.posts.length + " opslag";
    el("pv-stat-posts").textContent = pv.posts.length;
    const vsnap = snapVideos(el("pv-posts"));
    el("pv-posts").innerHTML = pv.posts.length
      ? pv.posts.map(postHTML).join("")
      : pvEmptyNote(pv.u);
    restoreVideos(el("pv-posts"), vsnap);
    el("pv-ava").innerHTML = avaHTML(pv.u, 86);
  }
}

export function initProfile(){
el("editprof").addEventListener("click", function(){
  if(!me) return;
  el("ep-name").value = me.name || "";
  el("ep-bio").value = me.bio || "";
  el("ep-share").checked = me.show_activity !== false;
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
  const share = el("ep-share").checked;
  if(!name || !me) return;
  this.disabled = true;
  const { error } = await sb.from("profiles").update({ name:name, bio: bio || null, show_activity: share }).eq("id", me.id);
  this.disabled = false;
  if(error){
    console.error(error);
    toast(String(error.message || "").indexOf("blocked_content") >= 0 ? BLOCKED_MSG : GENERIC_ERR);
    return;
  }
  me.name = name;
  me.bio = bio || null;
  me.show_activity = share;
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
    nativeLogout(); // tilbagekald device-token + besked til appen FØR sessionen ryddes
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
  nativeLogout(); // tilbagekald device-token + besked til appen FØR sessionen ryddes
  const { error } = await sb.auth.signOut();
  if(error){ console.error(error); toast(GENERIC_ERR); }
});
el("pv-back").addEventListener("click", closeProfile);
/* ---- "Se aktivitet": samtykke-tjek via RPC, derefter fladt bottom sheet ---- */
el("pv-act").addEventListener("click", async function(){
  const h = pv.u;
  if(!me || !h || this.disabled) return;
  const u = user(h);
  if(!u.id) return;
  const btn = this;
  btn.disabled = true;
  const { data, error } = await sb.rpc("activity_allowed", { u: u.id });
  btn.disabled = false;
  if(error){ console.error(error); toast(GENERIC_ERR); return; }
  if(data === "self_off"){ toast("Slå “Del min aktivitet” til for at se andres."); return; }
  if(data === "target_off"){ toast(u.name + " deler ikke sin aktivitet."); return; }
  if(data !== "ok"){ toast(GENERIC_ERR); return; }
  if(pv.u !== h) return;
  openActivitySheet(h);
});
/* ---- Ikke-ven: "Tilføj til din kreds" (optimistisk ✓, derefter refetch) ---- */
el("pv-add").addEventListener("click", async function(){
  const h = pv.u;
  if(!me || !h || this.disabled) return;
  const btn = this;
  btn.disabled = true;
  btn.classList.add("done");
  btn.textContent = "I din kreds ✓";
  const { data, error } = await sb.rpc("add_friend", { friend_handle: h });
  if(error){
    console.error(error);
    if(pv.u === h){
      btn.disabled = false;
      btn.classList.remove("done");
      btn.textContent = "Tilføj til din kreds";
    }
    const m = String(error.message || "");
    if(m.indexOf("not_found") >= 0) toast("Ingen bruger med det navn");
    else if(m.indexOf("self") >= 0) toast("Det er dig selv 😄");
    else toast(GENERIC_ERR);
    return;
  }
  if(data) registerProfile(data);
  await loadFriends();
  refreshSearchAfterFriendAdd(h); // Søg-listen bag panelet: fjern stale "Tilføj …"-knap og vis den nye ven
  renderStories();
  loadPosts();
  if(pv.u === h){
    renderPvRelation(h); // nu ven: viser "I din kreds siden …"
    loadPvPosts();       // RLS åbner for opslagene
  }
  toast(user(h).name + " er nu i din kreds");
});
/* ================= Bobler: klik ================= */
el("stories").addEventListener("click", function(e){
  const s = e.target.closest(".story");
  if(!s) return;
  if(s.dataset.me){ openCompose(); return; }
  openProfile(s.dataset.u);
});
}
