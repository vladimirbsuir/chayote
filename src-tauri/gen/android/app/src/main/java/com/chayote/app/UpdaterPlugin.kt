package com.chayote.app

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileInputStream

/* ADR-025: the Android half of the updater.
 *
 * `tauri-plugin-updater` downloads and verifies an update on Android — its
 * `download()` is platform-agnostic and checks the minisign signature — but its
 * `install_inner` is `Err(Error::UnsupportedOs)` under `cfg(mobile)`. This is the
 * part it cannot do: put the package where Android will accept it.
 *
 * So `commands/updates.rs` writes the verified bytes into the cache directory and
 * calls `install` here. By the time this runs those bytes came from the endpoint
 * named in `tauri.conf.json`, over HTTPS, and their signature has already been
 * checked against the public key compiled into the app. Nothing here re-decides
 * whether to trust them; this only moves them.
 *
 * Two permissions make it work, both declared in `AndroidManifest.xml`.
 * `REQUEST_INSTALL_PACKAGES` because an app that is not the system installer must
 * ask, and `UPDATE_PACKAGES_WITHOUT_USER_ACTION` so that an app updating *itself*
 * may commit a session with no confirmation. The second is honoured only when the
 * installed target is new enough on the running release; where it is not, Android
 * asks the user instead, and the receiver shows that screen rather than dropping
 * it — slower, not broken.
 *
 * Tauri instantiates this with the Activity as its only argument, which is why it
 * extends `Plugin(Activity)`. */
/* `@TauriPlugin` is not decoration. R8 only keeps a plugin's `@Command` methods
   because tauri's own consumer rules say
   `-keep @app.tauri.annotation.TauriPlugin public class * { @…Command public <methods>; }`,
   and a class without the annotation matches nothing in it. The debug build has
   `isMinifyEnabled = false` and so hides this completely: the plugin works when
   you run it and arrives with an empty class body when you ship it. Kept here
   with that reason attached, because the annotation is otherwise easy to read as
   boilerplate and remove. */
@TauriPlugin
class UpdaterPlugin(private val host: Activity) : Plugin(host) {

  @InvokeArg
  class InstallArgs {
    lateinit var path: String
  }

  private companion object {
    const val TAG = "chayote"

    const val ENTRY_NAME = "chayote.apk"

    /* A private action, so the commit result comes back to this app and nowhere
       else. `ACTION_PACKAGE_ADDED` would be the system-wide broadcast and brings
       different extras. */
    const val STATUS_ACTION = "com.chayote.app.UPDATE_STATUS"

    const val STATUS_COMMITTED = "committed"
    const val STATUS_NEEDS_PERMISSION = "needs-permission"

    /* The key `STATUS_PENDING_USER_ACTION` carries its confirmation screen on.
       `javap -constants` against `android.jar` for compileSdk 37 lists every
       `EXTRA_*` field on `PackageInstaller` and this is not among them, so the
       literal is spelled out here rather than reached for as a constant that
       does not resolve. It follows the same
       `android.content.pm.extra.*` convention as `EXTRA_STATUS` beside it. */
    const val EXTRA_INTENT = "android.content.pm.extra.INTENT"
  }

  /* One receiver per process. An update is a once-a-thing event, and registering
     the same action twice is an error rather than a no-op. */
  private var statusReceiverRegistered = false

  @Command
  fun install(invoke: Invoke) {
    val args = try {
      invoke.parseArgs(InstallArgs::class.java)
    } catch (err: Exception) {
      invoke.reject("no package path was given", err)
      return
    }

    val apk = File(args.path)
    if (!apk.isFile) {
      invoke.reject("the downloaded package is missing: ${args.path}")
      return
    }

    /* The permission is declared but the grant is per app in system settings, and
       the grant is checked rather than assumed: without it `commit` fails with a
       status no sentence can explain. Reporting it first is the difference
       between "allow Chayote to install updates" and "the update failed". */
    if (!canRequestPackageInstalls()) {
      openInstallPermissionSettings()
      invoke.resolveObject(mapOf("status" to STATUS_NEEDS_PERMISSION))
      return
    }

    try {
      commit(apk)
      invoke.resolveObject(mapOf("status" to STATUS_COMMITTED))
    } catch (err: Exception) {
      invoke.reject("could not stage the update", err)
    }
  }

  /** Streams the APK into a session and commits it.

      `openWrite` rather than a path handed to the installer means the bytes never
      leave this app: no `FileProvider` grant, no other app able to read the
      package, and no window in which a file on disk could be swapped. */
  private fun commit(apk: File) {
    val installer = host.packageManager.packageInstaller
    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)

    /* Statement, not a chain. Every one of these `SessionParams` setters returns
       `void` in the platform stub — verified with `javap` against compileSdk 37 —
       so chaining them makes the whole expression `Unit` and every call after it
       unresolved. This is the shape the platform's own samples use. */
    params.setAppPackageName(host.packageName)
    params.setSize(apk.length().toLong())

