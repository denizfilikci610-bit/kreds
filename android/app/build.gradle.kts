plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
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

    // Upload direkte til den URL web udleverer
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
