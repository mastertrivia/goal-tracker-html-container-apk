package com.goaltracker.shell

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ContentResolver
import android.content.Context
import android.media.AudioAttributes
import android.net.Uri

/**
 * Application class. Creates the notification channels once at startup.
 * Channels are required for any notification on Android 8+.
 */
class ShellApp : Application() {

    companion object {
        const val CHANNEL_ALERTS = "alerts"
        const val CHANNEL_TIMER = "timer"
        // v2.3: bumped so the new BUNDLED alarm sound takes effect on upgrade
        // (a channel's sound is immutable once created, so the id must change).
        const val CHANNEL_ALARM = "alarm_v2"
    }

    override fun onCreate() {
        super.onCreate()
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            // Remove the pre-v2.3 alarm channel (device-default sound) now that
            // it is replaced by "alarm_v2" with the bundled alarm sound.
            try { nm.deleteNotificationChannel("alarm") } catch (_: Exception) {}

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
                    // Use a BUNDLED alarm sound (not the device default) so the
                    // alarm is fully self-contained: it works after a factory
                    // reset, needs no storage permission, and never depends on
                    // an external file. FLAG_INSISTENT on the notification loops
                    // it until the user dismisses. NOTE: a channel's sound is
                    // immutable after creation on Android 8+, so this is the
                    // fixed alarm-channel tone; the in-app player handles the
                    // user's per-slot sound selection separately.
                    val bundled = Uri.parse(
                        "${ContentResolver.SCHEME_ANDROID_RESOURCE}://$packageName/${R.raw.snd_long_classic}"
                    )
                    setSound(
                        bundled,
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
