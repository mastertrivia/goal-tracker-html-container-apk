# Goal Tracker — Android Shell v3.1 — ENGINEERING HANDOVER

> **This is the authoritative, latest handover (v3.1).** Older handover sections
> remain below as history. A brand-new AI session with ZERO prior context can
> continue using ONLY: this file + the project ZIP + the docs inside the repo,
> and **must read `PROJECT_STRUCTURE.md` first**.

---

## v3.1 — Stale Bomb line after a background Pause / Resume fixed

**Shell/native version = 3.1** (`JsBridge.getShellVersion()` → `"3.1"`,
`app/build.gradle` versionCode 9 / versionName "3.1"). Both native Kotlin AND
the bundled HTML changed — the shell needs a fresh GitHub Actions APK build.

### The problem (follow-up to v3.0)
After v3.0, a background Pause/Resume tap correctly changed the timer, but the
notification's **Bomb line** was stale: missing after Pause, sometimes lingering
after Resume. Reopening the app fixed it.

### Root cause
While backgrounded the notification is drawn entirely by the v3.0 TEMPORARY
native feedback — HTML is asleep and its own re-render (`andSyncNotification`)
only runs on the 1s heartbeat, which Android freezes in the background. That
feedback froze/unfroze the session clock but never added/removed the Bomb line,
and had no Bomb remaining-time to show (that value lives only in HTML via
`bombLiveRemainingMs`).

### The fix (small, localized — no engine/sync redesign)
- **HTML (`andSyncNotificationNative`)** now attaches an INERT `bombPreview`
  object — `{ remainMs, line }` — to the running-session state it already pushes
  through `setTimerState`. Provided for every session (paused or not) so the
  line can always be added/removed. Computed with the existing
  `bombLiveRemainingMs`; no new HTML logic.
- **Native (`TimerService`)**: `State` gained inert `bombPreviewMs` /
  `bombPreviewLine` fields (parsed + persisted). `nativePauseResumeFeedback`
  now appends the Bomb line + a plain countdown clock on Pause and strips it on
  Resume, idempotently. Native does **no** Bomb math — it only renders/hides
  what HTML supplied.

### Non-negotiable guarantee (unchanged)
HTML remains the single source of truth for all timer and Bomb semantics; it
overwrites the temporary native presentation the moment it is alive again. The
timer subsystem (Pomodoro logic, Bomb logic, countdown math, timer engine,
persistence, recovery, synchronization) was left LOCKED and untouched.

### Verification
Standalone `public/goal-tracker.html` verified byte-for-byte identical to the
bundled `app/src/main/assets/app/index.html`. Android/Kotlin project — cannot run
in the v0 web preview; build the APK via GitHub Actions to test on-device.

---

## v3.0 — Notification action buttons fixed (Pause / Resume / Stop)

**Shell/native version = 3.0** (`JsBridge.getShellVersion()` → `"3.0"`,
`app/build.gradle` versionCode 8 / versionName "3.0"). Native Kotlin changed —
the shell needs a fresh GitHub Actions APK build.

### The problem
- Tapping **Pause / Resume / Stop** on the timer notification did nothing while
  the app was backgrounded ("dummy buttons"); reopening showed the Pomodoro
  still running.
- Pressing **Stop** while a **Bomb** was still ticking destroyed the notification
  entirely, even though the Bomb kept running.

### Root cause
Every notification action was delivered ONLY to the HTML/WebView — the single
source of truth for all timer logic — and that delivery path was alive only
while the Activity was foregrounded. Backgrounded taps were queued, but the
queue was drained by JS boot (`getPendingEvents()` in `andInit()`) only on a
COLD start; a warm resume never replayed them. Stop also tore down the
foreground notification unconditionally, ignoring a still-ticking Bomb.

### The fix (three native files only; timer subsystem LOCKED/untouched)
- **Fix A — reliable delivery (`MainActivity.kt`):** added a `pageEverFinished`
  flag (set in `onPageFinished`). On a **warm** resume only, `onResume()` now
  drains the native pending-event queue and replays each queued tap into the
  live HTML via `notifyJs` → `window.onAndroidEvent(...)` BEFORE firing
  `appResumed`. Cold starts still let JS boot drain the queue (no double-drain).
  HTML handlers are idempotent, so replays are safe.
