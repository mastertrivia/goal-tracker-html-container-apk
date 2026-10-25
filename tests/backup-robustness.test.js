'use strict';
/**
 * App & Data menu + hardened backup pipeline (v4.11).
 * Runs the REAL index.html in the jsdom harness and verifies:
 *   - the new App & Data card: all 7 rows, exact order, correct labels,
 *     Android Shell Settings launcher moved to the TOP of Settings,
 *     old Backup card / System Check button / HTML App Management removed,
 *   - every row dispatches to its bridge method,
 *   - gtValidateSnap rejects corrupt/foreign snapshots BEFORE anything is
 *     cleared (the old code wiped the database first),
 *   - a valid snapshot restores and replaces data,
 *   - andMirrorToNative produces a complete, fresh mirror for export.
 */
const { bootApp, wipeDb, flushReal } = require('./harness');
const { findBy } = require('./bridge-mock');

const results = [];
let currentSuite = '';
function suite(name) { currentSuite = name; console.log('\n=== ' + name + ' ==='); }
function check(name, cond, expected, actual) {
  const pass = !!cond;
  results.push({ suite: currentSuite, name, pass, expected: String(expected), actual: String(actual) });
  console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + ' | expected=' + expected + ' actual=' + actual);
}

const MENU_IDS = [
  'andMnuRefresh', 'andMnuImportData', 'andMnuExportData', 'andMnuInstallHtml',
  'andMnuRevertHtml', 'andMnuSaveHtml', 'andMnuFactoryReset', 'andMnuSysCheck',
];
const MENU_TITLES = [
  'Refresh App', 'Import User Data', 'Export User Data', 'Install NEW HTML File',
  'Revert to original HTML', 'Save Current HTML File', 'Factory Reset User Data', 'System Check',
];

function validSnap(extra = {}) {
  return {
    v: 1,
    savedAt: Date.now(),
    state: {
      key: 'state',
      lastActiveDate: '2026-10-23',
      settings: { pomodoroDuration: 1234, hearts: 2 },
      ...extra.state,
    },
    tasks: extra.tasks || [{ id: 999, category: 'study', name: 'ImportedTask', duration: 60, icon: 'x', color: '#fff' }],
    sessions: extra.sessions || [],
    timeline: extra.timeline || [],
  };
}

async function bootWithStorage(storage) {
  await wipeDb();
  return bootApp({ bridge: { storage } });
}

/* ------------------------------------------------------------------ */
async function b1_validateGateMatrix() {
  suite('B1 gtValidateSnap: pure validation gate');
  const app = await bootWithStorage({});
  const V = app.win.gtValidateSnap;
  check('B1.1 gate exposed on window', typeof V === 'function', 'function', typeof V);
  if (typeof V === 'function') {
    check('B1.2 valid snapshot accepted', V(validSnap()) === null, 'null', V(validSnap()));
    check('B1.3 null rejected', /no Goal Tracker data/.test(V(null) || ''), 'reason', V(null));
    check('B1.4 non-object rejected', V('just a string') === 'file contains no Goal Tracker data', 'reason', V('just a string'));
    check('B1.5 state-as-string rejected', /no valid app state/.test(V({ state: 'TOTAL GARBAGE' }) || ''), 'reason', V({ state: 'TOTAL GARBAGE' }));
    check('B1.6 missing settings rejected', /no settings/.test(V({ state: { goal: 'x' } }) || ''), 'reason', V({ state: { goal: 'x' } }));
    check('B1.7 tasks as string rejected', /tasks.*corrupt/.test(V({ state: { settings: {} }, tasks: 'nope' }) || ''), 'reason', V({ state: { settings: {} }, tasks: 'nope' }));
    check('B1.8 tasks of numbers rejected', /corrupt/.test(V({ state: { settings: {} }, tasks: [1, 2] }) || ''), 'reason', V({ state: { settings: {} }, tasks: [1, 2] }));
    check('B1.9 sessions containing null rejected', /corrupt/.test(V({ state: { settings: {} }, sessions: [null] }) || ''), 'reason', V({ state: { settings: {} }, sessions: [null] }));
    check('B1.10 missing collections tolerated (legacy)', V({ state: { settings: {} } }) === null, 'null', V({ state: { settings: {} } }));
  }
  app.close();
}

