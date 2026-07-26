/*
 * Zoom-justering, kun Android-appen.
 *
 * En Pixel er cirka 412 punkter bred, en iPhone cirka 393. Samme web-layout faar derfor
 * flere spalter-punkter paa Android og ser "zoomet ud" ud i forhold til iPhone-appen.
 *
 * Loesningen er at give siden en lidt smallere layout-bredde og lade WebViewet skalere
 * den op til fuld bredde. Faktoren bor i MainActivity (VF_ZOOM) og skal holdes i sync:
 * de native indhak divideres med den samme faktor, ellers rammer barerne forkert.
 */
(function () {
  "use strict";
  if (window.__vfZoomet) return;
  window.__vfZoomet = true;
  var Z = 1.12;
  var m = document.querySelector('meta[name="viewport"]');
  if (!m) return;
  m.setAttribute(
    "content",
    "width=" + Math.round(screen.width / Z) +
      ", user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content"
  );
})();
