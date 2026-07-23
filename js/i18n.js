/* ================= i18n =================
   Sprog-lag: t(key, vars) slår op i det aktive sprogs ordbog, falder tilbage
   til engelsk, så dansk og til sidst til selve nøglen. Sproget vælges
   automatisk fra ENHEDENS sprog (navigator.languages) medmindre brugeren
   selv har valgt et (localStorage vf_lang — kun brugerens EGET valg gemmes,
   auto-detektionen gemmes ikke, så et telefon-sprogskifte følger med).
   da+en bor i denne fil; de øvrige 30 sprog bor i js/lang/<kode>.js og
   hentes med dynamisk import ved behov (CSP script-src 'self' tillader det).
   Serverskabt indhold (governance-afstemninger, velkomstopslaget) forbliver
   dansk by design og oversættes IKKE her.
   REGEL: Dette modul må ikke importere andre app-moduler (skal kunne
   importeres af alle uden cyklus-problemer). */

const LS_KEY = "vf_lang";
let lang = "da";
let changeCb = null;

/* Alle understøttede sprog: kode → eget navn (bruges i sprogvælgerne).
   Koderne er også filnavne i js/lang/ (undtagen da/en der bor her). */
export const LANGS = {
  "da": "Dansk", "en": "English", "de": "Deutsch", "fr": "Français",
  "it": "Italiano", "es": "Español", "pt": "Português", "nl": "Nederlands",
  "sv": "Svenska", "no": "Norsk", "fi": "Suomi", "pl": "Polski",
  "cs": "Čeština", "el": "Ελληνικά", "ro": "Română", "ru": "Русский",
  "tr": "Türkçe", "uk": "Українська", "zh-hans": "简体中文", "zh-hant": "繁體中文",
  "ja": "日本語", "ko": "한국어", "hi": "हिन्दी", "id": "Bahasa Indonesia",
  "ms": "Bahasa Melayu", "th": "ไทย", "vi": "Tiếng Việt", "ar": "العربية",
  "he": "עברית", "fa": "فارسی", "af": "Afrikaans", "tl": "Filipino"
};
/* Højre-mod-venstre-sprog: html[dir=rtl] (flex/tekst flipper automatisk) */
const RTL = { "ar": 1, "he": 1, "fa": 1 };

