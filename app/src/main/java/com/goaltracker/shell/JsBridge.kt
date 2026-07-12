package com.goaltracker.shell

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.MediaPlayer
import android.os.Build
import android.os.SystemClock
import android.util.Base64
import android.webkit.JavascriptInterface
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * The JavaScript bridge. Everything your HTML app can ask Android to do
 * lives here. In JS these appear as: window.AndroidBridge.methodName(...)
 *
 * IMPORTANT: these methods run on a background thread. Anything that
 * touches the UI (toasts are safe, WebView is not) must hop to the
 * main thread via activity.runOnUiThread { }.
 *
 * STABILITY RULE (v2): every method body is wrapped in try/catch.
 * A bridge call may fail and report itself in the error log, but it
 * must NEVER crash the app.
 */
class JsBridge(private val activity: MainActivity) {

    private val dataDir: File
        get() = File(activity.filesDir, "data").apply { mkdirs() }

    private val soundFile: File
        get() = File(File(activity.filesDir, "sound").apply { mkdirs() }, "completion")

    // Single reusable player for the optional completion sound.
    private var player: MediaPlayer? = null

    /** Keys become filenames, so strip anything unsafe. */
    private fun safeKey(key: String): String =
        key.replace(Regex("[^A-Za-z0-9_-]"), "_").take(100)

    /** Runs [block]; on any failure logs to ErrorLog and returns [fallback]. */
    private fun <T> safe(where: String, fallback: T, block: () -> T): T = try {
        block()
    } catch (e: Exception) {
        ErrorLog.log(activity, where, e.message ?: e.javaClass.simpleName)
        fallback
    }

    /**
     * Runs [block] on the UI thread with the try/catch INSIDE the posted
     * runnable. A plain `safe { runOnUiThread { ... } }` only protects the
     * posting - the lambda body executes later, outside the try/catch, so
     * an exception there would crash the app and break the "bridge never
     * crashes" guarantee. This helper closes that gap.
     */
    private fun safeUi(where: String, block: () -> Unit) {
        try {
            activity.runOnUiThread {
                try {
                    block()
                } catch (e: Exception) {
                    ErrorLog.log(activity, where, e.message ?: e.javaClass.simpleName)
                }
            }
        } catch (e: Exception) {
            ErrorLog.log(activity, where, e.message ?: e.javaClass.simpleName)
        }
    }

    // ---------------- Toasts ----------------

    @JavascriptInterface
    fun showToast(message: String) {
        safeUi("showToast") {
            Toast.makeText(activity, message, Toast.LENGTH_SHORT).show()
        }
    }

    @JavascriptInterface
    fun showToastLong(message: String) {
        safeUi("showToastLong") {
            Toast.makeText(activity, message, Toast.LENGTH_LONG).show()
        }
    }

    // ---------------- Data: JSON files in internal storage ----------------
    // This is your real persistence layer. IndexedDB stays as a working
    // cache in JS; every save should ALSO call saveData().

    @JavascriptInterface
    fun saveData(key: String, json: String): Boolean = safe("saveData", false) {
        File(dataDir, safeKey(key) + ".json").writeText(json)
        true
    }

    /** Returns the stored JSON string, or "" if the key does not exist. */
    @JavascriptInterface
    fun loadData(key: String): String = safe("loadData", "") {
        val f = File(dataDir, safeKey(key) + ".json")
        if (f.exists()) f.readText() else ""
    }

    @JavascriptInterface
    fun deleteData(key: String): Boolean = safe("deleteData", false) {
        File(dataDir, safeKey(key) + ".json").delete()
    }

    /** Returns a JSON array of all stored keys, e.g. ["goals","settings"] */
    @JavascriptInterface
    fun listDataKeys(): String = safe("listDataKeys", "[]") {
        val keys = dataDir.listFiles()
            ?.filter { it.extension == "json" }
            ?.map { it.nameWithoutExtension }
            ?: emptyList()
        JSONArray(keys).toString()
    }

    // ---------------- Backup ----------------

    /** Opens a "save file" dialog; writes ALL data keys into one JSON file. */
    @JavascriptInterface
    fun exportBackup() {
        safeUi("exportBackup") { activity.launchExportBackup() }
    }

