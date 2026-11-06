package com.goaltracker.shell

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Fires when a scheduled alarm goes off (even if the app is closed).
 * Starts [AlarmPlaybackService], which posts a silent, actionable
 * notification and plays the selected slot for the configured duration.
 */
class AlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        try {
            val id = intent.getIntExtra(AlarmContract.EXTRA_ID, 0)
            val title = intent.getStringExtra(AlarmContract.EXTRA_TITLE) ?: "Reminder"
            val text = intent.getStringExtra(AlarmContract.EXTRA_TEXT) ?: ""
            val soundSlot = AlarmContract.normalizeSlot(
                intent.getStringExtra(AlarmContract.EXTRA_SOUND_SLOT)
            )
            val durationMs = AlarmContract.clampDuration(
                intent.getLongExtra(AlarmContract.EXTRA_DURATION_MS, AlarmContract.DEFAULT_DURATION_MS)
            )

            // Fire-time validation (v4.13). The deadline stored in this alarm, and the
            // "Session N out of M Done" label baked into the intent, are a SNAPSHOT taken by
            // the HTML's 1-second observer (andSyncAlarms). The session's real countdown lives
            // in its own clock and can move afterwards (pause/resume replayed from the
            // notification buttons, freeze/unfreeze), while the armed OS alarm can only be
            // updated by that same JS observer - which Android throttles as soon as the app is
            // backgrounded. The two clocks therefore drift silently and the alarm can ring
            // while the segment still has time left. Never announce a session that has not
            // finished: compare against the live session clock the HTML last pushed for the
            // timer notification (the same value the alarm countdown is derived from).
            if (id == AlarmContract.SESSION_ALARM_ID) {
                val live = TimerService.peekSessionClock(context)
                if (live != null) {
                    if (live.paused) {
                        // No segment can end while the session is paused: this alarm is stale.
                        // The HTML re-arms it from the live boundary once it is alive again.
                        AlarmScheduler.cancel(context, id)
                        return
                    }
                    if (live.remainMs > AlarmContract.STALE_TOLERANCE_MS) {
                        // The live segment still has time left, so re-arm for its real end
                        // instead of ringing. The HTML refreshes the label when it re-syncs.
                        AlarmScheduler.schedule(
                            context, id,
                            System.currentTimeMillis() + live.remainMs,
                            title, text, soundSlot, durationMs
                        )
                        return
                    }
                }
            }

            AlarmScheduler.markFired(context, id)

            if (!Flags.get(context, "alarmsEnabled")) return

            AlarmPlaybackService.start(context, id, title, text, soundSlot, durationMs)
        } catch (e: Exception) {
            ErrorLog.log(context, "AlarmReceiver", e.message ?: "unknown")
        } finally {
            pending.finish()
        }
    }
}
