package com.goaltracker.shell

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.webkit.JavascriptInterface
import android.widget.Toast
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import java.io.File

/**
 * The JavaScript bridge. Everything your HTML app can ask Android to do
 * lives here. In JS these appear as: window.AndroidBridge.methodName(...)
 *
 * IMPORTANT: these methods run on a background thread. Anything that
 * touches the UI (toasts are safe, WebView is not) must hop to the
 * main thread via activity.runOnUiThread { }.
 */
class JsBridge(private val activity: MainActivity) {

    private val dataDir: File
        get() = File(activity.filesDir, "data").apply { mkdirs() }

    /** Keys become filenames, so strip anything unsafe. */
    private fun safeKey(key: String): String =
        key.replace(Regex("[^A-Za-z0-9_-]"), "_").take(100)

    // ---------------- Toasts ----------------

    @JavascriptInterface
    fun showToast(message: String) {
        activity.runOnUiThread {
            Toast.makeText(activity, message, Toast.LENGTH_SHORT).show()
        }
    }

    // ---------------- Data: JSON files in internal storage ----------------
    // This is your real persistence layer. IndexedDB stays as a working
    // cache in JS; every save should ALSO call saveData().

    @JavascriptInterface
    fun saveData(key: String, json: String): Boolean {
        return try {
            File(dataDir, safeKey(key) + ".json").writeText(json)
            true
        } catch (e: Exception) {
            false
        }
    }

    /** Returns the stored JSON string, or "" if the key does not exist. */
    @JavascriptInterface
    fun loadData(key: String): String {
        val f = File(dataDir, safeKey(key) + ".json")
        return if (f.exists()) f.readText() else ""
    }

    @JavascriptInterface
    fun deleteData(key: String): Boolean =
        File(dataDir, safeKey(key) + ".json").delete()

    /** Returns a JSON array of all stored keys, e.g. ["goals","settings"] */
    @JavascriptInterface
    fun listDataKeys(): String {
        val keys = dataDir.listFiles()
            ?.filter { it.extension == "json" }
            ?.map { it.nameWithoutExtension }
            ?: emptyList()
        return JSONArray(keys).toString()
    }

    // ---------------- Backup ----------------

    /** Opens a "save file" dialog; writes ALL data keys into one JSON file. */
    @JavascriptInterface
    fun exportBackup() {
        activity.runOnUiThread { activity.launchExportBackup() }
    }

    /** Opens a file picker; restores data keys from a backup JSON file. */
    @JavascriptInterface
    fun importBackup() {
        activity.runOnUiThread { activity.launchImportBackup() }
    }

    // ---------------- Notifications ----------------

    /** Ask for notification permission (needed once on Android 13+). */
    @JavascriptInterface
    fun requestNotificationPermission() {
        activity.runOnUiThread { activity.requestNotificationPermissionIfNeeded() }
    }

    /** Show a notification right now. */
    @JavascriptInterface
    fun showNotification(id: Int, title: String, text: String) {
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

    // ---------------- Scheduled alarms (work when app is closed) ----------------

    /**
     * Schedule a notification at an absolute time.
     * triggerAtMillis comes from JS as Date.now() + delayMs.
     * (Declared as Double because JS numbers arrive as doubles.)
     */
    @JavascriptInterface
    fun scheduleAlarm(id: Int, triggerAtMillis: Double, title: String, text: String) {
        AlarmScheduler.schedule(activity, id, triggerAtMillis.toLong(), title, text)
    }

    @JavascriptInterface
    fun cancelAlarm(id: Int) {
        AlarmScheduler.cancel(activity, id)
    }

    // ---------------- Foreground timer service ----------------

    @JavascriptInterface
    fun startTimer(title: String, text: String) {
        val i = Intent(activity, TimerService::class.java).apply {
            action = TimerService.ACTION_START
            putExtra("title", title)
            putExtra("text", text)
        }
        activity.startForegroundService(i)
    }

    @JavascriptInterface
    fun updateTimer(title: String, text: String) {
        val i = Intent(activity, TimerService::class.java).apply {
            action = TimerService.ACTION_UPDATE
            putExtra("title", title)
            putExtra("text", text)
        }
        activity.startService(i)
    }

    @JavascriptInterface
    fun stopTimer() {
        val i = Intent(activity, TimerService::class.java).apply {
            action = TimerService.ACTION_STOP
        }
        activity.startService(i)
    }

    // ---------------- Misc ----------------

    @JavascriptInterface
    fun getShellVersion(): String = "1.0"
}
