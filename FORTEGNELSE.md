# Fortegnelse over behandlingsaktiviteter (GDPR artikel 30)

**INTERN — ikke linket fra appen.**

- **Dataansvarlig:** Deniz Filikci
- **Kontakt:** official@vibefeed.dk
- **Tjeneste:** VibeFeed (vibefeed.dk + iOS-app)
- **Senest opdateret:** 7. juli 2026

| Aktivitet | Formål | Kategorier af registrerede / oplysninger | Modtagere / databehandlere | Sletning | Sikkerhed |
| --- | --- | --- | --- | --- | --- |
| Brugerkonti | Oprettelse og drift af profiler, login | Brugere: navn, brugernavn, e-mail, adgangskode-hash, evt. profilbillede og bio | Supabase (database + storage, EU-region Stockholm), Vercel (hosting) | Ved "Slet konto" slettes alt permanent; ellers indtil brugeren selv retter/sletter | Row Level Security (RLS) i Postgres, adgangsbegrænsning (kun ejeren), data i EU |
| Indhold | Det sociale feed: deling i vennekredse | Brugere: opslag, kommentarer, billeder, 6-sekunders videoer, stemmer i meningsmålinger, likes, kreds-medlemskaber, venskaber, aktivitet | Supabase (EU-region Stockholm) | Løbende når brugeren sletter indhold; alt ved kontosletning | RLS begrænser synlighed til venner/kredsmedlemmer; data i EU |
| Notifikationer | Push-notifikationer til brugerens enhed | Brugere: notifikations-token pr. enhed, enhedens sprogvalg | Supabase; Apple (APNs-levering) | Token tilbagekaldes ved log ud/kontosletning | Token udstedes/tilbagekaldes via RPC; adgangsbegrænsning; data i EU |
| Reklamer | Visning af reklamer i appen; personalisering kun med samtykke | Brugere: samtykkevalg (personlig/ikke-personlig); reklame-SDK'ernes egne identifikatorer | Appodeal & Google AdMob | Samtykkevalg ligger lokalt på enheden og kan ændres når som helst | Uden samtykke sendes kun ikke-personlige reklamer; valget styres i appen |
| Moderation | Anmeldelse og skjulning af krænkende opslag | Brugere: anmeldelser (hvem anmeldte hvilket opslag) | Supabase (EU-region Stockholm) | Slettes med opslaget/kontoen | RLS; kun serveren tæller anmeldelser; data i EU |

**Generel sikkerhed:** al data ligger hos Supabase i EU (Stockholm); adgang styres af Row Level Security og server-side RPC'er; adgangskoder gemmes kun som hash; transport via TLS; ingen tredjelandsoverførsel af database-indhold.
