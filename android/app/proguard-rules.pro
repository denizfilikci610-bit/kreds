# Appen er en WebView-skal uden refleksion og uden JavaScript-broer, så der er
# intet R8 kan komme til at fjerne bag om ryggen på os. Skulle der senere komme
# en @JavascriptInterface-klasse, skal den beskyttes her.
-keepattributes JavascriptInterface
-keepattributes *Annotation*
