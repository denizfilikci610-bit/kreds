# VibeFeed (kreds)

VibeFeed er en lille dansk social app til lukkede vennekredse: et kronologisk feed (X-agtigt layout: avatar-kolonne, header-linje med @handle · tid, medie i afrundet kort) med opslag, billeder, korte videoer (maks. 6 sekunder, maks. 25 MB — optages med kameraet i appen eller vælges fra biblioteket; afspilles lydløst i loop, tryk slår lyden til/fra) og meningsmålinger, indlejrede kommentartråde (sammenklappet som standard — boble/“Vis kommentarer (X)” folder tråd + kommentarfelt ud), en like-økonomi (du kan modtage ét like mere, end du selv har givet), private kredse, vennesøgning, notifikationer og profiler (med bio). Opslag til hele kredsen kan deles via systemets dele-ark (navigator.share, ellers kopieres teksten); opslag i private kredse kan ikke deles. Egne opslag kan redigeres og slettes. Backend er Supabase (auth, Postgres, storage, realtime). Appen er en ren statisk side uden build-step og er også pakket som iOS-app (WKWebView i `ios/`).

Live: deployes automatisk via Vercel — hvert `git push` til `main` udløser et deploy.

## Filoversigt

| Fil | Indhold |
| --- | --- |
| `index.html` | Kun markup: head (CSP m.m.), hele appens HTML samt script-tags nederst |
| `css/app.css` | Hele stylesheetet (flad Instagram-agtig stil) |
| `js/vendor/supabase.js` | Vendored `@supabase/supabase-js` 2.110.0 (UMD-build, urørt) |
| `js/config.js` | Supabase-URL/nøgle, `sb`-klienten, recovery-detektion af hash, `GENERIC_ERR` |
| `js/store.js` | Delt mutérbar tilstand: `me` (+`setMe`), `USERS`, `state`, composers, `pv`, `curTab` m.m. |
| `js/helpers.js` | Småhjælpere: `esc`, `el`, tidsformat, avatarer/gradienter, `toast`, `imgUrl`, `uuid` |
| `js/auth.js` | Login, opret, glemt/nulstil adgangskode, `boot()`/`resetApp()`, auth-events |
| `js/feed.js` | Hent/render feed (X-layout, `postHTML`), likes + saldo (qchip), deling (`sharePost`), faner (`switchTab`), timeline-klik (inkl. video-lyd og dobbelttryk-like), rediger/slet egne opslag |
| `js/comments.js` | Kommentartråde (sammenklappet som standard, `cmtSectionHTML`/`toggleCmtSection`), composer, kommentar-likes, billede i kommentar |
| `js/kredse.js` | "Ny kreds"-sheet og `create_feed`-RPC |
| `js/compose.js` | Skriv-skærmen: tekst, medie-menu (kamera/video/bibliotek), billede- og videovedhæftning (video maks. 6 s / 25 MB), meningsmåling-editor, tegn-ring, del-til-valg |
| `js/polls.js` | Meningsmålinger: view-model (`mapPoll`), rendering (`pollHTML`) og stemmeafgivning (`votePoll`) |
| `js/search.js` | Søg-fanen: venner + global søgning + `add_friend` |
| `js/notifications.js` | Aktivitets-fanen (likes, svar, nye venner) |
| `js/profile.js` | Egen profil (statistik, bio, rediger-sheet, avatar, slet konto-popup, log ud), venneprofil (bio + vennetal), bobler |
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
