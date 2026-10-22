'use strict';
/**
 * Timer-engine regression suite (Phase 2/6 evidence).
 * Runs the REAL index.html in the jsdom harness with a controlled clock.
 * Each check prints PASS/FAIL with expected vs actual.
 */
const { bootApp, seedState, seedTasks, wipeDb, flushReal } = require('./harness');

const results = [];
let currentSuite = '';
function suite(name) { currentSuite = name; console.log('\n=== ' + name + ' ==='); }
function check(name, cond, expected, actual) {
  const pass = !!cond;
  results.push({ suite: currentSuite, name, pass, expected: String(expected), actual: String(actual) });
  console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + ' | expected=' + expected + ' actual=' + actual);
}
function approx(a, b, tol) { return Math.abs(a - b) <= tol; }

const T0 = new Date(2026, 9, 20, 9, 0, 0).getTime(); // Tue Oct 20 2026, 09:00 local
const YDAY = '2026-10-19';
const TODAY = '2026-10-20';

function baseSettings(extra) {
  return {
    wakeHour: 9,                       // sleep window = 00:00-09:00; boot at 09:00 is awake
    telegramEnabled: false,            // no network side effects
    realityCheckEnabled: false,        // isolate timer engine from RC flow
    thoughtsEnabled: false,
    bombDuration: 5 * 60,              // 5-minute bomb for fast expiry tests (seconds)
    dailyFreeLifelines: 0,             // hearts=0 after rollover -> explosions are real
    ...extra,
  };
}

async function standardBoot(opts = {}) {
  await wipeDb(); // isolate: fake-IndexedDB is process-global
  await seedState({
    settings: baseSettings(opts.settings),
    lastActiveDate: YDAY,
    dailyStudyKey: YDAY,
    hearts: 0,
    ...(opts.state || {}),
  });
  await seedTasks([{ category: 'study', name: 'Maths', duration: 30 * 60, icon: '\u{1F4D6}', color: '#5B4FE8' }]);
  return bootApp({ now: T0 });
}

/* ------------------------------------------------------------------ */
async function t1_bootRollover() {
  suite('T1 boot / day rollover arms the bomb (Mode 1, wake 09:00)');
  const app = await standardBoot();
  let st = await app.readState();
  check('T1.1 dailyStudyKey rolled to today', st.dailyStudyKey === TODAY, TODAY, st.dailyStudyKey);
  check('T1.2 bomb is the active timer after rollover', st.activeTimer && st.activeTimer.type === 'bomb', 'bomb', st.activeTimer && st.activeTimer.type);
  check('T1.3 fresh full clock banked', approx(st.bombRemainingMs, 300000, 1500), '300000±1500', st.bombRemainingMs);
  check('T1.4 bomb card shows 05:00', app.text('#breakTime') === '05:00', '05:00', app.text('#breakTime'));
  await app.advance(10_000);
  st = await app.readState();
  const rem = st.activeTimer ? (st.activeTimer.wallStartTs + 300000 - app.now()) : -1;
  check('T1.5 bomb counts down in real time after 10s', approx(rem, 290_000, 2000), '290000±2000', rem);
  check('T1.6 no page errors', app.pageErrors.filter(e => !e.includes('planners')).length === 0, 'none', app.pageErrors.slice(0, 2).join(';').slice(0, 200));
  app.close();
}

