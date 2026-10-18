package com.chayote.app

import android.content.Context
import android.app.Application

/** ADR-025: where the Rust side is given what it needs to verify a certificate.
 *
 * `rustls-platform-verifier` reaches Android's trust store by calling back into
 * the JVM, and it refuses to guess at one: until `nativeInit` has run, the first
 * HTTPS request panics with "Expect rustls-platform-verifier to be initialized".
 * That panic lands on a tokio worker, a panicking worker aborts the process, and
 * the app closed about a second after launch — which is exactly what release
 * v0.2.0 did.
 *
 * `attachBaseContext` rather than `onCreate` because an `Application` is built
 * before any Activity, so this runs before the WebView exists and well before
 * the first update check can ask for a certificate. Anything later leaves a
 * window in which a request could beat it.
 *
 * The `native` declaration binds to
 * `Java_com_chayote_app_ChayoteApplication_nativeInit` in `src-tauri/src/lib.rs`.
 * The two names are checked against each other by the build, and a mismatch
 * fails at launch rather than at compile time, so they are spelled the same way
 * on both sides and commented on both. */
class ChayoteApplication : Application() {

  override fun attachBaseContext(base: Context) {
    super.attachBaseContext(base)
    nativeInit(this)
  }

  private companion object {
    /* Tauri loads this library itself when the first Activity starts, but that
       is later than this call, and the verifier is needed before then. Loading
       an already-loaded library is a no-op, so doing it here is safe and makes
       the dependency explicit rather than assumed. */
    init {
      System.loadLibrary("chayote_lib")
    }

    @JvmStatic
    external fun nativeInit(context: Any)
  }
}