const DA = {
  /* Fælles */
  "common.loading": "Henter …",
  "common.cancel": "Annuller",
  "common.save": "Gem",
  "common.back": "Tilbage",
  "err.generic": "Noget gik galt. Prøv igen.",
  "err.blocked": "Teksten indeholder ord, der ikke er tilladt på VibeFeed.",
  "badge.aria": "I din kreds",
  "img.read_failed": "Kunne ikke læse billedet",

  /* Relativ tid */
  "time.now": "nu",
  "time.m": "m",
  "time.h": "t",
  "time.d": "d",

  /* Pluralisering */
  "likes.one": "1 like",
  "likes.many": "{n} likes",
  "votes.one": "1 stemme",
  "votes.many": "{n} stemmer",

  /* Topbar */
  "nosparkle.aria": "Feed-indstillinger",
  "nosparkle.title": "Altid kronologisk",
  "nosparkle.toast": "Ingen algoritme her. Feedet er altid kronologisk.",

  /* Feed */
  "caughtup.title": "Du er helt opdateret",
  "caughtup.sub": "Alle opslag fra din kreds — nyeste øverst, altid.",
  "feed.empty_friends": "Din kreds er tom endnu.<br>Find dine venner under Søg 🔍",
  "feed.empty_kreds": "Ingen opslag i denne kreds endnu.<br>Vær den første ✍️",
  "feed.pinned": "📌 Fastgjort",
  "feed.load_failed": "Kunne ikke hente opslag. Prøv igen.",
  "feedbar.all": "Hele kredsen",
  "feedbar.new": "+ Ny kreds",
  "feedbar.seek_aria": "Søg i dine kredse",
  "feedbar.search_ph": "Søg i dine kredse ...",
  "feedbar.cancel_aria": "Annuller søgning",
  "feedbar.no_match": "Ingen kredse matcher",
  "kredshead.aria": "Kredsens medlemmer",
  "kredshead.line": "<b>{n} medlemmer</b><br>Privat kreds. Kun jer kan se og skrive her.",
  "aria.profile": "Profil",
  "aria.more": "Mere",
  "aria.comments": "Kommentarer",
  "aria.like": "Like",
  "aria.share": "Del",
  "aria.save": "Gem",
  "save.saved": "Gemt",
  "save.removed": "Fjernet fra gemte",
  "save.empty": "Du har ikke gemt noget endnu. Tryk på bogmærket på et minde.",
  "prof.saved": "Gemte",
  "media.image": "Billede",
  "share.private": "Privat kreds — ingen deling udenfor 🤫",
  "share.byline": "{name} på VibeFeed",
  "share.copied": "Kopieret til udklipsholderen",
  "post.updated": "Opslaget er opdateret",
  "post.deleted": "Opslaget er slettet",
  "post.delete_failed": "Kunne ikke slette opslaget. Prøv igen.",
  "post.new": "NY",
  "report.reported": "Anmeldt · skjult for dig",
  "report.undo": "Fortryd",
  "report.undone": "Anmeldelse trukket tilbage",

  /* Tabbar */
  "tab.home": "Hjem",
  "tab.search": "Søg",
  "tab.compose": "Nyt opslag",
  "tab.notifs": "Notifikationer",

  /* Egen profil */
  "stats.posts": "Opslag",
  "stats.friends": "Venner",
  "stats.kredse": "Kredse",
  "profile.edit": "Rediger profil",
  "profile.logout": "Log ud",
  "profile.myposts": "Dine opslag",
  "profile.you": "Dig",
  "myposts.empty": "Du har ikke delt noget endnu. Tryk på + og del et billede eller en tanke.",
  "profile.updated": "Profil opdateret",
  "avatar.updated": "Profilbillede opdateret",
  "avatar.failed": "Kunne ikke opdatere profilbilledet. Prøv igen.",
  "account.deleted": "Din konto er slettet",
  "account.delete_failed": "Kunne ikke slette kontoen. Prøv igen.",

  /* Ven-profil */
  "pv.add": "Tilføj til din kreds",
  "pv.added": "I din kreds ✓",
  "pv.requested": "Anmodning sendt",
  "pv.since": "I din kreds siden {year} · Gensidig ven",
  "pv.today": "i dag",
  "pv.empty_friend": "Ingen opslag endnu.",
  "pv.empty_stranger": "Bliv venner for at se opslag",
  "pv.not_found": "Kunne ikke finde profilen",
  "pv.count": "{n} opslag",
  "pv.act": "Se aktivitet",
  "pv.remove": "Fjern ven",
  "pv.remove_confirm": "Fjern {name} som ven?",

  /* Aktivitet */
  "act.title": "{name}s aktivitet",
  "act.liked": "Likede {name}s opslag",
  "act.commented": "Kommenterede hos {name}",
  "act.empty": "Ingen aktivitet endnu.",
  "act.load_failed": "Kunne ikke hente aktiviteten. Prøv igen.",
  "act.self_off": "Slå “Del min aktivitet” til for at se andres.",
  "act.target_off": "{name} deler ikke sin aktivitet.",

  /* Venner */
  "friend.not_found": "Ingen bruger med det navn",
  "friend.self": "Det er dig selv 😄",
  "friend.added": "{name} er nu i din kreds",
  "friend.request_sent": "Anmodning sendt til {name}",
  "friend.request_cancelled": "Anmodning trukket tilbage",
  "friend.req_declined": "Anmodning afvist",
  "friend.removed": "{name} er fjernet som ven",

  /* Søg */
  "search.ph": "Søg i din kreds",
  "search.section": "Din kreds",
  "search.add": "Tilføj @{h} til din kreds",
  "search.requested": "Anmodning sendt",
  "search.no_match": "Ingen i din kreds matcher.",
  "search.empty": "Din kreds er tom endnu. Søg efter dine venner her 🔍",

  /* Beskeder (kreds-chat) */
  "chat.title": "Beskeder",
  "chat.empty": "Ingen kredse endnu. Opret en kreds, så får I en tråd her.",
  "chat.no_messages": "Ingen beskeder endnu. Sig hej 👋",
  "chat.ph": "Skriv en besked ...",
  "chat.send": "Send",
  "chat.shared_memory": "delte et minde",
  "chat.you": "Dig",
  "chat.say_hi": "Sig hej 👋",
  "chat.unread": "Ulæste beskeder",
  "chat.read": "Læst",
  "chat.notread": "Ikke læst",
  "chat.replying": "Du svarer på et minde fra {n}",
  "chat.ctx_close": "Fjern",
  "chat.only_two": "Kun jer to",
  "chat.kreds_sub": "Kreds · {n} medlemmer",
  "chat.kreds_sub_one": "Kreds · 1 medlem",
  "chat.menu_reply": "Svar",
  "chat.copy": "Kopiér",
  "chat.copied": "Kopieret",
  "chat.edit": "Rediger",
  "chat.editing": "Du redigerer beskeden",
  "chat.edited": "Redigeret",
  "chat.edit_too_old": "Beskeden er for gammel til at redigere",
  "chat.remove": "Fjern",
  "chat.remove_confirm": "Fjern beskeden for alle?",
  "chat.report": "Anmeld",
  "chat.report_confirm": "Anmeld denne besked?",
  "chat.report_note": "Beskeden skjules for dig med det samme, og anmeldelsen gemmes.",
  "chat.reported": "Beskeden er anmeldt og skjult",
  "chat.replying_to": "Svar til {n}",
  "chat.q_media": "📷 Medie",
  "chat.plus": "Del et minde",
  "chat.media_dm": "Billeder og video deles gennem en kreds. Opret en kreds med jer to og post et minde, så lander det her.",
  "chat.typing": "{n} skriver ...",
  "chat.thread_menu": "Indstillinger",
  "chat.members": "Se medlemmer",
  "chat.pin": "Fastgør",
  "chat.unpin": "Frigør",
  "chat.mute": "Slå lyd fra",
  "chat.unmute": "Slå lyd til",
  "chat.muted_toast": "Tråden er på lydløs",
  "chat.unmuted_toast": "Lyden er slået til igen",
  "chat.seen_by": "Set af",
  "chat.reactions": "Reaktioner",
  "memory.fit": "Tilpas udsnittet",
  "mode.memory": "Minde",
  "mode.story": "Story",
  "story.delete": "Slet story",
  "story.del_confirm": "Slet?",
  "story.deleted": "Storyen er slettet",
  "story.seenby": "Set af {n}",
  "story.noviews": "Ingen har set den endnu",
  "story.one": "Story",
  "story.one_video": "Story med video",
  "story.report": "Anmeld story",
  "story.report_confirm": "Anmeld denne story?",
  "story.reported": "Anmeldt · skjult for dig",
  "chat.mark_unread": "Markér som ulæst",
  "chat.clear_thread": "Ryd chatten",
  "chat.del_thread": "Slet chatten",
  "chat.clear_confirm": "Ryd chatten?",
  "chat.del_confirm": "Slet chatten?",
  "chat.clear_note": "Beskederne skjules kun for dig. De andre beholder deres.",
  "chat.do_clear": "Ryd",
  "chat.do_del": "Slet",
  "chat.search_ph": "Søg",
  "chat.search_msgs": "Beskeder",
  "chat.search_none": "Intet fundet",
  "aria.private_comment": "Kommentér privat",

  /* Notifikationer */
  "notif.liked": "likede dit opslag",
  "notif.commented": "svarede på dit opslag",
  "notif.posted_kreds": "postede i {k}",
  "notif.vote_add": "vil tilføje {name} til {k}",
  "notif.vote_remove": "vil smide {name} ud af {k}",
  "notif.vote_owner": "startede en afstemning om ny ejer i {k}",
  "notif.vote_request": "ønsker at blive lukket ind i {k}",
  "notif.admission_yes": "Tillykke! Du er nu med i <b>{k}</b> 🎉",
  "notif.admission_no_request": "Din anmodning om at være med i <b>{k}</b> gik desværre ikke igennem",
  "notif.admission_no_invite": "Afstemningen om at lukke dig ind i <b>{k}</b> gik desværre ikke igennem",
  "notif.replied": "svarede på din kommentar",
  "notif.liked_comment": "likede din kommentar",
  "notif.mentioned": "nævnte dig",
  "notif.friend": "er nu i din kreds",
  "notif.friend_request": "vil være venner",
  "notif.invited": "har inviteret dig til “{k}”",
  "notif.request": "vil være med i “{k}”",
  "notif.accept": "Accepter",
  "notif.decline": "Afvis",
  "notif.approve": "Godkend",
  "notif.reject": "Afvis",
  "notif.photo": "📷 Billede",
  "notif.empty": "Ingen notifikationer endnu.",
  "notif.load_failed": "Kunne ikke hente notifikationer. Prøv igen.",
  "notif.post_gone": "Opslaget findes ikke længere",
  "notif.post_not_visible": "Opslaget kunne ikke vises i feedet",
  "notif.invite_gone": "Invitationen findes ikke længere",
  "notif.already_member": "Du er allerede med i “{k}” 🎉",
  "notif.invite_declined": "Invitation afvist",
  "notif.now_member": "Du er nu med i “{k}” 🎉",
  "notif.vote_pending": "Accepteret — kredsen stemmer nu om dig 🗳️",
  "notif.request_gone": "Anmodningen findes ikke længere",
  "notif.approved": "{name} er nu med i {k}",
  "notif.request_rejected": "Anmodning afvist",

  /* Ny kreds (sheet) */
  "fs.title": "Ny kreds",
  "fs.name_ph": "Hvad skal kredsen hedde?",
  "fs.gov_label": "Hvem bestemmer medlemmer?",
  "fs.gov_vote": "Alle stemmer",
  "fs.gov_owner": "Ejeren bestemmer",
  "fs.pick": "Vælg venner",
  "fs.select_all": "Vælg alle",
  "fs.deselect_all": "Fravælg alle",
  "fs.create": "Opret kreds",
  "fs.empty": "Du har ingen venner endnu. Find dem under Søg 🔍",
  "fs.bad_name": "Ugyldigt kredsnavn",
  "fs.only_friends": "Du kan kun vælge dine venner",
  "fs.created": "Kredsen “{name}” er oprettet — invitationer sendt 💌",

  /* Medlemmer (sheet) */
  "ms.members": "Medlemmer",
  "ms.invite_label": "Invitér ven",
  "ms.owner": "Ejer",
  "ms.owner_governed": "Ejeren bestemmer hvem der er med",
  "ms.remove": "Fjern",
  "ms.invite": "Invitér",
  "ms.invited": "Invitation sendt ✓",
  "ms.invite_sent": "Invitation sendt til {name}",
  "ms.invite_cancel": "Fortryd",
  "ms.invite_cancelled": "Invitation trukket tilbage til {name}",
  "ms.all_in": "Alle dine venner er allerede med.",
  "ms.leave": "Forlad kreds",
  "ms.leave_confirm": "Vil du forlade kredsen? Er kredsen tom bagefter, slettes den.",
  "ms.leave_yes": "Ja, forlad kredsen",
  "ms.left": "Du har forladt kredsen",
  "ms.removed": "{name} er fjernet fra kredsen",
  "ms.vote_created": "Afstemning oprettet — de andre skal være enige",
  "gov.proposal_exists": "Der er allerede en afstemning i gang om det",
  "gov.vote_label": "Afstemning · din stemme tæller",
  "gov.closes_in_min": "lukker om {m} min",
  "gov.closing": "lukker snart",
  "adm.tally": "Ja {ja} · Nej {nej}",
  "adm.closes_in": "lukker om {t}",
  "mv.add": "{by} vil tilføje dig til {k}",
  "mv.remove": "{by} vil smide dig ud af {k}",
  "mv.admitted": "Optaget ✅",
  "mv.rejected": "Afvist ❌",
  "mv.kept": "Du bliver i kredsen ✅",
  "mv.removed": "Fjernet ❌",
  "mv.someone": "Nogen",
  "mv.request": "Din anmodning om at være med i {k}",
  "gov.not_owner": "Kun ejeren kan fjerne direkte i små kredse",
  "gov.already_member": "Personen er allerede med i kredsen",
  "gov.not_friend": "Du kan kun invitere dine egne venner",
  /* Automatiske afstemnings-opslag (bygges hos hver seer på deres eget sprog) */
  "gov.q_add": "Afstemning: Skal {name} med i kredsen?",
  "gov.q_remove": "Afstemning: Skal {name} ud af kredsen?",
  "gov.q_request": "Afstemning: Skal {name} lukkes ind i kredsen?",
  "gov.q_owner": "Afstemning: Hvem skal være ny ejer af {kreds}?",
  "gov.res_passed": "Vedtaget",
  "gov.res_rejected": "Afvist",
  "gov.res_owner": "{name} er ny ejer",
  "gov.res_ended": "Afsluttet",

  /* Skriv (compose) */
  "compose.title": "Nyt opslag",
  "compose.title.memory": "Nyt minde",
  "story.title": "Ny story",
  "story.share": "Del",
  "compose.ph.memory": "Skriv en billedtekst …",
  "chooser.title": "Hvad vil du dele?",
  "chooser.thought": "Post en tanke",
  "chooser.memory": "Post et minde",
  "memories.empty": "Ingen minder endnu.",
  "memory.next": "Videre",
  "memory.more": "Se mere",
  "memory.less": "Se mindre",
  "memview.title": "Minde",
  "postview.title": "Opslag",
  "memory.trim_hint": "Træk for at vælge op til 6 sekunder",
  "photolib.limited": "Du har givet adgang til et begrænset antal billeder.",
  "photolib.manage": "Administrer",
  "photolib.denied": "VibeFeed har ikke adgang til dine billeder. Giv adgang i Indstillinger for at vælge et minde.",
  "photolib.settings": "Åbn Indstillinger",
  "prof.grid": "Minder",
  "prof.list": "Tanker",
  "compose.post": "Del",
  "compose.label": "Skriv et opslag",
  "compose.dest": "Del til:",
  "compose.ph.default": "Hvad sker der?",
  "compose.ph.feed": "Skriv til {name} …",
  "compose.ph.poll": "Stil et spørgsmål ...",
  "compose.media_aria": "Tilføj billede eller video",
  "compose.poll_aria": "Tilføj meningsmåling",
  "attach.alt": "Valgt billede",
  "attach.remove": "Fjern medie",
  "mm.aria": "Tilføj medie",
  "mm.camera": "Tag et billede eller video",
  "mm.photo": "Tag et billede",
  "mm.video": "Optag video",
  "mm.lib": "Vælg fra biblioteket",
  "compose.conflict_media": "Fjern meningsmålingen først — et opslag kan ikke have både medie og meningsmåling",
  "compose.conflict_img": "Fjern billedet først — et opslag kan ikke have både billede og meningsmåling",
  "compose.conflict_vid": "Fjern videoen først — et opslag kan ikke have både video og meningsmåling",
  "compose.vid_removed": "Videoen blev fjernet — et opslag kan kun have ét medie",
  "compose.img_removed": "Billedet blev fjernet — et opslag kan kun have ét medie",
  "vid.too_big": "Videoen er for stor",
  "vid.too_long": "Videoen må højst vare 6 sekunder",
  "vid.read_failed": "Kunne ikke læse videoen",
  "compose.shared_in": "Delt i {name}",
  "compose.shared_all": "Delt med hele kredsen",
  "compose.share_failed": "Kunne ikke dele. Prøv igen.",
  "poll.create_failed": "Kunne ikke oprette meningsmålingen. Prøv igen.",
  "poll.opt_ph": "Svarmulighed {n}",
  "poll.rm_aria": "Fjern svarmulighed",
  "poll.add": "+ Tilføj svarmulighed",
  "poll.off": "Fjern meningsmåling",

  /* Meningsmålinger (visning) */
  "poll.mine_aria": "Din stemme",
  "poll.vote_aria": "Stem på {opt}",
  "poll.not_eligible": "Du kan ikke stemme i en afstemning om dig selv.",
  "poll.closed": "Afstemningen er afgjort.",
  "poll.bad_option": "Den svarmulighed hører ikke til meningsmålingen.",
  "poll.vote_failed": "Kunne ikke gemme din stemme. Prøv igen.",

  /* Kommentarer */
  "cmt.img_alt": "Billede i kommentar",
  "cmt.reply": "Svar",
  "cmt.delete": "Slet",
  "cmt.delete_confirm": "Slet?",
  "cmt.deleted": "Kommentar slettet",
  "cmt.hide": "Skjul kommentarer",
  "cmt.replying": "Svarer @{u}",
  "cmt.cancel_reply": "Annuller svar",
  "cmt.rm_img": "Fjern billede",
  "cmt.ph": "Tilføj en kommentar ...",
  "cmt.add_img": "Tilføj billede",
  "cmt.send": "Send",
  "cmt.send_failed": "Kunne ikke sende kommentaren. Prøv igen.",
  "cmt.title": "Kommentarer",
  "cmt.empty": "Ingen kommentarer endnu",

  /* Rediger opslag / menuer */
  "ed.title": "Rediger opslag",
  "ed.ph": "Skriv et opslag ...",
  "ed.hint": "Opslaget skal have tekst (1-280 tegn).",
  "pm.aria": "Opslag",
  "pm.edit": "Rediger",
  "pm.delete": "Slet opslag",
  "pm.confirm": "Slet opslaget permanent?",
  "pm.del": "Slet",
  "rm.report": "Anmeld opslag",
  "rm.confirm": "Anmeld dette opslag?",
  "rm.note": "Ved 10 anmeldelser skjules det for alle.",
  "rm.do": "Anmeld",

  /* Blokering */
  "rm.block": "Blokér brugeren",
  "block.confirm": "Blokér {name}?",
  "block.note": "I ser ikke længere hinandens opslag, kommentarer og profiler, og jeres venskab og anmodninger fjernes. Personen får ikke besked.",
  "block.do": "Blokér",
  "block.done": "{name} er blokeret",
  "block.undone": "Blokeringen er fjernet",
  "pv.block": "Blokér",
  "pv.unblock": "Fjern blokering",
  "pv.blocked": "Blokeret",
  "pv.empty_blocked": "Du har blokeret denne bruger.",

  /* Slet konto */
  "del.title": "Slet konto",
  "del.sure": "Er du sikker?",
  "del.text": "Dette sletter din profil, dine opslag, kommentarer og billeder permanent. Det kan ikke fortrydes. Skriv SLET for at bekræfte.",
  "del.btn": "Slet min konto permanent",

  /* Rediger profil (sheet) */
  "ep.pic": "Skift profilbillede",
  "ep.name": "Dit navn",
  "ep.handle": "Brugernavn",
  "ep.banner": "Skift banner",
  "ep.use": "Brug",
  "list.friends": "Venner",
  "list.kredse": "Kredse",
  "list.member_count": "{n} medlemmer",
  "list.member_one": "1 medlem",
  "list.friend_count": "{n} venner",
  "list.friend_one": "1 ven",
  "list.request": "Anmod",
  "list.requested": "Anmodning sendt ✓",
  "list.empty_friends": "Ingen venner endnu",
  "list.empty_kredse": "Ingen kredse endnu",
  "list.search_ph": "Søg",
  "ep.name_ph": "Dit navn",
  "ep.bio": "Din bio",
  "ep.bio_ph": "Skriv lidt om dig selv ...",
  "ep.activity": "Aktivitet",
  "ep.share": "Del min aktivitet",
  "ep.share_note": "Slår du den fra, kan du heller ikke se andres aktivitet.",
  "ep.lang": "Sprog / Language",

  /* Auth */
  "auth.tag": "Ingen algoritme. Bare din kreds.",
  "auth.email": "E-mail",
  "auth.pass": "Adgangskode",
  "auth.forgot": "Glemt adgangskode?",
  "auth.login": "Log ind",
  "auth.reset_note": "Skriv din e-mail, så sender vi dig et link til at vælge en ny adgangskode.",
  "auth.send_link": "Send link",
  "auth.back_login": "Tilbage til log ind",
  "auth.rc_note": "Vælg ny adgangskode",
  "auth.rc_p1": "Ny adgangskode",
  "auth.rc_p2": "Gentag adgangskode",
  "auth.rc_save": "Gem adgangskode",
  "auth.name": "Navn",
  "auth.handle": "Brugernavn",
  "auth.pass_min": "Adgangskode (mindst 6 tegn)",
  "auth.signup": "Opret profil",
  "auth.alt_login": "Har du ikke en profil?",
  "auth.alt_signup": "Har du allerede en profil?",
  "auth.toggle_login": "Opret en",
  "auth.toggle_signup": "Log ind",
  "auth.e.bad_email": "Skriv en gyldig e-mail",
  "auth.e.bad_password": "Adgangskoden skal være mindst 6 tegn",
  "auth.e.bad_name": "Navn: 1-40 tegn",
  "auth.e.bad_handle": "Brugernavn: 2-20 tegn — kun små bogstaver, tal, punktum og _",
  "auth.e.handle_taken": "Brugernavnet er taget",
  "auth.e.email_taken": "Der findes allerede en profil med den e-mail",
  "auth.profile_failed": "Kunne ikke hente din profil. Tjek din forbindelse og prøv igen.",
  "auth.retry_login": "Noget gik galt. Prøv at logge ind igen.",
  "auth.reset_bad_email": "Det ligner ikke en gyldig e-mailadresse.",
  "auth.reset_rate": "Vent lidt og prøv igen.",
  "auth.confirm_note": "Vi har sendt dig en mail — tryk på linket i den for at bekræfte din e-mail.",
  "auth.confirm_hint": "Tjek også uønsket post.",
  "auth.resend": "Send mailen igen",
  "auth.resent": "Sendt — tjek din indbakke.",
  "auth.e.not_confirmed": "Bekræft din e-mail først — vi har sendt dig et link.",
  "auth.email_confirmed": "Din e-mail er bekræftet 🎉",
  "auth.reset_sent": "Hvis der findes en profil med den e-mail, har vi sendt et link. Tjek din indbakke.",
  "auth.pw_short": "Adgangskoden skal være mindst 6 tegn.",
  "auth.pw_mismatch": "Adgangskoderne er ikke ens.",
  "auth.pw_same": "Den nye adgangskode skal være forskellig fra den gamle.",
  "auth.link_expired": "Linket er udløbet. Prøv \"Glemt adgangskode?\" igen.",
  "auth.link_used": "Linket er udløbet eller allerede brugt. Prøv \"Glemt adgangskode?\" igen.",
  "auth.pw_updated": "Din adgangskode er opdateret",
  "auth.wrong_login": "Forkert e-mail eller adgangskode",
  "auth.signup_login_failed": "Profilen er oprettet, men login fejlede. Prøv at logge ind.",

  /* Lightbox */
  "lb.aria": "Medie i fuld skærm",
  "lb.close": "Luk",
  "lb.sound": "Lyd til/fra",

  /* Sprogvalg */
  "lang.title": "Vælg sprog · Choose language",

  /* Samtykke (reklamer) */
  "consent.title": "Reklamer & privatliv",
  "consent.text": "VibeFeed viser reklamer. Vælg om de må være personlige — du kan ikke fravælge reklamer, kun personaliseringen. Du kan altid ændre dit valg under Rediger profil.",
  "consent.policy": "Privatlivspolitik",
  "consent.personal": "OK — også personlige reklamer",
  "consent.limited": "Kun ikke-personlige reklamer",

  /* Reklamer i feedet (sponsoreret opslag) */
  "ad.label": "Reklame",
  "ad.sponsored": "Sponsoreret",

  /* Privatliv (Rediger profil) */
  "ep.privacy": "Privatliv",
  "ep.ads_personal": "Personlige reklamer",
  "ep.ads_limited": "Kun ikke-personlige",

  /* Signup */
  "signup.accept": "Ved at oprette en profil accepterer du vores {terms} og {link}",
  "signup.policy": "privatlivspolitik",
  "signup.terms": "vilkår"
};

