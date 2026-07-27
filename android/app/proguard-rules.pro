# R8-regler for release-buildet.
#
# Appen er ikke længere den rene WebView-skal den startede som: der er en besked-bro,
# en baggrunds-worker og en FCM-tjeneste, og de tre bliver alle fundet af NAVN på
# kørselstidspunktet. Bliver de omdøbt eller fjernet, fejler de TAVST, hvilket er
# den værste slags fejl at opdage i produktion.

# --- Crash-rapporter skal kunne læses i Play Console.
# Uden de to linjer er hvert stakspor bare a.b.c(Unknown Source), og en fejlmelding
# fra en tester er dermed ubrugelig.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# --- WorkManager instantierer workeren via REFLEKSION, ud fra et klassenavn den har
# gemt i sin egen database. Omdøber R8 klassen, peger den gemte kvarters-opgave på et
# navn der ikke findes mere, og notifikations-pollen holder op med at køre.
-keep class dk.vibefeed.app.notif.VfPollWorker { *; }
-keep class * extends androidx.work.ListenableWorker { <init>(...); }

# --- FCM-tjenesten instantieres af Android ud fra manifestet. Manifest-klasser holdes
# normalt af de indbyggede regler, men den her er for vigtig til at bero på det.
-keep class dk.vibefeed.app.notif.VfMessagingService { *; }

# --- Besked-broen. WebViewCompat kalder tilbage på lytteren, og skulle der senere
# komme en ægte @JavascriptInterface-klasse, skal dens metoder overleve.
-keepattributes JavascriptInterface
-keepattributes *Annotation*
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# --- OkHttp trækker valgfrie Conscrypt/BouncyCastle-stier med sig som ikke findes på
# Android. Advarslerne er ufarlige, men de får bygningen til at fejle uden det her.
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
