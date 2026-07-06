import { sb, GENERIC_ERR } from "./config.js";
import { me } from "./store.js";
import { el, esc, avaHTML, user, fmtTime, toast, registerProfile } from "./helpers.js";
import { scheduleRefetch } from "./realtime.js";

/* ================= Notifikationer ================= */
export async function loadNotifs(){
  if(!me) return;
  el("notifs").innerHTML = '<div class="emptynote">Henter …</div>';
  const H = '<svg viewBox="0 0 24 24"><path class="stroke" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
  const B = '<svg viewBox="0 0 24 24"><path class="stroke" d="M12 3.3a8.7 8.7 0 0 0-7.4 13.2L3.4 20.6l4.2-1.1A8.7 8.7 0 1 0 12 3.3Z"/></svg>';
  const P = '<svg viewBox="0 0 24 24"><g class="stroke"><circle cx="10" cy="8" r="3.4"/><path d="M3.8 19.5c.7-3.3 3.2-5 6.2-5s5.5 1.7 6.2 5"/><path d="M18.5 6.5v6M15.5 9.5h6"/></g></svg>';
  function row(icon, cls, u, text, snip, t){
    return '<div class="notif">'+
      avaHTML(u, 32)+
      '<div class="grow">'+
        '<div class="ntext"><b>'+esc(user(u).name)+'</b> '+text+'. <span class="nt">'+esc(t)+'</span></div>'+
        (snip ? '<div class="nsnip">'+esc(snip)+'</div>' : '')+
      '</div>'+
      '<div class="nicon '+cls+'">'+icon+'</div>'+
    '</div>';
  }
  /* Anmodning om at være med i en af mine kredse (kun kreds-ejeren ser disse rækker) */
  function kreqRow(n){
    return '<div class="notif kreq" data-f="'+esc(n.f)+'" data-uid="'+esc(n.uid)+'" data-n="'+esc(user(n.u).name)+'" data-k="'+esc(n.k)+'">'+
      avaHTML(n.u, 32)+
      '<div class="grow">'+
        '<div class="ntext"><b>'+esc(user(n.u).name)+'</b> vil være med i “'+esc(n.k)+'”. <span class="nt">'+esc(fmtTime(n.at))+'</span></div>'+
        '<div class="kbtns">'+
          '<button class="kbtn kap">Godkend</button>'+
          '<button class="kbtn krej">Afvis</button>'+
        '</div>'+
      '</div>'+
    '</div>';
  }
  try{
    const mine = await sb.from("posts").select("id, text, image_path").eq("author", me.id);
    if(mine.error) throw mine.error;
    const ids = (mine.data || []).map(function(p){ return p.id; });
    const textById = {};
    (mine.data || []).forEach(function(p){ textById[p.id] = p.text || (p.image_path ? "📷 Billede" : ""); });

    const reqs = [
      sb.from("friendships").select("created_at, from_profile:profiles!user_id(*)").eq("friend_id", me.id),
      sb.from("kreds_requests").select("created_at, feed_id, user_id, requester:profiles!user_id(*), feed:feeds!feed_id(name)").neq("user_id", me.id)
    ];
    if(ids.length){
      reqs.push(sb.from("likes").select("created_at, post_id, liker:profiles!user_id(*)").in("post_id", ids).neq("user_id", me.id));
      reqs.push(sb.from("comments").select("created_at, post_id, text, image_path, author_profile:profiles!author(*)").in("post_id", ids).neq("author", me.id));
    }
    const res = await Promise.all(reqs);
    for(const r of res){ if(r.error) throw r.error; }

    const items = [];
    (res[0].data || []).forEach(function(r){
      if(r.from_profile){ registerProfile(r.from_profile); items.push({ type:"friend", u:r.from_profile.handle, at:r.created_at }); }
    });
    (res[1].data || []).forEach(function(r){
      if(r.requester){
        registerProfile(r.requester);
        items.push({ type:"kreq", u:r.requester.handle, at:r.created_at, f:r.feed_id, uid:r.user_id, k:(r.feed && r.feed.name) || "" });
      }
    });
    if(ids.length){
      (res[2].data || []).forEach(function(r){
        if(r.liker){ registerProfile(r.liker); items.push({ type:"like", u:r.liker.handle, at:r.created_at, snip:textById[r.post_id] || "" }); }
      });
      (res[3].data || []).forEach(function(r){
        if(r.author_profile){ registerProfile(r.author_profile); items.push({ type:"cmt", u:r.author_profile.handle, at:r.created_at, snip:r.text || (r.image_path ? "📷 Billede" : "") }); }
      });
    }
    items.sort(function(a,b){ return new Date(b.at) - new Date(a.at); });
    const top = items.slice(0, 30);
    el("notifs").innerHTML = top.length
      ? top.map(function(n){
          if(n.type === "like")   return row(H, "heart",  n.u, "likede dit opslag", n.snip, fmtTime(n.at));
          if(n.type === "cmt")    return row(B, "bubble", n.u, "svarede på dit opslag",  n.snip, fmtTime(n.at));
          if(n.type === "kreq")   return kreqRow(n);
          return row(P, "friend", n.u, "er nu i din kreds", "", fmtTime(n.at));
        }).join("")
      : '<div class="emptynote">Ingen notifikationer endnu.</div>';
  }catch(err){
    console.error(err);
    el("notifs").innerHTML = '<div class="emptynote">Kunne ikke hente notifikationer. Prøv igen.</div>';
  }
}

/* ---- Godkend/afvis kreds-anmodning (kun ejeren ser knapperne) ---- */
async function notifClick(e){
  const b = e.target.closest(".kap, .krej");
  if(!b || b.disabled || !me) return;
  const row = b.closest(".notif");
  if(!row || !row.dataset.f) return;
  const approve = b.classList.contains("kap");
  row.querySelectorAll(".kbtn").forEach(function(x){ x.disabled = true; });
  const { error } = await sb.rpc(approve ? "approve_kreds_request" : "reject_kreds_request", { f: row.dataset.f, u: row.dataset.uid });
  if(error){
    console.error(error);
    if(String(error.message || "").indexOf("no_request") >= 0){
      row.remove();
      if(!el("notifs").querySelector(".notif, .emptynote"))
        el("notifs").innerHTML = '<div class="emptynote">Ingen notifikationer endnu.</div>';
      toast("Anmodningen findes ikke længere");
      return;
    }
    row.querySelectorAll(".kbtn").forEach(function(x){ x.disabled = false; });
    toast(GENERIC_ERR);
    return;
  }
  row.remove();
  if(!el("notifs").querySelector(".notif, .emptynote"))
    el("notifs").innerHTML = '<div class="emptynote">Ingen notifikationer endnu.</div>';
  toast(approve ? row.dataset.n + " er nu med i " + row.dataset.k : "Anmodning afvist");
  if(approve) scheduleRefetch(); // medlemslisten i kredshead/compose skal med
}

export function initNotifs(){
  el("notifs").addEventListener("click", notifClick);
}
