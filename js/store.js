/* ================= Delt tilstand ================= */
/* REGEL: Modulgrafen har import-cyklusser mellem domæne-moduler (fx feed <-> comments,
   auth <-> profile). Det er kun sikkert, fordi cross-modul imports udelukkende bruges
   INDE I funktioner — aldrig i top-level initializers. Læs aldrig en importeret
   const/let-binding fra et søskende-modul på top-niveau (TDZ/ReferenceError ved load). */
export let me = null;            // own profile row from DB
export const USERS = {};         // handle -> { name, g:[c1,c2], since, id }
export const ID2H = {};          // uuid -> handle
export const FRIEND_SINCE = {};  // handle -> year friendship started
export function setMe(v){ me = v; }

export const state = {
  friends: [],            // handles
  posts: [],              // posts in current view (view-model shape)
  wholePosts: [],         // whole-kreds posts (feed_id null)
  teasers: [],            // blurred teasers fra private kredse (kreds_teasers-RPC)
  feeds: [],              // { id, name, memberIds:[uuid], members:[handle] }
  currentFeed: "all"
};

export const expandedCmts = new Set();   // post ids med fuldt udfoldet kommentartråd
export const composers = new Map();      // post id -> { text, replyTo:{id,u}|null, img:{blob,url}|null }
export function cstate(pid){
  pid = Number(pid);
  if(!composers.has(pid)) composers.set(pid, { text:"", replyTo:null, img:null });
  return composers.get(pid);
}
export function clearComposers(){
  composers.forEach(function(s){ if(s.img && s.img.url) URL.revokeObjectURL(s.img.url); });
  composers.clear();
}

export const pv = { u:null, posts:[] };

export let curTab = "feed";
export function setCurTab(v){ curTab = v; }

export let cfilePid = null;
export function setCfilePid(v){ cfilePid = v; }