const EN = {
  /* Common */
  "common.loading": "Loading …",
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.back": "Back",
  "err.generic": "Something went wrong. Try again.",
  "err.blocked": "The text contains words that aren't allowed on VibeFeed.",
  "badge.aria": "In your circle",
  "img.read_failed": "Couldn't read the image",

  /* Relative time */
  "time.now": "now",
  "time.m": "m",
  "time.h": "h",
  "time.d": "d",

  /* Pluralization */
  "likes.one": "1 like",
  "likes.many": "{n} likes",
  "votes.one": "1 vote",
  "votes.many": "{n} votes",

  /* Topbar */
  "nosparkle.aria": "Feed settings",
  "nosparkle.title": "Always chronological",
  "nosparkle.toast": "No algorithm here. The feed is always chronological.",

  /* Feed */
  "caughtup.title": "You're all caught up",
  "caughtup.sub": "All posts from your circle — newest first, always.",
  "feed.empty_friends": "Your circle is empty so far.<br>Find your friends under Search 🔍",
  "feed.empty_kreds": "No posts in this circle yet.<br>Be the first ✍️",
  "feed.pinned": "📌 Pinned",
  "feed.load_failed": "Couldn't load posts. Try again.",
  "feedbar.all": "Whole circle",
  "feedbar.new": "+ New circle",
  "feedbar.seek_aria": "Search your circles",
  "feedbar.search_ph": "Search your circles ...",
  "feedbar.cancel_aria": "Cancel search",
  "feedbar.no_match": "No circles match",
  "kredshead.aria": "Circle members",
  "kredshead.line": "<b>{n} members</b><br>Private circle — only you can see and post here.",
  "aria.profile": "Profile",
  "aria.more": "More",
  "aria.comments": "Comments",
  "aria.like": "Like",
  "aria.share": "Share",
  "aria.save": "Save",
  "save.saved": "Saved",
  "save.removed": "Removed from saved",
  "save.empty": "You have not saved anything yet. Tap the bookmark on a memory.",
  "prof.saved": "Saved",
  "media.image": "Image",
  "share.private": "Private circle — no sharing outside 🤫",
  "share.byline": "{name} on VibeFeed",
  "share.copied": "Copied to the clipboard",
  "post.updated": "The post has been updated",
  "post.deleted": "The post has been deleted",
  "post.delete_failed": "Couldn't delete the post. Try again.",
  "post.new": "NEW",
  "report.reported": "Reported · hidden for you",
  "report.undo": "Undo",
  "report.undone": "Report withdrawn",

  /* Tabbar */
  "tab.home": "Home",
  "tab.search": "Search",
  "tab.compose": "New post",
  "tab.notifs": "Notifications",

  /* Own profile */
  "stats.posts": "Posts",
  "stats.friends": "Friends",
  "stats.kredse": "Circles",
  "profile.edit": "Edit profile",
  "profile.logout": "Log out",
  "profile.myposts": "Your posts",
  "profile.you": "You",
  "myposts.empty": "You haven't shared anything yet. Tap + and share a photo or a thought.",
  "profile.updated": "Profile updated",
  "avatar.updated": "Profile photo updated",
  "avatar.failed": "Couldn't update the profile photo. Try again.",
  "account.deleted": "Your account has been deleted",
  "account.delete_failed": "Couldn't delete the account. Try again.",

  /* Friend profile */
  "pv.add": "Add to your circle",
  "pv.added": "In your circle ✓",
  "pv.requested": "Request sent",
  "pv.since": "In your circle since {year} · Mutual friend",
  "pv.today": "today",
  "pv.empty_friend": "No posts yet.",
  "pv.empty_stranger": "Become friends to see posts",
  "pv.not_found": "Couldn't find the profile",
  "pv.count": "{n} posts",
  "pv.act": "See activity",
  "pv.remove": "Remove friend",
  "pv.remove_confirm": "Remove {name} as a friend?",

  /* Activity */
  "act.title": "{name}'s activity",
  "act.liked": "Liked {name}'s post",
  "act.commented": "Commented on {name}'s post",
  "act.empty": "No activity yet.",
  "act.load_failed": "Couldn't load the activity. Try again.",
  "act.self_off": "Turn on “Share my activity” to see others'.",
  "act.target_off": "{name} doesn't share their activity.",

  /* Friends */
  "friend.not_found": "No user with that name",
  "friend.self": "That's you 😄",
  "friend.added": "{name} is now in your circle",
  "friend.request_sent": "Friend request sent to {name}",
  "friend.request_cancelled": "Request withdrawn",
  "friend.req_declined": "Request declined",
  "friend.removed": "{name} has been removed as a friend",

  /* Search */
  "search.ph": "Search your circle",
  "search.section": "Your circle",
  "search.add": "Add @{h} to your circle",
  "search.requested": "Request sent",
  "search.no_match": "No one in your circle matches.",
  "search.empty": "Your circle is empty so far. Search for your friends here 🔍",

  /* Beskeder (kreds-chat) */
  "chat.title": "Messages",
  "chat.empty": "No circles yet. Create a circle to get a thread here.",
  "chat.no_messages": "No messages yet. Say hi 👋",
  "chat.ph": "Write a message ...",
  "chat.send": "Send",
  "chat.shared_memory": "shared a memory",
  "chat.you": "You",
  "chat.say_hi": "Say hi 👋",
  "chat.unread": "Unread messages",
  "chat.read": "Read",
  "chat.notread": "Not read",
  "chat.replying": "Replying to a memory from {n}",
  "chat.ctx_close": "Remove",
  "chat.only_two": "Just you two",
  "chat.kreds_sub": "Circle · {n} members",
  "chat.kreds_sub_one": "Circle · 1 member",
  "chat.menu_reply": "Reply",
  "chat.copy": "Copy",
  "chat.copied": "Copied",
  "chat.edit": "Edit",
  "chat.editing": "You are editing the message",
  "chat.edited": "Edited",
  "chat.edit_too_old": "This message is too old to edit",
  "chat.remove": "Remove",
  "chat.remove_confirm": "Remove the message for everyone?",
  "chat.report": "Report",
  "chat.report_confirm": "Report this message?",
  "chat.report_note": "The message is hidden for you immediately and the report is saved.",
  "chat.reported": "The message has been reported and hidden",
  "chat.replying_to": "Replying to {n}",
  "chat.q_media": "📷 Media",
  "chat.plus": "Share a memory",
  "chat.media_dm": "Photos and video are shared through a circle. Create a circle with the two of you and post a memory, and it lands here.",
  "chat.typing": "{n} is typing ...",
  "chat.thread_menu": "Settings",
  "chat.members": "View members",
  "chat.pin": "Pin",
  "chat.unpin": "Unpin",
  "chat.mute": "Mute",
  "chat.unmute": "Unmute",
  "chat.muted_toast": "Thread muted",
  "chat.unmuted_toast": "Notifications back on",
  "chat.seen_by": "Seen by",
  "chat.reactions": "Reactions",
  "memory.fit": "Adjust the crop",
  "mode.memory": "Memory",
  "mode.story": "Story",
  "story.delete": "Delete story",
  "story.del_confirm": "Delete?",
  "story.deleted": "Story deleted",
  "story.seenby": "Seen by {n}",
  "story.noviews": "No views yet",
  "story.one": "Story",
  "story.one_video": "Story with video",
  "story.report": "Report story",
  "story.report_confirm": "Report this story?",
  "story.reported": "Reported · hidden for you",
  "chat.mark_unread": "Mark as unread",
  "chat.clear_thread": "Clear chat",
  "chat.del_thread": "Delete chat",
  "chat.clear_confirm": "Clear the chat?",
  "chat.del_confirm": "Delete the chat?",
  "chat.clear_note": "Messages are hidden only for you. The others keep theirs.",
  "chat.do_clear": "Clear",
  "chat.do_del": "Delete",
  "chat.search_ph": "Search",
  "chat.search_msgs": "Messages",
  "chat.search_none": "Nothing found",
  "aria.private_comment": "Comment privately",

  /* Notifications */
  "notif.liked": "liked your post",
  "notif.commented": "replied to your post",
  "notif.posted_kreds": "posted in {k}",
  "notif.vote_add": "wants to add {name} to {k}",
  "notif.vote_remove": "wants to remove {name} from {k}",
  "notif.vote_owner": "started a vote for a new owner in {k}",
  "notif.vote_request": "wants to be let into {k}",
  "notif.admission_yes": "Congratulations! You're now in <b>{k}</b> 🎉",
  "notif.admission_no_request": "Unfortunately your request to join <b>{k}</b> wasn't approved",
  "notif.admission_no_invite": "Unfortunately the vote to let you into <b>{k}</b> didn't pass",
  "notif.replied": "replied to your comment",
  "notif.liked_comment": "liked your comment",
  "notif.mentioned": "mentioned you",
  "notif.friend": "is now in your circle",
  "notif.friend_request": "wants to be friends",
  "notif.invited": "invited you to “{k}”",
  "notif.request": "wants to join “{k}”",
  "notif.accept": "Accept",
  "notif.decline": "Decline",
  "notif.approve": "Approve",
  "notif.reject": "Decline",
  "notif.photo": "📷 Photo",
  "notif.empty": "No notifications yet.",
  "notif.load_failed": "Couldn't load notifications. Try again.",
  "notif.post_gone": "The post no longer exists",
  "notif.post_not_visible": "The post couldn't be shown in the feed",
  "notif.invite_gone": "The invitation no longer exists",
  "notif.already_member": "You're already in “{k}” 🎉",
  "notif.invite_declined": "Invitation declined",
  "notif.now_member": "You're now in “{k}” 🎉",
  "notif.vote_pending": "Accepted — the circle is now voting on you 🗳️",
  "notif.request_gone": "The request no longer exists",
  "notif.approved": "{name} is now in {k}",
  "notif.request_rejected": "Request declined",

  /* New circle (sheet) */
  "fs.title": "New circle",
  "fs.name_ph": "What should the circle be called?",
  "fs.gov_label": "Who decides members?",
  "fs.gov_vote": "Everyone votes",
  "fs.gov_owner": "Owner decides",
  "fs.pick": "Pick friends",
  "fs.select_all": "Select all",
  "fs.deselect_all": "Deselect all",
  "fs.create": "Create circle",
  "fs.empty": "You don't have any friends yet. Find them under Search 🔍",
  "fs.bad_name": "Invalid circle name",
  "fs.only_friends": "You can only pick your own friends",
  "fs.created": "The circle “{name}” has been created — invitations sent 💌",

  /* Members (sheet) */
  "ms.members": "Members",
  "ms.invite_label": "Invite a friend",
  "ms.owner": "Owner",
  "ms.owner_governed": "The owner decides who's in",
  "ms.remove": "Remove",
  "ms.invite": "Invite",
  "ms.invited": "Invitation sent ✓",
  "ms.invite_sent": "Invitation sent to {name}",
  "ms.invite_cancel": "Undo",
  "ms.invite_cancelled": "Invitation withdrawn from {name}",
  "ms.all_in": "All your friends are already in.",
  "ms.leave": "Leave circle",
  "ms.leave_confirm": "Do you want to leave the circle? If it's empty afterwards, it will be deleted.",
  "ms.leave_yes": "Yes, leave the circle",
  "ms.left": "You have left the circle",
  "ms.removed": "{name} has been removed from the circle",
  "ms.vote_created": "Vote created — the others have to agree",
  "gov.proposal_exists": "There's already a vote in progress about that",
  "gov.vote_label": "Vote · your vote counts",
  "gov.closes_in_min": "closes in {m} min",
  "gov.closing": "closing soon",
  "adm.tally": "Yes {ja} · No {nej}",
  "adm.closes_in": "closes in {t}",
  "mv.add": "{by} wants to add you to {k}",
  "mv.remove": "{by} wants to remove you from {k}",
  "mv.admitted": "Admitted ✅",
  "mv.rejected": "Rejected ❌",
  "mv.kept": "You stay in the circle ✅",
  "mv.removed": "Removed ❌",
  "mv.someone": "Someone",
  "mv.request": "Your request to join {k}",
  "gov.not_owner": "Only the owner can remove directly in small circles",
  "gov.already_member": "That person is already in the circle",
  "gov.not_friend": "You can only invite your own friends",
  /* Automated vote posts (rendered per viewer in their own language) */
  "gov.q_add": "Vote: Should {name} join the circle?",
  "gov.q_remove": "Vote: Should {name} leave the circle?",
  "gov.q_request": "Vote: Should {name} be let into the circle?",
  "gov.q_owner": "Vote: Who should be the new owner of {kreds}?",
  "gov.res_passed": "Passed",
  "gov.res_rejected": "Rejected",
  "gov.res_owner": "{name} is the new owner",
  "gov.res_ended": "Ended",

  /* Compose */
  "compose.title": "New post",
  "compose.title.memory": "New memory",
  "story.title": "New story",
  "story.share": "Share",
  "compose.ph.memory": "Write a caption …",
  "chooser.title": "What do you want to share?",
  "chooser.thought": "Post a thought",
  "chooser.memory": "Post a memory",
  "memories.empty": "No memories yet.",
  "memory.next": "Next",
  "memory.more": "See more",
  "memory.less": "See less",
  "memview.title": "Memory",
  "postview.title": "Post",
  "memory.trim_hint": "Drag to pick up to 6 seconds",
  "photolib.limited": "You've given access to a limited number of photos.",
  "photolib.manage": "Manage",
  "photolib.denied": "VibeFeed doesn't have access to your photos. Allow access in Settings to pick a memory.",
  "photolib.settings": "Open Settings",
  "prof.grid": "Memories",
  "prof.list": "Thoughts",
  "compose.post": "Share",
  "compose.label": "Write a post",
  "compose.dest": "Share to:",
  "compose.ph.default": "What's happening?",
  "compose.ph.feed": "Write to {name} …",
  "compose.ph.poll": "Ask a question ...",
  "compose.media_aria": "Add photo or video",
  "compose.poll_aria": "Add poll",
  "attach.alt": "Selected image",
  "attach.remove": "Remove media",
  "mm.aria": "Add media",
  "mm.camera": "Take a photo or video",
  "mm.photo": "Take a photo",
  "mm.video": "Record a video",
  "mm.lib": "Choose from the library",
  "compose.conflict_media": "Remove the poll first — a post can't have both media and a poll",
  "compose.conflict_img": "Remove the photo first — a post can't have both a photo and a poll",
  "compose.conflict_vid": "Remove the video first — a post can't have both a video and a poll",
  "compose.vid_removed": "The video was removed — a post can only have one media item",
  "compose.img_removed": "The photo was removed — a post can only have one media item",
  "vid.too_big": "The video is too large",
  "vid.too_long": "The video can be at most 6 seconds",
  "vid.read_failed": "Couldn't read the video",
  "compose.shared_in": "Shared in {name}",
  "compose.shared_all": "Shared with the whole circle",
  "compose.share_failed": "Couldn't share. Try again.",
  "poll.create_failed": "Couldn't create the poll. Try again.",
  "poll.opt_ph": "Option {n}",
  "poll.rm_aria": "Remove option",
  "poll.add": "+ Add option",
  "poll.off": "Remove poll",

  /* Polls (view) */
  "poll.mine_aria": "Your vote",
  "poll.vote_aria": "Vote for {opt}",
  "poll.not_eligible": "You can't vote in a poll about yourself.",
  "poll.closed": "The vote has been decided.",
  "poll.bad_option": "That option doesn't belong to the poll.",
  "poll.vote_failed": "Couldn't save your vote. Try again.",

  /* Comments */
  "cmt.img_alt": "Image in comment",
  "cmt.reply": "Reply",
  "cmt.delete": "Delete",
  "cmt.delete_confirm": "Delete?",
  "cmt.deleted": "Comment deleted",
  "cmt.hide": "Hide comments",
  "cmt.replying": "Replying to @{u}",
  "cmt.cancel_reply": "Cancel reply",
  "cmt.rm_img": "Remove image",
  "cmt.ph": "Add a comment ...",
  "cmt.add_img": "Add image",
  "cmt.send": "Send",
  "cmt.send_failed": "Couldn't send the comment. Try again.",
  "cmt.title": "Comments",
  "cmt.empty": "No comments yet",

  /* Edit post / menus */
  "ed.title": "Edit post",
  "ed.ph": "Write a post ...",
  "ed.hint": "The post needs text (1-280 characters).",
  "pm.aria": "Post",
  "pm.edit": "Edit",
  "pm.delete": "Delete post",
  "pm.confirm": "Delete the post permanently?",
  "pm.del": "Delete",
  "rm.report": "Report post",
  "rm.confirm": "Report this post?",
  "rm.note": "After 10 reports it's hidden for everyone.",
  "rm.do": "Report",

  /* Blocking */
  "rm.block": "Block user",
  "block.confirm": "Block {name}?",
  "block.note": "You'll no longer see each other's posts, comments and profiles, and your friendship and requests are removed. They won't be notified.",
  "block.do": "Block",
  "block.done": "{name} is blocked",
  "block.undone": "Block removed",
  "pv.block": "Block",
  "pv.unblock": "Unblock",
  "pv.blocked": "Blocked",
  "pv.empty_blocked": "You've blocked this user.",

  /* Delete account */
  "del.title": "Delete account",
  "del.sure": "Are you sure?",
  "del.text": "This permanently deletes your profile, your posts, comments and photos. It cannot be undone. Type SLET to confirm.",
  "del.btn": "Permanently delete my account",

  /* Edit profile (sheet) */
  "ep.pic": "Change profile photo",
  "ep.name": "Your name",
  "ep.handle": "Username",
  "ep.banner": "Change banner",
  "ep.use": "Use",
  "list.friends": "Friends",
  "list.kredse": "Circles",
  "list.member_count": "{n} members",
  "list.member_one": "1 member",
  "list.friend_count": "{n} friends",
  "list.friend_one": "1 friend",
  "list.request": "Ask to join",
  "list.requested": "Request sent ✓",
  "list.empty_friends": "No friends yet",
  "list.empty_kredse": "No circles yet",
  "list.search_ph": "Search",
  "ep.name_ph": "Your name",
  "ep.bio": "Your bio",
  "ep.bio_ph": "Write a little about yourself ...",
  "ep.activity": "Activity",
  "ep.share": "Share my activity",
  "ep.share_note": "If you turn it off, you can't see others' activity either.",
  "ep.lang": "Sprog / Language",

  /* Auth */
  "auth.tag": "No algorithm. Just your circle.",
  "auth.email": "Email",
  "auth.pass": "Password",
  "auth.forgot": "Forgot password?",
  "auth.login": "Log in",
  "auth.reset_note": "Enter your email and we'll send you a link to choose a new password.",
  "auth.send_link": "Send link",
  "auth.back_login": "Back to log in",
  "auth.rc_note": "Choose a new password",
  "auth.rc_p1": "New password",
  "auth.rc_p2": "Repeat password",
  "auth.rc_save": "Save password",
  "auth.name": "Name",
  "auth.handle": "Username",
  "auth.pass_min": "Password (at least 6 characters)",
  "auth.signup": "Create profile",
  "auth.alt_login": "Don't have a profile?",
  "auth.alt_signup": "Already have a profile?",
  "auth.toggle_login": "Create one",
  "auth.toggle_signup": "Log in",
  "auth.e.bad_email": "Enter a valid email",
  "auth.e.bad_password": "The password must be at least 6 characters",
  "auth.e.bad_name": "Name: 1-40 characters",
  "auth.e.bad_handle": "Username: 2-20 characters — only lowercase letters, numbers, periods and _",
  "auth.e.handle_taken": "That username is taken",
  "auth.e.email_taken": "A profile with that email already exists",
  "auth.profile_failed": "Couldn't load your profile. Check your connection and try again.",
  "auth.retry_login": "Something went wrong. Try logging in again.",
  "auth.reset_bad_email": "That doesn't look like a valid email address.",
  "auth.reset_rate": "Wait a moment and try again.",
  "auth.confirm_note": "We've sent you an email — tap the link in it to confirm your email address.",
  "auth.confirm_hint": "Check your spam folder too.",
  "auth.resend": "Resend the email",
  "auth.resent": "Sent — check your inbox.",
  "auth.e.not_confirmed": "Confirm your email first — we've sent you a link.",
  "auth.email_confirmed": "Your email is confirmed 🎉",
  "auth.reset_sent": "If a profile exists with that email, we've sent a link. Check your inbox.",
  "auth.pw_short": "The password must be at least 6 characters.",
  "auth.pw_mismatch": "The passwords don't match.",
  "auth.pw_same": "The new password must be different from the old one.",
  "auth.link_expired": "The link has expired. Try \"Forgot password?\" again.",
  "auth.link_used": "The link has expired or has already been used. Try \"Forgot password?\" again.",
  "auth.pw_updated": "Your password has been updated",
  "auth.wrong_login": "Wrong email or password",
  "auth.signup_login_failed": "Your profile was created, but login failed. Try logging in.",

  /* Lightbox */
  "lb.aria": "Fullscreen media",
  "lb.close": "Close",
  "lb.sound": "Sound on/off",

  /* Language picker */
  "lang.title": "Vælg sprog · Choose language",

  /* Consent (ads) */
  "consent.title": "Ads & privacy",
  "consent.text": "VibeFeed shows ads. Choose whether they may be personalized — you can't opt out of ads, only of personalization. You can always change your choice under Edit profile.",
  "consent.policy": "Privacy policy",
  "consent.personal": "OK — personalized ads too",
  "consent.limited": "Only non-personalized ads",

  /* Ads in the feed (sponsored post) */
  "ad.label": "Ad",
  "ad.sponsored": "Sponsored",

  /* Privacy (Edit profile) */
  "ep.privacy": "Privacy",
  "ep.ads_personal": "Personalized ads",
  "ep.ads_limited": "Only non-personalized",

  /* Signup */
  "signup.accept": "By creating a profile you accept our {terms} and {link}",
  "signup.policy": "privacy policy",
  "signup.terms": "terms of use"
};

