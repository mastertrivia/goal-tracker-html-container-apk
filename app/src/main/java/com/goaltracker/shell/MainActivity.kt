package com.goaltracker.shell

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.widget.EditText
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.webkit.WebResourceErrorCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import org.json.JSONObject
import java.io.File
import java.util.zip.ZipInputStream

/**
 * The permanent shell. It only does four things:
 *  1. Hosts a WebView serving your HTML from internal storage (filesDir/app)
 *  2. Lets you import a new HTML file or ZIP bundle without rebuilding the APK
 *  3. Exposes the JsBridge to your HTML (window.AndroidBridge)
 *  4. Handles backup export/import via the system file picker
 *
 * All app logic lives in the HTML. The shell stays dumb.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private val appDir: File get() = File(filesDir, "app")
    // Named appDataDir (not dataDir) to avoid clashing with Android's
    // built-in Context.getDataDir(), which causes a duplicate JVM signature.
    private val appDataDir: File get() = File(filesDir, "data").apply { mkdirs() }

    // ---------- File picker launchers ----------

    private val importHtmlLauncher =
        registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri != null) importHtmlOrZip(uri)
        }

    private val exportBackupLauncher =
        registerForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
            if (uri != null) writeBackupTo(uri)
        }

    private val importBackupLauncher =
        registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri != null) restoreBackupFrom(uri)
        }

    private val notifPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            notifyJs("notificationPermission", if (granted) "\"granted\"" else "\"denied\"")
        }

    private var pendingDiagnostics: String = ""

    private val exportDiagnosticsLauncher =
        registerForActivityResult(ActivityResultContracts.CreateDocument("text/plain")) { uri ->
            if (uri != null) {
                try {
                    contentResolver.openOutputStream(uri)!!.use {
                        it.write(pendingDiagnostics.toByteArray())
                    }
                    toast("Diagnostics exported")
                } catch (e: Exception) {
                    ErrorLog.log(this, "exportDiagnostics", e.message ?: "unknown")
                    toast("Export failed: ${e.message}")
                }
            }
        }

    /** Guards against showing the load-failure dialog repeatedly. */
    private var recoveryDialogShowing = false

    // ---------- Lifecycle ----------

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        copyBundledAppIfNeeded()

        webView = WebView(this)
        setContentView(webView)

        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler(
                "/app/",
                WebViewAssetLoader.InternalStoragePathHandler(this, appDir)
            )
            .build()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true          // localStorage + IndexedDB
            allowFileAccess = false           // we serve via https://, not file://
            allowContentAccess = false
            mediaPlaybackRequiresUserGesture = false
        }

        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceErrorCompat
            ) {
                // Only react to the main page failing, not sub-resources.
                if (request.isForMainFrame) {
                    ErrorLog.log(this@MainActivity, "WebView.onReceivedError", request.url.toString())
                    showLoadFailureDialog()
                }
            }

            override fun onRenderProcessGone(
                view: WebView,
                detail: RenderProcessGoneDetail
            ): Boolean {
                // The WebView renderer crashed. Log it and recreate the
                // activity (a fresh WebView) instead of crashing the app.
                ErrorLog.log(this@MainActivity, "WebView.renderProcessGone", "renderer crashed")
                recreate()
                return true
            }
        }

        webView.addJavascriptInterface(JsBridge(this), "AndroidBridge")

        loadApp()
    }

    override fun onResume() {
        super.onResume()
        // While we're visible, notification button taps reach JS instantly.
        // (If we're not visible, TimerActionReceiver queues them and JS
        // drains the queue via getPendingEvents() on next load.)
        TimerActionReceiver.liveDelivery = { action ->
            notifyJs("timerAction", "\"$action\"")
        }
    }

    override fun onPause() {
        TimerActionReceiver.liveDelivery = null
        super.onPause()
    }

    private fun loadApp() {
        recoveryDialogShowing = false
        webView.loadUrl("https://appassets.androidplatform.net/app/index.html")
    }

    /** Shown when the main page fails to load (e.g. a broken HTML import). */
    private fun showLoadFailureDialog() {
        if (recoveryDialogShowing || isFinishing) return
        recoveryDialogShowing = true
        AlertDialog.Builder(this)
            .setTitle("App failed to load")
            .setMessage(
                "The current HTML app could not be loaded. You can retry, " +
                    "or restore the built-in app. Your data is not affected."
            )
            .setPositiveButton("Retry") { _, _ -> loadApp() }
            .setNegativeButton("Restore built-in app") { _, _ ->
                appDir.deleteRecursively()
                copyBundledApp()
                loadApp()
            }
            .setOnDismissListener { recoveryDialogShowing = false }
            .show()
    }

    /** First run: copy the bundled fallback app from assets/ to filesDir/app. */
    private fun copyBundledAppIfNeeded() {
        if (File(appDir, "index.html").exists()) return
        copyBundledApp()
    }

    private fun copyBundledApp() {
        appDir.mkdirs()
        assets.list("app")?.forEach { name ->
            assets.open("app/$name").use { input ->
                File(appDir, name).outputStream().use { output -> input.copyTo(output) }
            }
        }
    }

    // ---------- Menu ----------

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.main_menu, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        when (item.itemId) {
            R.id.action_reload -> loadApp()
            R.id.action_import_html -> typedConfirm(
                "Import HTML/ZIP",
                "This replaces the current app files. Your data is kept. " +
                    "Type IMPORT to continue.",
                "IMPORT"
            ) {
                importHtmlLauncher.launch(arrayOf("text/html", "application/zip"))
            }
            R.id.action_export_backup -> launchExportBackup()
            R.id.action_import_backup -> typedConfirm(
                "Restore backup",
                "This overwrites current data with the backup's contents. " +
                    "Type RESTORE to continue.",
                "RESTORE"
            ) {
                launchImportBackup()
            }
            R.id.action_system_check -> showSystemCheck()
            R.id.action_reset -> AlertDialog.Builder(this)
                .setTitle("Restore built-in app")
                .setMessage("Replaces the current HTML app with the bundled one. Your data is kept.")
                .setPositiveButton("Restore") { _, _ ->
                    appDir.deleteRecursively()
                    copyBundledApp()
                    loadApp()
                    toast("Restored bundled app (your data was kept)")
                }
                .setNegativeButton("Cancel", null)
                .show()
            R.id.action_factory_reset -> typedConfirm(
                "Factory reset",
                "Deletes ALL app data and the imported HTML app. " +
                    "Tip: export a backup first (menu > Export backup). " +
                    "A last-chance internal copy is kept at auto-backup-before-reset.json. " +
                    "Type FACTORY RESET to continue.",
                "FACTORY RESET"
            ) {
                factoryReset()
            }
            else -> return super.onOptionsItemSelected(item)
        }
        return true
    }

    /** Dialog that requires typing an exact word before a destructive action. */
    private fun typedConfirm(
        title: String,
        message: String,
        requiredWord: String,
        onConfirmed: () -> Unit
    ) {
        val input = EditText(this).apply { hint = requiredWord }
        AlertDialog.Builder(this)
            .setTitle(title)
            .setMessage(message)
            .setView(input)
            .setPositiveButton("Confirm") { _, _ ->
                if (input.text.toString().trim() == requiredWord) {
                    onConfirmed()
                } else {
                    toast("Cancelled: you must type $requiredWord")
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun showSystemCheck() {
        try {
            val json = JSONObject(JsBridge(this).getDiagnostics())
            val sb = StringBuilder()
            for (key in json.keys()) sb.append(key).append(": ").append(json.get(key)).append('\n')
            val text = sb.toString()
            AlertDialog.Builder(this)
                .setTitle("System Check")
                .setMessage(text)
                .setPositiveButton("Close", null)
                .setNeutralButton("Export as file") { _, _ ->
                    pendingDiagnostics = text
                    exportDiagnosticsLauncher.launch("goal-tracker-diagnostics.txt")
                }
                .show()
        } catch (e: Exception) {
            ErrorLog.log(this, "showSystemCheck", e.message ?: "unknown")
            toast("System check failed: ${e.message}")
        }
    }

    private fun factoryReset() {
        try {
            // Last-chance internal copy (survives until the next factory reset).
            val data = JSONObject()
            appDataDir.listFiles()?.filter { it.extension == "json" }?.forEach { f ->
                data.put(f.nameWithoutExtension, f.readText())
            }
            File(filesDir, "auto-backup-before-reset.json").writeText(
                JSONObject()
                    .put("app", "goal-tracker-shell")
                    .put("exportedAt", System.currentTimeMillis())
                    .put("data", data)
                    .toString(2)
            )
            appDataDir.deleteRecursively()
            appDir.deleteRecursively()
            getSharedPreferences("scheduled_alarms", MODE_PRIVATE).edit().clear().apply()
            getSharedPreferences("shell_pending_events", MODE_PRIVATE).edit().clear().apply()
            copyBundledApp()
            loadApp()
            toast("Factory reset complete")
        } catch (e: Exception) {
            ErrorLog.log(this, "factoryReset", e.message ?: "unknown")
            toast("Factory reset failed: ${e.message}")
        }
    }

    // ---------- HTML / ZIP import ----------

    private fun importHtmlOrZip(uri: Uri) {
        try {
            val type = contentResolver.getType(uri) ?: ""
            val isZip = type.contains("zip") ||
                (contentResolver.query(uri, null, null, null, null)?.use { c ->
                    val idx = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                    c.moveToFirst() && idx >= 0 && c.getString(idx).endsWith(".zip", true)
                } == true)

            // Replace the app files, keep the data directory untouched
            appDir.deleteRecursively()
            appDir.mkdirs()

            if (isZip) {
                contentResolver.openInputStream(uri)!!.use { raw ->
                    ZipInputStream(raw).use { zip ->
                        var entry = zip.nextEntry
                        while (entry != null) {
                            if (!entry.isDirectory) {
                                val out = File(appDir, entry.name)
                                // Protect against zip path traversal
                                if (out.canonicalPath.startsWith(appDir.canonicalPath)) {
                                    out.parentFile?.mkdirs()
                                    out.outputStream().use { zip.copyTo(it) }
                                }
                            }
                            zip.closeEntry()
                            entry = zip.nextEntry
                        }
                    }
                }
                if (!File(appDir, "index.html").exists()) {
                    appDir.deleteRecursively()
                    copyBundledApp()
                    toast("ZIP had no index.html - restored previous app")
                    loadApp()
                    return
                }
            } else {
                contentResolver.openInputStream(uri)!!.use { input ->
                    File(appDir, "index.html").outputStream().use { input.copyTo(it) }
                }
            }
            toast("App updated")
            loadApp()
        } catch (e: Exception) {
            copyBundledApp()
            loadApp()
            toast("Import failed: ${e.message}")
        }
    }

    // ---------- Backup export / import ----------

    fun launchExportBackup() {
        exportBackupLauncher.launch("goal-tracker-backup.json")
    }

    fun launchImportBackup() {
        importBackupLauncher.launch(arrayOf("application/json", "text/plain", "*/*"))
    }

    private fun writeBackupTo(uri: Uri) {
        try {
            val data = JSONObject()
            appDataDir.listFiles()?.filter { it.extension == "json" }?.forEach { f ->
                data.put(f.nameWithoutExtension, f.readText())
            }
            val backup = JSONObject()
                .put("app", "goal-tracker-shell")
                .put("exportedAt", System.currentTimeMillis())
                .put("data", data)
            contentResolver.openOutputStream(uri)!!.use {
                it.write(backup.toString(2).toByteArray())
            }
            toast("Backup exported")
        } catch (e: Exception) {
            toast("Export failed: ${e.message}")
        }
    }

    private fun restoreBackupFrom(uri: Uri) {
        try {
            val text = contentResolver.openInputStream(uri)!!
                .bufferedReader().use { it.readText() }
            val backup = JSONObject(text)
            val data = backup.getJSONObject("data")
            for (key in data.keys()) {
                File(appDataDir, "$key.json").writeText(data.getString(key))
            }
            toast("Backup restored")
            // Tell the HTML app so it can re-read its data
            notifyJs("backupRestored", "null")
        } catch (e: Exception) {
            toast("Restore failed: ${e.message}")
        }
    }

    // ---------- Permissions ----------

    fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33) {
            val granted = ContextCompat.checkSelfPermission(
                this, Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                notifPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                return
            }
        }
        notifyJs("notificationPermission", "\"granted\"")
    }

    // ---------- Helpers ----------

    /** Fire an event into the HTML app: window.onAndroidEvent(name, payload) */
    private fun notifyJs(event: String, jsonPayload: String) {
        runOnUiThread {
            webView.evaluateJavascript(
                "window.onAndroidEvent && window.onAndroidEvent('$event', $jsonPayload);",
                null
            )
        }
    }

    private fun toast(msg: String) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }
}
