package com.goaltracker.shell

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.RingtoneManager

/**
 * Application class. Creates the notification channels once at startup.
 * Channels are required for any notification on Android 8+.
 */
class ShellApp : Application() {

    companion object {
        const val CHANNEL_ALERTS = "alerts"
        const val CHANNEL_TIMER = "timer"
        const val CHANNEL_ALARM = "alarm"
    }

    override fun onCreate() {
        super.onCreate()
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            nm.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ALERTS,
                    "Alerts & reminders",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply { description = "Notifications and scheduled reminders from the app" }
            )

            nm.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_TIMER,
                    "Running timer",
                    NotificationManager.IMPORTANCE_LOW
                ).apply { description = "Shown while a timer is running in the background" }
            )

            // Loud alarm-class channel: system alarm sound + vibration.
            // The user can change the sound per-channel in Android settings.
            nm.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ALARM,
                    "Alarms",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "Scheduled alarms (Pomodoro end, reminders)"
                    enableVibration(true)
                    vibrationPattern = longArrayOf(0, 500, 250, 500)
                    setSound(
                        RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build()
                    )
                }
            )
        } catch (e: Exception) {
            // Channel creation failing would break notifications, but must
            // never prevent the app itself from starting.
            ErrorLog.log(this, "ShellApp.onCreate", e.message ?: "unknown")
        }
    }
}
