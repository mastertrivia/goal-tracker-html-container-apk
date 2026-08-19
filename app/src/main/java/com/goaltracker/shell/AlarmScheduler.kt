package com.goaltracker.shell

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONObject

/**
 * Schedules exact alarms and remembers them in SharedPreferences so
 * BootReceiver can re-schedule everything after the phone reboots.
 */
object AlarmScheduler {

    private const val PREFS = "scheduled_alarms"

    fun schedule(context: Context, id: Int, triggerAtMillis: Long, title: String, text: String) {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pi = buildPendingIntent(context, id, title, text)

        // On Android 12+ the user can revoke exact-alarm permission.
        // Fall back to an inexact alarm instead of crashing.
        val canExact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()
        if (canExact) {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pi)
        } else {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pi)
        }

        // Persist for reboot rescheduling
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val entry = JSONObject()
            .put("at", triggerAtMillis)
            .put("title", title)
            .put("text", text)
        prefs.edit().putString(id.toString(), entry.toString()).apply()
    }

    fun cancel(context: Context, id: Int) {
        val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        am.cancel(buildPendingIntent(context, id, "", ""))
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().remove(id.toString()).apply()
    }

    /** Cancel every persisted OS alarm. Used by the master Alarms switch. */
    fun cancelAll(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.all.keys.forEach { key -> key.toIntOrNull()?.let { cancel(context, it) } }
    }

    /** Called from BootReceiver: re-schedule future alarms, drop past ones. */
    fun rescheduleAll(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        val editor = prefs.edit()
        for ((key, value) in prefs.all) {
            try {
                val obj = JSONObject(value as String)
                val at = obj.getLong("at")
                if (at > now) {
                    schedule(context, key.toInt(), at, obj.getString("title"), obj.getString("text"))
                } else {
                    editor.remove(key)
                }
            } catch (_: Exception) {
                editor.remove(key)
            }
        }
        editor.apply()
    }

    /** Remove a fired alarm from the persisted list. */
    fun markFired(context: Context, id: Int) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().remove(id.toString()).apply()
    }

    private fun buildPendingIntent(context: Context, id: Int, title: String, text: String): PendingIntent {
        val intent = Intent(context, AlarmReceiver::class.java).apply {
            putExtra("id", id)
            putExtra("title", title)
            putExtra("text", text)
        }
        return PendingIntent.getBroadcast(
            context, id, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }
}
