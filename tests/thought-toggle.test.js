'use strict';
/**
 * Thought Logger toggle suite (v4.12).
 * Runs the REAL index.html in the jsdom harness and verifies:
 *   - The OFF switch only commits when Save Changes is pressed (draft model).
 *   - Save with OFF shows the SHARED typed-confirm dialog (type THOUGHT);
 *     wrong word keeps everything unchanged, Cancel keeps the feature ON,
 *     lowercase "thought" is accepted (case-insensitive like DONE).
 *   - After a confirmed turn-off: state persisted, Thoughts hidden on Home,
 *     History and Goals, subtitle says Off — and saved records are KEPT.
 *   - Turning back ON needs no confirmation and restores cards + records.
 *   - Reset All Data also runs through the same shared dialog (live-enable).
 */
const { bootApp, seedState, wipeDb, flushReal } = require('./harness');

const results = [];
let currentSuite = '';
function suite(name) { currentSuite = name; console.log('\n=== ' + name + ' ==='); }
function check(name, cond, expected, actual) {
  const pass = !!cond;
  results.push({ suite: currentSuite, name, pass, expected: String(expected), actual: String(actual) });
  console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + ' | expected=' + expected + ' actual=' + actual);
}

const DAY = '2026-10-20';
const SETTINGS_SEED = { thoughtCountsByDay: { [DAY]: { tc_fear: 3, tc_study: 2 } } };

function dispatchChange(app, el, checked) {
  el.checked = checked;
  el.dispatchEvent(new app.win.Event('change', { bubbles: true }));
}
const dialogOpen = (app) => { const d = app.$('#sharedConfirmDialog'); return !!d && d.classList.contains('show'); };
const dialogTitle = (app) => { const d = app.$('#sharedConfirmTitle'); return d ? d.textContent : '<missing>'; };
const typeInto = (app, value) => {
  const inp = app.$('#sharedConfirmInput');
  inp.value = value;
  inp.dispatchEvent(new app.win.Event('input', { bubbles: true }));
  return inp;
};

/* ------------------------------------------------------------------ */
async function tt1_toggleIsDraftUntilSave() {
  suite('TT1 toggle alone does not disable the feature (draft model)');
  await wipeDb();
  await seedState(SETTINGS_SEED);
  const app = await bootApp({ now: new Date(2026, 9, 20, 10, 0, 0).getTime() });

  const card = app.$('#thoughtCard');
  check('TT1.1 home Thoughts card visible at boot', !!card && card.style.display !== 'none', 'visible', card ? 'display=' + (card.style.display || '""') : 'missing');

  const launcher = app.$('#settingsMain .goal-settings-launch[data-sub="subThoughts"]');
  check('TT1.2 Thought Logger launcher exists', !!launcher, 'element', launcher ? 'element' : 'missing');
  if (launcher) await app.click(launcher);

  const toggle = app.$('#setThoughtsEnabled');
  check('TT1.3 toggle starts ON', !!toggle && toggle.checked === true, 'true', toggle ? toggle.checked : 'missing');
  check('TT1.4 no dialog open before any save', dialogOpen(app) === false, 'false', dialogOpen(app));

  dispatchChange(app, toggle, false);
  const st = await app.readState();
  check('TT1.5 state still enabled after toggling (nothing persisted yet)', st && st.settings && st.settings.thoughtsEnabled !== false, 'enabled', st && st.settings ? String(st.settings.thoughtsEnabled) : 'no state');
  check('TT1.6 home card still visible pre-save', app.$('#thoughtCard').style.display !== 'none', 'visible', app.$('#thoughtCard').style.display || '""');

  app.close();
  global.__thoughtApp = null;
}

