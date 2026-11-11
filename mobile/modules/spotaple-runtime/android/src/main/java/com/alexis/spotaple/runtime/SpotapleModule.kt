package com.alexis.spotaple.runtime

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.provider.DocumentsContract
import android.provider.Settings
import android.view.Gravity
import android.util.Log
import android.webkit.RenderProcessGoneDetail
import android.webkit.JavascriptInterface
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.FileProvider
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import org.json.JSONObject
import java.io.File
import java.lang.ref.WeakReference
import java.net.HttpURLConnection
import java.net.URL

private const val SAVE_FILE_REQUEST = 19623

class SpotapleModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SpotapleRuntime")
    View(SpotapleView::class) {
      Events("onOpenLocal")
      AsyncFunction("back") { view: SpotapleView -> view.back() }
    }
    OnActivityResult { _, (request, result, data) ->
      if (request == SAVE_FILE_REQUEST) SpotapleView.active?.get()?.saveTo(data?.data?.takeIf { result == Activity.RESULT_OK })
    }
  }
}

class SpotapleView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  companion object {
    internal var active: WeakReference<SpotapleView>? = null
  }

  override val shouldUseAndroidLayout = true
  private val background = Color.rgb(12, 13, 15)
  private val label = TextView(context).apply {
    gravity = Gravity.CENTER
    text = "Abriendo Spotaple…"
    setTextColor(Color.WHITE)
    textSize = 16f
  }
  private var browser: WebView? = null
  private var lastRecovery = -60_000L
  private var pendingSave: Pair<Int, String>? = null
  private val onOpenLocal by EventDispatcher()
  private val awaitRuntime = object : Runnable {
    override fun run() {
      val url = NodeRuntime.url
      when {
        NodeRuntime.failed -> showError()
        url != null -> open(url)
        isAttachedToWindow -> postDelayed(this, 100)
      }
    }
  }

  init {
    setBackgroundColor(background)
    addView(label, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    active = WeakReference(this)
    PlaybackService.command = { action, milliseconds ->
      post { browser?.evaluateJavascript("window.spotapleMedia?.('$action', ${milliseconds?.div(1000.0) ?: "undefined"})", null) }
    }
    if (browser == null) {
      NodeRuntime.start(context)
      post(awaitRuntime)
    }
  }

  override fun onDetachedFromWindow() {
    removeCallbacks(awaitRuntime)
    browser?.let {
      removeView(it)
      it.destroy()
    }
    browser = null
    if (active?.get() === this) {
      active = null
      PlaybackService.command = null
      PlaybackService.clear()
    }
    super.onDetachedFromWindow()
  }

  fun back() {
    val activity = appContext.currentActivity ?: return
    val view = browser
    if (view == null) activity.moveTaskToBack(true)
    else view.evaluateJavascript("window.spotapleBack?.() === true") {
      if (it != "true") activity.moveTaskToBack(true)
    }
  }

  private fun showError() {
    label.text = "No se pudo abrir Spotaple. Cerrá y volvé a abrir la aplicación."
    label.visibility = VISIBLE
    browser?.visibility = GONE
  }

  private fun open(url: String) {
    val view = WebView(context)
    browser = view
    view.setBackgroundColor(background)
    view.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      mediaPlaybackRequiresUserGesture = false
      allowFileAccess = false
      allowContentAccess = false
    }
    view.addJavascriptInterface(NativeActions(url), "SpotapleAndroid")
    view.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val next = request.url
        if (next.toString().startsWith(url)) return false
        if (request.isForMainFrame && request.hasGesture() && next.scheme == "https") {
          openExternal(next)
        }
        return true
      }

      override fun onPageFinished(view: WebView, page: String) {
        if (page == url && view.visibility == VISIBLE) label.visibility = GONE
      }

      override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (request.isForMainFrame) showError()
      }

      override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        removeView(view)
        view.destroy()
        browser = null
        pendingSave = null
        PlaybackService.clear()
        val now = SystemClock.elapsedRealtime()
        if (isAttachedToWindow && now - lastRecovery >= 60_000L) {
          lastRecovery = now
          label.text = "Recuperando Spotaple…"
          label.visibility = VISIBLE
          post(awaitRuntime)
        } else showError()
        return true
      }
    }
    label.visibility = GONE
    addView(view, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    view.loadUrl(Uri.parse(url).toString())
  }

  private inner class NativeActions(private val url: String) {
    @JavascriptInterface
    fun shareTrack(link: String) {
      if (!link.matches(Regex("https://music[.]youtube[.]com/watch[?]v=[A-Za-z0-9_-]{11}"))) return
      post {
        val activity = appContext.currentActivity ?: return@post
        val share = Intent(Intent.ACTION_SEND).apply {
          type = "text/plain"
          putExtra(Intent.EXTRA_TEXT, link)
        }
        runCatching { activity.startActivity(Intent.createChooser(share, null)) }.onFailure {
          Toast.makeText(context, "No se pudo compartir el enlace.", Toast.LENGTH_LONG).show()
        }
      }
    }

    @JavascriptInterface
    fun copy(text: String) {
      if (text.length > 200) return
      post {
        context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("Invitación de Spotaple", text))
      }
    }

    @JavascriptInterface
    fun openLocal() {
      post { onOpenLocal(emptyMap<String, Any>()) }
    }

    @JavascriptInterface
    fun install() {
      post {
        val activity = appContext.currentActivity ?: return@post
        val apk = File(context.filesDir, "updates/spotaple.apk")
        val info = context.packageManager.getPackageArchiveInfo(apk.path, 0)
        if (info?.packageName != context.packageName) {
          Toast.makeText(context, "No se pudo verificar el APK de Spotaple.", Toast.LENGTH_LONG).show()
          return@post
        }
        if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
          val settings = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
          runCatching { activity.startActivity(settings) }
          Toast.makeText(context, "Permití la instalación y volvé a tocar Instalar actualización.", Toast.LENGTH_LONG).show()
          return@post
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.spotapleUpdates", apk)
        val intent = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        runCatching { activity.startActivity(intent) }.onFailure {
          Toast.makeText(context, "No se pudo abrir el instalador de Android.", Toast.LENGTH_LONG).show()
        }
      }
    }

    @JavascriptInterface
    fun open(target: String) {
      val uri = Uri.parse(target)
      if (uri.scheme == "https" && uri.host != null) post { openExternal(uri) }
    }

    @JavascriptInterface
    fun media(raw: String) {
      if (raw.length > 4096) return
      val info = runCatching {
        val data = JSONObject(raw)
        PlaybackService.MediaInfo(data.getString("title"), data.getString("artist"),
          data.getString("status"), data.getLong("positionMs"), data.getLong("durationMs"))
      }.getOrNull() ?: return
      post {
        runCatching { PlaybackService.update(context, info) }.onFailure {
          Log.w("SpotaplePlayback", "No se pudo actualizar el servicio de reproducción", it)
        }
      }
    }

    @JavascriptInterface
    fun save(id: Int, token: String, name: String) {
      post {
        val activity = appContext.currentActivity
        val mime = when {
          name.endsWith(".m4a") -> "audio/mp4"
          name.endsWith(".webm") -> "audio/webm"
          else -> null
        }
        if (pendingSave != null || activity == null || mime == null || !token.matches(Regex("[a-f0-9]{40}"))) {
          saveResult(id, -1)
          return@post
        }
        pendingSave = id to "${url}export/$token"
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
          addCategory(Intent.CATEGORY_OPENABLE)
          type = mime
          putExtra(Intent.EXTRA_TITLE, name)
        }
        runCatching { activity.startActivityForResult(intent, SAVE_FILE_REQUEST) }.onFailure {
          pendingSave = null
          saveResult(id, -1)
        }
      }
    }
  }

  private fun openExternal(uri: Uri) {
    val intent = Intent(Intent.ACTION_VIEW, uri)
    runCatching {
      val activity = appContext.currentActivity
      if (activity != null) activity.startActivity(intent)
      else context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }.onFailure {
      Toast.makeText(context, "No se pudo abrir el navegador.", Toast.LENGTH_LONG).show()
    }
  }

  internal fun saveTo(destination: Uri?) {
    val (id, source) = pendingSave ?: return
    pendingSave = null
    if (destination == null) {
      saveResult(id, 0)
      return
    }
    Thread({
      val resolver = context.contentResolver
      val result = runCatching {
        val connection = URL(source).openConnection() as HttpURLConnection
        connection.connectTimeout = 5000
        connection.readTimeout = 30000
        try {
          connection.inputStream.use { input ->
            val output = resolver.openOutputStream(destination, "w") ?: error("No se pudo abrir el archivo.")
            output.use { input.copyTo(it) }
          }
        } finally {
          connection.disconnect()
        }
      }
      if (result.isFailure) runCatching { DocumentsContract.deleteDocument(resolver, destination) }
      post { saveResult(id, if (result.isSuccess) 1 else -1) }
    }, "spotaple-save").start()
  }

  private fun saveResult(id: Int, status: Int) {
    browser?.evaluateJavascript("window.spotapleSaveResult?.($id, $status)", null)
  }
}