/* ------------------------------------------------------------------ */
async function t2_startStopStudy() {
  suite('T2 start / live tick / stop a Study session (Bomb ON)');
  const app = await standardBoot();
  await app.click('#btnStart'); // bomb ON: stops idle bomb, starts selected Study task
  let st = await app.readState();
  check('T2.1 active timer is study', st.activeTimer && st.activeTimer.type === 'study', 'study', st.activeTimer && st.activeTimer.type);
  check('T2.2 full task duration assigned', st.activeTimer && st.activeTimer.duration === 1800, 1800, st.activeTimer && st.activeTimer.duration);
  check('T2.3 bomb clock banked (not reset)', approx(st.bombRemainingMs, 300000, 1500), '300000±1500', st.bombRemainingMs);
  check('T2.4 bomb card shows frozen value', app.text('#breakTime') === '05:00', '05:00', app.text('#breakTime'));
  check('T2.5 START button became DONE', (app.text('#btnStart') || '').includes('DONE'), 'DONE', app.text('#btnStart'));

  await app.advance(65_000);
  const pomo = app.text('#pomoTime');
  check('T2.6 countdown ~28:55 after 65s', /^28:5[3-7]$/.test(pomo || ''), '28:5x', pomo);
  st = await app.readState();
  check('T2.7 no persisted elapsed mid-run (active timer only)', st.dailyStudySeconds === 0, 0, st.dailyStudySeconds);

  await app.click('#btnStop'); // bomb ON: switch to Bomb = stopSession + startSession('bomb')
  st = await app.readState();
  const tl = await app.readTimeline();
  const studyEntries = tl.filter(e => e.category === 'study');
  check('T2.8 exactly one study timeline entry', studyEntries.length === 1, 1, studyEntries.length);
  check('T2.9 study duration ~65s', approx(studyEntries[0].duration, 65, 3), '65±3', studyEntries[0].duration);
  check('T2.10 hour streak banked ~65s', approx(st.hourStreakSec, 65, 3), '65±3', st.hourStreakSec);
  check('T2.11 active timer back to bomb', st.activeTimer && st.activeTimer.type === 'bomb', 'bomb', st.activeTimer && st.activeTimer.type);
  check('T2.12 toast shown', (app.win.document.body.textContent || '').includes('Session stopped'), 'present', 'missing');
  app.close();
}

/* ------------------------------------------------------------------ */
async function t3_rapidDoubleTap() {
  suite('T3 rapid repeated button presses');
  const app = await standardBoot();
  // Double-tap START within the same instant (no clock advance between taps)
  await app.click('#btnStart');
  await app.click('#btnStart'); // second tap while first handler may still be settling
  let st = await app.readState();
  const tl1 = await app.readTimeline();
  check('T3.1 single study timer after double START', st.activeTimer && st.activeTimer.type === 'study', 'study', st.activeTimer && st.activeTimer.type);
  await app.advance(30_000);
  // Double-tap STOP
  await app.click('#btnStop');
  await app.click('#btnStop');
  st = await app.readState();
  const tl = await app.readTimeline();
  const studyEntries = tl.filter(e => e.category === 'study');
  check('T3.2 exactly one study entry after double STOP', studyEntries.length === 1, 1, studyEntries.length);
  check('T3.3 no study-time double bank (streak ~30s)', approx(st.hourStreakSec, 30, 4), '30±4', st.hourStreakSec);
  check('T3.4 active timer is bomb (not double-started study/stopped-null)', st.activeTimer && st.activeTimer.type === 'bomb', 'bomb', st.activeTimer && st.activeTimer.type);
  check('T3.5 dailyStudySeconds ~30s (single count)', approx(st.dailyStudySeconds || 0, 30, 4), '30±4', st.dailyStudySeconds);
  app.close();
}

/* ------------------------------------------------------------------ */
async function t4_bombLifelineAndExplosion() {
  suite('T4 bomb expiry: lifeline save, then real explosion + password restart');
  const app = await standardBoot({ settings: { dailyFreeLifelines: 1 } }); // 1 heart
  let st = await app.readState();
  check('T4.0 one free lifeline at day start', st.hearts === 1, 1, st.hearts);
  // Run the idle bomb to 00:00
  await app.advance(5 * 60 * 1000 + 15_000);
  st = await app.readState();
  check('T4.1 lifeline consumed instead of exploding', st.hearts === 0 && !st.bombLocked, 'hearts=0, unlocked', `hearts=${st.hearts} locked=${st.bombLocked}`);
  check('T4.2 clock extended by lifeline extra (10 min)', approx(st.bombRemainingMs, 600000, 1500), '600000±1500', st.bombRemainingMs);
  check('T4.3 re-armed bomb active', st.activeTimer && st.activeTimer.type === 'bomb', 'bomb', st.activeTimer && st.activeTimer.type);
  // Now run the extension to 0 with no hearts -> explosion
  await app.advance(10 * 60 * 1000 + 15_000);
  st = await app.readState();
  check('T4.4 explosion locks the app', st.bombLocked === true, true, st.bombLocked);
  check('T4.5 explosion counter incremented once', st.bombExplodedToday === 1, 1, st.bombExplodedToday);
  check('T4.6 active timer cleared on explosion', st.activeTimer === null, null, JSON.stringify(st.activeTimer));
  check('T4.7 bomb card shows 00:00', app.text('#breakTime') === '00:00', '00:00', app.text('#breakTime'));
  // Advance more: nothing may re-explode while locked
  await app.advance(60_000);
  st = await app.readState();
  check('T4.8 no duplicate explosion while locked', st.bombExplodedToday === 1 && st.bombLocked === true, '1 / locked', `${st.bombExplodedToday} / ${st.bombLocked}`);
  const tlLocked = await app.readTimeline();
  const bombRuns = tlLocked.filter(e => e.category === 'bomb');
  check('T4.9 bomb timeline rows sane (2 runs: original + extension)', bombRuns.length === 2, 2, bombRuns.length);
  app.close();
}

