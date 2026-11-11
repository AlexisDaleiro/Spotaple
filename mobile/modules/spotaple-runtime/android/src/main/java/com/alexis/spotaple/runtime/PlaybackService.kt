package com.alexis.spotaple.runtime

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

class PlaybackService : Service() {
  companion object {
    private const val CHANNEL = "spotaple-playback"
    private const val NOTIFICATION = 617
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

  data class MediaInfo(val title: String, val artist: String, val status: String, val position: Long, val duration: Long) {
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
    session.setMetadata(MediaMetadata.Builder()
      .putString(MediaMetadata.METADATA_KEY_TITLE, info.title)
      .putString(MediaMetadata.METADATA_KEY_ARTIST, info.artist)
      .putLong(MediaMetadata.METADATA_KEY_DURATION, info.duration)
      .build())
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
    wakeLock?.takeIf { it.isHeld }?.release()
    session.release()
    manager.cancel(NOTIFICATION)
    current = null
    super.onDestroy()
  }
}
