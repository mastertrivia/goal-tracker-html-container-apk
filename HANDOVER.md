# GOAL TRACKER — ANDROID WEBVIEW SHELL: MASTER HANDOVER DOCUMENT

> Paste this entire document into any AI assistant (or hand it to any developer)
> and they will have the complete context of this project.
> Last updated: July 2026. Project state: WORKING — shell v2.0 (versionCode 2).
> v1 built and ran on device; v2 adds stability + notification actions + time
> safety + flags (see section 3).

---

## 1. PROJECT OVERVIEW

### What we are building
A personal Android app called **Goal Tracker** for a single user (the owner). The
actual application (goals, tasks, Pomodoro timers, etc.) is written entirely in
**HTML/CSS/JavaScript** by the owner. This repository contains a small permanent
**Kotlin "shell" APK** whose only job is to host that HTML app in a WebView and
give it native Android powers (storage, notifications, alarms, foreground timers).

### Why this approach was chosen
The owner:
- Builds their app as a single HTML file (or small HTML/CSS/JS bundle)
- Updates the HTML frequently, and must NOT need to rebuild the APK for HTML changes
- Has no PC for regular use — APKs are built via **GitHub Actions** (cloud CI)
- Is a beginner in Android/Kotlin — the shell must stay small and rarely change

### Difference from WebToApp converters
The owner previously used a "WebToApp" converter and hit hard limits: no control
over the native layer, no JavaScript bridge, features locked behind paywalls, and
no way to update the HTML without regenerating the APK. This shell replaces that:
- 100% owner-controlled JS bridge (`window.AndroidBridge`)
- HTML is swappable at runtime via a menu action — no rebuild
- Data lives in app-internal storage, independent of any browser
- The APK is rebuilt ONLY when a new native capability is added

---

## 2. CURRENT ARCHITECTURE

### The golden rule
**The shell is dumb. All app logic lives in the HTML/JS.** The shell only provides
capabilities. Never put business logic (timers, goals, scheduling decisions) in Kotlin.

### WebView system
- `MainActivity` hosts a single fullscreen `WebView`.
- HTML is served from **internal storage** (`filesDir/app/`) using
  `WebViewAssetLoader` with `InternalStoragePathHandler`.
- The app URL is always: `https://appassets.androidplatform.net/app/index.html`
- This fixed https:// origin is CRITICAL: it keeps localStorage/IndexedDB origins
  stable across HTML updates and avoids all `file://` restrictions.
- WebView settings: `javaScriptEnabled = true`, `domStorageEnabled = true`,
  `allowFileAccess = false`, `allowContentAccess = false`.
- Back button navigates WebView history before exiting the app.

### HTML import/update mechanism (NO APK REBUILD NEEDED)
- App menu (3-dot, top right) → **Import HTML/ZIP** → system file picker.
- A single `.html` file is copied to `filesDir/app/index.html`.
- A `.zip` is extracted into `filesDir/app/` (with zip-path-traversal protection).
  A ZIP **must contain `index.html` at its root** or the import is rejected and
  the previous bundled app is restored.
- Import wipes `filesDir/app/` but NEVER touches `filesDir/data/` (user data).
- First launch: a bundled fallback app is copied from APK `assets/app/` to
  `filesDir/app/`. Menu → "Reset to bundled app" restores it anytime (data kept).

### Storage architecture (three layers)
1. **`filesDir/data/*.json`** — THE SOURCE OF TRUTH. JSON files written via the
   bridge (`saveData`). App-private internal storage. Survives HTML updates,
   APK updates, and WebView data clears. Independent of Chrome/browsers.
2. **IndexedDB / localStorage in the WebView** — working cache only. The HTML app
   may keep using it for speed, but every meaningful save must ALSO call
   `AndroidBridge.saveData(key, json)`.
3. **Backup files** — the full `filesDir/data/` content can be exported to /
   imported from a user-chosen JSON file (system file picker), via app menu or
   bridge methods.

### AndroidBridge concept (how HTML talks to native)
- Kotlin class `JsBridge` is attached with
  `webView.addJavascriptInterface(JsBridge(this), "AndroidBridge")`.