const DICT = { da: DA, en: EN }; // øvrige sprog lægges heri efter dynamisk import

export function t(key, vars){
  let s = (DICT[lang] || EN)[key];
  if(s === undefined) s = EN[key];
  if(s === undefined) s = DA[key];
  if(s === undefined) return key;
  if(vars){
    s = s.replace(/\{(\w+)\}/g, function(m, k){
      return vars[k] !== undefined ? vars[k] : m;
    });
  }
  return s;
}

export function getLang(){ return lang; }

export function hasStoredLang(){
  try{ return !!LANGS[localStorage.getItem(LS_KEY)]; }
  catch(_e){ return false; }
}

/* Hent et sprogs ordbog (no-op for da/en og allerede hentede) */
function ensureLang(l){
  if(DICT[l]) return Promise.resolve(true);
  return import("./lang/" + l + ".js").then(function(mod){
    DICT[l] = mod.default || {};
    return true;
  }, function(err){
    console.error("i18n: kunne ikke hente sproget", l, err);
    return false;
  });
}

/* Gør sproget aktivt (ordbogen SKAL være hentet) + opdater dokumentet */
function commitLang(l){
  lang = l;
  document.documentElement.lang = l;
  document.documentElement.dir = RTL[l] ? "rtl" : "ltr";
  applyStaticI18n();
  if(changeCb) changeCb(l);
}