/* ------------------------------------------------------------------ */
async function t5_streakBarAfterExplosion() {
  suite('T5 hour-streak + progress-bar consistency around explosion (reported symptom)');
  const app = await standardBoot({
    state: {
      hourStreakSec: 12600,               // 3.5h banked streak
      hourStreakSecAtDayStart: 12600,
      dailyStudySeconds: 12600,
      streakPomodoros: 7,
      bestStreakHours: 3.5,
    },
  });
  let st = await app.readState();
  check('T5.1 seeded streak visible (3)', app.text('#streakNum') === '3', '3', app.text('#streakNum'));
  const fill1 = parseFloat(app.style('#streakBarFill', 'width'));
  check('T5.2 bar shows 3.5h -> 50%', approx(fill1, 50, 1), '50%', fill1 + '%');
  // Explode the idle bomb (0 hearts from standard setup)
  await app.advance(5 * 60 * 1000 + 15_000);
  st = await app.readState();
  check('T5.3 locked after explosion', st.bombLocked === true, true, st.bombLocked);
  check('T5.4 streak number still shows PRE-reset streak (3)', app.text('#streakNum') === '3', '3', app.text('#streakNum'));
  const fillLocked = parseFloat(app.style('#streakBarFill', 'width'));
  check('T5.5 bar still shows pre-reset 50% while locked', approx(fillLocked, 50, 1), '50%', fillLocked + '%');
  // Complete the password-verified restart flow
  const inp = app.win.document.getElementById('breachConfirmInput');
  inp.value = '123';
  await app.click('#breachOkBtn');
  await flushReal(6);
  st = await app.readState();
  check('T5.6 restart applied: streak zeroed', st.hourStreakSec === 0, 0, st.hourStreakSec);
  check('T5.7 streak number now 0', app.text('#streakNum') === '0', '0', app.text('#streakNum'));
  const fillReset = parseFloat(app.style('#streakBarFill', 'width'));
  check('T5.8 progress bar reset to 0%', approx(fillReset, 0, 0.5), '0%', fillReset + '%');
  check('T5.9 fresh bomb armed (05:00 immediately, no tick)', app.text('#breakTime') === '05:00', '05:00', app.text('#breakTime'));
  check('T5.10 lock cleared', st.bombLocked === false, false, st.bombLocked);
  // No stale callbacks may re-explode the fresh bomb
  await app.advance(30_000);
  st = await app.readState();
  check('T5.11 no re-explosion from stale state', st.bombExplodedToday === 1 && !st.bombLocked, '1 / unlocked', `${st.bombExplodedToday} / ${st.bombLocked}`);
  app.close();
}

/* ------------------------------------------------------------------ */
async function t6_reloadWhileRunning() {
  suite('T6 WebView reload while a study session runs');
  let app = await standardBoot();
  await app.click('#btnStart');
  await app.advance(90_000);
  let st = await app.readState();
  const remBefore = st.activeTimer.duration * 1000 - (app.now() - st.activeTimer.wallStartTs);
  // Simulate WebView reload: fresh page over the same IndexedDB
  const now2 = app.now();
  app.close();
  app = await bootApp({ now: now2 });
  st = await app.readState();
  check('T6.1 study timer restored after reload', st.activeTimer && st.activeTimer.type === 'study', 'study', st.activeTimer && st.activeTimer.type);
  const remAfter = st.activeTimer.duration * 1000 - (app.now() - st.activeTimer.wallStartTs);
  check('T6.2 remaining time consistent across reload (±3s)', approx(remAfter, remBefore, 3000), `${remBefore}±3000`, remAfter);
  check('T6.3 countdown display resumed', /^28:2\d$/.test(app.text('#pomoTime') || '') || /^28:3\d$/.test(app.text('#pomoTime') || ''), '28:2x-3x', app.text('#pomoTime'));
  await app.advance(30_000);
  st = await app.readState();
  const tl = await app.readTimeline();
  check('T6.4 no duplicate sessions created by reload', tl.filter(e => e.category === 'study').length === 0, 0, tl.filter(e => e.category === 'study').length);
  check('T6.5 still running after resume ticks', st.activeTimer && st.activeTimer.type === 'study', 'study', st.activeTimer && st.activeTimer.type);
  app.close();
}

