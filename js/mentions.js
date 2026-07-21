import { me, state, USERS } from "./store.js";
import { el, esc, avaHTML, user, ini, imgUrl } from "./helpers.js";
import { findPost, feedById, getEditPid } from "./feed.js";
import { getComposeDest } from "./compose.js";

/* ================= @-mention autocomplete =================
   Ét delt dropdown (fixed, genbruges af alle felter) på tre felt-typer:
   #compose-field (tanke/browser-minde — kandidater følger compose-destinationen),
   #ed-field (redigér opslag) og .cfield (kommentarer; delegeret — felterne genskabes
   ved hver re-render, så AL state bor her i modulet, aldrig i DOM'en).
   Kandidater er rent client-side: venner + kredsens medlemmer (dem der kan SE
   opslaget — databasen notificerer alligevel kun synlige brugere). Valg indsætter
   '@handle ' ved caret og affyrer et input-event, så eksisterende state-håndtering
   (cstate/updateRing) kører uændret. */

/* Tokenet accepterer OGSÅ store bogstaver ("@Anna" — iOS auto-capitalization) og
   matches lowercased mod de altid-lowercase handles (profiles_handle_check). */
const TOKEN_RE = /(^|[^a-zA-Z0-9_.@])@([a-zA-Z0-9_.]{0,20})$/;
let box = null;      // dropdown-elementet (lazy)
let curField = null; // feltet dropdownen er åben for
let tokStart = 0;    // index på '@' i feltets value
let hideTimer = null;

function ensureBox(){
  if(box) return box;
  box = document.createElement("div");
  box.className = "mdrop";
  // pointerdown må KUN holde fokus i feltet (preventDefault mod blur) — selve valget sker
  // på click, så et touch-SCROLL der starter på et item ikke indsætter en forkert mention.
  box.addEventListener("pointerdown", function(e){ e.preventDefault(); });
  box.addEventListener("click", function(e){
    const it = e.target.closest(".mitem");
    if(it) pick(it.dataset.u);
  });
  document.body.appendChild(box);
  return box;
}

function hide(){
  clearTimeout(hideTimer);
  if(box) box.style.display = "none";
  curField = null;
}

/* Hvem kan tagges: venner + medlemmer af destinationens/opslagets kreds (+ opslagets
   forfatter for kommentarer) — aldrig mig selv, kun kendte profiler. */
function candidateHandles(feedId, extra){
  const seen = new Set(), out = [];
  function add(h){
    if(!h || seen.has(h) || (me && h === me.handle)) return;
    if(!USERS[h] || !USERS[h].id) return; // kun rigtige, registrerede profiler
    if((state.blockedIds || []).indexOf(USERS[h].id) >= 0) return; // aldrig blokerede
    seen.add(h);
    out.push(h);
  }
  const f = (feedId && feedId !== "all") ? feedById(feedId) : null;
  if(f && f.members){
    // Rigtig kreds: KUN medlemmer kan se opslaget, så kun de kan tagges. En ven uden for
    // kredsen ville ellers blive foreslået, men DB-triggeren dropper omtalen i stilhed
    // (can_see_post er falsk for ikke-medlemmer), så @navnet forsvandt uden besked.
    f.members.forEach(add);
  } else {
    // Hele kredsen/venne-opslag (eller en kreds vi ikke selv er med i): venner kan se det.
    (state.humanFriends || []).forEach(add);
  }
  (extra || []).forEach(add); // opslagets forfatter kan altid tagges (ser sit eget opslag)
  return out;
}
function candidatesFor(field){
  let feedId = "all";
  const extra = [];
  if(field.id === "compose-field"){
    feedId = getComposeDest();
  } else {
    const pid = field.id === "ed-field" ? getEditPid() : field.dataset.id;
    const p = pid != null ? findPost(pid) : null;
    if(p){
      if(p.feed) feedId = p.feed;
      extra.push(p.u);
    }
  }
  return candidateHandles(feedId, extra);
}
/* Kandidat-kort til de NATIVE felter (minde-caption + kommentar-sheet) — samme
   form som friendCard i kredse.js, så GlassAvatar kan tegne dem direkte. */
export function mentionCards(feedId, extra){
  return candidateHandles(feedId, extra).map(function(h){
    const u = user(h);
    return { handle: h, name: u.name || h,
             avatarUrl: u.avatar_path ? imgUrl(u.avatar_path) : "",
             initials: ini(h), gradient: u.g || [] };
  });
}

function pick(h){
  const field = curField;
  if(!field || !h) return;
  const v = field.value;
  const caret = field.selectionStart != null ? field.selectionStart : v.length;
  const next = v.slice(0, tokStart) + "@" + h + " " + v.slice(caret);
  if(next.length > 280){ hide(); return; } // respekter 280-grænsen — afbryd (rør hverken tekst eller caret)
  field.value = next;
  const pos = Math.min(field.value.length, tokStart + h.length + 2);
  field.focus();
  try{ field.setSelectionRange(pos, pos); }catch(_e){}
  hide();
  field.dispatchEvent(new Event("input", { bubbles: true })); // cstate/updateRing følger med
}

function maybeShow(field){
  if(!me) return hide();
  const caret = field.selectionStart != null ? field.selectionStart : field.value.length;
  const m = TOKEN_RE.exec(field.value.slice(0, caret));
  if(!m) return hide();
  const typed = m[2];
  tokStart = caret - typed.length - 1; // index på '@'
  const q = typed.toLowerCase();
  const hits = candidatesFor(field).filter(function(h){
    return !q || h.indexOf(q) === 0 || (user(h).name || "").toLowerCase().indexOf(q) === 0;
  }).slice(0, 10);
  if(!hits.length) return hide();
  curField = field;
  const b = ensureBox();
  // Vandrette chips (avatar + @navn) — samme udtryk som det native minde-sheets tag-strip
  b.innerHTML = hits.map(function(h){
    return '<button class="mitem" data-u="'+esc(h)+'">'+avaHTML(h, 24)+
      '<span>@'+esc(h)+'</span></button>';
  }).join("");
  b.scrollLeft = 0;
  const r = field.getBoundingClientRect();
  b.style.display = "block";
  b.style.left = Math.max(8, r.left) + "px";
  b.style.width = Math.min(r.width, window.innerWidth - 16) + "px";
  // Strippen ligger OVER feltet (som i minde-sheetet) — dér er tastaturet aldrig i vejen;
  // under feltet kun når feltet står helt i toppen af skærmen
  if(r.top > 56){
    b.style.top = "";
    b.style.bottom = (window.innerHeight - r.top + 6) + "px";
  } else {
    b.style.bottom = "";
    b.style.top = (r.bottom + 6) + "px";
  }
}

function isMentionField(t){
  return t && (t.id === "compose-field" || t.id === "ed-field" ||
    (t.classList && t.classList.contains("cfield")));
}

export function initMentions(){
  document.addEventListener("input", function(e){
    if(isMentionField(e.target)) maybeShow(e.target);
  });
  document.addEventListener("focusout", function(e){
    if(!isMentionField(e.target)) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 150); // pointerdown på et valg når at køre først
  });
  // Scroll/resize flytter feltet under dropdownen — luk frem for at fejlplacere.
  // MEN scroll INDE i selve dropdownen (overflow-y) må selvfølgelig ikke lukke den.
  window.addEventListener("scroll", function(e){
    if(box && e.target instanceof Node && box.contains(e.target)) return;
    hide();
  }, true);
  window.addEventListener("resize", hide);
}
