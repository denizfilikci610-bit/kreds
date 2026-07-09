/* ================= i18n =================
   Sprog-lag: t(key, vars) slår op i det aktive sprogs ordbog, falder tilbage
   til dansk og til sidst til selve nøglen. Sproget er per enhed (localStorage
   vf_lang) — serverskabt indhold (governance-afstemninger, velkomstopslaget)
   forbliver dansk by design og oversættes IKKE her.
   REGEL: Dette modul må ikke importere andre app-moduler (skal kunne
   importeres af alle uden cyklus-problemer). */

const LS_KEY = "vf_lang";
let lang = "da";
let changeCb = null;

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
  "quota.aria": "Likes du kan modtage",
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
  "kredshead.line": "<b>{n} medlemmer</b><br>Privat kreds — kun jer kan se og skrive her.",
  "quota.line1": "Likes: givet <b>{given}</b> · modtaget <b>{received}</b> · plads til <b>{room}</b>",
  "quota.line2": "Du kan modtage ét like mere, end du selv har givet.",
  "quota.toast": "Du kan modtage {likes} mere. Giv likes til andre for at få plads til flere.",
  "like.quota": "{name} kan ikke modtage flere likes lige nu — de skal selv give likes for at få plads 😉",
  "reward.title": "Få plads til 20 flere likes",
  "reward.sub": "Se en kort video, så 20 flere kan like dine opslag",
  "reward.how": "Du kan modtage lige så mange likes, som du selv giver — en video giver +20 ekstra plads.",
  "reward.watch": "Se video",
  "reward.no": "Nej tak",
  "reward.granted": "Sådan! +20 plads til likes",
  "reward.none": "Ingen video lige nu — prøv igen om lidt",
  "reward.error": "Noget gik galt. Prøv igen.",
  "aria.profile": "Profil",
  "aria.more": "Mere",
  "aria.comments": "Kommentarer",
  "aria.like": "Like",
  "aria.share": "Del",
  "media.image": "Billede",
  "teaser.request": "Anmod om at være med",
  "teaser.undo": "Fortryd {n}",
  "teaser.sent": "Anmodning sendt ✓",
  "teaser.shared": "{name} delte i den private kreds",
  "teaser.members_only": "Kun for medlemmer",
  "teaser.already": "Du er allerede med i kredsen 🎉",
  "teaser.not_allowed": "Du kan ikke anmode om at være med i den kreds",
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

  /* Skriv (compose) */
  "compose.title": "Nyt opslag",
  "compose.title.memory": "Nyt minde",
  "compose.ph.memory": "Skriv en billedtekst …",
  "chooser.title": "Hvad vil du dele?",
  "chooser.thought": "Post en tanke",
  "chooser.memory": "Post et minde",
  "memories.empty": "Ingen minder endnu.",
  "memory.next": "Videre",
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
  "cmt.show": "Vis kommentarer ({n})",
  "cmt.hide": "Skjul kommentarer",
  "cmt.replying": "Svarer @{u}",
  "cmt.cancel_reply": "Annuller svar",
  "cmt.rm_img": "Fjern billede",
  "cmt.ph": "Tilføj en kommentar ...",
  "cmt.add_img": "Tilføj billede",
  "cmt.send": "Send",
  "cmt.send_failed": "Kunne ikke sende kommentaren. Prøv igen.",

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

  /* Slet konto */
  "del.title": "Slet konto",
  "del.sure": "Er du sikker?",
  "del.text": "Dette sletter din profil, dine opslag, kommentarer og billeder permanent. Det kan ikke fortrydes. Skriv SLET for at bekræfte.",
  "del.btn": "Slet min konto permanent",

  /* Rediger profil (sheet) */
  "ep.pic": "Skift profilbillede",
  "ep.name": "Dit navn",
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
  "signup.accept": "Ved at oprette en profil accepterer du vores {link}",
  "signup.policy": "privatlivspolitik"
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
  "quota.aria": "Likes you can receive",
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
  "quota.line1": "Likes: given <b>{given}</b> · received <b>{received}</b> · room for <b>{room}</b>",
  "quota.line2": "You can receive one more like than you've given yourself.",
  "quota.toast": "You can receive {likes} more. Give likes to others to make room for more.",
  "like.quota": "{name} can't receive more likes right now — they need to give likes to make room 😉",
  "reward.title": "Room for 20 more likes",
  "reward.sub": "Watch a short video so 20 more people can like your posts",
  "reward.how": "You can receive as many likes as you give — a video adds +20 extra room.",
  "reward.watch": "Watch video",
  "reward.no": "No thanks",
  "reward.granted": "Nice! +20 room for likes",
  "reward.none": "No video right now — try again shortly",
  "reward.error": "Something went wrong. Try again.",
  "aria.profile": "Profile",
  "aria.more": "More",
  "aria.comments": "Comments",
  "aria.like": "Like",
  "aria.share": "Share",
  "media.image": "Image",
  "teaser.request": "Ask to join",
  "teaser.undo": "Undo {n}",
  "teaser.sent": "Request sent ✓",
  "teaser.shared": "{name} shared in the private circle",
  "teaser.members_only": "Members only",
  "teaser.already": "You're already in the circle 🎉",
  "teaser.not_allowed": "You can't ask to join that circle",
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

  /* Compose */
  "compose.title": "New post",
  "compose.title.memory": "New memory",
  "compose.ph.memory": "Write a caption …",
  "chooser.title": "What do you want to share?",
  "chooser.thought": "Post a thought",
  "chooser.memory": "Post a memory",
  "memories.empty": "No memories yet.",
  "memory.next": "Next",
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
  "cmt.show": "Show comments ({n})",
  "cmt.hide": "Hide comments",
  "cmt.replying": "Replying to @{u}",
  "cmt.cancel_reply": "Cancel reply",
  "cmt.rm_img": "Remove image",
  "cmt.ph": "Add a comment ...",
  "cmt.add_img": "Add image",
  "cmt.send": "Send",
  "cmt.send_failed": "Couldn't send the comment. Try again.",

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

  /* Delete account */
  "del.title": "Delete account",
  "del.sure": "Are you sure?",
  "del.text": "This permanently deletes your profile, your posts, comments and photos. It cannot be undone. Type SLET to confirm.",
  "del.btn": "Permanently delete my account",

  /* Edit profile (sheet) */
  "ep.pic": "Change profile photo",
  "ep.name": "Your name",
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
  "signup.accept": "By creating a profile you accept our {link}",
  "signup.policy": "privacy policy"
};