/* ------------------------------------------------------------------ */
async function t7_processDeathRecovery() {
  suite('T7 process death: session completes + bomb deadlines replay while dead');
  let app = await standardBoot(); // 30-min study task, 5-min bomb
  await app.click('#btnStart');
  await app.advance(5_000);
  // Kill the app; reopen 40 minutes later (session 30m ends at +30m; bomb 5m ends +35m;
  // with 0 hearts that explodes at +35m; idle runs after)
  const killNow = app.now();
  app.close();
  app = await bootApp({ now: killNow + 40 * 60 * 1000 });
  const st = await app.readState();
  const tl = await app.readTimeline();
  const studyEntries = tl.filter(e => e.category === 'study');
  check('T7.1 completed session committed exactly once', studyEntries.length === 1, 1, studyEntries.length);
  check('T7.2 session duration = full 30 min', studyEntries[0] && studyEntries[0].duration === 1800, 1800, studyEntries[0] && studyEntries[0].duration);
  check('T7.3 session end stamped at real deadline', studyEntries[0] && approx(studyEntries[0].endTs, killNow + 30 * 60 * 1000, 8000), `${killNow + 30 * 60 * 1000}±8000`, studyEntries[0] && studyEntries[0].endTs);
  check('T7.4 hour streak reconciled to 30 min', approx(st.hourStreakSec, 1800, 3), '1800±3', st.hourStreakSec);
  check('T7.5 daily study seconds reconciled', approx(st.dailyStudySeconds, 1800, 3), '1800±3', st.dailyStudySeconds);
  check('T7.6 idle bomb exploded while dead (0 hearts) -> locked', st.bombLocked === true, true, st.bombLocked);
  check('T7.7 no active timer while locked', st.activeTimer === null, null, JSON.stringify(st.activeTimer));
  const bombEntries = tl.filter(e => e.category === 'bomb');
  check('T7.8 bomb run recorded for the missed window', bombEntries.length === 1, 1, bombEntries.length);
  check('T7.9 bomb entry end at real bomb deadline', bombEntries[0] && approx(bombEntries[0].endTs, killNow + 35 * 60 * 1000, 8000), `${killNow + 35 * 60 * 1000}±8000`, bombEntries[0] && bombEntries[0].endTs);
  app.close();
}

