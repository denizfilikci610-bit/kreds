import { sb } from "./config.js";
import { me, state, ID2H } from "./store.js";
import { el, esc, avaHTML, user, toast, fmtTime, imgUrl, registerProfile } from "./helpers.js";
import { t } from "./i18n.js";
import { feedById, findPost, postQuery, mapPost, switchTab } from "./feed.js";
import { openPostView, openProfile, closeProfile } from "./profile.js";

/* ================= Kreds-chat (Messenger-agtig: hver kreds er en gruppetråd) =================
   Beskeder-fanen (#view-chat) viser en tråd pr. kreds med seneste besked som preview.
   En tråd (#chatview) glider ind fra højre som de andre sider: bobler (egne højre/røde,
   andres venstre m. avatar+navn), composer i bunden. Når et minde postes i en kreds,
   indsætter DB-triggeren automatisk en delings-besked (post_id) — den vises med en
   miniature af billedet og åbner opslaget ved tap. Realtime-INSERTs appendes live. */

const MSG_SELECT = "*, author_profile:profiles!author(*), post:posts(id, image_path, video_path)";

let chatFeed = null;   // åben tråds feed_id (null = lukket)
let msgs = [];         // den åbne tråds beskeder (ældste først)
let lastByFeed = {};   // feed_id -> seneste besked (listens previews)
let chatSeq = 0;       // supersession: kun nyeste åbning må skrive tråden

function mapMsg(r){
  if(r.author_profile) registerProfile(r.author_profile);
  const post = r.post || null;
  return {
    id: r.id,
    feed: r.feed_id,
    u: r.author_profile ? r.author_profile.handle : (ID2H[r.author] || "?"),
    authorId: r.author,
    text: r.text || "",
    postId: r.post_id || null,
    thumb: post && post.image_path ? imgUrl(post.image_path) : "",
    thumbVideo: post && !post.image_path && post.video_path ? imgUrl(post.video_path) : "",
    t: fmtTime(r.created_at),
    created: r.created_at
  };
}

/* ---- Beskeder-fanen: én række pr. kreds, nyeste aktivitet øverst ---- */
export async function renderChatList(fetchLasts){
  if(!me) return;
  const box = el("chat-list");
  if(!state.feeds.length){
    box.innerHTML = '<div class="emptynote">'+t("chat.empty")+'</div>';
    return;
  }
  if(fetchLasts !== false){
    // Seneste beskeder på tværs (RLS = kun mine kredse); første række pr. kreds er nyeste
    const { data, error } = await sb.from("kreds_messages")
      .select(MSG_SELECT)
      .order("created_at", { ascending: false })
      .limit(120);
    if(error){ console.error(error); }
    else {
      lastByFeed = {};
      (data || []).forEach(function(r){ if(!lastByFeed[r.feed_id]) lastByFeed[r.feed_id] = mapMsg(r); });
    }
  }
  const feeds = state.feeds.slice().sort(function(a, b){
    const ta = lastByFeed[a.id] ? new Date(lastByFeed[a.id].created).getTime() : 0;
    const tb = lastByFeed[b.id] ? new Date(lastByFeed[b.id].created).getTime() : 0;
    if(ta !== tb) return tb - ta;
    return new Date(a.created) - new Date(b.created);
  });
  box.innerHTML = feeds.map(chatRowHTML).join("");
}
const CHAT_KREDS_SVG = '<svg viewBox="0 0 24 24"><circle class="stroke" cx="12" cy="12" r="7.3"/><g class="fillic"><circle cx="12" cy="4.7" r="2.1"/><circle cx="5.7" cy="15.7" r="2.1"/><circle cx="18.3" cy="15.7" r="2.1"/></g></svg>';
function chatRowHTML(f){
  const m = lastByFeed[f.id];
  let prev = t("chat.say_hi");
  if(m){
    const who = (me && m.authorId === me.id) ? t("chat.you") : (user(m.u).name || m.u).split(/\s+/)[0];
    prev = esc(who) + ": " + (m.postId ? "📷 " + t("chat.shared_memory") : esc(m.text));
  }
  return '<button class="chatrow" data-feed="'+esc(f.id)+'">'+
    '<span class="lki">'+CHAT_KREDS_SVG+'</span>'+
    '<span class="lcol">'+
      '<span class="lnm">'+esc(f.name)+'</span>'+
      '<span class="lh">'+prev+'</span>'+
    '</span>'+
    (m ? '<span class="chattime">'+esc(m.t)+'</span>' : '')+
  '</button>';
}

/* ---- Én tråd (fuldskærms-siden #chatview) ---- */
export async function openKredsChat(feedId){
  const f = feedById(feedId);
  if(!f || !me){ toast(t("err.generic")); return; }
  chatFeed = feedId;
  el("cv-title").textContent = f.name;
  el("cv-sub").textContent = f.members.length === 1 ? t("list.member_one") : t("list.member_count", { n: f.members.length });
  el("cv-body").innerHTML = '<div class="emptynote">'+t("common.loading")+'</div>';
  el("chatview").classList.add("on");
  const seq = ++chatSeq;
  const { data, error } = await sb.from("kreds_messages")
    .select(MSG_SELECT)
    .eq("feed_id", feedId)
    .order("created_at", { ascending: true })
    .limit(300);
  if(chatFeed !== feedId || seq !== chatSeq) return; // lukket/skiftet imens
  if(error){
    console.error(error);
    el("cv-body").innerHTML = '<div class="emptynote">'+t("err.generic")+'</div>';
    return;
  }
  msgs = (data || []).map(mapMsg);
  renderThread(true);
}
export function closeKredsChat(){
  chatFeed = null;
  el("chatview").classList.remove("on");
  el("cv-body").innerHTML = "";
}
export function resetChat(){
  closeKredsChat();
  msgs = [];
  lastByFeed = {};
  el("chat-list").innerHTML = "";
  el("cv-input").value = "";
}