const DICT = { da: DA, en: EN };

export function t(key, vars){
  let s = DICT[lang][key];
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
  try{ const v = localStorage.getItem(LS_KEY); return v === "da" || v === "en"; }
  catch(_e){ return false; }
}

export function setLang(l){
  if(l !== "da" && l !== "en") return;
  lang = l;
  try{ localStorage.setItem(LS_KEY, l); }catch(_e){}
  document.documentElement.lang = l;
  applyStaticI18n();
  if(changeCb) changeCb(l);
}

export function initI18n(cb){
  changeCb = cb || null;
  try{
    const stored = localStorage.getItem(LS_KEY);
    if(stored === "da" || stored === "en") lang = stored;
  }catch(_e){}
  document.documentElement.lang = lang;
  applyStaticI18n();
}

/* Sprogafhængig URL til privatlivspolitikken (statisk side pr. sprog) */
export function policyURL(){ return lang === "da" ? "/privatliv.html" : "/privacy.html"; }

/* Statisk markup: data-i18n (textContent), data-i18n-ph (placeholder),
   data-i18n-aria (aria-label), data-i18n-title (title), data-i18n-alt (alt) */
export function applyStaticI18n(){
  document.querySelectorAll("[data-i18n]").forEach(function(n){ n.textContent = t(n.dataset.i18n); });
  document.querySelectorAll("[data-i18n-ph]").forEach(function(n){ n.placeholder = t(n.dataset.i18nPh); });
  document.querySelectorAll("[data-i18n-aria]").forEach(function(n){ n.setAttribute("aria-label", t(n.dataset.i18nAria)); });
  document.querySelectorAll("[data-i18n-title]").forEach(function(n){ n.title = t(n.dataset.i18nTitle); });
  document.querySelectorAll("[data-i18n-alt]").forEach(function(n){ n.setAttribute("alt", t(n.dataset.i18nAlt)); });
  const cd = document.getElementById("lang-da"), ce = document.getElementById("lang-en");
  if(cd) cd.classList.toggle("on", lang === "da");
  if(ce) ce.classList.toggle("on", lang === "en");
  /* Links til privatlivspolitikken følger sproget */
  document.querySelectorAll("a[data-policy-link]").forEach(function(a){ a.setAttribute("href", policyURL()); });
}

/* Pluralisering (sprogafhængig) */
export function likesLabel(n){ return n === 1 ? t("likes.one") : t("likes.many", { n: n }); }
export function stemmerLabel(n){ return n === 1 ? t("votes.one") : t("votes.many", { n: n }); }

/* Datolokale til toLocaleDateString-fallback i fmtTime */
export function dateLocale(){ return lang === "da" ? "da-DK" : "en-GB"; }