- In JS, every `@JavascriptInterface` method appears as
  `window.AndroidBridge.methodName(args)`. Calls are SYNCHRONOUS from JS's view.
- Bridge methods run on a BACKGROUND thread. Any UI work in Kotlin must use
  `activity.runOnUiThread { }` (toasts are safe as written).
- **Native → JS direction**: the shell calls
  `window.onAndroidEvent(eventName, payload)` via `evaluateJavascript`.
  The HTML app should define `window.onAndroidEvent = function(name, payload) {...}`.
  Events currently emitted: `notificationPermission` ("granted"/"denied"),
  `backupRestored` (null), `timerAction` ("pause" | "resume" | "stop", from
  notification buttons).
- **Missed events**: if a notification button is tapped while the activity is
  dead, the event is queued (SharedPreferences). The HTML app must call
  `AndroidBridge.getPendingEvents()` on page load (drains the queue, each event
  delivered exactly once).
- JS numbers arrive in Kotlin as `Double` — that is why `scheduleAlarm` takes
  `triggerAtMillis: Double` and converts with `.toLong()`.

---

## 3. COMPLETED FEATURES (all working on device)

- WebView shell loading HTML from internal storage via stable https origin
- Bundled fallback/test app in `assets/app/index.html` (a bridge test console)
- Menu: Reload, Import HTML/ZIP, Export backup, Import backup, Reset to bundled app
- HTML/ZIP import with validation and safe failure recovery
- JSON data layer (`saveData`/`loadData`/`deleteData`/`listDataKeys`)
- Backup export/import via system file picker (menu AND bridge methods)
- Toasts from JS
- Immediate notifications from JS (`showNotification`)
- Android 13+ notification permission flow (`requestNotificationPermission`)
- Exact alarms that fire with app closed (`scheduleAlarm`/`cancelAlarm`),
  persisted in SharedPreferences and re-scheduled after reboot (BootReceiver);
  graceful fallback to inexact alarms if user revokes exact-alarm permission
- Foreground timer service with persistent notification
  (`startTimer`/`updateTimer`/`pauseTimer`/`stopTimer`) — JS owns all timing logic
- GitHub Actions workflow that builds a SIGNED release APK
- Permanent signing keystore auto-generated on first CI run and committed to repo

### New in v2 (all working, verified against source)
- **Bridge-wide error isolation**: every bridge method is wrapped in a `safe()`
  helper — failures log to a persistent error ring buffer (last 50 entries,
  `ErrorLog.kt`) instead of crashing. Same pattern in all receivers/services.
- **Timer notification action buttons**: Pause/Resume/Stop on the foreground
  timer notification (`TimerActionReceiver.kt`). Actions forward to JS as
  `timerAction` events; if the app process is dead they are queued
  (`PendingEvents.kt`) and drained on next load via `getPendingEvents()`.
- **Alarm-class notifications**: dedicated `CHANNEL_ALARM` channel (system alarm
  sound + vibration + Dismiss action). Alarm notifications use
  `CATEGORY_ALARM` and fire even when the app is closed.
- **Time safety**: `elapsedRealtime()` (monotonic ms, immune to manual clock
  changes) and `currentTimeInfo()` (wallMs + monoMs + bootId). `TimeSafety`
  (in `Flags.kt`) keeps a boot id refreshed by BootReceiver so JS can detect
  reboots. Timing logic stays in JS — the shell only supplies trusted clocks.
- **Feature flags** (`Flags.kt`): `notificationsEnabled`, `alarmsEnabled`,
  `timerNotificationEnabled`, `soundEnabled` — all default true. HTML settings
  screen reads/writes via `getFlag`/`setFlag`/`getAllFlags`; native code checks
  them before acting. Settings UI lives in HTML (owner decision).
- **Optional completion sound**: one short custom sound (base64 upload from JS,
  max 1 MB decoded) via `saveSoundFile`/`playCompletionSound`/`stopCompletionSound`/
  `clearSoundFile`. Playback failure always falls back silently (returns false).
  No snooze, no ringtone framework (owner decision: stability first).
