/* =========================================================================
   env(safe-area-inset-*) på Android.

   Hele web-appens layout hviler på env(safe-area-inset-top) og -bottom: topbaren,
   kreds-baren, fanebjælken, story-viseren, lightboxen og feedets bundpolstring,
   31 steder i css/app.css. På iOS fylder appen hele skærmen og iOS fortæller
   siden hvor uret og hjemme-streget er, så indholdet flyder ind under dem og
   barerne lægger sig pænt neden under.

   Et Android WebView rapporterer ALTID nul. Lader man appen fylde skærmen uden
   at gøre noget, lægger kreds-baren sig op i uret. Polstrer man i stedet
   WebViewet, som appen gjorde før, bliver indholdet lukket inde i en kasse
   mellem to sorte bjælker, og så ligner det ikke iPhone-appen.

   Løsningen her: appen fylder skærmen, og Kotlin melder de rigtige indhak ind
   via window.__vfInsets. Vi finder så ENHVER regel i sidens egne stylesheets der
   nævner safe-area-inset, og skriver den om med de målte tal ind i vores eget
   ark, som ligger sidst og derfor vinder. Så virker de 31 regler som de skal,
   uden at en eneste linje web-kode ændres, og det bliver ved med at virke hvis
   web-koden får flere af dem.
   ========================================================================= */
(function () {
  if (window.__vfInsets) return;

  var SIDER = { top: 0, right: 0, bottom: 0, left: 0 };
  var ark = null;

  function nyttArk() {
    var el = document.getElementById("vf-safe-area");
    if (el) return el;
    el = document.createElement("style");
    el.id = "vf-safe-area";
    document.head.appendChild(el);
    return el;
  }

  /* env(safe-area-inset-top) og env(safe-area-inset-top, 0px) skal begge fanges */
  var ENV = /env\(\s*safe-area-inset-(top|right|bottom|left)\s*(?:,[^()]*)?\)/g;

  function udskift(tekst) {
    return tekst.replace(ENV, function (_hel, side) {
      return SIDER[side] + "px";
    });
  }

  /* Samler reglerne. @media og @supports skal med, for de fleste af appens
     regler bor inde i en media-blok, og en omskrevet regel uden sin blok ville
     ramme forkert. */
  function saml(regler, ud) {
    for (var i = 0; i < regler.length; i++) {
      var r = regler[i];
      var tekst;
      try { tekst = r.cssText; } catch (e) { continue; }
      if (!tekst || tekst.indexOf("safe-area-inset") < 0) continue;

      if (r.cssRules && (r.type === 4 || r.type === 12)) {
        // 4 = @media, 12 = @supports
        var indre = [];
        saml(r.cssRules, indre);
        if (indre.length) {
          var betingelse = r.conditionText || (r.media && r.media.mediaText) || "";
          var nøgleord = r.type === 4 ? "@media" : "@supports";
          ud.push(nøgleord + " " + betingelse + "{" + indre.join("") + "}");
        }
        continue;
      }
      if (r.style) ud.push(udskift(tekst));
    }
  }

  function skrivOm() {
    var ud = [];
    var ark2 = document.styleSheets;
    for (var i = 0; i < ark2.length; i++) {
      var regler;
      try { regler = ark2[i].cssRules; } catch (e) { continue; } // fremmed oprindelse
      if (!regler) continue;
      if (ark2[i].ownerNode && ark2[i].ownerNode.id === "vf-safe-area") continue;
      saml(regler, ud);
    }
    ark = nyttArk();
    ark.textContent = ud.join("\n");
    return ud.length;
  }

  /* Kotlin kalder den her, både lige efter siden er klar og hver gang indhakkene
     ændrer sig (rotation, tastatur, skift mellem gestus og knapper). */
  window.__vfInsets = function (top, right, bottom, left) {
    var t = Math.max(0, Math.round(top || 0));
    var r = Math.max(0, Math.round(right || 0));
    var b = Math.max(0, Math.round(bottom || 0));
    var l = Math.max(0, Math.round(left || 0));
    if (t === SIDER.top && r === SIDER.right && b === SIDER.bottom && l === SIDER.left && ark) return;
    SIDER = { top: t, right: r, bottom: b, left: l };
    /* Også som variabler, så vores egne indsprøjtede lag kan bruge dem */
    var rod = document.documentElement.style;
    rod.setProperty("--vf-sat", t + "px");
    rod.setProperty("--vf-sar", r + "px");
    rod.setProperty("--vf-sab", b + "px");
    rod.setProperty("--vf-sal", l + "px");
    return skrivOm();
  };
})();