/* ------------------------------------------------------------------ */
async function t8_sleepFreezeAndWake() {
  suite('T8 overnight: sleep freeze at boundary, wake rollover');
  // Boot the evening before at 23:50 with wakeReplayDate=today to skip Mode-1 deduction.
  const T_EV = new Date(2026, 9, 19, 23, 50, 0).getTime(); // Oct 19, 23:50
  await wipeDb();
  await seedState({
    settings: baseSettings(),
    lastActiveDate: '2026-10-19',
    dailyStudyKey: '2026-10-19',
    wakeReplayDate: '2026-10-19', // block wake deduction for this study day
    hearts: 0,
  });
  await seedTasks([{ category: 'study', name: 'Maths', duration: 4 * 3600, icon: '\u{1F4D6}', color: '#5B4FE8' }]);
  let app = await bootApp({ now: T_EV });
  // NOTE: at 23:50 study day key is '2026-10-19' (wake 09:00 boundary), so no rollover yet.
  await app.click('#btnStart');
  await app.advance(60_000); // study runs 23:50 -> 23:51
  let st = await app.readState();
  check('T8.1 session running before midnight', st.activeTimer && st.activeTimer.type === 'study' && !st.activeTimer.pausedAt, 'running study', JSON.stringify(st.activeTimer && { t: st.activeTimer.type, p: st.activeTimer.pausedAt }));
  // Cross midnight into sleep window (00:00-09:00) - 10 minutes past boundary
  await app.advance(20 * 60 * 1000); // now ~00:11
  st = await app.readState();
  check('T8.2 session hard-frozen during sleep', !!(st.activeTimer && st.activeTimer.pausedAt), true, !!(st.activeTimer && st.activeTimer.pausedAt));
  check('T8.3 daily rollover deferred during sleep', st.dailyStudyKey === '2026-10-19', '2026-10-19', st.dailyStudyKey);
  // Freeze must latch at the sleep boundary (00:00), not at poll time: elapsed ~10 min only
  check('T8.4 no overnight time leaked into streak', (st.hourStreakSec || 0) <= 660, '<=660s', st.hourStreakSec);
  check('T8.5 daily study seconds not inflated', (st.dailyStudySeconds || 0) <= 660, '<=660s', st.dailyStudySeconds);
  // Wake: 09:05 next morning -> rollover, timer discarded, new bomb armed
  await app.advance(8 * 60 * 60 * 1000 + 52 * 60 * 1000, 60_000); // now 09:03 — before the 09:05 bomb expiry
  st = await app.readState();
  check('T8.6 study day rolled to Oct 20', st.dailyStudyKey === '2026-10-20', '2026-10-20', st.dailyStudyKey);
  check('T8.7 pre-wake session discarded (cannot cross wake)', st.activeTimer === null || st.activeTimer.type !== 'study', 'no study timer', JSON.stringify(st.activeTimer && st.activeTimer.type));
  // Existing intended semantics: the still-running (uncommitted) segment is discarded at the
  // Study-Day boundary, so the pre-midnight minutes do not enter the streak.
  check('T8.8 no phantom streak from discarded segment', (st.hourStreakSec || 0) === 0, 0, st.hourStreakSec);
  check('T8.9 new bomb armed for the new day', st.activeTimer && st.activeTimer.type === 'bomb', 'bomb', st.activeTimer && st.activeTimer.type);
  check('T8.10 fresh bomb still ticking (not spuriously expired)', st.bombLocked === false, false, st.bombLocked);
  app.close();
}

/* ------------------------------------------------------------------ */
async function t9_pauseResumeBombOff() {
  suite('T9 pause/resume/stop math (Bomb OFF where Pause is enabled)');
  await wipeDb();
  await seedState({
    settings: baseSettings({ bombChallengeMode: false }),
    lastActiveDate: YDAY,
    dailyStudyKey: YDAY,
    hearts: 0,
  });
  await seedTasks([{ category: 'study', name: 'Maths', duration: 30 * 60, icon: '\u{1F4D6}', color: '#5B4FE8' }]);
  const app = await bootApp({ now: T0 });
  check('T9.1 pause button visible with Bomb OFF', app.win.document.getElementById('btnPause').style.display !== 'none', 'visible', app.win.document.getElementById('btnPause').style.display);
  await app.click('#btnStart');
  await app.advance(60_000);
  await app.click('#btnPause');
  let st = await app.readState();
  check('T9.2 session paused', !!(st.activeTimer && st.activeTimer.pausedAt), true, !!(st.activeTimer && st.activeTimer.pausedAt));
  await app.advance(120_000); // 2 min paused
  await app.click('#btnPause'); // resume
  st = await app.readState();
  check('T9.3 pause cleared on resume', !st.activeTimer.pausedAt, false, !!st.activeTimer.pausedAt);
  await app.advance(30_000);
  await app.click('#btnStop');
  const tl = await app.readTimeline();
  const entries = tl.filter(e => e.category === 'study');
  // Existing design: pausing commits the completed segment immediately; stopping commits the
  // final segment. So exactly 2 rows for run(60s) + run(30s); the paused window appears in neither.
  check('T9.4 exactly 2 segment rows (pause-commit + stop-commit)', entries.length === 2, 2, entries.length);
  const totalSec = entries.reduce((s, e) => s + e.duration, 0);
  check('T9.5 committed timeline duration = real study 90s (no double count)', approx(totalSec, 90, 4), '90±4', totalSec);
  const segConsistent = entries.every(e => approx(e.duration, (e.endTs - e.startTs) / 1000, 1));
  check('T9.6 every row duration matches its own start/end span', segConsistent, 'consistent', JSON.stringify(entries.map(e => ({ d: e.duration, span: (e.endTs - e.startTs) / 1000 }))));
  st = await app.readState();
  check('T9.7 streak reflects real study time', approx(st.hourStreakSec, 90, 4), '90±4', st.hourStreakSec);
  await app.advance(7000); // let the 3s recovery reconcile run
  st = await app.readState();
  check('T9.8 reconciliation keeps study totals at 90s (no drift)', approx(st.dailyStudySeconds, 90, 4) && approx(st.hourStreakSec, 90, 4), '90±4 / 90±4', `${st.dailyStudySeconds} / ${st.hourStreakSec}`);
  app.close();
}

