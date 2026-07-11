package com.goaltracker.shell

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Foreground service that keeps a persistent "timer running" notification
 * while the HTML app has an active timer. The JS bridge starts, updates,
 * and stops it. The service itself holds no timing logic - JS owns the timer.
 *
 * v2: the notification now has action buttons (Pause/Resume/Stop). Taps go
 * to TimerActionReceiver, which forwards them to the HTML app.
 */
class TimerService : Service() {

    companion object {
        const val ACTION_START = "start"
        const val ACTION_UPDATE = "update"
        const val ACTION_PAUSE = "pause"
        const val ACTION_STOP = "stop"
        const val NOTIFICATION_ID = 9001
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        try {
            when (intent?.action) {
                ACTION_START -> {
                    val title = intent.getStringExtra("title") ?: "Timer running"
                    val text = intent.getStringExtra("text") ?: ""
                    startForeground(NOTIFICATION_ID, buildNotification(title, text, paused = false))
                }
                ACTION_UPDATE -> {
                    val title = intent.getStringExtra("title") ?: "Timer running"
                    val text = intent.getStringExtra("text") ?: ""
                    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    nm.notify(NOTIFICATION_ID, buildNotification(title, text, paused = false))
                }
                ACTION_PAUSE -> {
                    val title = intent.getStringExtra("title") ?: "Timer paused"
                    val text = intent.getStringExtra("text") ?: ""
                    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    nm.notify(NOTIFICATION_ID, buildNotification(title, text, paused = true))
                }
                ACTION_STOP -> {
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf()
                }
            }
        } catch (e: Exception) {
            ErrorLog.log(this, "TimerService", e.message ?: "unknown")
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun actionIntent(action: String): PendingIntent =
        PendingIntent.getBroadcast(
            this,
            action.hashCode(),
            Intent(this, TimerActionReceiver::class.java).setAction(action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

    private fun buildNotification(title: String, text: String, paused: Boolean): Notification {
        val openApp = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val builder = NotificationCompat.Builder(this, ShellApp.CHANNEL_TIMER)
            .setSmallIcon(android.R.drawable.ic_menu_recent_history)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(openApp)
            .setOngoing(true)
            .setOnlyAlertOnce(true)

        if (paused) {
            builder.addAction(0, "Resume", actionIntent(TimerActionReceiver.ACTION_RESUME))
        } else {
            builder.addAction(0, "Pause", actionIntent(TimerActionReceiver.ACTION_PAUSE))
        }
        builder.addAction(0, "Stop", actionIntent(TimerActionReceiver.ACTION_STOP))

        return builder.build()
    }
}