/* Brugerens EGET valg (sprogvælgerne): gemmes og aktiveres når ordbogen er klar */
export function setLang(l){
  if(!LANGS[l]) return;
  try{ localStorage.setItem(LS_KEY, l); }catch(_e){}
  ensureLang(l).then(function(ok){ commitLang(ok ? l : "en"); });
}

/* Enhedens sprog → nærmeste understøttede kode (fallback: engelsk).
   Kinesisk deles på skrift (Hans/Hant via region), norsk bokmål/nynorsk → no,
   gamle iOS-koder (iw/in/fil) mappes til de moderne. */
export function deviceLang(){
  const cands = (navigator.languages && navigator.languages.length
    ? navigator.languages : [navigator.language || "en"]);
  for(let i = 0; i < cands.length; i++){
    const v = String(cands[i] || "").toLowerCase();
    if(!v) continue;
    if(v.indexOf("zh") === 0){
      return (v.indexOf("hant") >= 0 || /-(tw|hk|mo)\b/.test(v)) ? "zh-hant" : "zh-hans";
    }
    let base = v.split("-")[0];
    if(base === "nb" || base === "nn") base = "no";
    if(base === "iw") base = "he";
    if(base === "in") base = "id";
    if(base === "fil") base = "tl";
    if(LANGS[base]) return base;
  }
  return "en";
}

