/* =========================================================================
   De to flydende opret-knapper (minde øverst, tanke nederst).

   På iOS bor de i den native fanebjælke (ios/VibeFeed/TabBarView.swift,
   NativeComposeButtons) og trykker over broen med window.vfTab("compose-memory")
   og window.vfTab("compose-thought"). Web-fanebjælken i index.html har dem
   IKKE, kun de fem faner, så uden native bar er der ingen vej til komposeren
   overhovedet. Derfor tegner appen dem her.

   De kalder ikke noget nyt: de trykker på #cm-memory og #cm-thought, altså
   præcis de to knapper vælgeren allerede bruger, og som begge ender i
   openComposeWith(kind) i js/compose.js. Det er nøjagtig samme funktion som
   window.vfTab rammer på iOS.

   Ligesom back.js bor scriptet HER og ikke i js/, fordi web-koden deles med
   iOS-appen i App Store. Når den er ude af review, hører knapperne rettelig
   hjemme i web-laget (skjult med body.native), for så får browseren dem også.
   ========================================================================= */
(function () {
  if (document.getElementById("vf-fabs")) return;

  /* Fanebjælken skal FORSVINDE når man scroller ned, som den native bjælke gør på iOS
     (TabBarView: offset 130 + opacity 0 ved compact). Web-css'en krymper den kun til .86,
     fordi den regel er skrevet til browseren. Vi retter den her i appen, ikke i css/app.css,
     som deles med iOS-appen der er i review. */
  var LAG = "\
body.hidebar .tabbar{transform:translateY(150%);opacity:0;pointer-events:none}\
#vf-fabs{position:fixed;z-index:51;right:16px;\
bottom:calc(max(8px, env(safe-area-inset-bottom) - 8px) + 72px);\
display:flex;flex-direction:column;gap:14px;\
opacity:0;visibility:hidden;pointer-events:none;\
transition:opacity .2s ease, visibility .2s ease, transform .42s cubic-bezier(.28,.9,.32,1.2)}\
#vf-fabs.on{opacity:1;visibility:visible;pointer-events:auto}\
body.hidebar #vf-fabs{transform:translateY(44px)}\
[dir=rtl] #vf-fabs{right:auto;left:16px}\
#vf-fabs button{width:56px;height:56px;border-radius:999px;border:0;padding:0;\
display:flex;align-items:center;justify-content:center;\
background:var(--red,#E0402F);color:#fff;\
box-shadow:0 4px 10px rgba(0,0,0,.22);\
transition:transform .16s cubic-bezier(.32,.72,.25,1)}\
#vf-fabs button:active{transform:scale(.9)}\
#vf-fabs svg{width:24px;height:24px;display:block}";

  var style = document.createElement("style");
  style.id = "vf-fabs-style";
  style.textContent = LAG;
  document.head.appendChild(style);

  /* Samme to symboler som iOS: et billede til minder, et plus til tanker */
  var MINDE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
    + '<path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm1.6 12h12.8l-4-5.2-3.1 3.9-2.1-2.5L5.6 17ZM8 10.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/>'
    + '</svg>';
  var TANKE = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">'
    + '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'
    + '</svg>';

  function label(key, fallback) {
    try {
      var el = document.querySelector('[data-i18n="' + key + '"]');
      var s = el && el.textContent && el.textContent.trim();
      return s || fallback;
    } catch (e) { return fallback; }
  }

  var wrap = document.createElement("div");
  wrap.id = "vf-fabs";

  function fab(html, targetId, ariaKey, ariaFallback) {
    var b = document.createElement("button");
    b.type = "button";
    b.innerHTML = html;
    b.setAttribute("aria-label", label(ariaKey, ariaFallback));
    b.addEventListener("click", function () {
      /* Vælgerens egen knap ejer flowet. Den fjerner .on fra #composemenu (uskadeligt
         når menuen ikke er åben) og kalder openComposeWith(kind). */
      var target = document.getElementById(targetId);
      if (target) target.click();
    });
    return b;
  }

  wrap.appendChild(fab(MINDE, "cm-memory", "chooser.memory", "Post et minde"));
  wrap.appendChild(fab(TANKE, "cm-thought", "chooser.thought", "Post en tanke"));
  document.body.appendChild(wrap);

  /* Knapperne hører til feedet, præcis som på iOS, og de skal væk når noget
     ligger ovenpå. Overlays har højere z-index og dækker dem alligevel, men
     så bliver de heller ikke ved med at kunne trykkes gennem et halvgennem-
     sigtigt lag. Selectoren er den samme som js/main.js selv bruger. */
  var BLOKERET = "#scrim.on, .compose.on, .profileview.on, .postview.on, #chatview.on,"
    + " #lightbox.on, #authview.on, #langview.on, #consentview.on, #inviteview.on,"
    + " .storyview.on, .modal.on";

  function refresh() {
    var view = document.querySelector(".view.active");
    var onFeed = !!view && view.id === "view-feed";
    var splash = document.getElementById("splash");
    var booting = !!splash && !splash.classList.contains("gone");
    var blocked = booting || !!document.querySelector(BLOKERET);
    wrap.classList.toggle("on", onFeed && !blocked);
  }

  refresh();
  /* Faneskift, ark der åbner og lukker, og hidebar sætter alt sammen klasser,
     så det er nok at følge attributter i hele dokumentet. */
  new MutationObserver(refresh).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
    subtree: true,
  });
})();
