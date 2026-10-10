package com.chayote.app

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  /* `06-platform.md` §4.4: the back button walks the view stack, and at the root it
     is the platform's job rather than the app's.

     Tauri 2.12 has no JavaScript-reachable back button. `AppPlugin.hasListener`
     reads a Java-only map that a JS `listen()` never populates, `Plugin.trigger`
     sends only to Java channels, and `WryActivity.handleBackNavigation` installs
     `goBack`-or-finish rather than reaching the web layer — so `TauriActivity`
     leaves `handleBackNavigation` false and the only way in is here.

     `onWebViewCreate` is the hook `WryActivity.setWebView` calls once the real
     WebView exists, which is why this cannot be done in `onCreate`. The callback is
     added after `AppPlugin`'s, so this one wins while the dispatcher has two enabled
     callbacks; disabling it and re-dispatching hands the press to `AppPlugin`,
     which backgrounds or finishes the task the way §4.4 wants at the root. */
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        webView.evaluateJavascript(PROBE) { result ->
          if (result == null || !result.contains("true")) {
            isEnabled = false
            onBackPressedDispatcher.onBackPressed()
            isEnabled = true
          }
        }
      }
    })
  }

  private companion object {
    /* Must be an expression, not a statement: `evaluateJavascript` hands back the
       JSON encoding of the value, and `!result.contains("true")` has to see the
       absence of it. `typeof` guards the window between page loads, when the app
       has not installed its handler yet. */
    const val PROBE =
      "(typeof window.__chayoteHandleBack__ === 'function') && window.__chayoteHandleBack__()"
  }
}