function renderThread(scrollBottom){
  const box = el("cv-body");
  box.innerHTML = msgs.length
    ? msgs.map(msgHTML).join("")
    : '<div class="emptynote">'+t("chat.no_messages")+'</div>';
  if(scrollBottom) box.scrollTop = box.scrollHeight;
}
function msgHTML(m){
  const mine = !!(me && m.authorId === me.id);
  const share = m.postId
    ? '<button class="cv-share" data-post="'+esc(m.postId)+'">'+
        (m.thumb ? '<img class="cv-thumb" src="'+esc(m.thumb)+'" alt="">'
         : m.thumbVideo ? '<video class="cv-thumb" src="'+esc(m.thumbVideo)+'#t=0.1" muted playsinline preload="metadata"></video>'
         : '')+
        '<span class="cv-sharetxt">'+t("chat.shared_memory")+'</span>'+
      '</button>'
    : '';
  return '<div class="cv-msg'+(mine ? " mine" : "")+'" data-mid="'+esc(m.id)+'">'+
    (mine ? '' : '<button class="pavab cv-ava" data-u="'+esc(m.u)+'" aria-label="'+t("aria.profile")+'">'+avaHTML(m.u, 28)+'</button>')+
    '<div class="cv-col">'+
      (mine ? '' : '<span class="cv-nm">'+esc(user(m.u).name)+'</span>')+
      '<div class="cv-bubble">'+share+(m.text ? '<span class="cv-text">'+esc(m.text)+'</span>' : '')+'</div>'+
      '<span class="cv-time">'+esc(m.t)+'</span>'+
    '</div>'+
  '</div>';
}

async function sendChatMsg(){
  if(!me || chatFeed == null) return;
  const inp = el("cv-input");
  const text = inp.value.trim();
  if(!text) return;
  inp.value = "";
  const feedId = chatFeed;
  // Optimistisk: vis beskeden med det samme, byt til den rigtige række fra serveren
  const temp = { id: "tmp-" + Date.now(), feed: feedId, u: me.handle, authorId: me.id,
                 text: text, postId: null, thumb: "", thumbVideo: "",
                 t: fmtTime(new Date().toISOString()), created: new Date().toISOString() };
  msgs.push(temp);
  renderThread(true);
  const { data, error } = await sb.from("kreds_messages")
    .insert({ feed_id: feedId, author: me.id, text: text })
    .select(MSG_SELECT)
    .single();
  if(chatFeed !== feedId) return; // tråden blev lukket/skiftet imens
  msgs = msgs.filter(function(x){ return x.id !== temp.id; });
  if(error){
    console.error(error);
    renderThread(false);
    inp.value = text; // giv teksten tilbage, så intet mistes
    toast(t("err.generic"));
    return;
  }
  const real = mapMsg(data);
  if(!msgs.some(function(x){ return x.id === real.id; })) msgs.push(real);
  lastByFeed[feedId] = real;
  renderThread(true);
}

/* Delings-besked → åbn selve opslaget (hent det hvis det ikke er i de lokale arrays) */
async function openSharedPost(pid){
  let p = findPost(pid);
  if(!p){
    const { data, error } = await postQuery().eq("id", Number(pid));
    if(error || !data || !data.length){ toast(t("notif.post_gone")); return; }
    p = mapPost(data[0]);
  }
  openPostView(p); // minde-siden (z-90) lægger sig OVER chatten (z-85)
}

/* Realtime-INSERT: hent den fulde række (payload har ingen joins; RLS afgør synlighed) */
export function chatRealtime(payload){
  if(!me || !payload || payload.eventType !== "INSERT") return;
  const row = payload.new;
  if(!row || !row.id) return;
  sb.from("kreds_messages").select(MSG_SELECT).eq("id", row.id).maybeSingle().then(function(r){
    if(r.error || !r.data) return;
    const m = mapMsg(r.data);
    lastByFeed[m.feed] = m;
    if(el("view-chat").classList.contains("active")) renderChatList(false);
    if(chatFeed === m.feed && el("chatview").classList.contains("on")){
      if(!msgs.some(function(x){ return x.id === m.id; })){
        msgs.push(m);
        renderThread(true);
      }
    }
  }, function(){});
}

export function initChat(){
  el("cv-back").addEventListener("click", closeKredsChat);
  el("cv-send").addEventListener("click", sendChatMsg);
  el("cv-input").addEventListener("keydown", function(e){
    if(e.key === "Enter" && !e.isComposing) sendChatMsg();
  });
  el("chat-list").addEventListener("click", function(e){
    const r = e.target.closest(".chatrow");
    if(r) openKredsChat(r.dataset.feed);
  });
  el("cv-body").addEventListener("click", function(e){
    const sh = e.target.closest(".cv-share");
    if(sh){ openSharedPost(sh.dataset.post); return; }
    const av = e.target.closest(".pavab");
    if(av && av.dataset.u){
      // Profilen (z-70) ligger UNDER chatten (z-85) — luk tråden først
      closeKredsChat();
      if(me && av.dataset.u === me.handle){ closeProfile(); switchTab("profil"); }
      else openProfile(av.dataset.u);
    }
  });
}
