package com.goaltracker.shell

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * One naming rule for every native export path.
 *
 * Exports used a fixed `goal-tracker-backup.json`, and the picker-free Downloads
 * fallback used an opaque epoch-millis suffix — so two exports on the same day
 * either overwrote each other or were impossible to tell apart in a file manager.
 * Filename generation belongs here (the native layer owns file creation) and must
 * be shared by every route:
 *   - the user-chosen export folder (Settings -> Export Folder)
 *   - the JSON `CreateDocument` picker
 *   - the generic fallback picker (any MIME type)
 *   - the picker-free Downloads fallback
 *   - "Save Current HTML File" (same rule, `.html`)
 *
 * The date is the local calendar date, matching what the user sees in the app.
 * Pure Kotlin so the format stays testable without an Android device.
 */
object BackupNaming {

    /** Local calendar date, DD-MM-YYYY (e.g. 08-11-2026). */
    private const val PATTERN = "dd-MM-yyyy"

    private fun stamp(date: Date): String =
        try {
            SimpleDateFormat(PATTERN, Locale.US).format(date)
        } catch (e: Exception) {
            "export"
        }

    /** `goal-tracker-backup-08-11-2026.json` */
    fun backupFileName(date: Date = Date()): String =
        "goal-tracker-backup-${stamp(date)}.json"

    /** `goal-tracker-app-08-11-2026.html` */
    fun htmlFileName(date: Date = Date()): String =
        "goal-tracker-app-${stamp(date)}.html"

    /**
     * `goal-tracker-backup-08-11-2026 (2).json`
     *
     * Same-day duplicates never overwrite each other. MediaStore already appends
     * " (1)" on its own, but the export folder and the pre-Android-10 Downloads
     * path need this to stay consistent.
     */
    fun withSuffix(name: String, index: Int): String {
        if (index <= 1) return name
        val dot = name.lastIndexOf('.')
        return if (dot > 0) {
            name.substring(0, dot) + " ($index)" + name.substring(dot)
        } else {
            "$name ($index)"
        }
    }
}