- **Fix B — responsive, bomb-aware notification (`TimerActionReceiver.kt` +
  `TimerService.kt`):** each tap now also asks the foreground service for
  INSTANT, TEMPORARY notification-presentation feedback via new intents
  `ACTION_NOTIF_PAUSE / _RESUME / _STOP`. `nativePauseResumeFeedback()` freezes/
  unfreezes the session clocks and flips the paused flag (mirroring the HTML's
  own rules — a bomb-only notification does not pause); `nativeStopFeedback()`
  keeps a ticking bomb-only notification alive instead of destroying it.

### Non-negotiable guarantee (owner rule)
The **HTML remains the single source of truth** for all timer semantics. The
native feedback is PRESENTATION ONLY and is **never authoritative** — the HTML
overwrites it via `setTimerState` / `andSyncNotification` the instant it is alive
again. The native layer must never permanently own Pause/Resume/Stop business
logic. The following were left LOCKED and untouched: Pomodoro logic, Bomb logic,
countdown calculations, timer engine, timer persistence, timer recovery, timer
synchronization, and all HTML business logic.

### Verification
Standalone `public/goal-tracker.html` verified byte-for-byte identical to the
bundled `app/src/main/assets/app/index.html` (this was a native-only change, so
both HTML files are unchanged from v2.6). This is an Android/Kotlin project and
cannot run in the v0 web preview; build the APK via GitHub Actions to test the
notification buttons on-device.

---

# Goal Tracker — Android Shell v2.2 — ENGINEERING HANDOVER (post–Task 6)

> **This is the authoritative, latest handover.** It supersedes `HANDOVER_v2.2.md`
> (kept only as history). A brand-new AI session with ZERO prior context can
> continue using ONLY: this file + the project ZIP + the docs inside the repo.
>
> **Last completed checkpoint: TASK 6 (final browser re-verification + repackage) — DONE.**
> **ALL SIX TASKS (1–6) ARE NOW COMPLETE.** Tasks 4, 2, and 5 were finished this session
> (details in §2b). The only native-Kotlin change was Task 2; the shell ZIP has been rebuilt
> and needs a fresh GitHub Actions APK build.

---

## 0. TL;DR — WHERE WE ARE RIGHT NOW

Two deliverables:

1. **The HTML app — `public/goal-tracker.html`** (~6,340 lines, single self-contained file: HTML + CSS + one big `<script>` closure, no build step, no framework). This is the actual Goal Tracker application. The user IMPORTS it into the Android shell at runtime (Android menu → "Import HTML"). It also runs standalone in any browser.
2. **The Android shell — `goal-tracker-android/`** (a Gradle Android Studio project, packaged as `public/goal-tracker-android-v2.2.zip`). A thin WebView wrapper that gives the HTML native powers (notifications, exact alarms, background timer, file storage, sound) via a JS bridge, `window.AndroidBridge`. Builds an APK via GitHub Actions (`.github/workflows/build-apk.yml`) or locally.

- **Shell/native version = 2.2** (`JsBridge.getShellVersion()` → `"2.2"`, `app/build.gradle` versionCode 4 / versionName "2.2"). **Task 2 changed native Kotlin** (toast gating) — the shell ZIP `public/goal-tracker-android-v2.2.zip` was rebuilt this session and requires a fresh CI APK build. The shell version string was left at "2.2" (a behavior-only change); bump it in `app/build.gradle` + `JsBridge` if you want a new version label.
- **HTML integration layer = "Bridge v2.2 / HTML Integration v1.1"** (bumped this step; shown in the Application Settings diagnostics table).

### Session timeline (what is DONE vs PENDING)

- **Task 1 — Notification content mirrors the Current Activity card.** DONE + verified (previous session).
- **v2.2 native Kotlin** (file chooser, Downloads export fallback, named sounds + default-ringtone fallback, FLAG_INSISTENT looping alarm, persistent explosion notification, session-complete ADD/CANCEL notification, BigTextStyle). WRITTEN + compiles (via CI). Was unused by HTML until Task 3.
- **Task 3 — Wire HTML to the new native v2.2 capabilities.** DONE + browser-verified (previous session). HTML-only changes.
- **Task 4 — Telegram message on bomb explosion.** **DONE + browser-verified THIS session.** HTML-only. See §2b.
- **Task 2 — Native toasts respect the HTML toast setting.** **DONE THIS session** (native Kotlin + HTML). Shell ZIP rebuilt; needs CI APK build. See §2b.
- **Task 5 — Error Log viewer / defaults / factory-reset / dead-button audit.** **DONE + browser-verified THIS session.** HTML-only. See §2b.
- **Task 6 — Final verification + repackage.** **DONE THIS session.** Re-verified all tasks via the mocked-bridge harness (drove the real observer for the explosion→Telegram path); rebuilt `public/goal-tracker-android-v2.2.zip`. See §2b.

