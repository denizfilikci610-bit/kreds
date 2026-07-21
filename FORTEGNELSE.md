# Fortegnelse over behandlingsaktiviteter (GDPR artikel 30)

**INTERN. Ikke linket fra appen.**

- **Dataansvarlig:** Deniz Filikci
- **Kontakt:** official@vibefeed.dk
- **Tjeneste:** VibeFeed (vibefeed.dk + iOS-app)
- **Senest opdateret:** 21. juli 2026

| Aktivitet | Formål | Kategorier af registrerede / oplysninger | Modtagere / databehandlere | Sletning | Sikkerhed |
| --- | --- | --- | --- | --- | --- |
| Brugerkonti | Oprettelse og drift af profiler, login | Brugere: navn, brugernavn, e-mail, adgangskode-hash, evt. profilbillede, banner og bio | Supabase (database + storage, EU-region Stockholm), Vercel (hosting) | Ved "Slet konto" slettes alt permanent; ubekræftede konti slettes automatisk efter 24 timer; ellers indtil brugeren selv retter/sletter | Row Level Security (RLS) i Postgres, adgangsbegrænsning (kun ejeren), data i EU |
| Indhold | Det sociale feed: deling i vennekredse | Brugere: tanker og minder, kommentarer, billeder, korte videoer, stemmer i meningsmålinger, likes, gemte opslag, @-omtaler, kreds-medlemskaber, venskaber, aktivitet | Supabase (EU-region Stockholm) | Løbende når brugeren sletter indhold; alt ved kontosletning | RLS begrænser synlighed til venner/kredsmedlemmer; data i EU |
| Stories | Kortlivet deling i kredsen | Brugere: billede eller video, samt hvem der har set den (vises kun til forfatteren) | Supabase (EU-region Stockholm) | Automatisk efter 24 timer, eller når brugeren selv sletter; alt ved kontosletning | RLS som resten af indholdet; visningslisten kan kun læses af forfatteren; data i EU |
| Beskeder | Kreds-chat og private samtaler | Brugere: beskedtekst, billeder og videoer i beskeder, reaktioner, citat-svar, læse-kvitteringer | Supabase (EU-region Stockholm); Apple (APNs) når notifikationen indeholder afsendernavn og et uddrag af beskeden | Løbende når brugeren sletter en besked eller rydder en tråd; alt ved kontosletning, også beskeder sendt ind i andres tråde | RLS: kun deltagerne i tråden; **ikke** ende-til-ende-krypteret, den dataansvarlige har teknisk DB-adgang; transport via TLS |
| Notifikationer | Push-notifikationer til brugerens enhed | Brugere: notifikations-token pr. enhed, enhedens sprogvalg, badge-tal | Supabase; Apple (APNs-levering) | Token tilbagekaldes ved log ud/kontosletning | Token udstedes/tilbagekaldes via RPC; adgangsbegrænsning; data i EU |
| E-mail | Bekræftelse af e-mail og nulstilling af adgangskode | Brugere: e-mailadresse, engangslink | Google (Gmail SMTP) | Links udløber; mails opbevares i mailkontoen | Kun transaktionelle mails; ingen nyhedsbreve; TLS |
| Reklamer | Ingen. Reklamer er slukket i hele appen | Ingen. Der kører intet reklame-SDK, og der bliver ikke bedt om sporingstilladelse (ATT) | Ingen | Et gammelt samtykkevalg kan ligge lokalt på enheden og bruges ikke | Én fælles kill-switch (ADS_LIVE i js/ads.js) som både web og app retter sig efter |
| Moderation | Anmeldelse og skjulning af krænkende indhold, blokering af brugere | Brugere: anmeldelser af opslag, kommentarer, beskeder og stories (hvem anmeldte hvad); blokeringer | Supabase (EU-region Stockholm) | Slettes med indholdet/kontoen | RLS; kun serveren tæller anmeldelser; data i EU |

**Generel sikkerhed:** al data i database og fillagring ligger hos Supabase i EU (Stockholm); adgang styres af Row Level Security og server-side RPC'er; adgangskoder gemmes kun som hash; transport via TLS.

**Tredjelande:** database og filer forlader ikke EU. To databehandlere kan behandle oplysninger uden for EU som led i deres levering: Apple (push-notifikationer, herunder afsendernavn og uddrag af beskedtekst) og Google (transaktionelle e-mails). Begge sker på deres standardvilkår.
