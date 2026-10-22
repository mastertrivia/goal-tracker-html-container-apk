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

  const bridge = {
    __calls: calls,
    __flags: flags,
    __storage: storage,

    getShellVersion: () => '4.10',
    getFlag: (k, d) => (Object.prototype.hasOwnProperty.call(flags, k) ? flags[k] : d),
    setFlag: (k, v) => { flags[k] = v; rec('setFlag', [k, v]); return true; },
    getAllFlags: () => JSON.stringify(flags),

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
    getDiagnostics: () => JSON.stringify({ shellVersion: '4.10', notificationsAllowed: true, exactAlarmsAllowed: true }),

    exportBackup: () => rec('exportBackup', []),
    importBackup: () => rec('importBackup', []),
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
