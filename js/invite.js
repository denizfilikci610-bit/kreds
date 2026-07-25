import { me } from "./store.js";
import { el, user, toast } from "./helpers.js";
import { t } from "./i18n.js";

/* ================= Inviter venner =================
   En ny bruger lander i et tomt feed: uden venner er der intet at se og ingen grund til
   at komme igen. Derfor spørges der ÉN gang lige efter oprettelse, om man vil sende et
   link til sine folk, og den samme knap bliver liggende på profilen, så man kan gøre det
   senere når man kommer i tanke om nogen.

   Delingen går gennem iOS' eget delingsark (navigator.share): brugeren vælger selv
   modtageren i SMS, WhatsApp eller hvad de nu bruger. Vi rører ALDRIG kontakterne — det
   ville kræve en ny tilladelse, en ny binær og et nyt App Review, og det er ikke besværet
   værd for noget systemarket allerede gør bedre. */

/* Uden landekode: Apple sender selv modtageren til deres egen butik. Det betyder noget,
   når appen findes på 32 sprog. */
export const APPSTORE_URL = "https://apps.apple.com/app/id6789519264";

/* Afsenderen SKAL med i teksten. Uden den ved modtageren hverken hvem der inviterede
   eller hvordan de finder personen igen, og så lander de i et lige så tomt feed. */
function shareText(){
  if(!me) return t("invite.share_plain");
  return t("invite.share_text", { name: user(me.handle).name || me.handle, handle: me.handle });
}
export function shareInvite(){
  const text = shareText();
  if(navigator.share){
    // Skal kaldes i samme klik som brugerens tryk, ellers afviser iOS det
    navigator.share({ title: "VibeFeed", text: text, url: APPSTORE_URL }).catch(function(err){
      // Lukker man bare arket igen, er det ikke en fejl
      if(!err || err.name !== "AbortError"){ console.error(err); toast(t("err.generic")); }
    });
    return;
  }
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text + " " + APPSTORE_URL).then(function(){
      toast(t("invite.copied"));
    }, function(){ toast(t("err.generic")); });
    return;
  }
  toast(t("err.generic"));
}

export function openInviteSheet(){ el("inviteview").classList.add("on"); }
export function closeInviteSheet(){ el("inviteview").classList.remove("on"); }

/* Vis arket én gang for en NY bruger. To betingelser, så en gammel bruger der logger ind
   på en ny telefon ikke bliver mødt af det: profilen skal være oprettet inden for det
   seneste døgn, OG arket må ikke være vist på denne enhed før. Mærket sættes FØR arket
   åbnes, så et afbrudt boot ikke kan vise det to gange. */
const SEEN_KEY = "vf_invite_seen";
export function maybeShowInviteSheet(){
  if(!me || !me.created_at) return;
  if(Date.now() - new Date(me.created_at).getTime() > 24 * 60 * 60 * 1000) return;
  const key = SEEN_KEY + "_" + me.id;
  try{
    if(localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
  }catch(_e){ /* uden localStorage vises det bare hver gang — bedre end aldrig */ }
  openInviteSheet();
}

export function initInvite(){
  el("invite-send").addEventListener("click", function(){
    closeInviteSheet();
    shareInvite(); // stadig inde i klikket, så delingsarket får lov at åbne
  });
  el("invite-later").addEventListener("click", closeInviteSheet);
  el("inviteview").addEventListener("click", function(e){
    if(e.target === el("inviteview")) closeInviteSheet(); // tryk uden for arket lukker
  });
}
