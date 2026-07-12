package com.goaltracker.shell

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Receives taps on notification action buttons (timer Pause/Resume/Stop and
 * alarm Dismiss). The shell holds NO timer logic: actions are forwarded to
 * the HTML app. If the activity is alive, delivery is instant; if Android
 * killed it, the event is queued and the HTML app picks it up on next load
 * via AndroidBridge.getPendingEvents().
 */
class TimerActionReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_PAUSE = "com.goaltracker.shell.TIMER_PAUSE"
        const val ACTION_RESUME = "com.goaltracker.shell.TIMER_RESUME"
        const val ACTION_STOP = "com.goaltracker.shell.TIMER_STOP"
        const val ACTION_DISMISS_ALARM = "com.goaltracker.shell.ALARM_DISMISS"
        // v2.2: "ADD" button on the session-completed notification. Opens the
        // app and tells the HTML to jump straight to the Reflection popup.
        const val ACTION_REVIEW_ADD = "com.goaltracker.shell.REVIEW_ADD"

        /**
         * Set by MainActivity in onResume, cleared in onPause.
         * When present, events reach the WebView immediately.
         */
        @Volatile
        var liveDelivery: ((action: String) -> Unit)? = null
    }

    override fun onReceive(context: Context, intent: Intent) {
        try {
            when (intent.action) {
                ACTION_PAUSE -> deliver(context, "pause")
                ACTION_RESUME -> deliver(context, "resume")
                ACTION_STOP -> {
                    // Stopping the notification is native (safe); the timer
                    // state change itself is still delivered to JS.
                    context.startService(
                        Intent(context, TimerService::class.java).apply {
                            action = TimerService.ACTION_STOP
                        }
                    )
                    deliver(context, "stop")
                }
                ACTION_DISMISS_ALARM -> {
                    val id = intent.getIntExtra("id", 0)
                    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    nm.cancel(id)
                }
                ACTION_REVIEW_ADD -> {
                    // v2.2: dismiss the notification, deliver "reviewAdd" to
                    // the HTML (exactly-once via the pending queue when the
                    // WebView is dead), then open/foreground the app so the
                    // Reflection popup can be shown.
                    val id = intent.getIntExtra("id", 0)
                    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    nm.cancel(id)
                    deliver(context, "reviewAdd")
                    context.startActivity(
                        Intent(context, MainActivity::class.java).apply {
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                        }
                    )
                }
            }
        } catch (e: Exception) {
            ErrorLog.log(context, "TimerActionReceiver", e.message ?: "unknown")
        }
    }

    private fun deliver(context: Context, action: String) {
        val live = liveDelivery
        if (live != null) {
            live(action)
        } else {
            PendingEvents.add(context, "timerAction", "\"$action\"")
        }
    }
}
