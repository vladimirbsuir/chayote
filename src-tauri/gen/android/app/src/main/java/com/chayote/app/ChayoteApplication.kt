package com.chayote.app

import android.content.Context
import android.app.Application

class ChayoteApplication : Application() {

  override fun attachBaseContext(base: Context) {
    super.attachBaseContext(base)
    nativeInit(this)
  }

  private companion object {
    init {
      System.loadLibrary("chayote_lib")
    }

    @JvmStatic
    external fun nativeInit(context: Any)
  }
}
