package com.goaltracker.shell

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat

/**
 * Fires when a scheduled alarm goes off (even if the app is closed).
 * Posts a loud alarm-class notification (sound + vibration, from the
 * dedicated alarm channel) with a Dismiss action.
 */
class AlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        try {
            val id = intent.getIntExtra("id", 0)
            val title = intent.getStringExtra("title") ?: "Reminder"
            val text = intent.getStringExtra("text") ?: ""

            AlarmScheduler.markFired(context, id)

            // User can disable alarms from the HTML settings screen.
            if (!Flags.get(context, "alarmsEnabled")) return

            val openApp = PendingIntent.getActivity(
                context, 0,
                Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val dismiss = PendingIntent.getBroadcast(
                context, id,
                Intent(context, TimerActionReceiver::class.java)
                    .setAction(TimerActionReceiver.ACTION_DISMISS_ALARM)
                    .putExtra("id", id),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val notification = NotificationCompat.Builder(context, ShellApp.CHANNEL_ALARM)
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle(title)
                .setContentText(text)
                .setContentIntent(openApp)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .addAction(0, "Dismiss", dismiss)
                .build()

            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(id, notification)
        } catch (e: Exception) {
            ErrorLog.log(context, "AlarmReceiver", e.message ?: "unknown")
        }
    }
}