    /** Opens a file picker; restores data keys from a backup JSON file. */
    @JavascriptInterface
    fun importBackup() {
        safeUi("importBackup") { activity.launchImportBackup() }
    }

    // ---------------- Notifications ----------------

    /** Ask for notification permission (needed once on Android 13+). */
    @JavascriptInterface
    fun requestNotificationPermission() {
        safeUi("requestNotificationPermission") {
            activity.requestNotificationPermissionIfNeeded()
        }
    }

    /** Show a notification right now. Respects the "notificationsEnabled" flag. */
    @JavascriptInterface
    fun showNotification(id: Int, title: String, text: String) {
        safe("showNotification", Unit) {
            if (!Flags.get(activity, "notificationsEnabled")) return@safe
            val openApp = PendingIntent.getActivity(
                activity, 0,
                Intent(activity, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val n = NotificationCompat.Builder(activity, ShellApp.CHANNEL_ALERTS)
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle(title)
                .setContentText(text)
                .setContentIntent(openApp)
                .setAutoCancel(true)
                .build()
            val nm = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(id, n)
        }
    }

    // ---------------- Scheduled alarms (work when app is closed) ----------------

    /**
     * Schedule a notification at an absolute time.
     * triggerAtMillis comes from JS as Date.now() + delayMs.
     * (Declared as Double because JS numbers arrive as doubles.)
     * Respects the "alarmsEnabled" flag.
     */
    @JavascriptInterface
    fun scheduleAlarm(id: Int, triggerAtMillis: Double, title: String, text: String) {
        safe("scheduleAlarm", Unit) {
            if (!Flags.get(activity, "alarmsEnabled")) return@safe
            AlarmScheduler.schedule(activity, id, triggerAtMillis.toLong(), title, text)
        }
    }

    @JavascriptInterface
    fun cancelAlarm(id: Int) {
        safe("cancelAlarm", Unit) {
            AlarmScheduler.cancel(activity, id)
        }
    }

    // ---------------- Foreground timer service ----------------

    /** Respects the "timerNotificationEnabled" flag. */
    @JavascriptInterface
    fun startTimer(title: String, text: String) {
        safe("startTimer", Unit) {
            if (!Flags.get(activity, "timerNotificationEnabled")) return@safe
            val i = Intent(activity, TimerService::class.java).apply {
                action = TimerService.ACTION_START
                putExtra("title", title)
                putExtra("text", text)
            }
            activity.startForegroundService(i)
        }
    }

    @JavascriptInterface
    fun updateTimer(title: String, text: String) {
        safe("updateTimer", Unit) {
            val i = Intent(activity, TimerService::class.java).apply {
                action = TimerService.ACTION_UPDATE
                putExtra("title", title)
                putExtra("text", text)
            }
            activity.startService(i)
        }
    }

    /** Update the notification and mark it paused (shows Resume button). */
    @JavascriptInterface
    fun pauseTimer(title: String, text: String) {
        safe("pauseTimer", Unit) {
            val i = Intent(activity, TimerService::class.java).apply {
                action = TimerService.ACTION_PAUSE
                putExtra("title", title)
                putExtra("text", text)
            }
            activity.startService(i)
        }
    }

    @JavascriptInterface
    fun stopTimer() {
        safe("stopTimer", Unit) {
            val i = Intent(activity, TimerService::class.java).apply {
                action = TimerService.ACTION_STOP
            }
            activity.startService(i)
        }
    }

    // ---------------- Time safety ----------------
    // JS contract: at session start store {wallMs, monoMs, bootId} from
    // currentTimeInfo(). Elapsed = monotonic delta while bootId is unchanged
    // (immune to manual clock changes). If bootId changed, the phone
    // rebooted: fall back to a clamped wall-clock estimate.

    /** Milliseconds since boot (monotonic - manual clock changes cannot affect it). */
    @JavascriptInterface
    fun elapsedRealtime(): Double = safe("elapsedRealtime", 0.0) {
        SystemClock.elapsedRealtime().toDouble()
    }

    /** JSON: { "wallMs": ..., "monoMs": ..., "bootId": "..." } */
    @JavascriptInterface
    fun currentTimeInfo(): String = safe("currentTimeInfo", "{}") {
        JSONObject()
            .put("wallMs", System.currentTimeMillis())
            .put("monoMs", SystemClock.elapsedRealtime())
            .put("bootId", TimeSafety.bootId(activity))
            .toString()
    }

    // ---------------- Feature flags (HTML settings screen) ----------------

    @JavascriptInterface
    fun getFlag(key: String, defaultValue: Boolean): Boolean =
        safe("getFlag", defaultValue) { Flags.get(activity, key, defaultValue) }

    @JavascriptInterface
    fun setFlag(key: String, value: Boolean) {
        safe("setFlag", Unit) { Flags.set(activity, key, value) }
    }

    /** All flags as a JSON object string. */
    @JavascriptInterface
    fun getAllFlags(): String = safe("getAllFlags", "{}") { Flags.all(activity) }

    // ---------------- Pending events ----------------
    // Call on page load AND on document visibilitychange. Reading drains
    // the queue, so each event is delivered exactly once.

    @JavascriptInterface
    fun getPendingEvents(): String =
        safe("getPendingEvents", "[]") { PendingEvents.drain(activity) }

    // ---------------- Error log / diagnostics ----------------

    @JavascriptInterface
    fun getErrorLog(): String = safe("getErrorLog", "[]") { ErrorLog.getAll(activity) }

    @JavascriptInterface
    fun clearErrorLog() {
        safe("clearErrorLog", Unit) { ErrorLog.clear(activity) }
    }

    /** System state as JSON, for the HTML settings/diagnostics screen. */
    @JavascriptInterface
    fun getDiagnostics(): String = safe("getDiagnostics", "{}") {
        val alarmManager = activity.getSystemService(Context.ALARM_SERVICE)
                as android.app.AlarmManager
        val canExact = Build.VERSION.SDK_INT < 31 || alarmManager.canScheduleExactAlarms()
        JSONObject()
            .put("shellVersion", getShellVersion())
            .put("androidRelease", Build.VERSION.RELEASE ?: "unknown")
            .put("androidSdk", Build.VERSION.SDK_INT)
            .put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
            .put("notificationsAllowed", NotificationManagerCompat.from(activity).areNotificationsEnabled())
            .put("exactAlarmsAllowed", canExact)
            .put("dataKeyCount", JSONArray(listDataKeys()).length())
            .put("errorLogCount", ErrorLog.count(activity))
            .put("customSoundSet", soundFile.exists())
            .put("bootId", TimeSafety.bootId(activity))
            .put("flags", JSONObject(Flags.all(activity)))
            .toString()
    }

    // ---------------- Optional completion sound ----------------
    // One short sound file, base64-encoded from JS, max 1 MB decoded.
    // Playback failures ALWAYS fall back silently (return false) - the
    // channel's default notification sound remains the reliable path.

    @JavascriptInterface
    fun saveSoundFile(base64: String): Boolean = safe("saveSoundFile", false) {
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        if (bytes.size > 1_000_000) {
            ErrorLog.log(activity, "saveSoundFile", "rejected: file larger than 1 MB")
            return@safe false
        }
        soundFile.writeBytes(bytes)
        true
    }

    @JavascriptInterface
    fun clearSoundFile(): Boolean = safe("clearSoundFile", false) {
        releasePlayer()
        !soundFile.exists() || soundFile.delete()
    }

    /**
     * Play the custom completion sound if set and "soundEnabled" flag is on.
     * Returns false (never throws) when no sound is set or playback fails.
     */
    @JavascriptInterface
    fun playCompletionSound(): Boolean = safe("playCompletionSound", false) {
        if (!Flags.get(activity, "soundEnabled")) return@safe false
        if (!soundFile.exists()) return@safe false
        releasePlayer()
        val p = MediaPlayer()
        p.setDataSource(soundFile.absolutePath)
        p.setOnCompletionListener { releasePlayer() }
        p.setOnErrorListener { _, _, _ -> releasePlayer(); true }
        p.prepare()
        p.start()
        player = p
        true
    }

    @JavascriptInterface
    fun stopCompletionSound() {
        safe("stopCompletionSound", Unit) { releasePlayer() }
    }

    private fun releasePlayer() {
        try {
            player?.stop()
        } catch (_: Exception) {
        }
        try {
            player?.release()
        } catch (_: Exception) {
        }
        player = null
    }

    // ---------------- Misc ----------------

    @JavascriptInterface
    fun getShellVersion(): String = "2.1"
}
