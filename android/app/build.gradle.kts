plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// FCM virker først når ejeren har lagt google-services.json her i app-mappen (fra
// Firebase-konsollen). Indtil da bygger appen fint uden, og notifikationerne kommer
// gennem kvarters-pollen i stedet. Pluginet må derfor kun anvendes når filen findes.
//
// Server-siden ER klar: send-push v43 (i repoet, deployet) har FCM-grenen og vælger
// platform per device_tokens-række, og register-push v25 udleder platformen af
// token-formatet. Det eneste der mangler er filen her plus FCM_SERVICE_ACCOUNT-
// hemmeligheden i Supabase.
//
// ⚠️ VIGTIGT når filen hentes: registrér BÅDE dk.vibefeed.app OG dk.vibefeed.app.debug
// som Android-apps i Firebase-konsollen og hent en google-services.json med begge
// klienter. Debug-varianten har applicationIdSuffix ".debug", og pluginet fejler hårdt
// på assembleDebug hvis pakkenavnet ikke findes i filen.
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

// Signeringen læses fra ~/.gradle/gradle.properties, ALDRIG fra repoet. Så ligger hverken
// nøglefilen eller kodeordet et sted hvor de kan blive committet ved et uheld, og en build
// på en maskine uden nøglen fejler ikke, den laver bare en usigneret udgave.
//   vfStoreFile=/Users/…/vibefeed-upload.jks
//   vfStorePassword=…
//   vfKeyAlias=upload
//   vfKeyPassword=…
val vfStoreFile: String? = providers.gradleProperty("vfStoreFile").orNull
val vfStorePassword: String? = providers.gradleProperty("vfStorePassword").orNull
val vfKeyAlias: String? = providers.gradleProperty("vfKeyAlias").orNull
val vfKeyPassword: String? = providers.gradleProperty("vfKeyPassword").orNull
val hasUploadKey = !vfStoreFile.isNullOrBlank() && file(vfStoreFile).exists()

android {
    namespace = "dk.vibefeed.app"
    compileSdk = 36

    signingConfigs {
        if (hasUploadKey) {
            create("upload") {
                storeFile = file(vfStoreFile!!)
                storePassword = vfStorePassword
                keyAlias = vfKeyAlias
                keyPassword = vfKeyPassword
            }
        }
    }

    defaultConfig {
        applicationId = "dk.vibefeed.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        resourceConfigurations += listOf("en", "da")
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            if (hasUploadKey) signingConfig = signingConfigs.getByName("upload")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }

    buildFeatures {
        buildConfig = true
        compose = true
    }
}

// Versionerne holdes bevidst på det nyeste der virker med Android Gradle plugin 8.13
// og compileSdk 36. De nyeste AndroidX-udgivelser kræver AGP 9, som kun findes i alpha.
dependencies {
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.browser:browser:1.8.0")

    // De native skærme. SwiftUI-koden på iOS oversætter næsten linje for linje til Compose.
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation(platform("androidx.compose:compose-bom:2026.03.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")

    // Kameraet i minde- og story-komposeren
    implementation("androidx.camera:camera-core:1.5.3")
    implementation("androidx.camera:camera-camera2:1.5.3")
    implementation("androidx.camera:camera-lifecycle:1.5.3")
    implementation("androidx.camera:camera-video:1.5.3")
    implementation("androidx.camera:camera-view:1.5.3")

    // Miniaturer i galleri-gitteret
    implementation("io.coil-kt:coil-compose:2.7.0")
    // Video-miniaturer i galleri-gitteret og forhåndsvisningerne. Uden dekoderen er
    // ALLE video-flader blanke grå plader med et varigheds-badge.
    implementation("io.coil-kt:coil-video:2.7.0")

    // EXIF, så et billede taget på højkant ikke lander på siden
    implementation("androidx.exifinterface:exifinterface:1.4.1")

    // Video: loopende preview i trim og beskærer, plus selve eksporten med klip,
    // beskæring og målstørrelse
    implementation("androidx.media3:media3-exoplayer:1.5.1")
    implementation("androidx.media3:media3-ui:1.5.1")
    implementation("androidx.media3:media3-transformer:1.5.1")
    implementation("androidx.media3:media3-effect:1.5.1")
    implementation("androidx.media3:media3-common:1.5.1")

    // Upload direkte til den URL web udleverer
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // Notifikationer: FCM-push når Firebase er sat op, ellers kvarters-pollen som
    // sikkerhedsnet (samme arbejdsdeling som iOS' APNs + BGAppRefresh)
    implementation("com.google.firebase:firebase-messaging:24.1.0")
    implementation("androidx.work:work-runtime-ktx:2.10.1")
}
