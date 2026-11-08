package com.alexis.spotaple.runtime

import android.content.Context
import android.net.ConnectivityManager
import android.util.Log
import java.io.File
import java.net.Inet4Address

internal object NodeRuntime {
  @Volatile var url: String? = null
    private set
  @Volatile var failed = false
    private set
  private var started = false

  @Synchronized
  fun start(context: Context) {
    if (started) return
    started = true
    val app = context.applicationContext
    val work = File(app.cacheDir, "spotaple-runtime")
    val ready = File(work, "ready")
    ready.delete()
    Thread({
      try {
        System.loadLibrary("spotaple_runtime")
        copyAssets(app, "spotaple", work)
        val cm = app.getSystemService(ConnectivityManager::class.java)
        val address = cm?.activeNetwork?.let { cm.getLinkProperties(it) }?.linkAddresses
          ?.map { it.address }?.firstOrNull { it is Inet4Address && !it.isLoopbackAddress }?.hostAddress
          ?: "127.0.0.1"
        startNode(arrayOf("spotaple", File(work, "start.cjs").path, app.filesDir.path,
          File(work, "renderer").path, ready.path, address,
          app.packageManager.getPackageInfo(app.packageName, 0).versionName.orEmpty()))
      } catch (error: Throwable) {
        Log.e("SpotapleRuntime", "Could not start local runtime", error)
      } finally {
        failed = true
        url = null
      }
    }, "spotaple-node").start()
    Thread({
      while (!failed) {
        val endpoint = runCatching { ready.readText() }.getOrNull()
        if (endpoint?.matches(Regex("http://127[.]0[.]0[.]1:[0-9]+/[a-f0-9]{64}/")) == true) {
          url = endpoint
          return@Thread
        }
        Thread.sleep(100)
      }
    }, "spotaple-ready").start()
  }

  private fun copyAssets(context: Context, path: String, target: File) {
    val children = context.assets.list(path).orEmpty()
    if (children.isEmpty()) {
      context.assets.open(path).use { input -> target.outputStream().use { input.copyTo(it) } }
    } else {
      target.mkdirs()
      children.forEach { copyAssets(context, "$path/$it", File(target, it)) }
    }
  }

  private external fun startNode(arguments: Array<String>): Int
}
