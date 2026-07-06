# VibeFeed (kreds)

VibeFeed er en lille dansk social app til lukkede vennekredse: et kronologisk feed med opslag og billeder, indlejrede kommentartråde, en like-økonomi (du kan modtage ét like mere, end du selv har givet), private kredse, vennesøgning, notifikationer og profiler. Backend er Supabase (auth, Postgres, storage, realtime). Appen er en ren statisk side uden build-step.

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
| `js/feed.js` | Hent/render feed, likes + saldo (qchip), faner (`switchTab`), timeline-klik |
| `js/comments.js` | Kommentartråde, composer, kommentar-likes, billede i kommentar |
| `js/kredse.js` | "Ny kreds"-sheet og `create_feed`-RPC |
| `js/compose.js` | Skriv-skærmen: tekst, billedvedhæftning, tegn-ring, del-til-valg |
| `js/search.js` | Søg-fanen: venner + global søgning + `add_friend` |
| `js/notifications.js` | Aktivitets-fanen (likes, svar, nye venner) |
| `js/profile.js` | Egen profil (statistik, rediger-sheet, avatar, slet konto, log ud), venneprofil, bobler |
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