export function initI18n(cb){
  changeCb = cb || null;
  let stored = null;
  try{ stored = localStorage.getItem(LS_KEY); }catch(_e){}
  const target = LANGS[stored] ? stored : deviceLang();
  if(DICT[target]){
    lang = target;
    document.documentElement.lang = target;
    document.documentElement.dir = RTL[target] ? "rtl" : "ltr";
    applyStaticI18n();
  } else {
    // Ordbogen hentes (samme origin, typisk <100 ms bag boot-splashen).
    // Indtil da vises engelsk; commitLang gen-render'er når den lander.
    lang = "en";
    document.documentElement.lang = "en";
    applyStaticI18n();
    ensureLang(target).then(function(ok){ if(ok) commitLang(target); });
  }
  // Sprogvælgerne (select[data-langsel]) er selvkørende herfra
  document.addEventListener("change", function(e){
    if(e.target && e.target.matches && e.target.matches("select[data-langsel]")){
      setLang(e.target.value);
    }
  });
}

/* Sprogafhængig URL til privatlivspolitikken (kun da har egen side) */
export function policyURL(){ return lang === "da" ? "/privatliv.html" : "/privacy.html"; }

/* Sprogafhængig URL til vilkårene (kun da har egen side) */
export function termsURL(){ return lang === "da" ? "/vilkaar.html" : "/terms.html"; }

