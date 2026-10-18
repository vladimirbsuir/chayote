import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 37
    namespace = "com.chayote.app"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.chayote.app"
        minSdk = 26
        targetSdk = 37
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    // ADR-025: release builds are signed with the project keystore rather than a
    // debug key. Android refuses an update whose signing certificate differs from
    // the installed one, so a debug-signed APK could never be updated in place —
    // and the standard debug keystore is public knowledge, which would make any
    // APK claiming to be this app installable. `keystore.properties` is generated
    // per machine and in CI from secrets, and is gitignored, so this block
    // resolves to null properties when it is absent and the release build falls
    // back to unsigned rather than failing with a confusing key error.
    val keystoreProperties = mutableMapOf<String, String>()
    val keystorePropertiesFile = rootProject.file("keystore.properties")
    if (keystorePropertiesFile.exists()) {
        // Read by hand rather than with `java.util.Properties`, which treats the
        // file as a properties *escape* format: on a Windows machine
        // `storeFile=C:\Users\…\chayote-release.jks` comes back as
        // `C:Users…` with a vertical tab where the backslash was, and the build
        // then fails with "Keystore file not found" for a path that never
        // existed. A keystore path is a path, not an escape sequence, so the
        // value is taken exactly as written and only the surrounding space goes.
        keystorePropertiesFile.readLines().forEach { line ->
            val trimmed = line.trim()
            if (trimmed.isEmpty() || trimmed.startsWith("#")) return@forEach
            val split = trimmed.indexOf('=')
            if (split > 0) {
                keystoreProperties[trimmed.substring(0, split).trim()] =
                    trimmed.substring(split + 1).trim()
            }
        }
    }

    val keystorePath = keystoreProperties["storeFile"]
    val keystoreFile =
        when {
            keystorePath == null -> null
            File(keystorePath).isAbsolute -> File(keystorePath)
            else -> file(keystorePath)
        }

    signingConfigs {
        if (keystoreFile != null) {
            create("release") {
                keyAlias = keystoreProperties["keyAlias"]
                keyPassword = keystoreProperties["password"]
                storeFile = keystoreFile
                storePassword = keystoreProperties["password"]
            }
        }
    }

    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            if (keystoreFile != null) {
                signingConfig = signingConfigs.getByName("release")
            }
            optimization {
               enable = true
            }
            proguardFiles(
                *fileTree(".") {
                  include("**/*.pro")
                  exclude("build/**")
                }.files.toTypedArray()
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    // ADR-025. `rustls-platform-verifier` is a Rust crate that also has a Kotlin
    // component, and the Rust half panics on Android with "Expect
    // rustls-platform-verifier to be initialized" until that component is in the
    // build and has run. It is what makes the updater's HTTPS work: this is the
    // certificate check that `download()` performs before it will return a byte.
    //
    // No version on purpose. The root build script reads it out of Cargo.lock at
    // configuration time, because it must equal the version of
    // `rustls-platform-verifier-android` cargo resolved, and a version written
    // here would drift from that the next time either moves.
    implementation("org.rustls:rustls-platform-verifier")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