/* ------------------------------------------------------------------ */
async function t10_restartAfterExplosion() {
  suite('T10 restart after explosion does not revive stale state');
  const app = await standardBoot();
  let st = await app.readState();
  await app.advance(5 * 60 * 1000 + 15_000); // explode (0 hearts)
  st = await app.readState();
  check('T10.1 locked', st.bombLocked === true, true, st.bombLocked);
  const inp = app.win.document.getElementById('breachConfirmInput');
  inp.value = '123';
  await app.click('#breachOkBtn');
  await flushReal(6);
  st = await app.readState();
  check('T10.2 fresh full bomb running after restart', st.activeTimer && st.activeTimer.type === 'bomb', 'bomb', st.activeTimer && st.activeTimer.type);
  const startWall = st.activeTimer.wallStartTs;
  check('T10.3 fresh bomb anchored at restart time', approx(startWall, app.now(), 5000), `${app.now()}±5000`, startWall);
  check('T10.4 clock refilled to full', approx(st.bombRemainingMs, 300000, 1500), '300000±1500', st.bombRemainingMs);
  check('T10.5 bomb card counts fresh 05:00', /^0[45]:\d\d$/.test(app.text('#breakTime') || ''), '04-05:xx', app.text('#breakTime'));
  await app.advance(60_000);
  st = await app.readState();
  check('T10.6 still ticking fresh bomb after 60s', st.activeTimer && st.activeTimer.type === 'bomb' && !st.bombLocked, 'bomb unlocked', JSON.stringify({ t: st.activeTimer && st.activeTimer.type, l: st.bombLocked }));
  app.close();
}

/* ------------------------------------------------------------------ */
async function t11_foregroundNaturalCompletion() {
  suite('T11 foreground natural completion banks Hour Streak / Daily Study (GT-03)');
  const app = await standardBoot(); // 30-min study task; shorten by... we start and run to natural end
  // Give the task a short duration by editing the persisted task record before start? Simpler:
  // run the FULL 30-minute task — deterministic and also verifies the long path.
  await app.click('#btnStart');
  let st = await app.readState();
  check('T11.1 session started', st.activeTimer && st.activeTimer.type === 'study', 'study', st.activeTimer && st.activeTimer.type);
  await app.advance(30 * 60 * 1000 + 10_000, 1000); // run past natural completion
  await flushReal(8);
  st = await app.readState();
  const tl = await app.readTimeline();
  const entries = tl.filter(e => e.category === 'study');
  check('T11.2 session completed and committed once', entries.length === 1 && entries[0].duration === 1800, '1×1800', JSON.stringify(entries.map(e => e.duration)));
  check('T11.3 Hour Streak banked in the SAME pass (no stale 0)', approx(st.hourStreakSec, 1800, 3), '1800±3', st.hourStreakSec);
  check('T11.4 Daily Study banked in the SAME pass', approx(st.dailyStudySeconds, 1800, 3), '1800±3', st.dailyStudySeconds);
  check('T11.5 streak card shows 0 hours (1800s = 0 full hours)', app.text('#streakNum') === '0', '0', app.text('#streakNum'));
  check('T11.6 bomb re-armed after completion', st.activeTimer && st.activeTimer.type === 'bomb', 'bomb', st.activeTimer && st.activeTimer.type);
  // Healing must not double-count on later recovery cycles
  await app.advance(7000);
  st = await app.readState();
  check('T11.7 no double-bank after later recovery cycles', approx(st.hourStreakSec, 1800, 3) && approx(st.dailyStudySeconds, 1800, 3), '1800±3 / 1800±3', `${st.hourStreakSec} / ${st.dailyStudySeconds}`);
  app.close();
}