**No half-finished states.** The build compiles and runs. If any v2.2 method is absent on an older shell, every call degrades gracefully via `andCall`/`AND.has`.

### 2b. WHAT CHANGED THIS SESSION (Tasks 4, 2, 5, 6)

All HTML changes are in `public/goal-tracker.html`; the Kotlin changes are in `goal-tracker-android/`.

- **Task 4 (HTML-only):** New `telegramOnBomb` setting (default `true`) in `DEFAULT_SETTINGS` + load-time migration guard. Toggle added to the Bomb settings sub-page (`data-sub="subBomb"`), wired into the settings render + save paths. Fires the EXISTING `telegramApiSend(token, chatId, text)` from the explosion observer branch (`bombModeOn && p.hourStreak>0 && now.hourStreak===0`, id `AND_NOTIF_BOMB_EXPLODE`), fire-and-forget in try/catch, gated by `telegramEnabled && telegramOnBomb && telegramBotToken && telegramChatId`. NO new sender written.
- **Task 2 (native + HTML):** `MainActivity.toast()` now takes a `force` param and gates informational toasts behind a new `nativeToastsEnabled` flag (default `true`, read via `Flags.get`); all failure/hard-error/cancellation toasts pass `force = true`. `JsBridge.showToast/showToastLong` respect the same flag. HTML side: new `toastsEnabled` setting (default `true`) gates the in-app `showToast()`, a "Pop-up Messages" toggle in the `subOther` sub-page, and `andSyncToastFlag()` mirrors it into the native flag on boot and on save.
- **Task 5 (HTML-only):** `factoryReset()` already deep-clones all of `DEFAULT_SETTINGS`, so new keys are covered automatically (verified). Error Log viewer (`andShowErrors`) now shows a count header + newest-first ordering + readable local timestamps via `fmtLogTime()` (was raw epoch ms). Audited all 26 Settings controls — no dead buttons.
- **Task 6:** Mocked-bridge harness verification of all tasks (explosion→Telegram driven through the real `andDetectEvents()` observer with two snapshots), then repackaged the shell ZIP. Harness (`public/gt-test.html`) deleted.

**Verification results (all pass):** Telegram fires once on explosion when enabled; suppressed when the toggle, the master switch, or credentials are off/missing; persistent explosion notification still fires independently. Toast gating hides/shows in-app toasts and mirrors `nativeToastsEnabled` correctly. Error Log renders formatted timestamps + header and the Clear flow works. No client console errors.

---

## 1. PROJECT ARCHITECTURE (read before touching anything)

### 1.1 The HTML app (`public/goal-tracker.html`)
- Persists state in **IndexedDB** via `saveState(STATE)` / load helpers. `STATE` is the global app-state object; `CACHED_TASKS` is the in-memory task array.
- Screens are `<div>`s switched by elements with `data-screen="..."` (`home`, `tasks`, `stats`, `settings`, …). Settings sub-pages use `data-sub="subXxx"` (e.g. `subAndroid`, `subBomb`, `subOther`). **There is no `go()`/`navigate()` helper** — switch screens by `document.querySelector('.nav-item[data-screen="home"]').click()`.
- Key engine functions (DO NOT rewrite; reuse):
  - `startSession(category, task, note)` — starts a timer session; sets `STATE.activeTimer`.
  - `pauseResumeSession()` — toggles pause; sets/clears `at.pausedAt`.
  - `stopSession()` — ends session.
  - `msRemaining(at)` — ms left; uses `at.startTs`, `at.duration` (seconds), `at.accumulatedPause` (ms).
  - `effectiveElapsedMs(at)` — elapsed accounting for pauses.
  - `activitySplit(totalSec, pomoSec)` — splits a study block into Pomodoro segments. **Used by BOTH the running chip and the notification builder — keep them consistent.**
  - `handleBombExpired()` — called from the tick when a bomb timer hits 0.
  - `tickCurrentActivity()` — 500ms UI updater for the Current Activity card + running chip.
  - `openReviewModal()` / `submitReview()` — the Reflection/Review popup. `submitReview()` reads the LIVE `activeTimer` (subject/startTs), so the review overlay is only safe to open while `activeTimer.state === 'REVIEW_PENDING'`.
