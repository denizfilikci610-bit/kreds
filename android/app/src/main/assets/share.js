/*
 * navigator.share-shim, kun Android-appen.
 *
 * iPhone-appens WKWebView HAR navigator.share, saa "Del" og "Inviter en ven" aabner
 * systemets dele-ark dér. Et Android WebView har den IKKE, og web-koden falder saa
 * tilbage til udklipsholderen med en toast der er usynlig bag de native sider.
 *
 * Shimmen sender i stedet indholdet over broen, og appen aabner Androids eget dele-ark
 * (ACTION_SEND). Web-koden er urort: den kalder bare navigator.share som paa iPhone.
 */
(function () {
  "use strict";
  if (navigator.share) return;
  if (!(window.webkit && window.webkit.messageHandlers &&
        window.webkit.messageHandlers.vibefeed)) return;
  navigator.share = function (data) {
    try {
      window.webkit.messageHandlers.vibefeed.postMessage({
        type: "share",
        title: (data && data.title) || "",
        text: (data && data.text) || "",
        url: (data && data.url) || ""
      });
      return Promise.resolve();
    } catch (e) {
      return Promise.reject(e);
    }
  };
})();
