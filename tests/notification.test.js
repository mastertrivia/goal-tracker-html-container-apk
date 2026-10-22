'use strict';
/**
 * Notification & Android-bridge lifecycle suite (Phase 3/6 evidence).
 * Runs the REAL index.html with a recording AndroidBridge mock, so the app's
 * observer layer (andInit, andSyncNotification, andSyncAlarms, permission
 * flow, pending-event drain) executes for real and every bridge call is
 * recorded. Native execution itself (AlarmManager, NotificationManager) is
 * NOT covered here — see the test report limitations.
 */
const { bootApp, seedState, seedTasks, wipeDb, flushReal } = require('./harness');
const { findBy, countBy, lastBy } = require('./bridge-mock');

const results = [];
let currentSuite = '';
function suite(name) { currentSuite = name; console.log('\n=== ' + name + ' ==='); }
function check(name, cond, expected, actual) {
  const pass = !!cond;
  results.push({ suite: currentSuite, name, pass, expected: String(expected), actual: String(actual) });
  console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + ' | expected=' + expected + ' actual=' + actual);
}
function approx(a, b, tol) { return Math.abs(a - b) <= tol; }

const T0 = new Date(2026, 9, 20, 9, 0, 0).getTime();
const YDAY = '2026-10-19';
const TODAY = '2026-10-20';

function baseSettings(extra) {
  return {
    wakeHour: 9,
    telegramEnabled: false,
    realityCheckEnabled: false,
    thoughtsEnabled: false,
    bombDuration: 10 * 60,   // 10-minute bomb: alarm windows stay > 3s during short tests
    dailyFreeLifelines: 0,
    ...extra,
  };
}

async function seedAll(settingsPatch, statePatch) {
  await wipeDb();
  await seedState({
    settings: baseSettings(settingsPatch),
    lastActiveDate: YDAY,
    dailyStudyKey: YDAY,
    hearts: 0,
    ...(statePatch || {}),
  });
  await seedTasks([{ category: 'study', name: 'Maths', duration: 30 * 60, icon: 'x', color: '#5B4FE8' }]);
}

function lastTimerState(app) {
  const row = lastBy(app.bridge.__calls, 'setTimerState');
  if (!row) return null;
  try { return JSON.parse(row[1]); } catch (e) { return null; }
}

/* ------------------------------------------------------------------ */
async function n1_permissionAskedOnce() {
  suite('N1 notification permission: asked once, then never again');
  await seedAll();
  const flags = { gt_permAsked: false };
  const opts = { flags, storage: {} };
  let app = await bootApp({ now: T0, bridge: opts });
  await app.advance(2000);
  check('N1.1 permission requested on first boot', countBy(app.bridge.__calls, 'requestNotificationPermission') === 1, 1,
    countBy(app.bridge.__calls, 'requestNotificationPermission'));
  check('N1.2 asked-marker persisted', flags.gt_permAsked === true, true, flags.gt_permAsked);
  app.close();
  // Second page load with the marker set: no re-ask
  app = await bootApp({ now: app.now ? T0 : T0, bridge: opts });
  await app.advance(1500);
  check('N1.3 no re-ask on subsequent loads', countBy(app.bridge.__calls, 'requestNotificationPermission') === 0, 0,
    countBy(app.bridge.__calls, 'requestNotificationPermission'));
  app.close();
}

