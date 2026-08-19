package com.goaltracker.shell

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
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

    // v2.2: multiple named sounds ("completion", "bombwarn"). The legacy
    // single-sound methods keep working and map to the "completion" name.
    private fun namedSoundFile(name: String): File =
        File(File(activity.filesDir, "sound").apply { mkdirs() }, safeKey(name))

    // Single reusable player for the optional completion sound.
    private var player: MediaPlayer? = null

    // v2.3: in-app sounds used to play the file ONCE (a ~3s clip rang for
    // ~3s). A real alarm should keep ringing. We now LOOP the sound and
    // auto-stop after RING_DURATION_MS so short clips ring for a full
    // "alarm length" (up to a minute) instead of a single short blip.
    private val soundHandler = Handler(Looper.getMainLooper())
    private var stopSoundRunnable: Runnable? = null

    private companion object {
        // How long an in-app alarm/completion sound keeps ringing before it
        // auto-stops. Short source clips are looped to fill this window.
        const val RING_DURATION_MS = 60_000L
    }

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
        if (!Flags.get(activity, "nativeToastsEnabled", true)) return
        safeUi("showToast") {
            Toast.makeText(activity, message, Toast.LENGTH_SHORT).show()
        }
    }

    @JavascriptInterface
    fun showToastLong(message: String) {
        if (!Flags.get(activity, "nativeToastsEnabled", true)) return
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
            val nm = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(id, buildAlertNotification(title, text, persistent = false, withReviewActions = false))
        }
    }

    /**
     * v2.2: persistent (non-swipeable until tapped) notification, used for
     * the Bomb-exploded alert. Tapping it opens Goal Tracker and clears it.
     */
    @JavascriptInterface
    fun showPersistentNotification(id: Int, title: String, text: String) {
        safe("showPersistentNotification", Unit) {
            if (!Flags.get(activity, "notificationsEnabled")) return@safe
            val nm = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(id, buildAlertNotification(title, text, persistent = true, withReviewActions = false))
        }
    }

    /**
     * v2.2: session-completed notification with [ADD] / [CANCEL] actions.
     * ADD opens Goal Tracker straight to the Reflection popup (the HTML
     * receives a "reviewAdd" timerAction event); CANCEL just dismisses.
     */
    @JavascriptInterface
    fun showReviewNotification(id: Int, title: String, text: String) {
        safe("showReviewNotification", Unit) {
            if (!Flags.get(activity, "notificationsEnabled")) return@safe
            val nm = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(id, buildAlertNotification(title, text, persistent = false, withReviewActions = true, notifId = id))
        }
    }

    /** Cancel any notification previously shown through this bridge. */
    @JavascriptInterface
    fun cancelNotification(id: Int) {
        safe("cancelNotification", Unit) {
            val nm = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancel(id)
        }
    }

    private fun buildAlertNotification(
        title: String,
        text: String,
        persistent: Boolean,
        withReviewActions: Boolean,
        notifId: Int = 0
    ): android.app.Notification {
        val openApp = PendingIntent.getActivity(
            activity, 0,
            Intent(activity, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val b = NotificationCompat.Builder(activity, ShellApp.CHANNEL_ALERTS)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle(title)
            .setContentText(text.substringBefore('\n'))
            // BigTextStyle so multi-line bodies (Bomb explosion, reflection
            // prompt with emoji line) render in full.
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(openApp)
            .setAutoCancel(true)
        if (persistent) {
            // Not dismissible by swipe; cleared when tapped (contentIntent
            // opens the app, then the HTML calls cancelNotification) or via
            // cancelNotification from JS.
            b.setOngoing(true)
        }
        if (withReviewActions) {
            val add = PendingIntent.getBroadcast(
                activity, notifId,
                Intent(activity, TimerActionReceiver::class.java)
                    .setAction(TimerActionReceiver.ACTION_REVIEW_ADD)
                    .putExtra("id", notifId),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val cancel = PendingIntent.getBroadcast(
                activity, notifId + 100000,
                Intent(activity, TimerActionReceiver::class.java)
                    .setAction(TimerActionReceiver.ACTION_DISMISS_ALARM)
                    .putExtra("id", notifId),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            b.addAction(0, "ADD", add)
            b.addAction(0, "CANCEL", cancel)
        }
        return b.build()
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

    @JavascriptInterface
    fun cancelAllAlarms() {
        safe("cancelAllAlarms", Unit) { AlarmScheduler.cancelAll(activity) }
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

    /**
     * v2.4 - native timer engine (single source of truth for the notification).
     *
     * JS calls this ONLY when the notification state changes (start / pause /
     * resume / stop / subject or bomb change) - NOT every second. The service
     * then ticks the countdown on its own clock, so the notification keeps
     * counting even when the WebView's JS timers are throttled/suspended in
     * the background. This replaces the old per-second startTimer/updateTimer
     * heartbeat that froze after ~30s.
     *
     * json shape:
     * {
     *   "running": true, "paused": false,
     *   "title": "🟢 Study — Math",
     *   "template": "{c0} — 2/4 —— Left {c1}\n🔴 Bomb Ticking 💣 — {c2} remaining",
     *   "clocks": [
     *     {"id":"c0","fmt":"mmss","remainMs":1475000,"ticking":true},
     *     {"id":"c1","fmt":"left","remainMs":4320000,"ticking":true},
     *     {"id":"c2","fmt":"bomb","remainMs":275000,"ticking":true}
     *   ],
     *   // Optional INERT presentation data (v3.1). Lets background Pause
     *   // feedback show the bomb line using a value HTML already computed;
     *   // native does NO bomb math and HTML overwrites this on resume.
     *   "bombPreview": {"id":"c2","fmt":"bomb","remainMs":275000,"line":"\n🔴 Bomb Ticking 💣 — {c2} remaining"}
     * }
     * running:false stops the foreground service.
     */
    @JavascriptInterface
    fun setTimerState(json: String) {
        safe("setTimerState", Unit) {
            // Respect the same gate as the legacy path: if the user disabled the
            // timer notification, a running state must not start the service.
            val running = try { org.json.JSONObject(json).optBoolean("running", true) } catch (_: Exception) { true }
            if (running && !Flags.get(activity, "timerNotificationEnabled")) return@safe
            val i = Intent(activity, TimerService::class.java).apply {
                action = TimerService.ACTION_SYNC
                putExtra("json", json)
            }
            if (running) activity.startForegroundService(i) else activity.startService(i)
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
        saveNamedSoundInternal("completion", base64)
    }

    @JavascriptInterface
    fun clearSoundFile(): Boolean = safe("clearSoundFile", false) {
        releasePlayer()
        !soundFile.exists() || soundFile.delete()
    }

    /**
     * Play the custom completion sound if set and "soundEnabled" flag is on.
     * v2.2: when no custom sound is set, falls back to the device's default
     * notification ringtone so completion is NEVER silent while Sound is on.
     * Returns false (never throws) only when Sound is off or playback fails.
     */
    @JavascriptInterface
    fun playCompletionSound(): Boolean = safe("playCompletionSound", false) {
        playNamedSoundInternal("completion")
    }

    @JavascriptInterface
    fun stopCompletionSound() {
        safe("stopCompletionSound", Unit) { releasePlayer() }
    }

    // ---- v2.2: named sounds (separate Pomodoro-completion / Bomb-warning) ----

    /** Save a named sound ("completion" or "bombwarn"), base64, max 1 MB. */
    @JavascriptInterface
    fun saveNamedSound(name: String, base64: String): Boolean = safe("saveNamedSound", false) {
        saveNamedSoundInternal(name, base64)
    }

    @JavascriptInterface
    fun clearNamedSound(name: String): Boolean = safe("clearNamedSound", false) {
        releasePlayer()
        val f = if (name == "completion") soundFile else namedSoundFile(name)
        !f.exists() || f.delete()
    }

    @JavascriptInterface
    fun hasNamedSound(name: String): Boolean = safe("hasNamedSound", false) {
        (if (name == "completion") soundFile else namedSoundFile(name)).exists()
    }

    /**
     * Play a named sound. Custom file first; if none is set, falls back to
     * the device's default notification ringtone (so the button is never a
     * dummy). Respects the "soundEnabled" flag. Returns false only when
     * Sound is off or every playback path failed.
     */
    @JavascriptInterface
    fun playNamedSound(name: String): Boolean = safe("playNamedSound", false) {
        playNamedSoundInternal(name)
    }

    private fun saveNamedSoundInternal(name: String, base64: String): Boolean {
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        if (bytes.size > 1_000_000) {
            ErrorLog.log(activity, "saveNamedSound", "rejected: file larger than 1 MB")
            return false
        }
        val f = if (name == "completion") soundFile else namedSoundFile(name)
        f.writeBytes(bytes)
        return true
    }

    /**
     * Resolve and play the sound for a slot ("completion" or "bombwarn").
     *
     * Resolution order (first hit wins):
     *   1. A user-uploaded custom file (legacy HTML upload path) if present.
     *   2. The native selection: a bundled res/raw sound, or a device Uri.
     *   3. The bundled default for the slot (guaranteed to exist).
     *
     * Long/alarm sounds LOOP and auto-stop after RING_DURATION_MS so a short
     * clip still rings like a real alarm; short notification tones play once.
     */
    private fun playNamedSoundInternal(name: String): Boolean {
        releasePlayer()

        val slot = name  // "completion" / "bombwarn" map 1:1 to SoundLibrary slots
        val file = if (slot == "completion") soundFile else namedSoundFile(slot)
        var loop = SoundLibrary.shouldLoop(activity, slot)

        val p = MediaPlayer()
        try {
            // Play on the ALARM stream so it uses alarm volume and still rings
            // when the phone is on silent/vibrate - real alarm behavior.
            p.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )

            if (file.exists()) {
                // Legacy: a custom file was uploaded from the HTML settings.
                p.setDataSource(file.absolutePath)
                loop = (slot == SoundLibrary.SLOT_BOMB) // bomb file still loops
            } else {
                val sel = SoundLibrary.getSelection(activity, slot)
                if (sel.type == SoundLibrary.TYPE_DEVICE) {
                    p.setDataSource(activity, Uri.parse(sel.value))
                } else {
                    val b = SoundLibrary.builtinByKey(sel.value)
                        ?: SoundLibrary.BUILTINS.first()
                    activity.resources.openRawResourceFd(b.resId).use { afd ->
                        p.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
                    }
                }
            }

            p.isLooping = loop
            p.setOnErrorListener { _, _, _ -> releasePlayer(); true }
            if (!loop) {
                // One-shot notification tone: release as soon as it finishes.
                p.setOnCompletionListener { releasePlayer() }
            }
            p.prepare()
            p.start()
            player = p

            if (loop) {
                // End the ring after the full alarm window.
                stopSoundRunnable?.let { soundHandler.removeCallbacks(it) }
                val stop = Runnable { releasePlayer() }
                stopSoundRunnable = stop
                soundHandler.postDelayed(stop, RING_DURATION_MS)
            }
            return true
        } catch (e: Exception) {
            try { p.release() } catch (_: Exception) {}
            ErrorLog.log(activity, "playNamedSound", e.message ?: e.javaClass.simpleName)
            // Last resort: never leave the alarm silent - try the built-in default.
            return playBuiltinFallback(slot)
        }
    }

    /** Absolute last-resort playback of a guaranteed-present bundled sound. */
    private fun playBuiltinFallback(slot: String): Boolean {
        return try {
            releasePlayer()
            val b = SoundLibrary.builtinByKey(
                if (slot == SoundLibrary.SLOT_BOMB) "classic" else "chime"
            ) ?: SoundLibrary.BUILTINS.first()
            val p = MediaPlayer()
            p.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            activity.resources.openRawResourceFd(b.resId).use { afd ->
                p.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
            }
            val loop = slot == SoundLibrary.SLOT_BOMB || b.isLong
            p.isLooping = loop
            p.setOnErrorListener { _, _, _ -> releasePlayer(); true }
            if (!loop) p.setOnCompletionListener { releasePlayer() }
            p.prepare()
            p.start()
            player = p
            if (loop) {
                stopSoundRunnable?.let { soundHandler.removeCallbacks(it) }
                val stop = Runnable { releasePlayer() }
                stopSoundRunnable = stop
                soundHandler.postDelayed(stop, RING_DURATION_MS)
            }
            true
        } catch (e: Exception) {
            ErrorLog.log(activity, "playBuiltinFallback", e.message ?: "failed")
            false
        }
    }

    // ---- v2.3: built-in sound library + selection (native-authoritative) ----

    /** JSON: the 10 bundled sounds + current per-slot selection. */
    @JavascriptInterface
    fun listBuiltinSounds(): String = safe("listBuiltinSounds", "{}") {
        SoundLibrary.toJson(activity)
    }

    /** Preview a bundled sound by key without changing the saved selection. */
    @JavascriptInterface
    fun previewBuiltinSound(key: String): Boolean = safe("previewBuiltinSound", false) {
        val b = SoundLibrary.builtinByKey(key) ?: return@safe false
        releasePlayer()
        val p = MediaPlayer()
        p.setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
        )
        activity.resources.openRawResourceFd(b.resId).use { afd ->
            p.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
        }
        p.isLooping = false
        p.setOnErrorListener { _, _, _ -> releasePlayer(); true }
        p.setOnCompletionListener { releasePlayer() }
        p.prepare()
        p.start()
        player = p
        true
    }

    /**
     * Select a bundled sound for a slot. Clears any legacy uploaded file for
     * that slot so the built-in choice takes effect immediately.
     */
    @JavascriptInterface
    fun selectBuiltinSound(slot: String, key: String): Boolean =
        safe("selectBuiltinSound", false) {
            if (SoundLibrary.builtinByKey(key) == null) return@safe false
            val s = normalizeSlot(slot)
            clearSlotFile(s)
            SoundLibrary.setBuiltin(activity, s, key)
            true
        }

    /** Record a device-picked ringtone/alarm Uri as the selection for a slot. */
    @JavascriptInterface
    fun selectDeviceSound(slot: String, uri: String): Boolean =
        safe("selectDeviceSound", false) {
            val s = normalizeSlot(slot)
            clearSlotFile(s)
            SoundLibrary.setDevice(activity, s, uri)
            true
        }

    /**
     * Records which sound slot the user is about to edit. Injected click
     * listeners on the HTML sound inputs call this just before the native
     * chooser opens, so it targets the correct slot. Never throws.
     */
    @JavascriptInterface
    fun noteSoundSlot(slot: String) {
        safe("noteSoundSlot", Unit) {
            activity.runOnUiThread { activity.setPendingSoundSlot(slot) }
        }
    }

    private fun normalizeSlot(slot: String): String = when (slot) {
        SoundLibrary.SLOT_SESSION_END, SoundLibrary.SLOT_TASK_COMPLETE,
        SoundLibrary.SLOT_BOMB, SoundLibrary.SLOT_COMPLETION -> slot
        else -> SoundLibrary.SLOT_COMPLETION
    }

    private fun clearSlotFile(slot: String) {
        val f = if (slot == "completion") soundFile else namedSoundFile(slot)
        if (f.exists()) try { f.delete() } catch (_: Exception) {}
    }

    private fun releasePlayer() {
        // Cancel any pending auto-stop so it can't fire against a new player.
        stopSoundRunnable?.let { soundHandler.removeCallbacks(it) }
        stopSoundRunnable = null
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

    /**
     * Stops any currently ringing in-app sound immediately. Safe to call
     * even when nothing is playing. Lets the app cut the alarm short (e.g.
     * when the user acknowledges it) instead of waiting the full window.
     */
    @JavascriptInterface
    fun stopSound(): Boolean = safe("stopSound", false) {
        releasePlayer()
        true
    }

    // ---------------- Misc ----------------

    @JavascriptInterface
    fun getShellVersion(): String = "4.0"

    // ---------------- Manual fallback ----------------

    /**
     * Returns the raw text content of manuals.js so the HTML can display
     * the Goal Section Manual even when the <script src="manuals.js"> tag
     * silently failed (e.g. after a single-HTML import without the side-car file).
     *
     * Strategy (in priority order):
     *  1. Read manuals.js from the live app directory (filesDir/app/manuals.js).
     *     This is the user's current version and is always preferred.
     *  2. Fall back to the copy bundled inside the APK's assets/ folder.
     *     This always exists and cannot be lost.
     *
     * The returned string is the raw JS source (the whole file). The HTML
     * extracts window.GOAL_SECTION_MANUAL from it via a controlled eval so
     * only the template-literal value is rendered — no arbitrary execution.
     *
     * Returns "" on any failure so the HTML can distinguish "bridge absent"
     * (AndroidBridge undefined) from "bridge returned nothing" (empty string).
     */
    @JavascriptInterface
    fun getManualText(): String = safe("getManualText", "") {
        // 1. Live app directory copy (preferred — always up to date).
        val liveFile = File(File(activity.filesDir, "app"), "manuals.js")
        if (liveFile.exists()) {
            val text = liveFile.readText()
            if (text.isNotBlank()) return@safe text
        }
        // 2. Bundled APK asset (guaranteed present).
        activity.assets.open("app/manuals.js").use { it.reader().readText() }
    }
}
