package com.goaltracker.shell

import android.content.Context
import org.json.JSONObject
import java.util.UUID

/**
 * Feature flags stored in SharedPreferences. The HTML settings screen
 * reads/writes these via the bridge; native code checks them before acting.
 *
 * Known keys (all default true):
 *  - "notificationsEnabled"      gate for showNotification()
 *  - "alarmsEnabled"             gate for scheduleAlarm() + AlarmReceiver
 *  - "timerNotificationEnabled"  gate for startTimer()
 *  - "soundEnabled"              gate for playCompletionSound()
 *  - "nativeToastsEnabled"       gate for informational native Toasts (hard
 *                                errors ignore it); mirrors the HTML
 *                                "Show pop-up messages" preference.
 */
object Flags {

    private const val PREFS = "shell_flags"

    fun get(context: Context, key: String, default: Boolean = true): Boolean = try {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(key, default)
    } catch (_: Exception) {
        default
    }

    fun set(context: Context, key: String, value: Boolean) {
        try {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putBoolean(key, value).apply()
        } catch (e: Exception) {
            ErrorLog.log(context, "Flags.set", e.message ?: "unknown")
        }
    }

    /** All flags as a JSON object string, for the HTML settings screen. */
    fun all(context: Context): String = try {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val obj = JSONObject()
        for ((k, v) in prefs.all) if (v is Boolean) obj.put(k, v)
        obj.toString()
    } catch (_: Exception) {
        "{}"
    }
}

/**
 * Time-safety support. Provides a stable "boot id" so the HTML app can
 * detect reboots: monotonic elapsedRealtime() resets on reboot, and the
 * boot id changes with it. BootReceiver refreshes the id on every boot.
 */
object TimeSafety {

    private const val PREFS = "shell_time_safety"
    private const val KEY_BOOT_ID = "boot_id"

    /** Returns the current boot id, creating one on first use. */
    fun bootId(context: Context): String = try {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.getString(KEY_BOOT_ID, null) ?: UUID.randomUUID().toString().also {
            prefs.edit().putString(KEY_BOOT_ID, it).apply()
        }
    } catch (_: Exception) {
        "unknown"
    }

    /** Called from BootReceiver after every reboot. */
    fun refreshBootId(context: Context) {
        try {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString(KEY_BOOT_ID, UUID.randomUUID().toString()).apply()
        } catch (e: Exception) {
            ErrorLog.log(context, "TimeSafety.refreshBootId", e.message ?: "unknown")
        }
    }
}