/* ------------------------------------------------------------------ */
async function n2_initAndSessionAlarm() {
  suite('N2 boot init + session-end alarm scheduling');
  await seedAll();
  const opts = { flags: { gt_permAsked: true }, storage: {} };
  const app = await bootApp({ now: T0, bridge: opts });
  await app.advance(1500);
  check('N2.1 leftover bomb-explosion notification cleared at boot', countBy(app.bridge.__calls, 'cancelNotification', c => c[1] === 4) >= 1, '>=1',
    countBy(app.bridge.__calls, 'cancelNotification', c => c[1] === 4));

  await app.click('#btnStart');
  await app.advance(2500);
  const st = await app.readState();
  const ts = lastTimerState(app);
  check('N2.2 live timer notification pushed (running)', !!(ts && ts.running === true && ts.paused === false), 'running', ts && JSON.stringify({ r: ts.running, p: ts.paused, t: ts.title }));
  check('N2.3 notification carries ticking session clocks', !!(ts && Array.isArray(ts.clocks) && ts.clocks.length >= 1), '>=1 clock', ts && ts.clocks.length);

  const alarms = findBy(app.bridge.__calls, 'scheduleAlarmWithSound', c => c[1] === 9101);
  check('N2.4 session-end alarm scheduled', alarms.length >= 1, '>=1', alarms.length);
  const last = alarms[alarms.length - 1];
  const expectedTrigger = st.activeTimer.wallStartTs + st.activeTimer.duration * 1000;
  check('N2.5 alarm deadline = real session end (±3s)', approx(last[2], expectedTrigger, 3000), `${expectedTrigger}±3000`, last[2]);
  check('N2.6 alarm uses session slot + configured duration', last[5] === 'sessionend' && last[6] === 60000, 'sessionend/60000', `${last[5]}/${last[6]}`);
  app.close();
}

/* ------------------------------------------------------------------ */
async function n3_stopCancelsSessionAndArmsBomb() {
  suite('N3 stop: session alarm cancelled, bomb alarm armed, no idle cancel churn (GT-05)');
  await seedAll();
  const opts = { flags: { gt_permAsked: true }, storage: {} };
  const app = await bootApp({ now: T0, bridge: opts });
  await app.click('#btnStart');
  await app.advance(2500);
  await app.click('#btnStop'); // bomb ON: stop session, arm bomb
  await app.advance(2500);

  const cancels9101 = countBy(app.bridge.__calls, 'cancelAlarm', c => c[1] === 9101);
  check('N3.1 session alarm cancelled after stop', cancels9101 >= 1, '>=1', cancels9101);
  const bombAlarms = findBy(app.bridge.__calls, 'scheduleAlarmWithSound', c => c[1] === 9102);
  check('N3.2 bomb-explosion alarm armed while bomb ticks', bombAlarms.length >= 1, '>=1', bombAlarms.length);
  const bombTrigger = bombAlarms[bombAlarms.length - 1][2];
  const st = await app.readState();
  const expectedBombEnd = st.activeTimer.wallStartTs + st.activeTimer.duration * 1000;
  check('N3.3 bomb alarm deadline = real bomb end (±3s)', approx(bombTrigger, expectedBombEnd, 3000), `${expectedBombEnd}±3000`, bombTrigger);

  // GT-05: idling must not re-send cancelAlarm for the already-cancelled session id
  const before = countBy(app.bridge.__calls, 'cancelAlarm', c => c[1] === 9101);
  await app.advance(6000);
  const after = countBy(app.bridge.__calls, 'cancelAlarm', c => c[1] === 9101);
  check('N3.4 idle ticks send no repeat session-alarm cancels (6s window)', after === before, `${before} (frozen)`, `${before} → ${after}`);
  const ts = lastTimerState(app);
  check('N3.5 notification switched to bomb state', !!(ts && ts.running === true && /Bomb/i.test(ts.title || '')), 'bomb notification', ts && ts.title);
  app.close();
}

/* ------------------------------------------------------------------ */
async function n4_reloadReschedulesAlarm() {
  suite('N4 WebView reload while session runs: alarm re-armed for the true deadline');
  await seedAll();
  const opts = { flags: { gt_permAsked: true }, storage: {} };
  let app = await bootApp({ now: T0, bridge: opts });
  await app.click('#btnStart');
  await app.advance(45_000);
  const st1 = await app.readState();
  const expected = st1.activeTimer.wallStartTs + st1.activeTimer.duration * 1000;
  const now2 = app.now();
  app.close();
  app = await bootApp({ now: now2, bridge: opts }); // same flags/storage = device-like reload
  await app.advance(2500);
  const alarms = findBy(app.bridge.__calls, 'scheduleAlarmWithSound', c => c[1] === 9101);
  check('N4.1 session alarm re-scheduled after reload', alarms.length >= 1, '>=1', alarms.length);
  check('N4.2 re-scheduled deadline matches the ORIGINAL session end (±4s)',
    alarms.length >= 1 && approx(alarms[alarms.length - 1][2], expected, 4000), `${expected}±4000`,
    alarms.length && alarms[alarms.length - 1][2]);
  const ts = lastTimerState(app);
  check('N4.3 timer notification restored after reload', !!(ts && ts.running === true), 'running', ts && ts.running);
  app.close();
}

