package com.goaltracker.shell

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog

/**
 * v2.4: A single, premium, card-styled confirmation dialog used by every
 * item in the overflow menu. It shows, before the user commits to anything:
 *
 *   - a colour-coded header (icon + heading) that signals the action type,
 *   - a short English description,
 *   - a one-line Hinglish explanation,
 *   - a summary that spells out exactly what happens to the HTML and the
 *     user's data (Preserved / Replaced / Restored / Deleted / Saved).
 *
 * Destructive actions additionally require the user to type a confirmation
 * word. Everything is built programmatically so it needs no extra
 * dependencies (the project only ships AppCompat) and it is wrapped in a
 * try/catch that falls back to a plain dialog, honouring the app-wide
 * "optional UI must never crash the app" rule.
 */
object ConfirmDialog {

    // Category accent colours (per the product spec).
    const val BLUE = 0xFF1E63D6.toInt()    // Refresh / Import app
    const val GREEN = 0xFF1B8A5A.toInt()   // Backup / restore data
    const val ORANGE = 0xFFE8892B.toInt()  // Restore default app
    const val RED = 0xFFC62828.toInt()     // Factory reset
    const val GREY = 0xFF5A6470.toInt()    // System check (read-only)

    // Card palette (fixed so it reads well in both light and dark themes).
    private const val CARD_BG = 0xFFFFFFFF.toInt()
    private const val TEXT_PRIMARY = 0xFF1A1D21.toInt()
    private const val TEXT_SECONDARY = 0xFF5A6470.toInt()
    private const val HINGLISH_BG = 0xFFF3F5F7.toInt()

    /** One "✓ Label : Value" line in the summary block. */
    data class SummaryLine(val label: String, val value: String)

    /**
     * @param requiredWord when non-null, the user must type it to enable the
     *   confirm button (used for destructive/irreversible actions).
     */
    fun show(
        activity: Activity,
        accent: Int,
        icon: String,
        heading: String,
        english: String,
        hinglish: String,
        summary: List<SummaryLine>,
        confirmLabel: String,
        requiredWord: String? = null,
        onConfirmed: () -> Unit,
    ) {
        try {
            showPremium(
                activity, accent, icon, heading, english, hinglish,
                summary, confirmLabel, requiredWord, onConfirmed,
            )
        } catch (e: Exception) {
            ErrorLog.log(activity, "ConfirmDialog", e.message ?: "render failed")
            showFallback(activity, heading, english, hinglish, confirmLabel, requiredWord, onConfirmed)
        }
    }

    private fun showPremium(
        activity: Activity,
        accent: Int,
        icon: String,
        heading: String,
        english: String,
        hinglish: String,
        summary: List<SummaryLine>,
        confirmLabel: String,
        requiredWord: String?,
        onConfirmed: () -> Unit,
    ) {
        val d = activity.resources.displayMetrics.density
        fun dp(v: Int) = (v * d).toInt()

        // ---- Card root -------------------------------------------------
        val card = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply {
                setColor(CARD_BG)
                cornerRadius = dp(20).toFloat()
            }
            clipToOutline = true
        }