/* ------------------------------------------------------------------ */
async function t12_stopWhilePaused() {
  suite('T12 stop while PAUSED writes no duplicate row (GT-04)');
  await wipeDb(); // isolate from T11's completed task
  await seedState({
    settings: baseSettings({ bombChallengeMode: false }),
    lastActiveDate: YDAY,
    dailyStudyKey: YDAY,
    hearts: 0,
  });
  await seedTasks([{ category: 'study', name: 'Maths', duration: 30 * 60, icon: '\u{1F4D6}', color: '#5B4FE8' }]);
  const app = await bootApp({ now: T0 });
  await app.click('#btnStart');
  await app.advance(60_000);
  await app.click('#btnPause'); // commits the 60s segment
  await app.advance(30_000);    // 30s paused (no time accrues)
  await app.click('#btnStop');  // stop while paused
  await flushReal(8);
  const tl = await app.readTimeline();
  const entries = tl.filter(e => e.category === 'study');
  check('T12.1 exactly 1 row (pause-commit only; stop adds none)', entries.length === 1, 1, entries.length);
  check('T12.2 row duration matches span', entries[0] && approx(entries[0].duration, (entries[0].endTs - entries[0].startTs) / 1000, 1), 'consistent', entries[0] && JSON.stringify({ d: entries[0].duration, span: (entries[0].endTs - entries[0].startTs) / 1000 }));
  const st = await app.readState();
  check('T12.3 streak banked once (60s)', approx(st.hourStreakSec, 60, 3), '60±3', st.hourStreakSec);
  check('T12.4 daily study banked once (60s)', approx(st.dailyStudySeconds, 60, 3), '60±3', st.dailyStudySeconds);
  await app.advance(7000);
  const st2 = await app.readState();
  check('T12.5 reconciliation agrees with banked values (no inflation)', approx(st2.hourStreakSec, 60, 3) && approx(st2.dailyStudySeconds, 60, 3), '60±3 / 60±3', `${st2.hourStreakSec} / ${st2.dailyStudySeconds}`);
  app.close();
}

/* ------------------------------------------------------------------ */
async function t15_bombOffNoPhantom() {
  suite('T15 Bomb Mode OFF: stop/reload must not install a phantom bomb (GT-06)');
  await wipeDb();
  await seedState({
    settings: baseSettings({ bombChallengeMode: false, bombDuration: 0 }),
    lastActiveDate: TODAY, dailyStudyKey: TODAY, // same study day — no rollover to mask the bug
    hearts: 1,
    bombRemainingMs: 0,
  });
  await seedTasks([{ category: 'study', name: 'Maths', duration: 30 * 60, icon: 'x', color: '#5B4FE8' }]);
  let app = await bootApp({ now: T0 });
  await app.click('#btnStart');
  await app.advance(30_000);
  await app.click('#btnStop'); // Bomb OFF: stopSession must leave an IDLE state, not a bomb timer
  await flushReal(8);
  let st = await app.readState();
  check('T15.1 no bomb timer installed at stop with Bomb OFF', !(st.activeTimer && st.activeTimer.type === 'bomb'), 'no bomb timer', JSON.stringify(st.activeTimer && { type: st.activeTimer.type, duration: st.activeTimer.duration }));
  const tl = await app.readTimeline();
  check('T15.2 study row committed at stop', tl.filter(e => e.category === 'study').length === 1, 1, tl.filter(e => e.category === 'study').length);
  // Reload: boot recovery runs against whatever stop left behind
  const now2 = app.now();
  app.close();
  app = await bootApp({ now: now2 });
  await flushReal(8);
  st = await app.readState();
  check('T15.3 reload keeps no bomb timer (Bomb OFF)', !(st.activeTimer && st.activeTimer.type === 'bomb'), 'none', JSON.stringify(st.activeTimer && { type: st.activeTimer.type, duration: st.activeTimer.duration }));
  check('T15.4 lifeline NOT consumed by an inert subsystem', st.hearts === 1, 1, st.hearts);
  check('T15.5 no phantom explosion recorded', !(st.bombExplodedToday > 0), 0, st.bombExplodedToday);
  check('T15.6 bomb clock untouched (stays 0)', st.bombRemainingMs === 0, 0, st.bombRemainingMs);
  app.close();
}