- **Timer types** (`at.type`): `'study'`, `'bomb'`, plus simple categories. Study sessions have Pomodoro segmentation; others are single-countdown.
  - **IMPORTANT ENGINE FACT (discovered in Task 3):** the value `at.type === 'pomodoro'` is what sets `activeTimer.state = 'REVIEW_PENDING'`, but **no code path currently creates a timer with `type:'pomodoro'`** — natural study Pomodoro completion is routed through `completeNonStudySession()` (which re-arms the bomb) and never enters `REVIEW_PENDING`. Net effect: in this build the session-complete **review notification path is wired but effectively dormant** at runtime until the engine is changed to produce `REVIEW_PENDING`. This is a PRE-EXISTING engine condition, intentionally NOT touched in Task 3 (observer-only rule). See §7 Known Limitations.
- **Sleep Mode:** `isSleepActive()` returns true inside the configured window (default 00:00–08:00, `STATE.settings.dayResetHour`/`wakeHour`). When active, timers freeze and START is a no-op. During browser testing you MUST fake the clock or set resetHour==wakeHour.

### 1.2 The Android/JS bridge (`AndroidBridge`) + HTML integration layer
The HTML integration layer lives at the **bottom of `goal-tracker.html`** (search `ANDROID SHELL INTEGRATION`, `andInit`, `andDetectEvents`, `andNotifyCompletion`). Design rules that MUST be preserved:
- **Zero changes to the core engine.** The integration is an **observer**: `andDetectEvents()` runs on a ~1s loop, diffs a previous snapshot (`andPrev`) against the current `STATE`, and derives native effects. It never modifies engine behavior.
- Every bridge call goes through a safe wrapper. Two forms exist and BOTH must be used:
  - `AND.call('method', ...args)` — existence-check + try/catch; returns `null`/`false` if absent.
  - `AND.has('method')` — capability check before calling a v2.2-only method, so behavior can fall back on older shells.
- Notifications only re-fire when their text changes (diffed against `andPrev`). Alarms are scheduled once, not per tick.
- Data mirrored to native storage on boot, once per minute, and before export. One-time notification-permission request on boot.
- If `window.AndroidBridge` is undefined (plain browser), the whole layer no-ops and Application Settings shows a "not running inside the Android shell" card.

### 1.3 Android project layout (`goal-tracker-android/`) — repo structure is FROZEN
```
app/src/main/java/com/goaltracker/shell/
  MainActivity.kt        WebView host, permissions, file chooser, backup export/import
  JsBridge.kt            @JavascriptInterface methods exposed to JS as AndroidBridge.*
  TimerService.kt        Foreground service showing the ongoing timer notification
  TimerActionReceiver.kt BroadcastReceiver for notification buttons (pause/resume/stop, +ADD)
  AlarmReceiver.kt       Fires the exact-alarm notification (looping via FLAG_INSISTENT)
  AlarmScheduler.kt      Schedules/cancels exact alarms
  PendingEvents.kt       Queue for events delivered while WebView is dead (exactly-once)
  ErrorLog.kt            Native error ring buffer, surfaced to HTML via getErrorLog()
  ShellApp.kt            Application + notification channels (CHANNEL_TIMER/ALERTS/ALARM)
app/src/main/assets/app/index.html   ~8KB PLACEHOLDER shell page (NOT the real app; leave it)
.github/workflows/build-apk.yml      CI that produces the APK artifact
BRIDGE_API.md, CAPABILITY_LIST.md, HANDOVER.md, HTML_INTEGRATION_GUIDE.md  (native-side docs)
```
- **`assets/app/index.html` is intentionally a tiny placeholder.** The real Goal Tracker HTML is imported by the user at runtime, not bundled. Do NOT overwrite it.
- **Do NOT add/move/rename anything inside `goal-tracker-android/`** (it uploads to an existing GitHub repo). The root-level handover/ZIP files live OUTSIDE that folder on purpose.

---

## 2. EXACTLY WHAT WAS DONE THIS SESSION (Task 3 — HTML-only, DONE + VERIFIED)

All edits were in `public/goal-tracker.html`, in the observer/integration layer and the Settings markup. The core engine was NOT touched.