/* Statisk markup: data-i18n (textContent), data-i18n-ph (placeholder),
   data-i18n-aria (aria-label), data-i18n-title (title), data-i18n-alt (alt) */
export function applyStaticI18n(){
  document.querySelectorAll("[data-i18n]").forEach(function(n){ n.textContent = t(n.dataset.i18n); });
  document.querySelectorAll("[data-i18n-ph]").forEach(function(n){ n.placeholder = t(n.dataset.i18nPh); });
  document.querySelectorAll("[data-i18n-aria]").forEach(function(n){ n.setAttribute("aria-label", t(n.dataset.i18nAria)); });
  document.querySelectorAll("[data-i18n-title]").forEach(function(n){ n.title = t(n.dataset.i18nTitle); });
  document.querySelectorAll("[data-i18n-alt]").forEach(function(n){ n.setAttribute("alt", t(n.dataset.i18nAlt)); });
  /* Sprogvælgere: udfyld med alle sprog (én gang) + vis det aktive */
  document.querySelectorAll("select[data-langsel]").forEach(function(sel){
    if(!sel.options.length){
      Object.keys(LANGS).forEach(function(code){
        const o = document.createElement("option");
        o.value = code; o.textContent = LANGS[code];
        sel.appendChild(o);
      });
    }
    sel.value = lang;
  });
  /* Links til privatlivspolitikken følger sproget */
  document.querySelectorAll("a[data-policy-link]").forEach(function(a){ a.setAttribute("href", policyURL()); });
}

