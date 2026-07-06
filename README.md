# VibeFeed (kreds)

VibeFeed er en lille dansk social app til lukkede vennekredse: et kronologisk feed (X-agtigt layout: avatar-kolonne, header-linje med @handle · tid, medie i afrundet kort) med opslag, billeder, korte videoer (maks. 6 sekunder, maks. 25 MB — optages med kameraet i appen eller vælges fra biblioteket; afspilles lydløst i loop i feedet) og meningsmålinger, indlejrede kommentartråde (sammenklappet som standard — boble/“Vis kommentarer (X)” folder tråd + kommentarfelt ud), en like-økonomi (du kan modtage ét like mere, end du selv har givet), private kredse, vennesøgning, notifikationer og profiler (med bio). Ét tryk på et billede eller en video åbner en fuldskærms-lightbox (`js/lightbox.js`): billeder kan pinch-zoomes (1x-4x), panoreres og dobbelttryk-zoomes (1x ↔ 2.5x) via Pointer Events (side-zoom er slået fra i viewporten); videoer vises med lyd, native controls og loop. Dobbelttryk på mediet i feedet liker stadig opslaget (320 ms tap-vindue) uden at åbne lightboxen. Feedbaren har en lup ved venstre kant, der folder en inline kreds-søgning ud og filtrerer kreds-pillerne live ("Hele kredsen" vises altid). Alle rækker i Søg (venner og globale resultater) åbner profilpanelet; profiler for ikke-venner viser en rød "Tilføj til din kreds"-chip (add_friend) i stedet for "I din kreds siden …", og deres opslag er skjult af RLS ("Bliv venner for at se opslag"). Opslag til hele kredsen kan deles via systemets dele-ark (navigator.share, ellers kopieres teksten); opslag i private kredse kan ikke deles. Egne opslag kan redigeres og slettes; andres opslag kan anmeldes via ⋯-menuen (ved 2 anmeldelser skjuler serveren opslaget for alle). Den officielle profil `@vibefeed` er automatisk ven med alle, og dens opslag vises fastgjort øverst i "Hele kredsen". Notifikationer kan tappes for at hoppe direkte til opslaget (eller åbne profilen). Kredse styres via medlems-sheetet (tap på medlems-headeren i en kreds): fjern/tilføj medlemmer (ved 3+ medlemmer opretter serveren en Ja/Nej-afstemning i kredsen) og forlad kreds; "Ny kreds"-sheetet har en "Vælg alle"/"Fravælg alle"-knap over vennelisten. Backend er Supabase (auth, Postgres, storage, realtime). Appen er en ren statisk side uden build-step og er også pakket som iOS-app (WKWebView i `ios/`).

Live: deployes automatisk via Vercel — hvert `git push` til `main` udløser et deploy.

## Filoversigt

| Fil | Indhold |
| --- | --- |
| `index.html` | Kun markup: head (CSP m.m.), hele appens HTML samt script-tags nederst |
| `css/app.css` | Hele stylesheetet (flad Instagram-agtig stil) |
| `js/vendor/supabase.js` | Vendored `@supabase/supabase-js` 2.110.0 (UMD-build, urørt) |
| `js/config.js` | Supabase-URL/nøgle, `sb`-klienten, recovery-detektion af hash, `GENERIC_ERR`/`BLOCKED_MSG` |
| `js/store.js` | Delt mutérbar tilstand: `me` (+`setMe`), `USERS`, `state`, composers, `pv`, `curTab` m.m. |
| `js/helpers.js` | Småhjælpere: `esc`, `el`, tidsformat, avatarer/gradienter, `toast`, `imgUrl`, `uuid` |
| `js/auth.js` | Login, opret, glemt/nulstil adgangskode, `boot()`/`resetApp()`, auth-events |
| `js/feed.js` | Hent/render feed (X-layout, `postHTML`, fastgjort `@vibefeed`-opslag), feedbar med kreds-søgning (lup → inline filter af pillerne), slørede teasers fra private kredse (`kreds_teasers`-RPC, `teaserHTML`, anmod-om-at-være-med), likes + saldo (qchip), deling (`sharePost`), faner (`switchTab`), timeline-klik (enkelt-tryk på medie åbner lightboxen, dobbelttryk liker — 320 ms vindue), rediger/slet egne opslag, anmeld andres opslag (`reports`) |
| `js/comments.js` | Kommentartråde (sammenklappet som standard, `cmtSectionHTML`/`toggleCmtSection`), composer, kommentar-likes, billede i kommentar |
| `js/kredse.js` | "Ny kreds"-sheet (`create_feed`-RPC) og medlems-sheet (`remove_kreds_member`/`add_kreds_member`/`leave_kreds`-RPC'er, ejer-tag, forlad kreds) |
| `js/compose.js` | Skriv-skærmen: tekst, medie-menu (kamera/video/bibliotek), billede- og videovedhæftning (video maks. 6 s / 25 MB), meningsmåling-editor, tegn-ring, del-til-valg |
| `js/polls.js` | Meningsmålinger: view-model (`mapPoll`), rendering (`pollHTML`) og stemmeafgivning (`votePoll`) |
| `js/search.js` | Søg-fanen: venner + global søgning + `add_friend`; hele rækken åbner profilpanelet |
| `js/lightbox.js` | Fuldskærms-lightbox: billede med pinch-zoom/pan/dobbelttryk-zoom (Pointer Events, uafhængigt af side-zoom), video med lyd + native controls; scroll-lås og safe-area-luk-knap |
| `js/notifications.js` | Aktivitets-fanen (likes, svar, nye venner, kreds-anmodninger med Godkend/Afvis for kreds-ejeren); tap på en række hopper til opslaget (med flash-highlight) eller åbner profilen |
| `js/profile.js` | Egen profil (statistik, bio, rediger-sheet, avatar, slet konto-popup, log ud), venne- OG ikke-ven-profil (bio, vennetal via RPC'er, "Tilføj til din kreds"-chip for ikke-venner), bobler |
| `js/realtime.js` | Realtime-kanal og debounced refetch ved ændringer/fokus |
| `js/main.js` | Importerer alt, kobler alle event-lyttere (`init*()`), kører opstartssekvensen |
| `kreds-app.html` | Gammel demo — rør den ikke |
| `ios/` | iOS-wrapper-projekt (holdes separat, rør den ikke herfra) |

## Kør lokalt

```
python3 -m http.server 8000
```

Åbn derefter `http://localhost:8000` i browseren. Ingen afhængigheder eller build — filerne serveres som de er.

## Deploy

Push til `main` — Vercel bygger og deployer automatisk.