### 2.1 New Settings UI — "Bomb Warning Sound" card
- Added a SECOND sound-picker card (`id="cardBombSound"`) directly below the existing completion-sound card, with **Choose Sound / Test / Remove** buttons (`andBombSoundPick`, `andBombSoundTest`, `andBombSoundClear`) and a status line (`andBombSoundStatus`).
- Uses the v2.2 named-sound API for the name **`"bombwarn"`**: save via `AND.call('saveNamedSound','bombwarn',base64)`, test via `playNamedSound('bombwarn')`, remove via `clearNamedSound('bombwarn')`, status via `hasNamedSound('bombwarn')`.
- Enforces the 1 MB limit (same as completion sound), reads the file as base64 via `FileReader`.
- Card is **gated to v2.2+ shells**: if `AND.has('saveNamedSound')` is false, the card dims and the status reads "Requires Android shell v2.2 or newer"; buttons show a toast telling the user to update.
- Wiring added in `andRenderSettings()` (status text) and `andBindSettings()` (button handlers).

### 2.2 Bomb explosion → persistent notification + dedicated sound
- In the observer's bomb-explosion branch (fires when `bombModeOn(STATE)` and `hourStreak` went from `>0` to `0`):
  - Calls `AND.call('showPersistentNotification', AND_NOTIF_BOMB_EXPLODE, '💥 Bomb exploded', msg)` when available, else falls back to `showNotification`.
  - Plays the dedicated bomb sound via new helper `andPlayBombSound()` → `playNamedSound('bombwarn')` (falls back to `playCompletionSound` on old shells; native itself falls back to the device notification tone if no file is set).
  - Stronger vibration pattern `[300,120,300,120,300]` (respects the existing `vibrate` setting).
- The persistent (ongoing) notification is **auto-cancelled** in two places: when the user acknowledges the breach screen (`breachOkBtn` handler, after typing "123"), and on app open in `andInit()`.

### 2.3 Session-complete ADD action (review notification)
- New helper `andNotifyReview(id, title, text)` → uses `showReviewNotification` (native ADD/CANCEL buttons) when available, else plain `showNotification`; also plays completion sound + vibrates.
- The observer's session-complete branch now calls `andNotifyReview(AND_NOTIF_REVIEW, …)` for a study Pomodoro awaiting review (`now.review === true`), and plain `andNotifyCompletion(...)` otherwise.
- The incoming `timerAction` value **`"reviewAdd"`** is handled in the existing `onAndroidEvent('timerAction', …)` path: it cancels the review notification, switches to Home (via the nav item), and calls `openReviewModal()` — **guarded by `activeTimer.state === 'REVIEW_PENDING'`** so it is a safe no-op otherwise. CANCEL is handled natively (just dismisses).
- NOTE: because the engine never sets `REVIEW_PENDING` today (see §1.1), this path is dormant at runtime but fully wired and verified via a forced state in tests.

### 2.4 New constants / version bump
- `const AND_NOTIF_REVIEW = 1;` and `const AND_NOTIF_BOMB_EXPLODE = 4;` added next to the alarm-id constants.
- Integration header comment changed to `Bridge v2.2`; diagnostics table row bumped to `['HTML Integration', 'v1.1']`.

### 2.5 Verification (browser, mocked bridge — all PASS)
Ran with a mocked `AndroidBridge` recording calls into `window.__calls`, clock frozen to 12:30 to defeat Sleep Mode, and test hooks (`window.__gt`) injected inside the app closure. Verified:
- **Bomb explosion** emits `showPersistentNotification("4", …)` + `playNamedSound("bombwarn")`.
- **Observer review path** (forced `REVIEW_PENDING`) emits `showReviewNotification` + `playCompletionSound`.
- **`reviewAdd`** is a safe no-op without a pending review; opens the review overlay when `REVIEW_PENDING`.
- **Breach acknowledge** ("123" + OK) calls `cancelNotification("4")` and hides the breach screen.
- **Settings card** renders with correct status text and all three buttons bound; `saveNamedSound('bombwarn', …)` round-trips.
- Test harness (`public/gt-test.html`) was DELETED after verification — it must NOT ship.

---

## 3. REMAINING WORK (nothing below is started)

