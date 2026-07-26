plugins {
    id("com.android.application") version "8.13.2" apply false
    id("org.jetbrains.kotlin.android") version "2.2.20" apply false
    // Compose-compileren følger Kotlin siden 2.0, så versionen skal være den samme
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.20" apply false
    // FCM-push. Selve pluginet anvendes kun i app-modulet NÅR google-services.json
    // findes, så en build uden Firebase-opsætning stadig lykkes (pollen bærer imens).
    id("com.google.gms.google-services") version "4.4.2" apply false
}