/* Pluralisering (sprogafhængig) */
export function likesLabel(n){ return n === 1 ? t("likes.one") : t("likes.many", { n: n }); }
export function stemmerLabel(n){ return n === 1 ? t("votes.one") : t("votes.many", { n: n }); }

/* Datolokale til toLocaleDateString-fallback i fmtTime */
const LOCALES = {
  "da": "da-DK", "en": "en-GB", "de": "de-DE", "fr": "fr-FR", "it": "it-IT",
  "es": "es-ES", "pt": "pt-PT", "nl": "nl-NL", "sv": "sv-SE", "no": "nb-NO",
  "fi": "fi-FI", "pl": "pl-PL", "cs": "cs-CZ", "el": "el-GR", "ro": "ro-RO",
  "ru": "ru-RU", "tr": "tr-TR", "uk": "uk-UA", "zh-hans": "zh-CN", "zh-hant": "zh-TW",
  "ja": "ja-JP", "ko": "ko-KR", "hi": "hi-IN", "id": "id-ID", "ms": "ms-MY",
  "th": "th-TH", "vi": "vi-VN", "ar": "ar", "he": "he-IL", "fa": "fa-IR",
  "af": "af-ZA", "tl": "fil-PH"
};
export function dateLocale(){ return LOCALES[lang] || "en-GB"; }
