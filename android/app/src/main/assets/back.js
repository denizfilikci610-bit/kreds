/* =========================================================================
   Tilbage-knappen på Android.

   Web-appen laver aldrig historik-indgange (den bruger kun replaceState), så
   WebViewets canGoBack er næsten altid falsk. Uden det her ville et tryk på
   tilbage lukke appen, også midt i en chat-tråd eller et åbent minde.

   Scriptet bor med vilje HER i Android-appen og ikke i js/ på vibefeed.dk:
   web-koden deles med iOS-appen der ligger i App Store, og den må ikke røres.
   Første linje spørger derfor efter window.vfBack, så web-koden senere kan
   overtage rent, uden at appen skal bygges om.

   Lagene lukkes i samme rækkefølge som de ligger i (z-index fra css/app.css).
   ========================================================================= */
(function () {
  if (window.__vfAndroidBack) return;

  function el(sel) {
    return document.querySelector(sel);
  }
  /* Et lag er åbent når det bærer klassen .on, som hele web-appen bruger */
  function open(sel) {
    var e = el(sel);
    return e && e.classList.contains("on") ? e : null;
  }
  function press(node) {
    if (!node) return false;
    node.click();
    return true;
  }
  /* Menuer lukkes ved at fjerne .on, præcis som luk-funktionerne i js/ gør.
     Vi trykker bevidst IKKE på knapperne i dem: de udfører handlinger. */
  function dismissTopMenu(scope) {
    var menus = (scope || document).querySelectorAll(".modal.on");
    if (!menus.length) return false;
    menus[menus.length - 1].classList.remove("on");
    return true;
  }

  window.__vfAndroidBack = function () {
    try {
      /* Overtager web-koden en dag, vinder den */
      if (typeof window.vfBack === "function") return window.vfBack() === true;

      /* Fuldskærms-medie (z 300) */
      if (open("#lightbox")) return press(el("#lb-close"));

      /* Invitations-arket (z 240) */
      if (open("#inviteview")) return press(el("#invite-later"));

      /* Story-viseren (z 200). Menuen inde i den ligger øverst og lukkes først. */
      var story = open("#storyview");
      if (story) {
        if (dismissTopMenu(story)) return true;
        if (press(story.querySelector(".sv-close"))) return true;
        story.classList.remove("on");
        return true;
      }

      /* Sprogvalg, login og samtykke er porte, ikke sider: de kan ikke lukkes med
         tilbage. Vi svarer nej, og Android lægger appen i baggrunden i stedet. */
      if (open("#langview") || open("#authview") || open("#consentview")) return false;

      /* Menuer og bekræftelser (z 120) */
      if (dismissTopMenu(document)) return true;

      /* Komposeren (z 90) */
      if (open("#compose")) return press(el("#compose-cancel"));

      /* Sider der glider ind fra højre (z 90, chat 85), øverste først.
         Alle har den samme tilbage-pil i deres .pv-head. */
      var pages = document.querySelectorAll(".postview.on");
      if (pages.length) {
        var top = pages[pages.length - 1];
        for (var i = pages.length - 1; i >= 0; i--) {
          if (pages[i].id !== "chatview") { top = pages[i]; break; }
        }
        if (press(top.querySelector(".pv-head .back"))) return true;
        top.classList.remove("on");
        return true;
      }

      /* Ark bag scrimmen (z 80). Scrimmens egen lytter i js/main.js lukker dem alle. */
      if (open("#scrim")) return press(el("#scrim"));

      /* Profil-siden (z 70) */
      if (open("#profileview")) return press(el("#pv-back"));

      /* Står vi på en anden fane, fører tilbage til feedet i stedet for ud af
         appen. Det er den samme opførsel som Instagram og Google Fotos har. */
      var view = document.querySelector(".view.active");
      if (view && view.id !== "view-feed") {
        var tab = document.querySelector('.tabbar [data-view="feed"]');
        if (tab) return press(tab);
      }
    } catch (e) {
      /* En fejl her må aldrig kunne låse tilbage-knappen: sig nej og lad
         Android gøre sit normale (lægge appen i baggrunden). */
    }
    return false;
  };
})();