- **Recovery system**: broken HTML import → load-failure dialog (Retry / Restore
  built-in app, data untouched); WebView renderer crash → logged + `recreate()`.
- **Native menu additions**: System Check (diagnostics dialog + export as file),
  Factory Reset (typed confirmation "FACTORY RESET", makes an internal
  last-chance copy `auto-backup-before-reset.json` before wiping).
- **Typed confirmations** for destructive actions: Import HTML ("IMPORT"),
  Restore backup ("RESTORE"), Factory reset ("FACTORY RESET").
- **Diagnostics**: `getDiagnostics()` returns shell version, Android version,
  device, notification/exact-alarm permission state, data key count, error log
  count, custom sound state, boot id, and all flags.

### Explicitly REJECTED features (do not re-add without owner approval)
| Feature | Why rejected |
|---|---|
| Full ringtone picker framework | OEM URI-permission inconsistency; high failure-mode count |
| Snooze on alarms | Would duplicate timer logic natively (JS owns timing) |
| Floating overlay/bubble | SYSTEM_ALERT_WINDOW friction + OEM battery killers |
| Watchdog/keep-alive service | Fights the OS, battery drain, unreliable on modern Android |
| WebView debugging in release | Security hole in a data-holding personal app |

### Full current bridge API (verified against JsBridge.kt)
| JS call | What it does |
|---|---|
| `AndroidBridge.showToast(message)` | Android toast |
| `AndroidBridge.saveData(key, jsonString)` → boolean | Write JSON file to filesDir/data |
| `AndroidBridge.loadData(key)` → string ("" if missing) | Read JSON file |
| `AndroidBridge.deleteData(key)` → boolean | Delete JSON file |
| `AndroidBridge.listDataKeys()` → JSON array string | List stored keys |
| `AndroidBridge.exportBackup()` | Open save-file dialog, write all data |
| `AndroidBridge.importBackup()` | Open file picker, restore data, fires `backupRestored` |
| `AndroidBridge.requestNotificationPermission()` | Ask once (Android 13+), fires `notificationPermission` |
| `AndroidBridge.showNotification(id, title, text)` | Immediate notification |
| `AndroidBridge.scheduleAlarm(id, triggerAtMillis, title, text)` | Exact alarm (works app-closed); pass `Date.now() + delayMs` |
| `AndroidBridge.cancelAlarm(id)` | Cancel scheduled alarm |
| `AndroidBridge.startTimer(title, text)` | Start foreground service + persistent notification (Pause/Stop buttons) |
| `AndroidBridge.updateTimer(title, text)` | Update that notification (call every second from JS) |
| `AndroidBridge.pauseTimer(title, text)` | v2: mark notification paused (shows Resume button) |
| `AndroidBridge.stopTimer()` | Stop service, remove notification |
| `AndroidBridge.showToastLong(message)` | v2: long-duration toast |
| `AndroidBridge.elapsedRealtime()` → number | v2: monotonic ms since boot (clock-change immune) |
| `AndroidBridge.currentTimeInfo()` → JSON string | v2: `{wallMs, monoMs, bootId}` |
| `AndroidBridge.getFlag(key, default)` → boolean | v2: read a feature flag |
| `AndroidBridge.setFlag(key, value)` | v2: write a feature flag |
| `AndroidBridge.getAllFlags()` → JSON string | v2: all flags as object |
| `AndroidBridge.getPendingEvents()` → JSON array string | v2: drain queued events (call on page load) |
| `AndroidBridge.getErrorLog()` → JSON array string | v2: last 50 native errors |
| `AndroidBridge.clearErrorLog()` | v2: clear the error log |
| `AndroidBridge.getDiagnostics()` → JSON string | v2: full system state |
| `AndroidBridge.saveSoundFile(base64)` → boolean | v2: store completion sound (max 1 MB) |
| `AndroidBridge.playCompletionSound()` → boolean | v2: play it (false = no sound/failed, always silent-safe) |
| `AndroidBridge.stopCompletionSound()` | v2: stop playback |
| `AndroidBridge.clearSoundFile()` → boolean | v2: remove the stored sound |
| `AndroidBridge.getShellVersion()` → "2.0" | Shell version string |