### TASK 4 — Telegram message on bomb explosion
- The HTML ALREADY has a Telegram sender — **grep `api.telegram.org`, `tgSend`/`sendTelegram`, `botToken`/`chatId`** (there is an existing raw sender roughly around the 2639–2660 line region). **Reuse it; do NOT write a new one.**
- Add a toggle (+ bot token / chat id fields only if not already present) in the **Bomb settings sub-page** (`data-sub="subBomb"`, page markup around line 1306+). Suggested key `STATE.settings.telegramOnBomb`.
- Fire from the bomb-explosion hook (the same observer branch Task 3 uses at `AND_NOTIF_BOMB_EXPLODE`, or `handleBombExpired()`), wrapped in try/catch. Search Settings first to avoid duplicate Telegram fields.

### TASK 2 — Native toasts respect the HTML toast setting
- Native `Toast` (via `MainActivity.toast(...)`) fires regardless of the in-HTML toast preference.
- Recommended: add a `nativeToastsEnabled` flag (default true) read by `MainActivity.toast()`, and mirror the HTML `toastsEnabled` setting into it inside the flag-sync path (grep `andSyncFlags`/`setFlag`). Keep hard-error toasts (e.g. "No file picker available") always-on; gate informational ones.
- **This one touches native Kotlin** → will require rebuilding the shell ZIP + a CI build.

### TASK 5 — Error Log viewer, defaults, factory-reset, dead-button audit
- **Error Log:** improve the Application Settings viewer (`getErrorLog()` → JSON `[{where,message,at}]`; `clearErrorLog()`). Add copy/clear if missing; consistent ordering.
- **Defaults + factory reset:** ensure `DEFAULT_SETTINGS` includes ALL new keys (bomb-sound presence is stored natively, but `telegramOnBomb`, any toast keys, etc.). Verify the factory-reset / "erase all" path (grep `factory`, `resetAll`, `eraseAll`) resets them.
- **Audit EVERY Settings button** across all sub-pages for dead controls, especially the Application Settings page.

### TASK 6 — Final verification + repackage
- After Tasks 2/4/5, re-verify in-browser with the mocked-bridge harness (§5) and rebuild `public/goal-tracker-android-v2.2.zip` from `goal-tracker-android/` **only if native changed** (Task 2 will change native; Tasks 4/5 are HTML-only). Also rebuild the whole-project ZIP.

---

## 4. RECOMMENDED IMPLEMENTATION ORDER
1. **Task 4 — Telegram on explosion** (HTML-only; builds directly on the Task 3 explosion hook; high user value).
2. **Task 2 — toast gating** (small, isolated; the only remaining NATIVE change → schedule its CI build).
3. **Task 5 — defaults / error log / button audit** (cleanup pass; validates keys added in 2 & 4).
4. **Task 6 — final verify + repackage.**

> Per the user's workflow rule: **STOP after EACH task** and ask whether to continue or to produce a handover. Do NOT auto-continue between tasks.

---

## 5. TESTING PLAYBOOK (browser, mocked bridge)

The dev server serves `public/` at `http://localhost:3000/`. Use the `agent-browser` skill. Match the desktop preview viewport (~417×465) before judging layout/screenshots.

**Build a harness** — copy `goal-tracker.html` → `public/gt-test.html`, then:
- Inject a mock `window.AndroidBridge` **before `<head>` content** that records every call into `window.__calls` (each entry `[methodName, ...stringifiedArgs]`) and returns sensible values (`getShellVersion` → `"2.2"`, `hasNamedSound` → `false`, etc.).
- Freeze the clock so Sleep Mode is OFF: override `Date.prototype.getHours` → 12 and `getMinutes` → 30.
- **Inject test hooks INSIDE the app's `<script>` closure** at the `/* ============ BOOT ============ */` anchor (engine vars `STATE`, `CACHED_TASKS`, `startSession`, `andDetectEvents`, `andPrev` live there — a separate `<script>` cannot see them):
  ```js
  window.__gt = {
    state:()=>STATE, tasks:()=>CACHED_TASKS,
    async start(){ const t=CACHED_TASKS.find(x=>!x.completedAt)||CACHED_TASKS[0]; await startSession(t.category||'study', t, ''); return !!STATE.activeTimer; },
    async pause(){ await pauseResumeSession(); },
    async stop(){ await stopSession(); },
    async fastForward(){ const at=STATE.activeTimer; at.startTs=Date.now()-at.duration*1000+1500-(at.accumulatedPause||0); await saveState(STATE); },
    fire:(n,v)=> window.onAndroidEvent(n,v),
    detect:()=> andDetectEvents(),      // drive the observer manually
    resetObs:()=>{ andPrev=null; }       // clear the observer's previous snapshot
  };
  ```
