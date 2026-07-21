import { sb } from "./config.js";
import { me, state } from "./store.js";
import { el, esc, imgUrl, avaHTML, registerProfile, toast } from "./helpers.js";
import { t } from "./i18n.js";
import { renderStories } from "./profile.js";

/* ================= Stories: data ================= */
/* Hent stories (RLS-filtreret: egen, venner uden kreds, eller kredse man er medlem af) +
   min set-status, grupperet pr. forfatter. Fylder state.storyGroups; rækken tegnes af renderStories. */
export async function loadStories(){
  if(!me){ state.storyGroups = []; return; }
  const { data: rows, error } = await sb.from("stories")
    .select("id, author, image_path, video_path, created_at, profiles!stories_author_fkey(handle, name, avatar_path)")
    .order("created_at", { ascending: true });
  if(error || !rows){ state.storyGroups = []; return; }
  const seenSet = new Set();
  try{
    const { data: seen } = await sb.from("story_views").select("story_id");
    (seen || []).forEach(function(v){ seenSet.add(v.story_id); });
  }catch(_e){}
  const byAuthor = new Map();
  rows.forEach(function(r){
    const p = r.profiles || {};
    if(p.handle) registerProfile({ id: r.author, handle: p.handle, name: p.name, avatar_path: p.avatar_path });
    if(!byAuthor.has(r.author)){
      byAuthor.set(r.author, {
        author: { id: r.author, handle: p.handle || "", name: p.name || "", avatar_path: p.avatar_path || null },
        items: [], isMe: r.author === me.id
      });
    }
    const isVideo = !!r.video_path;
    byAuthor.get(r.author).items.push({
      id: r.id, url: imgUrl(isVideo ? r.video_path : r.image_path), isVideo: isVideo,
      path: isVideo ? r.video_path : r.image_path, // rå sti (storage-oprydning ved sletning)
      seen: seenSet.has(r.id)
    });
  });
  const groups = Array.from(byAuthor.values());
  groups.forEach(function(g){ g.allSeen = g.items.every(function(i){ return i.seen; }); });
  groups.sort(function(a, b){
    if(a.isMe !== b.isMe) return a.isMe ? -1 : 1;        // egen først
    return (a.allSeen ? 1 : 0) - (b.allSeen ? 1 : 0);    // uset før set
  });
  state.storyGroups = groups;
  renderStories();
}

/* ================= Stories: fuldskærms-viewer ================= */
const vw = { groups: [], gi: 0, ii: 0, timer: null };

export function openStoryViewer(handle){
  const groups = state.storyGroups || [];
  const gi = groups.findIndex(function(g){ return g.author.handle === handle; });
  if(gi < 0 || !groups[gi].items.length) return;
  vw.groups = groups; vw.gi = gi; vw.ii = 0;
  el("storyview").classList.add("on");
  document.body.classList.add("lb-lock");
  showItem();
}

function clearTimer(){ if(vw.timer){ clearTimeout(vw.timer); vw.timer = null; } }

function showItem(){
  clearTimer();
  const g = vw.groups[vw.gi];
  if(!g){ closeStoryViewer(); return; }
  const it = g.items[vw.ii];
  if(!it){ gotoGroup(vw.gi + 1); return; }
  const bars = g.items.map(function(_it, i){
    const cls = i < vw.ii ? "done" : (i === vw.ii ? "active" : "");
    return '<div class="sv-bar ' + cls + '"><i></i></div>';
  }).join("");
  const media = it.isVideo
    ? '<video src="' + esc(it.url) + '" playsinline autoplay></video>'
    : '<img src="' + esc(it.url) + '" alt="">';
  el("storyview").innerHTML =
    '<div class="sv-media">' + media + '</div>' +
    '<div class="sv-bars">' + bars + '</div>' +
    '<div class="sv-head">' +
      '<span class="sv-ava">' + avaHTML(g.author.handle, 30) + '</span>' +
      '<span class="sv-name">' + esc(g.author.name || g.author.handle) + '</span>' +
      (g.isMe
        ? '<button class="sv-del" data-sv="del" aria-label="' + esc(t("story.delete")) + '">' +
            '<svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4.5 6.5h15M9.5 6V4.5h5V6M6.5 6.5l1 13h9l1-13M10 10.5v6M14 10.5v6"/></g></svg>' +
          '</button>'
        : '') +
      '<button class="sv-close" data-sv="close" aria-label="Luk">✕</button>' +
    '</div>' +
    '<button class="sv-tap sv-left" data-sv="prev" aria-label="Forrige"></button>' +
    '<button class="sv-tap sv-right" data-sv="next" aria-label="Næste"></button>';
  markSeen(it);
  vw.timer = setTimeout(next, 6000);   // 6 sek pr. story (billede + video)
}

