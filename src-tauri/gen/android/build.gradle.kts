buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:9.3.1")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.10")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
        // ADR-025. `rustls-platform-verifier` needs a Kotlin component to reach
        // Android's trust store, and the crate publishes it as a Maven artifact
        // from its own repository rather than from Maven Central.
        maven {
            url = uri("https://github.com/rustls/rustls-platform-verifier/raw/maven-archive/android-release-support/maven/")
        }
    }
}

/** The version of the Kotlin component, read out of Cargo.lock.

    Cargo resolves `rustls-platform-verifier-android` alongside the Rust crate,
    and the two have to be the same version — the Rust half calls into the Java
    half by symbol. Hard-coding it here would work until either moved, and then
    the failure is a runtime crash rather than a build error, so the version is
    taken from the lockfile every time instead. A `ValueSource` rather than a
    plain read so `org.gradle.configuration-cache=true` stays happy. */
abstract class RustlsVersion : ValueSource<String, RustlsVersion.Params> {
    interface Params : ValueSourceParameters {
        val lockFile: RegularFileProperty
    }

    companion object {
        const val CRATE_NAME = "rustls-platform-verifier-android"
    }

    override fun obtain(): String {
        val lines = parameters.lockFile.get().asFile.readLines()
        val nameIdx = lines.indexOfFirst { it.trim() == "name = \"$CRATE_NAME\"" }
        if (nameIdx < 0) error("$CRATE_NAME not found in ${parameters.lockFile.get().asFile}")
        return lines.drop(nameIdx + 1)
            .firstOrNull { it.trimStart().startsWith("version = ") }
            ?.substringAfter('"', "")
            ?.substringBefore('"', "")
            ?: error("$CRATE_NAME has no version in ${parameters.lockFile.get().asFile}")
    }
}

val rustlsPlatformVerifierVersion = providers.of(RustlsVersion::class.java) {
    parameters.lockFile.set(layout.projectDirectory.file("../../Cargo.lock"))
}

allprojects {
    configurations.configureEach {
        resolutionStrategy.eachDependency {
            if (requested.group == "org.rustls" && requested.name == "rustls-platform-verifier") {
                useVersion(rustlsPlatformVerifierVersion.get())
                because("must match rustls-platform-verifier-android in Cargo.lock")
            }
        }
    }
}

tasks.register("clean").configure {
    delete("build")
}