async function b2_corruptRestoreNeverTouchesData() {
  suite('B2 corrupt snapshot: import fails loudly, existing data untouched');
  const app = await bootWithStorage({});
  // Simulate the native file holding damaged content (as an old buggy import
  // could have left behind) — set AFTER boot so the auto-mirror cannot race us.
  app.bridge.__storage.gt_backup = JSON.stringify({ v: 1, state: 'TOTAL GARBAGE' });
  const before = await app.readTasks();
  const ret = await app.win.andRestoreFromNative();
  const after = await app.readTasks();
  check('B2.1 restore reports failure', ret === false, 'false', ret);
  const toast = app.$('#toast');
  check('B2.2 toast says import failed', !!toast && /Import failed/i.test(toast.textContent), 'Import failed …', toast && toast.textContent);
  check('B2.3 task store untouched', after.length === before.length && after.every((t, i) => t.id === before[i].id),
    before.length + ' tasks preserved', after.length);
  const st = await app.readState();
  check('B2.4 state still the live default', !!st && st.settings && st.settings.pomodoroDuration !== undefined, 'live state intact', st && st.settings && st.settings.pomodoroDuration);
  app.close();
}

async function b3_foreignShapeRejected() {
  suite('B3 foreign JSON shape: rejected without touching data');
  const app = await bootWithStorage({});
  app.bridge.__storage.gt_backup = JSON.stringify({ users: ['someone', 'else'], database: 'postgres' });
  const before = await app.readTasks();
  const ret = await app.win.andRestoreFromNative();
  const after = await app.readTasks();
  check('B3.1 foreign snapshot rejected', ret === false, 'false', ret);
  check('B3.2 toast says import failed', /Import failed/i.test(app.text('#toast') || ''), 'Import failed', app.text('#toast'));
  check('B3.3 data untouched', after.length === before.length, String(before.length), String(after.length));
  app.close();
}

async function b4_validRestoreApplies() {
  suite('B4 valid snapshot: restores fully and replaces data');
  const app = await bootWithStorage({});
  const snap = validSnap();
  app.bridge.__storage.gt_backup = JSON.stringify(snap);
  const defaultsBefore = (await app.readTasks()).length;
  const ret = await app.win.andRestoreFromNative();
  check('B4.1 restore reports success', ret === true, 'true', ret);
  check('B4.2 toast confirms restore', /Backup restored/i.test(app.text('#toast') || ''), 'Backup restored', app.text('#toast'));
  const tasks = await app.readTasks();
  check('B4.3 backup tasks replaced defaults', tasks.length === snap.tasks.length && tasks[0].name === 'ImportedTask',
    '1 imported task', defaultsBefore + ' defaults -> ' + tasks.length + ' (' + (tasks[0] && tasks[0].name) + ')');
  const st = await app.readState();
  check('B4.4 state settings applied', !!st && st.settings && st.settings.pomodoroDuration === 1234, '1234', st && st.settings && st.settings.pomodoroDuration);
  check('B4.5 hearts applied', st && st.settings && st.settings.hearts === 2, '2', st && st.settings && st.settings.hearts);
  app.close();
}

async function b5_exportMirrorIsFreshAndComplete() {
  suite('B5 export path: mirror is fresh and complete before the picker opens');
  const app = await bootWithStorage({});
  const ok = await app.win.andMirrorToNative();
  check('B5.1 mirror reports success', ok === true, 'true', ok);
  const raw = app.bridge.__storage.gt_backup;
  let snap = null;
  try { snap = JSON.parse(raw); } catch (e) { snap = null; }
  check('B5.2 mirror is valid JSON', !!snap, 'parsed object', snap ? 'object' : 'unparsable');
  check('B5.3 mirror carries state + settings', !!(snap && snap.state && snap.state.settings), 'state.settings', snap && typeof snap.state);
  check('B5.4 mirror carries all three collections', !!(snap && Array.isArray(snap.tasks) && Array.isArray(snap.sessions) && Array.isArray(snap.timeline)),
    'tasks/sessions/timeline arrays', snap && [typeof snap.tasks, typeof snap.sessions, typeof snap.timeline].join(','));
  check('B5.5 mirror timestamped', !!(snap && snap.savedAt > 0), 'savedAt > 0', snap && snap.savedAt);
  app.close();
}