    /* Asks for a silent install. Android honours it for an app updating itself,
       when the installed target is new enough for the running release, and when
       the manifest declares `UPDATE_PACKAGES_WITHOUT_USER_ACTION`. Where it
       cannot, the commit comes back as `STATUS_PENDING_USER_ACTION` carrying a
       confirmation screen, which `receiver` launches — so the outcome is the
       reader tapping "install" on Android's own dialog, not a stalled update. */
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
    }

    val session = installer.openSession(installer.createSession(params))
    try {
      session.openWrite(ENTRY_NAME, 0, apk.length().toLong()).use { output ->
        FileInputStream(apk).use { input ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            val read = input.read(buffer)
            if (read <= 0) break
            output.write(buffer, 0, read)
          }
          /* Closing the stream is what hands the bytes to the session, so this
             matters and `fsync` does not: `openWrite` is declared to return
             `OutputStream`, which has no `fsync` to call, and the platform's own
             samples use this same overload without one. */
          output.flush()
        }
      }
      registerStatusReceiver()
      session.commit(statusIntentSender())
    } finally {
      session.close()
    }
  }

  private fun statusIntentSender(): android.content.IntentSender {
    val intent = Intent(STATUS_ACTION).setPackage(host.packageName)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
    val pending = PendingIntent.getBroadcast(host, 0, intent, flags)
    return pending.intentSender
  }

  /** Receives the commit result.

      Two statuses matter and they want opposite things.

      `STATUS_PENDING_USER_ACTION` means Android declined to install silently and
      put a confirmation screen in the `Intent` it sends as
      `EXTRA_INTENT`. Nothing acts on that on its own — the app must launch it —
      so without this branch the update would sit staged forever with no error
      anywhere, which is the worst outcome: the reader pressed a button, saw a
      progress bar finish, and then nothing.

      `STATUS_SUCCESS` needs no handling at all. By the time Android reports it,
      it has already replaced this process's package.

      The receiver is registered because a session committed with none is an
      unmonitored session, and the failure it reports is the only trace left of
      an install that did not happen. */
  private fun registerStatusReceiver() {
    if (statusReceiverRegistered) return
    val filter = IntentFilter(STATUS_ACTION)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      ContextCompat.registerReceiver(host, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
    } else {
      host.registerReceiver(receiver, filter)
    }
    statusReceiverRegistered = true
  }

  private val receiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      val status = intent?.getIntExtra(PackageInstaller.EXTRA_STATUS, Int.MIN_VALUE)
      val message = intent?.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)

      when (status) {
        PackageInstaller.STATUS_PENDING_USER_ACTION -> {
          val confirmation = readConfirmation(intent)
          if (confirmation == null) {
            Log.w(TAG, "Android asked for a confirmation and sent no way to show it")
            return
          }
          try {
            confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            host.startActivity(confirmation)
          } catch (err: Exception) {
            /* `IntentSender`-backed intents arrive as a one-shot `Intent` that is
               already filled in, so `startActivity` is right; but a device that
               has no such screen would otherwise crash the app over a failed
               update, which is worse than the update failing. */
            Log.w(TAG, "could not show the install confirmation: ${err.message}")
          }
        }

        PackageInstaller.STATUS_SUCCESS -> Log.i(TAG, "update committed")

        else -> Log.w(TAG, "update not installed: status=$status message=$message")
      }
    }
  }

  /** The confirmation screen from a pending-install status, read the way the
      running release allows.

      `getParcelableExtra(String, Class)` arrived in API 33 and the one-argument
      form is deprecated from there, but `STATUS_PENDING_USER_ACTION` itself only
      arrives in API 31 — so there is a window on 31 and 32 where the deprecated
      call is the only one that exists. Both paths are kept, and the warning is
      silenced on exactly the branch that has no alternative. */
  @Suppress("DEPRECATION")
  private fun readConfirmation(intent: Intent?): Intent? =
    if (intent == null) {
      null
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(EXTRA_INTENT, Intent::class.java)
    } else {
      intent.getParcelableExtra(EXTRA_INTENT)
    }

  private fun canRequestPackageInstalls(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
      host.packageManager.canRequestPackageInstalls()

  /** Sends the user to the one system screen that grants the permission, scoped to
      this app. There is no runtime prompt for it: `REQUEST_INSTALL_PACKAGES` is
      granted in settings, which is why the tab has to explain rather than ask. */
  private fun openInstallPermissionSettings() {
    try {
      host.startActivity(
        Intent(
          Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
          Uri.parse("package:${host.packageName}"),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    } catch (err: Exception) {
      Log.w(TAG, "no install-permission screen on this device: ${err.message}")
    }
  }
}