function next(){
  const g = vw.groups[vw.gi];
  if(g && vw.ii < g.items.length - 1){ vw.ii++; showItem(); }
  else gotoGroup(vw.gi + 1);
}
function prev(){
  if(vw.ii > 0){ vw.ii--; showItem(); }
  else gotoGroup(vw.gi - 1, true);
}
function gotoGroup(gi, last){
  if(gi < 0){ vw.ii = 0; showItem(); return; }
  if(gi >= vw.groups.length){ closeStoryViewer(); return; }
  vw.gi = gi;
  vw.ii = last ? Math.max(0, vw.groups[gi].items.length - 1) : 0;
  showItem();
}

export function closeStoryViewer(){
  clearTimer();
  el("storyview").classList.remove("on");
  el("storyview").innerHTML = "";
  document.body.classList.remove("lb-lock");
  renderStories();   // opdater ringene (set-status)
}

async function markSeen(it){
  if(it.seen) return;
  it.seen = true;
  const g = vw.groups[vw.gi];
  if(g) g.allSeen = g.items.every(function(x){ return x.seen; });
  try{
    await sb.from("story_views").upsert({ story_id: it.id, viewer: me.id }, { onConflict: "story_id,viewer", ignoreDuplicates: true });
  }catch(_e){}
}

/* Slet den viste story (kun egne — RLS håndhæver det også). To-trins: første tryk
   armerer knappen ("Slet?") og sætter fremdriften på pause, andet tryk sletter. */
async function deleteCurrentStory(){
  const g = vw.groups[vw.gi];
  const it = g && g.items[vw.ii];
  if(!g || !it || !g.isMe) return;
  clearTimer();
  const { error } = await sb.from("stories").delete().eq("id", it.id);
  if(error){ console.error(error); toast(t("err.generic")); showItem(); return; }
  if(it.path) sb.storage.from("post-images").remove([it.path]).catch(function(){});
  g.items.splice(vw.ii, 1);
  toast(t("story.deleted"));
  if(!g.items.length){
    vw.groups.splice(vw.gi, 1);
    if(!vw.groups.length){ closeStoryViewer(); loadStories().then(renderStories); return; }
    if(vw.gi >= vw.groups.length) vw.gi = vw.groups.length - 1;
    vw.ii = 0;
  } else if(vw.ii >= g.items.length){
    vw.ii = g.items.length - 1;
  }
  showItem();
  loadStories().then(renderStories); // rækken/ringene opdateres i baggrunden
}

export function initStories(){
  el("storyview").addEventListener("click", function(e){
    const b = e.target.closest("[data-sv]");
    if(!b) return;
    const a = b.dataset.sv;
    if(a === "close") closeStoryViewer();
    else if(a === "next") next();
    else if(a === "prev") prev();
    else if(a === "del"){
      if(!b.classList.contains("arm")){
        b.classList.add("arm");
        b.textContent = t("story.del_confirm");
        clearTimer(); // stå stille mens man beslutter sig
        const v = el("storyview").querySelector("video");
        if(v) v.pause();
        return;
      }
      deleteCurrentStory();
    }
  });
}