### APK build process (GitHub Actions — no PC needed)
- Repo is PRIVATE on GitHub. Workflow: `.github/workflows/build-apk.yml`
- Triggers on every push to main/master, or manually (Actions → Run workflow)
- Steps: checkout → JDK 17 → chmod gradlew → (first run only: generate
  `signing/release.keystore` and commit it back) → `./gradlew assembleRelease` →
  upload artifact `goal-tracker-apk`
- Download: Actions tab → finished run → Artifacts → `goal-tracker-apk` →
  unzip → install `app-release.apk`
- The Gradle wrapper (`gradlew`, `gradlew.bat`, `gradle/wrapper/gradle-wrapper.jar`)
  is COMMITTED to the repo (the jar is the official Gradle 8.5 binary). Do not
  remove these; GitHub's web upload loses the exec bit, hence the chmod step.

---

## 4. PROJECT STRUCTURE

```
goal-tracker-android/
├── .github/workflows/build-apk.yml   # CI: builds signed APK, manages keystore
├── .gitignore
├── HANDOVER.md                       # This document
├── settings.gradle                   # Repos + module include
├── build.gradle                      # Root: AGP 8.2.2, Kotlin 1.9.22
├── gradle.properties
├── gradlew / gradlew.bat             # Wrapper scripts (committed)
├── gradle/wrapper/
│   ├── gradle-wrapper.jar            # Official Gradle binary (committed)
│   └── gradle-wrapper.properties     # Gradle 8.5
├── signing/release.keystore          # PERMANENT signing key (created by CI, committed)
└── app/
    ├── build.gradle                  # minSdk 26, target/compile 34, signing config
    └── src/main/
        ├── AndroidManifest.xml       # Permissions, activity, service, receivers
        ├── assets/app/index.html     # Bundled fallback/test app (bridge console)
        ├── res/
        │   ├── values/strings.xml    # App name: "Goal Tracker"
        │   ├── values/themes.xml
        │   ├── drawable/ic_launcher.xml
        │   └── menu/main_menu.xml    # Reload / Import / Backup / Reset
        └── java/com/goaltracker/shell/
            ├── ShellApp.kt           # Application: creates notification channels
            │                         #   CHANNEL_ALERTS + CHANNEL_TIMER + CHANNEL_ALARM (v2)
            ├── MainActivity.kt       # WebView host, import, backup, permissions,
            │                         #   notifyJs() → window.onAndroidEvent,
            │                         #   v2: recovery dialogs, System Check,
            │                         #   Factory Reset, typed confirmations
            ├── JsBridge.kt           # ALL bridge methods (see table above);
            │                         #   v2: every method wrapped in safe()
            ├── TimerService.kt       # Foreground service, notification id 9001,
            │                         #   v2: Pause/Resume/Stop action buttons
            ├── TimerActionReceiver.kt # v2: notification button taps → JS
            │                         #   (live if activity visible, else queued)
            ├── AlarmScheduler.kt     # Exact alarms + SharedPreferences persistence
            ├── AlarmReceiver.kt      # Fires alarm-channel notification + Dismiss
            ├── BootReceiver.kt       # Re-schedules alarms + refreshes bootId (v2)
            ├── ErrorLog.kt           # v2: persistent 50-entry error ring buffer
            ├── Flags.kt              # v2: feature flags + TimeSafety (boot id)
            └── PendingEvents.kt      # v2: queue for events missed while app dead
```

Key identifiers:
- `applicationId` / namespace: **`com.goaltracker.shell`** (NEVER change)
- Keystore alias `goaltracker`, store/key password `goaltracker-shell`
  (acceptable for a personal private repo; the repo must stay private)
- Known naming trap: in `MainActivity`, the data directory property is
  **`appDataDir`** — NOT `dataDir` — because a `dataDir` property collides with
  Android's built-in `Context.getDataDir()` (duplicate JVM signature compile
  error). Do not "clean up" this name. (`JsBridge.dataDir` is fine — JsBridge
  does not extend Context.)