/* ------------------------------------------------------------------ */
async function t16_idleAnchorAfterStop() {
  suite('T16 History idle anchor = stop moment, not day wake (GT-07)');
  await wipeDb();
  await seedState({
    // Bomb OFF → stop leaves a true IDLE state (activeTimer null), so the live History
    // Idle row depends on _idleStartTs being persisted at the stop moment.
    settings: baseSettings({ bombChallengeMode: false, bombDuration: 0 }),
    lastActiveDate: YDAY, dailyStudyKey: YDAY, // rollover at boot anchors _idleStartTs to 09:00
    hearts: 0,
  });
  await seedTasks([{ category: 'study', name: 'Maths', duration: 30 * 60, icon: 'x', color: '#5B4FE8' }]);
  const app = await bootApp({ now: T0 });          // 09:00 boot → rollover sets _idleStartTs = 09:00
  await app.click('#btnStart');
  await app.advance(60_000);                       // run 60s
  await app.click('#btnStop');                     // stop at 09:01
  await flushReal(8);
  const st = await app.readState();
  const stopMoment = app.now();
  check('T16.1 _idleStartTs persisted at the stop moment (±3s)',
    st._idleStartTs != null && approx(st._idleStartTs, stopMoment, 3000),
    `${stopMoment}±3000`, st._idleStartTs);
  app.close();
}

/* ------------------------------------------------------------------ */
async function t17_bombOffNaturalCompletion() {
  suite('T17 Bomb Mode OFF: natural completion must not install a phantom bomb (GT-06)');
  await wipeDb();
  await seedState({
    settings: baseSettings({ bombChallengeMode: false, bombDuration: 0 }),
    lastActiveDate: TODAY, dailyStudyKey: TODAY,
    hearts: 1,
    bombRemainingMs: 0,
  });
  await seedTasks([{ category: 'study', name: 'Maths', duration: 30 * 60, icon: 'x', color: '#5B4FE8' }]);
  let app = await bootApp({ now: T0 });
  await app.click('#btnStart');
  await app.advance(30 * 60 * 1000 + 10_000, 1000); // run past natural completion
  await flushReal(8);
  let st = await app.readState();
  check('T17.1 idle (no bomb timer) right after completion', !(st.activeTimer && st.activeTimer.type === 'bomb'), 'no bomb timer',
    JSON.stringify(st.activeTimer && { type: st.activeTimer.type, duration: st.activeTimer.duration }));
  const tl = await app.readTimeline();
  check('T17.2 completed session committed', tl.filter(e => e.category === 'study').length === 1, 1, tl.filter(e => e.category === 'study').length);
  const now2 = app.now();
  app.close();
  app = await bootApp({ now: now2 });
  await flushReal(8);
  st = await app.readState();
  check('T17.3 reload: still idle', !(st.activeTimer && st.activeTimer.type === 'bomb'), 'none', JSON.stringify(st.activeTimer && st.activeTimer.type));
  check('T17.4 reload: lifeline intact', st.hearts === 1, 1, st.hearts);
  check('T17.5 reload: no phantom explosion', !(st.bombExplodedToday > 0), 0, st.bombExplodedToday);
  app.close();
}

/* ------------------------------------------------------------------ */
async function main() {
  await t1_bootRollover();
  await t2_startStopStudy();
  await t3_rapidDoubleTap();
  await t4_bombLifelineAndExplosion();
  await t5_streakBarAfterExplosion();
  await t6_reloadWhileRunning();
  await t7_processDeathRecovery();
  await t8_sleepFreezeAndWake();
  await t9_pauseResumeBombOff();
  await t10_restartAfterExplosion();
  await t11_foregroundNaturalCompletion();
  await t12_stopWhilePaused();
  await t15_bombOffNoPhantom();
  await t16_idleAnchorAfterStop();
  await t17_bombOffNaturalCompletion();

  const pass = results.filter(r => r.pass).length;
  console.log(`\n==== SUMMARY: ${pass}/${results.length} passed, ${results.length - pass} failed ====`);
  for (const r of results.filter(x => !x.pass)) console.log('FAILED: [' + r.suite + '] ' + r.name + ' expected=' + r.expected + ' actual=' + r.actual);
  process.exit(results.some(r => !r.pass) ? 1 : 0);
}

main().catch((e) => { console.error('SUITE CRASH', e); process.exit(2); });