        // ---- Header (accent bar) --------------------------------------
        val header = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(20), dp(18), dp(20), dp(18))
            background = GradientDrawable().apply {
                cornerRadii = floatArrayOf(
                    dp(20).toFloat(), dp(20).toFloat(),
                    dp(20).toFloat(), dp(20).toFloat(),
                    0f, 0f, 0f, 0f,
                )
                setColor(accent)
            }
        }
        header.addView(TextView(activity).apply {
            text = icon
            textSize = 22f
            setPadding(0, 0, dp(12), 0)
        })
        header.addView(TextView(activity).apply {
            text = heading
            setTextColor(Color.WHITE)
            textSize = 18f
            setTypeface(typeface, Typeface.BOLD)
        })
        card.addView(header)

        // ---- Body ------------------------------------------------------
        val body = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(18), dp(20), dp(8))
        }

        // English description.
        body.addView(TextView(activity).apply {
            text = english
            setTextColor(TEXT_PRIMARY)
            textSize = 15f
            setLineSpacing(dp(3).toFloat(), 1f)
        })

        // Hinglish explanation in a subtle tinted box.
        val hinglishBox = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(12))
            background = GradientDrawable().apply {
                setColor(HINGLISH_BG)
                cornerRadius = dp(12).toFloat()
            }
        }
        hinglishBox.addView(TextView(activity).apply {
            text = "HINGLISH"
            setTextColor(accent)
            textSize = 11f
            letterSpacing = 0.08f
            setTypeface(typeface, Typeface.BOLD)
        })
        hinglishBox.addView(TextView(activity).apply {
            text = hinglish
            setTextColor(TEXT_SECONDARY)
            textSize = 14f
            setPadding(0, dp(4), 0, 0)
            setLineSpacing(dp(3).toFloat(), 1f)
        })
        body.addView(hinglishBox, marginParams(dp(14), dp(14)))

        // Summary block.
        if (summary.isNotEmpty()) {
            val summaryBox = LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(14), dp(10), dp(14), dp(10))
                background = GradientDrawable().apply {
                    setColor(withAlpha(accent, 0x14))
                    cornerRadius = dp(12).toFloat()
                }
            }
            summary.forEach { line ->
                val row = LinearLayout(activity).apply {
                    orientation = LinearLayout.HORIZONTAL
                    setPadding(0, dp(4), 0, dp(4))
                }
                row.addView(TextView(activity).apply {
                    text = "\u2713"
                    setTextColor(valueColor(line.value, accent))
                    textSize = 14f
                    setTypeface(typeface, Typeface.BOLD)
                    setPadding(0, 0, dp(8), 0)
                })
                row.addView(TextView(activity).apply {
                    text = line.label
                    setTextColor(TEXT_PRIMARY)
                    textSize = 14f
                    layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
                })
                row.addView(TextView(activity).apply {
                    text = line.value
                    setTextColor(valueColor(line.value, accent))
                    textSize = 14f
                    setTypeface(typeface, Typeface.BOLD)
                })
                summaryBox.addView(row)
            }
            body.addView(summaryBox, marginParams(0, dp(4)))
        }

        // Optional typed-confirmation field for destructive actions.
        var input: EditText? = null
        if (requiredWord != null) {
            body.addView(TextView(activity).apply {
                text = "Type \u201C$requiredWord\u201D to confirm"
                setTextColor(TEXT_SECONDARY)
                textSize = 13f
                setPadding(0, dp(14), 0, dp(6))
            })
            input = EditText(activity).apply {
                hint = requiredWord
                inputType = InputType.TYPE_CLASS_TEXT or
                    InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
                setSingleLine()
            }
            body.addView(input)
        }

        card.addView(body)

        // Make tall content scrollable on small screens.
        val scroll = ScrollView(activity).apply { addView(card) }
        val outer = LinearLayout(activity).apply {
            setPadding(dp(16), dp(16), dp(16), dp(4))
            addView(scroll)
        }

        val dialog = AlertDialog.Builder(activity)
            .setView(outer)
            .setPositiveButton(confirmLabel, null) // handler set below to gate closing
            .setNegativeButton("Cancel", null)
            .create()
        dialog.window?.setBackgroundDrawable(GradientDrawable().apply {
            setColor(CARD_BG)
            cornerRadius = dp(20).toFloat()
        })
        // The card provides its own surface; hide the default window bg so the
        // rounded corners are visible.
        dialog.window?.setBackgroundDrawable(
            android.graphics.drawable.ColorDrawable(Color.TRANSPARENT)
        )

        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE)?.apply {
                setTextColor(accent)
                setOnClickListener {
                    val field = input
                    if (field != null && field.text.toString().trim() != requiredWord) {
                        field.error = "Type $requiredWord exactly"
                        return@setOnClickListener
                    }
                    dialog.dismiss()
                    onConfirmed()
                }
            }
            dialog.getButton(AlertDialog.BUTTON_NEGATIVE)?.setTextColor(TEXT_SECONDARY)
        }
        dialog.show()
    }

    /** Ultra-safe fallback if the custom view fails for any reason. */
    private fun showFallback(
        activity: Activity,
        heading: String,
        english: String,
        hinglish: String,
        confirmLabel: String,
        requiredWord: String?,
        onConfirmed: () -> Unit,
    ) {
        val input = if (requiredWord != null) EditText(activity).apply { hint = requiredWord } else null
        val b = AlertDialog.Builder(activity)
            .setTitle(heading)
            .setMessage("$english\n\n$hinglish")
            .setPositiveButton(confirmLabel) { _, _ ->
                if (input == null || input.text.toString().trim() == requiredWord) onConfirmed()
            }
            .setNegativeButton("Cancel", null)
        if (input != null) b.setView(input)
        b.show()
    }

    private fun marginParams(top: Int, bottom: Int): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(-1, -2).apply { topMargin = top; bottomMargin = bottom }

    private fun withAlpha(color: Int, alpha: Int): Int =
        (alpha shl 24) or (color and 0x00FFFFFF)

    /** Colour a summary value by its meaning. */
    private fun valueColor(value: String, accent: Int): Int = when {
        value.equals("Deleted", true) -> RED
        value.equals("Replaced", true) -> ORANGE
        value.equals("Preserved", true) -> GREEN
        value.equals("Saved", true) || value.equals("Saved to Device", true) -> GREEN
        value.equals("Restored", true) -> BLUE
        value.equals("Not Included", true) -> GREY
        else -> accent
    }
}
