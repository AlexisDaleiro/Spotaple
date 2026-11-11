package com.alexis.spotaple.runtime

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.Future

class PlaybackService : Service() {
  companion object {
    private const val CHANNEL = "spotaple-playback"
    private const val NOTIFICATION = 617
    private const val ARTWORK_LIMIT = 1024 * 1024
    private const val ARTWORK_SIDE = 384
    private val imageDomains = listOf("googleusercontent.com", "ggpht.com", "ytimg.com")
    private val bundledArtwork = Regex("assets/brand-[A-Za-z0-9_-]+[.]png")
    var current: PlaybackService? = null
      private set
    var command: ((String, Long?) -> Unit)? = null
    private var latest: MediaInfo? = null
    private var starting = false

    fun update(context: Context, media: MediaInfo) {
      latest = media.takeUnless { it.title.isEmpty() }
      if (starting) return
      current?.let {
        if (latest == null) it.stopSelf() else it.publish(media)
        return
      }
      if (latest == null || !media.keepForeground) return
      starting = true
      val start = Intent(context, PlaybackService::class.java)
      try {
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(start)
        else context.startService(start)
      } catch (error: RuntimeException) {
        starting = false
        throw error
      }
    }

    fun clear() {
      latest = null
      if (!starting) current?.stopSelf()
    }
  }

  data class MediaInfo(
    val title: String, val artist: String, val status: String, val position: Long, val duration: Long,
    val artwork: String? = null,
  ) {
    val keepForeground get() = status == "playing" || status == "buffering" || status == "loading"
    val playbackState get() = when (status) {
      "playing" -> PlaybackState.STATE_PLAYING
      "buffering", "loading" -> PlaybackState.STATE_BUFFERING
      else -> PlaybackState.STATE_PAUSED
    }
  }

  private lateinit var session: MediaSession
  private lateinit var manager: NotificationManager
  private var wakeLock: PowerManager.WakeLock? = null
  private var active = false
  private val main = Handler(Looper.getMainLooper())
  private val artworkExecutor = Executors.newSingleThreadExecutor()
  private var artworkTask: Future<*>? = null
  private var artworkUrl: String? = null
  private var artwork: Bitmap? = null
  private var lastMetadata: MediaInfo? = null
  private var lastArtwork: Bitmap? = null