---

## 5. IMPORTANT RULES — DO NOT VIOLATE

1. **NEVER change `applicationId` (`com.goaltracker.shell`)** — changing it makes
   the next APK a different app; data would not carry over.
2. **NEVER delete or regenerate `signing/release.keystore`** — a new key means
   Android refuses to install updates over the old app (fresh install → data loss
   risk). This file is the single most precious file in the repo.
3. **NEVER remove the HTML import system** (Import HTML/ZIP menu) — it is the
   core reason this project exists.
4. **NEVER move or restructure `filesDir/data/`** — the JSON data layer's
   location and file format (`<key>.json`) are a stable contract with the HTML app.
5. **NEVER break backward compatibility of existing bridge methods** — the HTML
   app in the field calls them. Add NEW methods; do not rename/remove/change
   signatures of existing ones.
6. **Keep the shell independent from the HTML** — no business logic in Kotlin,
   no assumptions about what the HTML app does. The bundled `assets/app/index.html`
   is a test console, not the real app.
7. **HTML import must never touch `filesDir/data/`.**
8. **Keep the fixed origin** `https://appassets.androidplatform.net/app/` —
   changing it would orphan the WebView's localStorage/IndexedDB.
9. **Keep the repo PRIVATE** (keystore + passwords are committed).
10. **Do not rebuild the project from scratch** — extend the existing code.

---

## 6. FUTURE ROADMAP (planned, NOT yet implemented)

Each of these = add code to the shell → one APK rebuild via GitHub Actions → the
new bridge methods become available to the HTML app.

DONE in v2 (do not re-implement): notification action buttons, alarm sound
channel, optional completion sound, settings-via-flags, diagnostics, time
safety, error isolation, recovery system, factory reset.

Still open (only with owner approval — check the rejected-features table first):
- **Live-activity-style rich timer notification**: use `setUsesChronometer(true)`
  / `setWhen()` for a self-ticking clock, or a custom `RemoteViews` layout, so
  the countdown ticks even if JS update calls are throttled.
- **Android home-screen widgets**: `AppWidgetProvider` reading from
  `filesDir/data/` JSON (widgets cannot run the WebView; they read the saved data).
- **Lock screen controls**: mostly covered by notification actions +
  `setVisibility(VISIBILITY_PUBLIC)` on the timer notification; consider
  `MediaSession`-style controls only if truly needed.

REJECTED features are listed in section 3 — do not add them without the owner
explicitly accepting the stability trade-offs.

---

## 7. HTML INTEGRATION PLAN (contract for the real HTML app)

The owner's real HTML app (Pomodoro/goals, currently a single index.html with
IndexedDB) should integrate like this:

