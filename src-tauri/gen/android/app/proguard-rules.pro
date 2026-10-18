# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# ADR-025. `rustls-platform-verifier` is a Rust crate whose Android half is a
# Kotlin component the Rust code reaches only through JNI, by class name. R8
# cannot see a JNI call it is not part of, so it reads these three classes as
# dead code and removes them — which leaves the verifier uninitialisable and the
# app dying on its first HTTPS request. `includedescriptorclasses` is in the
# rule's documented form for exactly this case; keep it with it.
-keep, includedescriptorclasses class org.rustls.platformverifier.** { *; }

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile