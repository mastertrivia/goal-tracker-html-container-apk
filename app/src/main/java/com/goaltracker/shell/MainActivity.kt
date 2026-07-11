package com.goaltracker.shell

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
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
    private val dataDir: File get() = File(filesDir, "data").apply { mkdirs() }

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
        }

        webView.addJavascriptInterface(JsBridge(this), "AndroidBridge")

        loadApp()
    }

    private fun loadApp() {
        webView.loadUrl("https://appassets.androidplatform.net/app/index.html")
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
            R.id.action_import_html ->
                importHtmlLauncher.launch(arrayOf("text/html", "application/zip"))
            R.id.action_export_backup -> launchExportBackup()
            R.id.action_import_backup -> launchImportBackup()
            R.id.action_reset -> {
                appDir.deleteRecursively()
                copyBundledApp()
                loadApp()
                toast("Restored bundled app (your data was kept)")
            }
            else -> return super.onOptionsItemSelected(item)
        }
        return true
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
            dataDir.listFiles()?.filter { it.extension == "json" }?.forEach { f ->
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
                File(dataDir, "$key.json").writeText(data.getString(key))
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