  override fun onCreate() {
    super.onCreate()
    manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= 26) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL, "Reproducción de Spotaple", NotificationManager.IMPORTANCE_LOW))
    }
    session = MediaSession(this, "Spotaple").apply {
      setCallback(object : MediaSession.Callback() {
        override fun onPlay() { command?.invoke("play", null) }
        override fun onPause() { command?.invoke("pause", null) }
        override fun onSkipToPrevious() { command?.invoke("prev", null) }
        override fun onSkipToNext() { command?.invoke("next", null) }
        override fun onSeekTo(pos: Long) { command?.invoke("seek", pos) }
        override fun onStop() { command?.invoke("pause", null); stopSelf() }
      })
      isActive = true
    }
    current = this
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (val action = intent?.action) {
      "play", "pause", "prev", "next" -> command?.invoke(action, null)
      else -> {
        starting = false
        val media = latest
        // Android exige completar el arranque aunque la canción haya cambiado o se haya quitado.
        if (!active) {
          startForeground(NOTIFICATION, notification(media ?: MediaInfo("Spotaple", "", "idle", 0, 0)))
          active = true
        }
        if (media == null) stopSelf() else publish(media)
      }
    }
    return START_NOT_STICKY
  }

  private fun publish(info: MediaInfo) {
    if (artworkUrl != info.artwork) requestArtwork(info.artwork)
    val previous = lastMetadata
    if (previous == null || previous.title != info.title || previous.artist != info.artist || previous.duration != info.duration || lastArtwork !== artwork) {
      val metadata = MediaMetadata.Builder()
        .putString(MediaMetadata.METADATA_KEY_TITLE, info.title)
        .putString(MediaMetadata.METADATA_KEY_ARTIST, info.artist)
        .putLong(MediaMetadata.METADATA_KEY_DURATION, info.duration)
      artwork?.let {
        metadata.putBitmap(MediaMetadata.METADATA_KEY_ART, it)
        metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, it)
      }
      session.setMetadata(metadata.build())
      lastMetadata = info
      lastArtwork = artwork
    }
    session.setPlaybackState(PlaybackState.Builder()
      .setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or
        PlaybackState.ACTION_SKIP_TO_PREVIOUS or PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SEEK_TO)
      .setState(info.playbackState, info.position, if (info.status == "playing") 1f else 0f)
      .build())
    val note = notification(info)
    if (info.keepForeground) {
      if (!active) startForeground(NOTIFICATION, note) else manager.notify(NOTIFICATION, note)
      active = true
      if (wakeLock?.isHeld != true) {
        wakeLock = getSystemService(PowerManager::class.java)
          .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:playback").apply { acquire() }
      }
    } else {
      wakeLock?.takeIf { it.isHeld }?.release()
      if (active) stopForeground(STOP_FOREGROUND_DETACH)
      active = false
      manager.notify(NOTIFICATION, note)
    }
  }

  private fun requestArtwork(url: String?) {
    artworkTask?.cancel(true)
    artworkUrl = url
    artwork = null
    artworkTask = url?.let { requested ->
      artworkExecutor.submit(Runnable {
        val bitmap = runCatching { loadArtwork(requested) }.getOrNull() ?: return@Runnable
        main.post {
          val info = latest
          if (current === this && info != null && info.artwork == requested) {
            artwork = bitmap
            publish(info)
          }
        }
      })
    }
  }

  private fun loadArtwork(source: String): Bitmap? {
    val url = URL(source)
    val local = NodeRuntime.url?.let { source.startsWith(it) && bundledArtwork.matches(source.removePrefix(it)) } == true
    val remote = url.protocol == "https" && url.userInfo == null && (url.port == -1 || url.port == 443) &&
      imageDomains.any { url.host == it || url.host.endsWith(".$it") }
    if (!local && !remote) return null
    val connection = (url.openConnection() as HttpURLConnection).apply {
      instanceFollowRedirects = false
      connectTimeout = 4000
      readTimeout = 4000
    }
    val data = try {
      if (connection.responseCode != HttpURLConnection.HTTP_OK || connection.contentLength > ARTWORK_LIMIT) return null
      connection.inputStream.use { input ->
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (!Thread.currentThread().isInterrupted) {
          val count = input.read(buffer)
          if (count < 0) break
          if (output.size() + count > ARTWORK_LIMIT) return null
          output.write(buffer, 0, count)
        }
        output.toByteArray()
      }
    } finally {
      connection.disconnect()
    }
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(data, 0, data.size, options)
    val side = maxOf(options.outWidth, options.outHeight)
    if (side !in 1..8192) return null
    options.inJustDecodeBounds = false
    options.inSampleSize = 1
    while (side / options.inSampleSize > ARTWORK_SIDE) options.inSampleSize *= 2
    return BitmapFactory.decodeByteArray(data, 0, data.size, options)
  }

  @Suppress("DEPRECATION")
  private fun notification(info: MediaInfo): Notification {
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    fun action(id: Int, label: String, key: String) = Notification.Action.Builder(
      id, label, PendingIntent.getService(this, 0, Intent(this, PlaybackService::class.java).setAction(key), PendingIntent.FLAG_IMMUTABLE),
    ).build()
    return builder
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle(info.title)
      .setContentText(info.artist)
      .setContentIntent(open)
      .setLargeIcon(artwork)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setOngoing(info.keepForeground)
      .addAction(action(android.R.drawable.ic_media_previous, "Anterior", "prev"))
      .addAction(if (info.keepForeground) action(android.R.drawable.ic_media_pause, "Pausar", "pause")
        else action(android.R.drawable.ic_media_play, "Reproducir", "play"))
      .addAction(action(android.R.drawable.ic_media_next, "Siguiente", "next"))
      .setStyle(Notification.MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(0, 1, 2))
      .build()
  }

  override fun onTaskRemoved(rootIntent: Intent?) { stopSelf() }
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    artworkExecutor.shutdownNow()
    main.removeCallbacksAndMessages(null)
    wakeLock?.takeIf { it.isHeld }?.release()
    session.release()
    manager.cancel(NOTIFICATION)
    current = null
    super.onDestroy()
  }
}
