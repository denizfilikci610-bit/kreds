plugins {
    id("com.android.application") version "8.13.2" apply false
    id("org.jetbrains.kotlin.android") version "2.2.20" apply false
    // Compose-compileren følger Kotlin siden 2.0, så versionen skal være den samme
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.20" apply false
}