async function b6_menuStructure() {
  suite('B6 App & Data menu: 7 rows in exact order; Android Shell first; old UI gone');
  const app = await bootWithStorage({});
  const launcher = app.$('#settingsMain .goal-settings-launch[data-sub="subAndroid"]');
  check('B6.1 Android Shell launcher exists', !!launcher, 'element', launcher ? 'element' : 'missing');
  const first = app.$('#settingsMain .goal-settings-launch');
  check('B6.2 Android Shell Settings is the FIRST launcher', !!first && first === launcher, 'first = subAndroid', first && first.getAttribute('data-sub'));
  // Open the sub-page so andRenderSettings fills the card.
  if (launcher) await app.click(launcher);
  const rows = MENU_IDS.map((id) => app.$('#' + id));
  check('B6.3 all 7 rows present', rows.every(Boolean), '7 elements', rows.filter(Boolean).length + '/7');
  // Exact order in the DOM:
  const domIds = app.$$('#cardAppData .and-row').map((r) => r.id);
  check('B6.4 rows in the exact specified order', JSON.stringify(domIds) === JSON.stringify(MENU_IDS),
    MENU_IDS.join(','), domIds.join(','));
  rows.forEach((row, i) => {
    if (!row) return;
    const t1 = (row.querySelector('.ar-t1') || {}).textContent || '';
    const t2 = (row.querySelector('.ar-t2') || {}).textContent || '';
    check('B6.5 row ' + (i + 1) + ' labelled "' + MENU_TITLES[i] + '"', t1.indexOf(MENU_TITLES[i]) !== -1 && t2.length > 10,
      MENU_TITLES[i] + ' + description', t1 + ' / ' + t2.slice(0, 30));
  });
  check('B6.6 old Backup card removed', !app.$('#cardBackup'), 'absent', app.$('#cardBackup') ? 'present' : 'absent');
  check('B6.7 old System Check button removed from Diagnostics', !app.$('#andSysCheck'), 'absent', app.$('#andSysCheck') ? 'present' : 'absent');
  check('B6.8 Error Log kept in Diagnostics', !!app.$('#andShowErrors'), 'present', app.$('#andShowErrors') ? 'present' : 'missing');
  check('B6.9 HTML App Management card removed', !/HTML App Management/.test(app.$('#andBridgeUI').innerHTML), 'absent', /HTML App Management/.test(app.$('#andBridgeUI').innerHTML));
  check('B6.10 mirror freshness line moved into App & Data', !!app.$('#cardAppData #andBackupInfo'), 'inside cardAppData', !!app.$('#cardAppData #andBackupInfo'));
  app.close();
}

async function b7_menuRowsDispatchToBridge() {
  suite('B7 every App & Data row dispatches to its bridge method');
  const app = await bootWithStorage({});
  const launcher = app.$('#settingsMain .goal-settings-launch[data-sub="subAndroid"]');
  if (launcher) await app.click(launcher);
  await app.click('#andMnuRefresh');
  await app.click('#andMnuImportData');
  await app.click('#andMnuExportData');
  await flushReal(6); // export handler awaits the mirror first
  await app.click('#andMnuInstallHtml');
  await app.click('#andMnuRevertHtml');
  await app.click('#andMnuSaveHtml');
  await app.click('#andMnuFactoryReset');
  await app.click('#andMnuSysCheck');
  const calls = app.bridge.__calls;
  const expect = {
    refreshApp: 1, importBackup: 1, exportBackup: 1, importHtmlFile: 1,
    revertHtmlFile: 1, exportCurrentHtml: 1, factoryResetUserData: 1, systemCheck: 1,
  };
  for (const [name, n] of Object.entries(expect)) {
    check('B7.' + name + ' called', findBy(calls, name).length === n, String(n), String(findBy(calls, name).length));
  }
  const mirrors = findBy(calls, 'saveData').filter((c) => c[1] === 'gt_backup');
  check('B7.export mirrors fresh data first', mirrors.length >= 1, '>=1 saveData(gt_backup)', String(mirrors.length));
  app.close();
}

/* ------------------------------------------------------------------ */
async function main() {
  await b1_validateGateMatrix();
  await b2_corruptRestoreNeverTouchesData();
  await b3_foreignShapeRejected();
  await b4_validRestoreApplies();
  await b5_exportMirrorIsFreshAndComplete();
  await b6_menuStructure();
  await b7_menuRowsDispatchToBridge();

  const pass = results.filter((r) => r.pass).length;
  console.log(`\n==== BACKUP-ROBUSTNESS SUMMARY: ${pass}/${results.length} passed, ${results.length - pass} failed ====`);
  for (const r of results.filter((x) => !x.pass)) console.log('FAILED: [' + r.suite + '] ' + r.name + ' expected=' + r.expected + ' actual=' + r.actual);
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