/* ------------------------------------------------------------------ */
async function tt2_saveOpensSharedDialogAndGates() {
  suite('TT2 Save with OFF opens shared dialog; wrong word rejected');
  const app = await bootApp({ now: new Date(2026, 9, 20, 10, 0, 0).getTime() });

  const launcher = app.$('#settingsMain .goal-settings-launch[data-sub="subThoughts"]');
  if (launcher) await app.click(launcher);
  const toggle = app.$('#setThoughtsEnabled');
  dispatchChange(app, toggle, false);

  await app.click('#saveThoughtSettingsBtn');
  await flushReal(15);
  check('TT2.1 shared confirm dialog opens on Save', dialogOpen(app) === true, 'true', dialogOpen(app));
  check('TT2.2 dialog is the Thought-off one', /Turn off Thought Logging/i.test(dialogTitle(app)), 'Turn off Thought Logging?', dialogTitle(app));
  const inp = app.$('#sharedConfirmInput');
  check('TT2.3 placeholder is THOUGHT', inp && inp.placeholder === 'THOUGHT', 'THOUGHT', inp ? inp.placeholder : 'missing');

  let st = await app.readState();
  check('TT2.4 state untouched while dialog open', st && st.settings.thoughtsEnabled !== false, 'enabled', String(st && st.settings && st.settings.thoughtsEnabled));

  // Wrong word -> mismatch toast, dialog stays, nothing changes.
  typeInto(app, 'thoughts');
  await app.click('#sharedConfirmConfirm');
  await flushReal(8);
  check('TT2.5 wrong word keeps dialog open', dialogOpen(app) === true, 'true', dialogOpen(app));
  const toast = app.$('#toast');
  check('TT2.6 mismatch toast shown', !!toast && /Type THOUGHT to confirm/i.test(toast.textContent), 'Type THOUGHT to confirm', toast ? toast.textContent : 'no toast');
  st = await app.readState();
  check('TT2.7 state still enabled after wrong word', st && st.settings.thoughtsEnabled !== false, 'enabled', String(st && st.settings && st.settings.thoughtsEnabled));

  // Cancel -> dialog closes, feature STAYS ON, other changes still saved.
  await app.click('#sharedConfirmCancel');
  await flushReal(15);
  check('TT2.8 cancel closes dialog', dialogOpen(app) === false, 'false', dialogOpen(app));
  st = await app.readState();
  check('TT2.9 cancel keeps feature ON', st && st.settings.thoughtsEnabled !== false, 'enabled', String(st && st.settings && st.settings.thoughtsEnabled));
  const sub = app.$('#thoughtLaunchSub');
  check('TT2.10 subtitle still On after cancel', !!sub && /^On/.test(sub.textContent), 'On ...', sub ? sub.textContent : 'missing');
  check('TT2.11 home card visible after cancel', app.$('#thoughtCard').style.display !== 'none', 'visible', app.$('#thoughtCard').style.display || '""');

  app.close();
}

/* ------------------------------------------------------------------ */
async function tt3_confirmedTurnOffHidesEverywhereKeepsRecords() {
  suite('TT3 confirmed THOUGHT turns off everywhere; records kept');
  const app = await bootApp({ now: new Date(2026, 9, 20, 10, 0, 0).getTime() });

  const launcher = app.$('#settingsMain .goal-settings-launch[data-sub="subThoughts"]');
  if (launcher) await app.click(launcher);
  dispatchChange(app, app.$('#setThoughtsEnabled'), false);
  await app.click('#saveThoughtSettingsBtn');
  await flushReal(10);
  check('TT3.1 dialog open', dialogOpen(app) === true, 'true', dialogOpen(app));

  // Lowercase must be accepted (case-insensitive, like DONE).
  typeInto(app, 'thought');
  await app.click('#sharedConfirmConfirm');
  await flushReal(20);

  check('TT3.2 dialog closed after correct word', dialogOpen(app) === false, 'false', dialogOpen(app));
  const st = await app.readState();
  check('TT3.3 thoughtsEnabled persisted as false', st && st.settings && st.settings.thoughtsEnabled === false, 'false', String(st && st.settings && st.settings.thoughtsEnabled));
  check('TT3.4 home Thoughts card hidden', app.$('#thoughtCard').style.display === 'none', 'none', app.$('#thoughtCard').style.display || '""');
  check('TT3.5 History thought reader hidden', app.$('#historyThoughtCard').style.display === 'none', 'none', app.$('#historyThoughtCard').style.display || '""');
  check('TT3.6 Goals thought reader hidden', app.$('#goalThoughtCard').style.display === 'none', 'none', app.$('#goalThoughtCard').style.display || '""');
  const sub = app.$('#thoughtLaunchSub');
  check('TT3.7 subtitle shows Off', !!sub && /^Off/.test(sub.textContent), 'Off ...', sub ? sub.textContent : 'missing');
  const toggle = app.$('#setThoughtsEnabled');
  check('TT3.8 toggle shows OFF', !!toggle && toggle.checked === false, 'false', toggle ? toggle.checked : 'missing');

  // Regression: renderHeader() ticks every second and calls renderSleepExtraCard(),
  // which used to set thoughtCard.style.display='' while awake — resurrecting the
  // card after it had been hidden (vanish on touch, reappear a moment later).
  if(typeof app.win.renderHeader === 'function') app.win.renderHeader();
  if(typeof app.win.renderSleepExtraCard === 'function') app.win.renderSleepExtraCard();
  await flushReal(5);
  check('TT3.10 Home card STILL hidden after header tick', app.$('#thoughtCard').style.display === 'none', 'none', app.$('#thoughtCard').style.display || '\"\"');

  // Even a direct sleep-state transition (awake tick) must not bring it back.
  if(typeof app.win.updateThoughtCooldownUI === 'function') app.win.updateThoughtCooldownUI();
  await flushReal(5);
  check('TT3.11 Home card STILL hidden after cooldown UI refresh', app.$('#thoughtCard').style.display === 'none', 'none', app.$('#thoughtCard').style.display || '\"\"');

  // Records are KEPT (the whole point of the confirmation).
  const counts = st && st.thoughtCountsByDay ? st.thoughtCountsByDay[DAY] : null;
  check('TT3.9 saved thought records kept in state', !!counts && counts.tc_fear === 3 && counts.tc_study === 2, '{"tc_fear":3,"tc_study":2}', JSON.stringify(counts));

  app.close();
}