```js
// 1. Detect the shell
const native = typeof window.AndroidBridge !== 'undefined';

// 2. On startup: ask notification permission once, restore data
if (native) {
  AndroidBridge.requestNotificationPermission();
  const saved = AndroidBridge.loadData('goals');       // "" if none
  if (saved) restoreStateFrom(JSON.parse(saved));
}

// 3. On EVERY meaningful save (IndexedDB stays as cache):
if (native) AndroidBridge.saveData('goals', JSON.stringify(state));

// 4. Timer flow ("Current Activity" / Pomodoro):
//    start → AndroidBridge.startTimer('Mathematics', '25:00 remaining')
//    every second → AndroidBridge.updateTimer('Mathematics', '24:59 remaining')
//    pause → AndroidBridge.updateTimer('Mathematics', 'Paused')
//    finish/stop → AndroidBridge.stopTimer()
//                 + AndroidBridge.showNotification(1, 'Done!', 'Session complete')

// 5. "Bomb mode" (deadline pressure): schedule an alarm that fires even if the
//    app is killed:
//    AndroidBridge.scheduleAlarm(42, Date.now() + 30*60*1000, 'BOOM', 'Time expired!');
//    Defuse: AndroidBridge.cancelAlarm(42)

// 6. Task completion: showToast + showNotification as desired.

// 7. Listen for native events (including notification buttons):
window.onAndroidEvent = function (name, payload) {
  if (name === 'backupRestored') location.reload();
  if (name === 'notificationPermission') console.log('perm:', payload);
  if (name === 'timerAction') {
    if (payload === 'pause') pauseMyTimer();   // then AndroidBridge.pauseTimer(...)
    if (payload === 'resume') resumeMyTimer(); // then AndroidBridge.updateTimer(...)
    if (payload === 'stop') stopMyTimer();     // shell already removed the notification
  }
};

// 8. v2 REQUIRED on startup: drain events that arrived while the app was dead
if (native) {
  JSON.parse(AndroidBridge.getPendingEvents()).forEach(function (ev) {
    window.onAndroidEvent(ev.name, JSON.parse(ev.payload));
  });
}

// 9. v2 time safety for running sessions (detect manual clock changes):
//    On session start, store: const t0 = JSON.parse(AndroidBridge.currentTimeInfo());
//    Elapsed at any moment:
//      const t1 = JSON.parse(AndroidBridge.currentTimeInfo());
//      if (t1.bootId === t0.bootId) elapsedMs = t1.monoMs - t0.monoMs;  // trusted
//      else elapsedMs = Math.max(0, t1.wallMs - t0.wallMs);             // reboot fallback, clamp
//    Manual clock changes CANNOT affect monoMs. If wall-clock delta and
//    mono delta disagree wildly (same boot), the user changed the clock —
//    keep the monotonic value for history consistency.
```

Rules for the HTML side: always guard with the `native` check so the same file
still works in a normal browser; use unique integer ids for notifications/alarms;
`updateTimer` uses `setOnlyAlertOnce` so per-second updates do not buzz.

---

## 8. DEVELOPMENT WORKFLOW — WHICH TOOL WHEN

| Change | What is needed |
|---|---|
| Any HTML/CSS/JS change (UI, logic, timers, new features in the app) | **HTML import only.** Menu → Import HTML/ZIP. No GitHub, no rebuild. |
| New native capability (new bridge method, notification buttons, sound, bubble, widget) | Edit Kotlin → push to GitHub → Actions builds APK → install over old app. Data + imported HTML survive. |
| Changing app name/icon | Edit res/ → rebuild APK |
| Bump `versionCode`/`versionName` | Recommended (not strictly required) on each APK rebuild: edit `app/build.gradle` |

GitHub is ONLY needed for shell (Kotlin) changes. In this architecture the APK
is rebuilt rarely — most weeks, only HTML imports happen.

---

## 9. BEGINNER INSTRUCTIONS (assume zero knowledge)

**The owner**: builds HTML apps, beginner in Android/Kotlin, works primarily from
an Android phone, no regular PC access, builds APKs with GitHub Actions in a
private repo. Explain things simply; give exact click-by-click steps for anything
involving GitHub or Android settings.

**To change the HTML app**: edit your HTML file anywhere (even on the phone),
then in Goal Tracker: 3-dot menu → Import HTML/ZIP → pick the file. Done.
Your data is kept automatically.

**To change the shell (native features)**:
1. Edit the Kotlin file(s) in the GitHub repo (GitHub web editor works fine)
2. Commit → the "Build APK" action runs automatically
3. Actions tab → wait for the green check → click the run → Artifacts →
   download `goal-tracker-apk` → unzip → install `app-release.apk`
4. Android installs it as an UPDATE (same key + id) — nothing is lost

**If the build fails**: open the failed run → click the red step → read the last
~30 lines of the log — that is the actual error. Common past issues: missing
gradle wrapper files (now committed), Kotlin name clash with Context methods
(see `appDataDir` note in section 4).

**Before big experiments**: menu → Export backup (saves all data to a JSON file).

**Testing the bridge**: menu → Reset to bundled app → the built-in test console
has a button for every bridge method and an on-screen log.

---

## 10. FINAL INSTRUCTION

**Any AI reading this document should continue development from the current
state and avoid rebuilding the project from scratch.** The shell works, the CI
pipeline works, the signing key exists, and the bridge API is a stable contract
with the owner's HTML app. Extend — never restart.