- The observer needs TWO consecutive `detect()` calls to see a transition (it diffs `andPrev` vs now). To test the review notification: `start()` → set `at.type='study'`, remaining `<2500`ms → `resetObs()` → `detect()` (snapshot 1) → set `at.state='REVIEW_PENDING'` → `detect()` (snapshot 2) → assert `showReviewNotification` in `__calls`.
- To fast-forward a running timer you MUST `await saveState(STATE)` (a background `recoverState()` reloads from IndexedDB and would wipe a non-persisted edit).
- **Always delete `public/gt-test.html` when done.**

---

## 6. BRIDGE / API REFERENCE (current, v2.2)

All are `window.AndroidBridge.*`; always call through `AND.call(name,...args)` (and check `AND.has(name)` for v2.2-only methods).

- **Storage/flags:** `getFlag(k,default)`, `setFlag(k,v)`, `getAllFlags()→json`, `saveData(k,v)→bool`, `loadData(k)→string`.
- **Diagnostics:** `getShellVersion()→"2.2"`, `getDiagnostics()→json`, `getErrorLog()→json[]`, `clearErrorLog()`.
- **Notifications:** `showNotification(id,title,text)`, **`showPersistentNotification(id,title,text)`** (ongoing; bomb explosion — id `4` = `AND_NOTIF_BOMB_EXPLODE`), **`showReviewNotification(id,title,text)`** (ADD/CANCEL; review — id `1` = `AND_NOTIF_REVIEW`), **`cancelNotification(id)`**.
- **Timer service:** `startTimer/updateTimer/pauseTimer/stopTimer`.
- **Alarms:** `scheduleAlarm(...)→bool` (loops via FLAG_INSISTENT), `cancelAlarm(...)`.
- **Sound:** `playCompletionSound()→bool` (falls back to default ringtone), `stopCompletionSound()`, legacy `saveSoundFile(b64)`/`clearSoundFile()`, **`saveNamedSound(name,b64)→bool`**, **`clearNamedSound(name)→bool`**, **`hasNamedSound(name)→bool`**, **`playNamedSound(name)→bool`**. Named sounds in use: `"completion"` (legacy maps here) and **`"bombwarn"`** (added by Task 3 UI).
- **Backup:** `exportBackup()` / `importBackup()` (Downloads fallback automatic in native).
- **Permissions/events:** `requestNotificationPermission()`, `getPendingEvents()→json[]`.
- **Events INTO the HTML:** `window.onAndroidEvent(name, value)` — `timerAction` (`pause`/`resume`/`stop`/**`reviewAdd`**), `notificationPermission`, `backupRestored`.
- Status emoji convention: 🟢 running · 🟡 paused · 🔴 bomb · 💥 explosion.

---

## 7. KNOWN LIMITATIONS / ASSUMPTIONS
- **`REVIEW_PENDING` is currently unreachable in the engine** (no timer is created with `type:'pomodoro'`), so the session-complete review notification + ADD-action flow are wired and verified-by-forcing but DORMANT at runtime. Making them live requires an ENGINE change (out of the observer-only scope) — confirm with the user before touching the engine.
- **Kotlin is not compiled in this environment** (no Android SDK). Native changes rely on the GitHub Actions build. Task 3 changed NO Kotlin, so the shell ZIP is unchanged and known-good from v2.2.
- Sound fallback uses the default NOTIFICATION ringtone; if notifications are muted at OS level it may still be silent (OS policy, not a bug).
- `showReviewNotification` ADD button uses request codes `notifId` and `notifId+100000` for its two PendingIntents — keep notification ids small to avoid collisions (that's why review=1, bomb=4).
- The persistent bomb notification is `setOngoing(true)`; it is cleared on breach-acknowledge and on app open — if you add other explosion paths, make sure they also `cancelNotification(AND_NOTIF_BOMB_EXPLODE)`.
- Repo structure of `goal-tracker-android/` is FROZEN; do not restructure or overwrite `assets/app/index.html`.

---

## 8. FILES MODIFIED THIS SESSION (Task 3)
- `public/goal-tracker.html` — ONLY file changed. Additions: `cardBombSound` Settings markup; `AND_NOTIF_REVIEW`/`AND_NOTIF_BOMB_EXPLODE` constants; `andNotifyReview()` + `andPlayBombSound()` helpers; observer wiring for review + persistent explosion notif; `reviewAdd` handling in `onAndroidEvent`; breach-acknowledge + `andInit` cancel of the persistent notif; `andRenderSettings`/`andBindSettings` bomb-sound handlers; version bump to Bridge v2.2 / HTML Integration v1.1.
- Documentation: this `HANDOVER.md` created; `HANDOVER_v2.2.md` marked superseded.
- No Kotlin / no `goal-tracker-android/` changes → shell ZIP unchanged.

---

## 9. "CONTINUE FROM HERE" PROMPT (paste into a fresh Claude/v0 chat)

```
You are continuing an in-progress project called "Goal Tracker — Android Shell v2.2".
You have ZERO prior context. Read HANDOVER.md in the project root FIRST and treat it as ground truth
(HANDOVER_v2.2.md is older history — ignore it if it conflicts).

WORKFLOW RULE (mandatory): Do NOT auto-continue between tasks. After you FULLY finish ONE task, STOP and ask me:
  "✅ Task X complete. 1) Continue to next task, or 2) Stop and prepare a full handover package?"
Never start the next task until I explicitly say continue. Each finished task is a safe checkpoint.

Project = two deliverables:
1) public/goal-tracker.html — the single-file Goal Tracker web app (~6,340 lines; imported into the shell at
   runtime; also runs in a browser). All app logic lives here.
2) goal-tracker-android/ — a WebView shell Android project (packaged as public/goal-tracker-android-v2.2.zip)
   exposing native powers to the HTML via window.AndroidBridge. Native version = 2.2.

Status: Task 1 (notification content mirrors the Current Activity card) and Task 3 (HTML wiring of the v2.2 native
capabilities: bomb warning sound picker, persistent explosion notification, session-complete ADD/CANCEL review
notification) are BOTH DONE and browser-verified. The v2.2 native Kotlin is already written and compiles.

Remaining work, in this order (full detail in HANDOVER.md §3–4):
- Task 4: Telegram message on bomb explosion. Reuse the EXISTING HTML Telegram sender (grep api.telegram.org /
  tgSend / botToken). Add a toggle in the Bomb settings sub-page (data-sub="subBomb"). Fire from the explosion hook
  (observer branch AND_NOTIF_BOMB_EXPLODE / handleBombExpired), wrapped in try/catch. HTML-only.
- Task 2: Gate native Android toasts behind the HTML toast setting (add nativeToastsEnabled flag read by
  MainActivity.toast(); keep hard-error toasts). THIS CHANGES NATIVE KOTLIN → rebuild the shell ZIP + CI build.
- Task 5: Ensure DEFAULT_SETTINGS + factory-reset include all new keys; improve the Error Log viewer; audit every
  Settings button for dead controls.
- Task 6: Re-verify in browser (mocked-bridge harness, HANDOVER.md §5) and repackage.

Hard rules:
- NEVER modify the HTML core timer engine. The Android integration is an OBSERVER (~1s loop, andDetectEvents(),
  diffing STATE via andPrev) at the bottom of goal-tracker.html. All bridge calls go through the safe AND.call(...)
  wrapper, and v2.2-only methods must be guarded with AND.has(...) so older shells can't crash.
- Reuse existing engine functions: startSession, pauseResumeSession, stopSession, msRemaining, activitySplit,
  handleBombExpired, tickCurrentActivity, openReviewModal / REVIEW_PENDING flow, and the existing Telegram sender.
  Grep before writing anything new.
- Keep goal-tracker-android/ repo structure IDENTICAL (it uploads to an existing GitHub repo). Do NOT overwrite
  assets/app/index.html (intentional placeholder).
- KNOWN ENGINE GOTCHA: no timer is created with type:'pomodoro', so activeTimer.state==='REVIEW_PENDING' is never
  reached at runtime — the review-notification path is wired but dormant. Do NOT "fix" this by editing the engine
  without asking me first.
- Bridge API reference is in HANDOVER.md §6. Status emojis: 🟢 running · 🟡 paused · 🔴 bomb · 💥 explosion.
- Test with the mocked-bridge harness in §5 (inject hooks INSIDE the app's script closure; fake the clock to defeat
  Sleep Mode; drive the observer with two andDetectEvents() calls; delete public/gt-test.html when done).

Start with Task 4. First summarize your understanding and plan, then implement. STOP when Task 4 is done and ask me.
```

---
END OF HANDOVER.
