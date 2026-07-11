package com.goaltracker.shell

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context

/**
 * Application class. Creates the notification channels once at startup.
 * Channels are required for any notification on Android 8+.
 */
class ShellApp : Application() {

    companion object {
        const val CHANNEL_ALERTS = "alerts"
        const val CHANNEL_TIMER = "timer"
    }

    override fun onCreate() {
        super.onCreate()
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
    }
}
