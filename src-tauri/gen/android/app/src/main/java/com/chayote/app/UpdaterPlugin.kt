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

@TauriPlugin
class UpdaterPlugin(private val host: Activity) : Plugin(host) {

  @InvokeArg
  class InstallArgs {
    lateinit var path: String
  }

  private companion object {
    const val TAG = "chayote"

    const val ENTRY_NAME = "chayote.apk"

    const val STATUS_ACTION = "com.chayote.app.UPDATE_STATUS"

    const val STATUS_COMMITTED = "committed"
    const val STATUS_NEEDS_PERMISSION = "needs-permission"

    const val EXTRA_INTENT = "android.content.pm.extra.INTENT"
  }

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

  private fun commit(apk: File) {
    val installer = host.packageManager.packageInstaller
    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)

    params.setAppPackageName(host.packageName)
    params.setSize(apk.length().toLong())

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
            Log.w(TAG, "could not show the install confirmation: ${err.message}")
          }
        }

        PackageInstaller.STATUS_SUCCESS -> Log.i(TAG, "update committed")

        else -> Log.w(TAG, "update not installed: status=$status message=$message")
      }
    }
  }

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