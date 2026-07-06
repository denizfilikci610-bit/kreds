import { sb } from "./config.js";
import { USERS, ID2H } from "./store.js";

/* ================= Helpers ================= */
export function esc(s){
  return String(s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
export function el(id){ return document.getElementById(id); }

const FALLBACK = [["#5C7CF0","#8E5CF0"],["#F05C9E","#F08E5C"],["#2EB2A4","#5CCB7A"],["#E0708F","#B84DD6"]];

function fallbackGrad(h){
  let x = 0;
  for(let i = 0; i < h.length; i++) x = (x*31 + h.charCodeAt(i)) >>> 0;
  return FALLBACK[x % FALLBACK.length];
}
export function registerProfile(p){
  if(!p || !p.handle) return;
  let g = [p.color1, p.color2];
  if(!g[0] || !g[1]) g = fallbackGrad(p.handle);
  const prev = USERS[p.handle];
  USERS[p.handle] = {
    name: p.name || p.handle,
    g: g,
    since: p.created_at ? new Date(p.created_at).getFullYear() : "",
    id: p.id,
    avatar_path: p.avatar_path !== undefined ? p.avatar_path : (prev ? prev.avatar_path : null),
    bio: p.bio !== undefined ? p.bio : (prev ? prev.bio : null)
  };
  if(p.id) ID2H[p.id] = p.handle;
}
export function user(h){
  if(!USERS[h]) USERS[h] = { name: h, g: fallbackGrad(h), since: "" };
  return USERS[h];
}
export function grad(h){ const g = user(h).g; return "linear-gradient(140deg,"+g[0]+","+g[1]+")"; }
export function ini(h){
  const n = (user(h).name || h).trim().split(/\s+/);
  const a = (n[0] && n[0][0]) || (h && h[0]) || "?";
  return (a + (n[1] ? n[1][0] : "")).toUpperCase().replace(/[^\p{L}\p{M}\p{N}]/gu, "") || "?";
}
export function avaHTML(h, size, cls){
  const u = user(h);
  const c = "av" + (cls ? " " + cls : "");
  const style = "width:" + size + "px;height:" + size + "px;";
  if(u.avatar_path){
    return '<img class="'+c+'" src="'+esc(imgUrl(u.avatar_path))+'" alt="" style="'+style+'">';
  }
  const fs = Math.max(8, Math.round(size * 0.38));
  return '<span class="'+c+'" style="'+style+'font-size:'+fs+'px;background:'+grad(h)+'">'+ini(h)+'</span>';
}
export function likesLabel(n){ return n + (n === 1 ? " like" : " likes"); }

const MONTHS = ["januar","februar","marts","april","maj","juni","juli","august","september","oktober","november","december"];
export function fmtTime(iso){
  const d = new Date(iso);
  const s = Math.max(0, (Date.now() - d.getTime())/1000);
  if(s < 60) return "nu";
  if(s < 3600) return Math.floor(s/60)+"m";
  if(s < 86400) return Math.floor(s/3600)+"t";
  if(s < 7*86400) return Math.floor(s/86400)+"d";
  return d.getDate()+". "+MONTHS[d.getMonth()];
}
export function imgUrl(path){
  return sb.storage.from("post-images").getPublicUrl(path).data.publicUrl;
}
export function uuid(){
  if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c){
    const r = Math.random()*16|0;
    return (c === "x" ? r : (r&0x3|0x8)).toString(16);
  });
}

export const BADGE = '<svg viewBox="0 0 24 24" aria-label="I din kreds"><circle cx="12" cy="12" r="10" fill="#E0402F"/><path d="M17 9l-6.2 6.2L7 11.4" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
let toastTimer = null;
export function toast(msg){
  const t = el("toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.classList.remove("on"); }, 2100);
}

export const HEART_SVG = '<svg viewBox="0 0 24 24"><path class="stroke" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
