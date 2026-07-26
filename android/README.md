# VibeFeed til Android

Samme model som iOS-appen: **én WebView på det live site https://vibefeed.dk**.
Al app-logik bor i `js/` og `css/` og er allerede ude hos brugerne. Denne mappe
indeholder kun den skal Android har brug for.

## Hvorfor der ikke sættes nogen `window.__vf`-flag

Web-koden bruger flag som `__vfNative`, `__vfPhotoLib` og `__vfComments` til at sige
"der findes en native erstatning for det her". iOS sætter dem i `WebView.swift`.
Android sætter **ingen** af dem, og det er med vilje.

Det vigtigste eksempel: `js/main.js` sætter `body.native` når `__vfNative` er sat, og
`css/app.css` skjuler så både `.tabbar` og `.feedbar`, fordi iOS leverer dem nativt.
Satte Android det flag uden at levere barerne, ville al navigation forsvinde.

Uden flagene falder web-koden selv tilbage til sine egne versioner. Det eneste man
ikke kan i dag er at **oprette** en story: `js/compose.js` når kun `insertStory` gennem
den native bro. Man kan godt se andres stories.

## De fire ting skallen faktisk leverer

1. **Tilbage-knappen** (`assets/back.js`). Web-appen laver aldrig historik-indgange, kun
   `replaceState`, så `WebView.canGoBack()` er næsten altid falsk. Uden det her ville
   tilbage lukke appen midt i en chat-tråd. Scriptet lukker i stedet det øverste åbne
   lag i siden, i samme rækkefølge som lagene ligger (z-index fra `css/app.css`).
   Det bor her og ikke i `js/`, fordi web-koden deles med iOS-appen i App Store.
   Første linje spørger efter `window.vfBack`, så web-koden kan overtage senere uden
   at appen skal bygges om.
2. **Filvælgeren** (`onShowFileChooser`). Uden den gør `<input type="file">` bogstaveligt
   talt ingenting i et Android WebView, og så kan man hverken poste et minde, skifte
   profilbillede eller sende et billede i chatten.
3. **Ruter for links.** Samme værtsliste som `ios/VibeFeed/WebView.swift`. Alt andet
   åbnes uden for appen: websider i en Custom Tab, `mailto:` og `tel:` i den app der
   kan dem.
4. **Systemets kanter.** Fra Android 15 tegner apps kant til kant, og et WebView
   rapporterer altid `env(safe-area-inset-*)` som nul. Indhakkene lægges derfor som
   polstring omkring WebViewet. Tastaturet tæller med, så siden krymper når det åbner.

## Tilladelser

Kun `INTERNET`. Billeder hentes gennem systemets fotovælger og kameraet gennem
`ACTION_IMAGE_CAPTURE`, som kamera-appen udfører for os. Erklærede vi `CAMERA` i
manifestet, ville Android begynde at kræve den tilladelse også for den intent, så
erklæringen ville gøre det værre, ikke bedre.

## Byg og installér

Værktøjerne ligger i brugermappen, ikke i systemet:

```bash
export JAVA_HOME=$HOME/.local/jdk/jdk-21.0.11+10/Contents/Home
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH="$ANDROID_HOME/platform-tools:$PATH"
cd android && ./gradlew installDebug
```

`local.properties` peger på SDK'et og er ikke i git. Skal den laves igen:

```bash
echo "sdk.dir=$HOME/Library/Android/sdk" > android/local.properties
```

Telefonen skal have Udviklerindstillinger og USB-fejlfinding slået til, og den skal
godkende computerens nøgle første gang (`adb devices` skal vise `device`, ikke
`unauthorized`).

## Udestående

- **App Links.** Manifestet er klar, men `.well-known/assetlinks.json` på vibefeed.dk
  kræver SHA-256-fingeraftrykket fra Play App Signing, som først findes efter den
  første upload til Play. Indtil da åbner bekræftelses- og nulstillingsmails i Chrome,
  hvor de virker præcis som før.
- **Push.** `supabase/functions/send-push` taler kun APNs. Android kræver FCM ved siden
  af, plus en `platform`-kolonne på `device_tokens`.
- **Deling.** `js/invite.js` peger på App Store-linket, og `navigator.share` findes ikke
  i et Android WebView (den falder tilbage til udklipsholderen). Begge dele skal rettes
  når appen har en adresse i Google Play.
- **Stories.** Kan ses, men ikke oprettes, før der er en native komposer.
