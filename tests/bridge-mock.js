'use strict';
/**
 * Recording mock of window.AndroidBridge — lets the app's real Android
 * integration layer (andInit observer, notification state machine, alarm sync,
 * pending-event drain, backup mirror) run under test, with every bridge call
 * recorded instead of executed.
 *
 * storage/flags objects are shared across page reloads by the caller so a
 * "WebView reload" test behaves like the real device.
 */
function makeBridge(win, opts = {}) {
  const calls = [];
  const storage = opts.storage || {};
  const flags = opts.flags || {};
  const rec = (name, args) => calls.push([name, ...args]);
  const now = () => Date.now();

  // Display scale (v4.11): string-persisted like the native Flags store.
  // Shared across page reloads by the caller (opts.displayScale) so a
  // "WebView reload" test behaves like the real device. Mirrors native:
  // levels "1".."10", default "2", legacy 4-size values migrated at read.
  const DISPLAY_SCALE_LEVELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
  const DISPLAY_SCALE_DEFAULT = '2';
  const DISPLAY_SCALE_LEGACY = { xsmall: '4', small: '6', medium: '7', large: '8' };
  const displayScale = opts.displayScale || { value: opts.initialDisplayScale || DISPLAY_SCALE_DEFAULT };
  const normalizeLevel = (v) => {
    let s = String(v == null ? '' : v).trim().toLowerCase();
    if (DISPLAY_SCALE_LEGACY[s]) s = DISPLAY_SCALE_LEGACY[s];
    return DISPLAY_SCALE_LEVELS.includes(s) ? s : null;
  };

  const bridge = {
    __calls: calls,
    __flags: flags,
    __storage: storage,

    getShellVersion: () => '4.11',
    getFlag: (k, d) => (Object.prototype.hasOwnProperty.call(flags, k) ? flags[k] : d),
    setFlag: (k, v) => { flags[k] = v; rec('setFlag', [k, v]); return true; },
    getAllFlags: () => JSON.stringify(flags),

    // Mirrors native JsBridge: level whitelist in, "2" out, unknown rejected.
    getDisplayScale: () => normalizeLevel(displayScale.value) || DISPLAY_SCALE_DEFAULT,
    setDisplayScale: (v) => {
      const s = normalizeLevel(v);
      if (s) { displayScale.value = s; rec('setDisplayScale', [s]); }
      else rec('setDisplayScale.rejected', [String(v)]);
    },

    requestNotificationPermission: () => rec('requestNotificationPermission', []),

    showNotification: (id, title, text) => rec('showNotification', [id, title, text]),
    showPersistentNotification: (id, title, text) => rec('showPersistentNotification', [id, title, text]),
    showReviewNotification: (id, title, text) => rec('showReviewNotification', [id, title, text]),
    cancelNotification: (id) => rec('cancelNotification', [id]),

    scheduleAlarm: (id, triggerAtMillis, title, text) => rec('scheduleAlarm', [id, triggerAtMillis, title, text]),
    scheduleAlarmWithSound: (id, triggerAtMillis, title, text, soundSlot, durationMs) =>
      rec('scheduleAlarmWithSound', [id, triggerAtMillis, title, text, soundSlot, durationMs]),
    cancelAlarm: (id) => rec('cancelAlarm', [id]),
    cancelAllAlarms: () => rec('cancelAllAlarms', []),

    startTimer: (title, text) => rec('startTimer', [title, text]),
    updateTimer: (title, text) => rec('updateTimer', [title, text]),
    pauseTimer: (title, text) => rec('pauseTimer', [title, text]),
    stopTimer: () => rec('stopTimer', []),
    setTimerState: (json) => rec('setTimerState', [json]),

    // Time safety: pair wall+mono so monotonicNow() anchors exactly like on-device.
    currentTimeInfo: () => JSON.stringify({ wallMs: now(), monoMs: win.performance.now(), bootId: 'test-boot' }),
    elapsedRealtime: () => win.performance.now(),

    getPendingEvents: () => '[]',
    saveData: (key, json) => { storage[key] = json; rec('saveData', [key]); return true; },
    loadData: (key) => (Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : ''),
    deleteData: (key) => { delete storage[key]; return true; },
    listDataKeys: () => JSON.stringify(Object.keys(storage)),

    playCompletionSound: () => true,
    stopCompletionSound: () => true,
    playNamedSound: () => true,
    playNamedSoundForDuration: () => true,
    stopAlarmPlayback: () => true,
    stopSound: () => true,

    showToast: (m) => rec('showToast', [m]),
    showToastLong: (m) => rec('showToastLong', [m]),

    getErrorLog: () => '[]',
    clearErrorLog: () => true,
    getDiagnostics: () => JSON.stringify({ shellVersion: '4.11', notificationsAllowed: true, exactAlarmsAllowed: true, displayScale: (normalizeLevel(displayScale.value) || DISPLAY_SCALE_DEFAULT), useWideViewPort: true, loadWithOverviewMode: true, textZoom: 100, fontScale: 1 }),

    exportBackup: () => rec('exportBackup', []),
    importBackup: () => rec('importBackup', []),
    // v4.11 App & Data menu (moved out of the removed top-bar menu)
    refreshApp: () => rec('refreshApp', []),
    importHtmlFile: () => rec('importHtmlFile', []),
    exportCurrentHtml: () => rec('exportCurrentHtml', []),
    factoryResetUserData: () => rec('factoryResetUserData', []),
    systemCheck: () => rec('systemCheck', []),
  };
  return bridge;
}

function findBy(calls, name, predicate) {
  return calls.filter((c) => c[0] === name && (!predicate || predicate(c)));
}
function countBy(calls, name, predicate) {
  return findBy(calls, name, predicate).length;
}
function lastBy(calls, name) {
  const rows = calls.filter((c) => c[0] === name);
  return rows.length ? rows[rows.length - 1] : null;
}

module.exports = { makeBridge, findBy, countBy, lastBy };