/* ------------------------------------------------------------------ */
async function n5_pauseResumeNotification() {
  suite('N5 pause/resume notification states (Bomb OFF where Pause exists)');
  await seedAll({ bombChallengeMode: false });
  const opts = { flags: { gt_permAsked: true }, storage: {} };
  const app = await bootApp({ now: T0, bridge: opts });
  await app.click('#btnStart');
  await app.advance(2500);
  await app.click('#btnPause');
  await app.advance(2500);
  let ts = lastTimerState(app);
  check('N5.1 pause pushes paused notification state', !!(ts && ts.running === true && ts.paused === true), 'paused', ts && JSON.stringify({ r: ts.running, p: ts.paused }));
  check('N5.2 pause cancels the session alarm', countBy(app.bridge.__calls, 'cancelAlarm', c => c[1] === 9101) >= 1, '>=1',
    countBy(app.bridge.__calls, 'cancelAlarm', c => c[1] === 9101));
  await app.click('#btnPause'); // resume
  await app.advance(2500);
  ts = lastTimerState(app);
  check('N5.3 resume pushes running state again', !!(ts && ts.running === true && ts.paused === false), 'running', ts && JSON.stringify({ r: ts.running, p: ts.paused }));
  check('N5.4 session alarm re-armed after resume', countBy(app.bridge.__calls, 'scheduleAlarmWithSound', c => c[1] === 9101) >= 2, '>=2',
    countBy(app.bridge.__calls, 'scheduleAlarmWithSound', c => c[1] === 9101));
  app.close();
}

/* ------------------------------------------------------------------ */
async function n6_stopSendsRunningFalse() {
  suite('N6 full stop clears the native timer notification');
  await seedAll({ bombChallengeMode: false });
  const opts = { flags: { gt_permAsked: true }, storage: {} };
  const app = await bootApp({ now: T0, bridge: opts });
  await app.click('#btnStart');
  await app.advance(2500);
  await app.click('#btnStop');
  await app.advance(2500);
  const ts = lastTimerState(app);
  check('N6.1 native timer state set to running:false', !!(ts && ts.running === false), 'running:false', ts && JSON.stringify({ r: ts.running, t: ts.title }));
  app.close();
}

/* ------------------------------------------------------------------ */
async function n7_permissionDeniedEventToasts() {
  suite('N7 permission-denied event surfaces the settings hint');
  await seedAll();
  const opts = { flags: { gt_permAsked: true }, storage: {} };
  const app = await bootApp({ now: T0, bridge: opts });
  await app.advance(1000);
  app.win.onAndroidEvent('notificationPermission', 'denied'); // native evaluateJavascript passes the plain string
  await flushReal(4);
  const toastText = app.win.document.body.textContent || '';
  check('N7.1 toast explains notifications are blocked', toastText.includes('Notifications are blocked'), 'present', toastText.includes('Notifications are blocked'));
  app.close();
}

/* ------------------------------------------------------------------ */
async function main() {
  await n1_permissionAskedOnce();
  await n2_initAndSessionAlarm();
  await n3_stopCancelsSessionAndArmsBomb();
  await n4_reloadReschedulesAlarm();
  await n5_pauseResumeNotification();
  await n6_stopSendsRunningFalse();
  await n7_permissionDeniedEventToasts();

  const pass = results.filter(r => r.pass).length;
  console.log(`\n==== NOTIFICATION SUMMARY: ${pass}/${results.length} passed, ${results.length - pass} failed ====`);
  for (const r of results.filter(x => !x.pass)) console.log('FAILED: [' + r.suite + '] ' + r.name + ' expected=' + r.expected + ' actual=' + r.actual);
  process.exit(results.some(r => !r.pass) ? 1 : 0);
}

main().catch((e) => { console.error('SUITE CRASH', e); process.exit(2); });
