package com.goaltracker.shell

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * v4.11: the import gate must accept every legitimate Goal Tracker backup
 * (v4.11 with checksum AND legacy without) and reject everything else —
 * corrupt JSON, wrong app, damaged structure, checksum mismatch — with a
 * clear user-facing reason BEFORE any stored file is touched.
 */
class BackupValidatorTest {

    private fun validInner(): String {
        val state = JSONObject()
            .put("key", "state")
            .put("lastActiveDate", "2026-10-23")
            .put("settings", JSONObject().put("pomodoroDuration", 1800).put("hearts", 1))
        return JSONObject()
            .put("v", 1)
            .put("savedAt", 1792731955585L)
            .put("state", state)
            .put("tasks", JSONArray().put(JSONObject().put("id", 1).put("name", "Maths")))
            .put("sessions", JSONArray())
            .put("timeline", JSONArray())
            .toString()
    }

    private fun backupDoc(inner: String = validInner(), checksum: String? = null): String {
        val data = JSONObject().put("gt_backup", inner)
        val doc = JSONObject()
            .put("app", BackupValidator.APP_ID)
            .put("exportedAt", 123L)
            .put("data", data)
        if (checksum != null) doc.put("checksum", checksum)
        return doc.toString()
    }

    private fun validChecksum(entries: Map<String, String>): String =
        BackupValidator.fnv1a32(BackupValidator.checksumPayload(entries))

    private fun expectReject(json: String, needle: String) {
        try {
            BackupValidator.validate(json)
            fail("expected rejection mentioning \"$needle\"")
        } catch (e: IllegalArgumentException) {
            val msg = e.message ?: ""
            assertTrue("reason \"$msg\" should mention \"$needle\"", msg.contains(needle, ignoreCase = true))
        }
    }

    @Test
    fun validFileWithChecksumPasses() {
        val inner = validInner()
        val entries = mapOf("gt_backup" to inner)
        val result = BackupValidator.validate(backupDoc(inner, validChecksum(entries)))
        assertEquals(setOf("gt_backup"), result.keys)
        assertEquals(inner, result["gt_backup"])
    }

    @Test
    fun legacyFileWithoutChecksumStillPasses() {
        val result = BackupValidator.validate(backupDoc(checksum = null))
        assertNotNull(result["gt_backup"])
    }

    @Test
    fun notValidJsonRejected() {
        expectReject("{this is not json", "not valid JSON")
    }

    @Test
    fun foreignAppRejected() {
        val doc = JSONObject()
            .put("app", "some-other-app")
            .put("data", JSONObject().put("gt_backup", validInner()))
            .toString()
        expectReject(doc, "not a Goal Tracker backup")
    }

    @Test
    fun missingDataSectionRejected() {
        val doc = JSONObject().put("app", BackupValidator.APP_ID).toString()
        expectReject(doc, "no data section")
    }

    @Test
    fun nonStringFieldValueRejected() {
        val doc = JSONObject()
            .put("app", BackupValidator.APP_ID)
            .put("data", JSONObject().put("gt_backup", 42))
            .toString()
        expectReject(doc, "corrupt")
    }

    @Test
    fun corruptInnerJsonRejected() {
        expectReject(backupDoc(inner = "{\"state\": {truncated"), "damaged")
    }

    @Test
    fun missingStateRejected() {
        val inner = JSONObject().put("v", 1).toString()
        expectReject(backupDoc(inner = inner), "no app state")
    }

    @Test
    fun missingSettingsRejected() {
        val inner = JSONObject().put("state", JSONObject().put("goal", "x")).toString()
        expectReject(backupDoc(inner = inner), "no settings")
    }

    @Test
    fun tasksNotArrayRejected() {
        val inner = JSONObject()
            .put("state", JSONObject().put("settings", JSONObject()))
            .put("tasks", "not-an-array")
            .put("sessions", JSONArray())
            .put("timeline", JSONArray())
            .toString()
        expectReject(backupDoc(inner = inner), "tasks")
    }

    @Test
    fun checksumMismatchRejected() {
        val inner = validInner()
        val doc = JSONObject()
            .put("app", BackupValidator.APP_ID)
            .put("exportedAt", 123L)
            .put("checksum", "deadbeef")
            .put("data", JSONObject().put("gt_backup", inner))
            .toString()
        expectReject(doc, "damaged")
    }

    @Test
    fun checksumDetectsEditedContents() {
        val inner = validInner()
        val entries = mapOf("gt_backup" to inner)
        val tampered = backupDoc(inner = inner.replace("Maths", "Evil"), checksum = validChecksum(entries))
        expectReject(tampered, "checksum")
    }

    @Test
    fun fnv1aMatchesKnownValues() {
        // FNV-1a 32-bit of the empty string is the offset basis itself.
        assertEquals("811c9dc5", BackupValidator.fnv1a32(""))
        // Deterministic, order-independent payload (sorted keys).
        val a = BackupValidator.checksumPayload(linkedMapOf("b" to "2", "a" to "1"))
        val b = BackupValidator.checksumPayload(linkedMapOf("a" to "1", "b" to "2"))
        assertEquals(a, b)
        assertEquals(BackupValidator.fnv1a32(a), BackupValidator.fnv1a32(b))
    }
}