/* ------------------------------------------------------------------ */
async function tt4_reEnableNeedsNoDialogAndRestores() {
  suite('TT4 turning back ON needs no confirmation and restores everything');
  const app = await bootApp({ now: new Date(2026, 9, 20, 10, 0, 0).getTime() });

  // Boot, turn OFF first (confirmed), then re-enable.
  const launcher = app.$('#settingsMain .goal-settings-launch[data-sub="subThoughts"]');
  if (launcher) await app.click(launcher);
  dispatchChange(app, app.$('#setThoughtsEnabled'), false);
  await app.click('#saveThoughtSettingsBtn');
  await flushReal(10);
  typeInto(app, 'THOUGHT');
  await app.click('#sharedConfirmConfirm');
  await flushReal(20);
  check('TT4.1 off state reached', (await app.readState()).settings.thoughtsEnabled === false, 'false', String((await app.readState()).settings.thoughtsEnabled));

  // Now ON + Save: no dialog must appear.
  dispatchChange(app, app.$('#setThoughtsEnabled'), true);
  await app.click('#saveThoughtSettingsBtn');
  await flushReal(20);
  check('TT4.2 no confirmation needed to turn ON', dialogOpen(app) === false, 'false', dialogOpen(app));
  const st = await app.readState();
  check('TT4.3 state enabled again', st.settings.thoughtsEnabled !== false, 'enabled', String(st.settings.thoughtsEnabled));
  check('TT4.4 home card visible again', app.$('#thoughtCard').style.display !== 'none', 'visible', app.$('#thoughtCard').style.display || '""');
  check('TT4.5 history reader visible again', app.$('#historyThoughtCard').style.display !== 'none', 'visible', app.$('#historyThoughtCard').style.display || '""');
  const total = app.$('#historyThoughtTotal');
  check('TT4.6 historical counts still render (5 total)', !!total && /5\s*total/.test(total.textContent), '5 total', total ? total.textContent : 'missing');
  const sub = app.$('#thoughtLaunchSub');
  check('TT4.7 subtitle shows On', !!sub && /^On/.test(sub.textContent), 'On ...', sub ? sub.textContent : 'missing');

  app.close();
}

/* ------------------------------------------------------------------ */
async function tt5_resetUsesSameSharedDialog() {
  suite('TT5 Reset All Data shares the same dialog (live-enable)');
  const app = await bootApp({ now: new Date(2026, 9, 20, 10, 0, 0).getTime() });

  await app.click('#resetDataBtn');
  await flushReal(5);
  check('TT5.1 same shared dialog opens', dialogOpen(app) === true, 'true', dialogOpen(app));
  check('TT5.2 titled Reset All Data', /Reset All Data/.test(dialogTitle(app)), 'Reset All Data', dialogTitle(app));
  const inp = app.$('#sharedConfirmInput');
  const btn = app.$('#sharedConfirmConfirm');
  check('TT5.3 placeholder 123456789', inp && inp.placeholder === '123456789', '123456789', inp ? inp.placeholder : 'missing');
  check('TT5.4 confirm button starts disabled (live-enable)', btn && btn.disabled === true, 'true', btn ? btn.disabled : 'missing');

  // Digits-only filter + enable once exact.
  typeInto(app, '12ab34');
  check('TT5.5 filter strips non-digits', inp.value === '1234', '1234', inp.value);
  check('TT5.6 still disabled on partial code', btn.disabled === true, 'true', btn.disabled);
  typeInto(app, '123456789');
  check('TT5.7 enabled when code exact', btn.disabled === false, 'false', btn.disabled);

  // Cancel closes without running factoryReset (no reload happened).
  await app.click('#sharedConfirmCancel');
  await flushReal(5);
  check('TT5.8 cancel closes shared dialog', dialogOpen(app) === false, 'false', dialogOpen(app));

  const errs = app.pageErrors;
  check('TT5.9 no page errors', errs.length === 0, '0', errs.length + (errs.length ? ' :: ' + errs[0] : ''));
  app.close();
}

/* ------------------------------------------------------------------ */
async function main() {
  await tt1_toggleIsDraftUntilSave();
  await tt2_saveOpensSharedDialogAndGates();
  await tt3_confirmedTurnOffHidesEverywhereKeepsRecords();
  await tt4_reEnableNeedsNoDialogAndRestores();
  await tt5_resetUsesSameSharedDialog();

  const pass = results.filter((r) => r.pass).length;
  console.log(`\n==== THOUGHT-TOGGLE SUMMARY: ${pass}/${results.length} passed, ${results.length - pass} failed ====`);
  for (const r of results.filter((x) => !x.pass)) console.log('FAILED: [' + r.suite + '] ' + r.name + ' expected=' + r.expected + ' actual=' + r.actual);
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
