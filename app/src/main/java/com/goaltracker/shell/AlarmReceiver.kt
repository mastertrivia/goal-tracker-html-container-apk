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
                .setContentText(text.substringBefore('\n'))
                // v2.2: BigTextStyle so multi-line alarm text renders fully.
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(openApp)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .addAction(0, "Dismiss", dismiss)
                .build()

            // v2.2 fix for "alarm only plays ~3 seconds": notification sounds
            // play once by default (typically a short tone). FLAG_INSISTENT
            // makes the channel's alarm sound LOOP until the user dismisses
            // or taps the notification - real alarm-clock behavior.
            notification.flags = notification.flags or android.app.Notification.FLAG_INSISTENT

            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(id, notification)
        } catch (e: Exception) {
            ErrorLog.log(context, "AlarmReceiver", e.message ?: "unknown")
        }
    }
}
