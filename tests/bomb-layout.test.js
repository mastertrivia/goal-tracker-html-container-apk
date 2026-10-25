'use strict';
/**
 * Bomb Timer conditional Home layout suite.
 * Runs the REAL index.html in the jsdom harness and verifies:
 *   - Bomb ON: the original grid renders untouched (buttons inside #pomoCard,
 *     Bomb card right after Day Streak, L-shape slot + footer note hidden).
 *   - Bomb OFF: the Bomb card is REMOVED from the document (no space taken),
 *     the Study control buttons relocate into #bombOffBtnSlot (directly under
 *     Day Streak), the subtle footer notice appears, and the moved buttons
 *     still work (listeners survive the move).
 *   - Mid-session toggling through the real Settings save flow switches
 *     cleanly between both states and restores the EXACT original structure.
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

const T0 = new Date(2026, 9, 20, 10, 0, 0).getTime(); // Tue Oct 20 2026, 10:00 local (awake, wakeHour 9)
const YDAY = '2026-10-19';

function baseSettings(extra) {
  return {
    wakeHour: 9,
    telegramEnabled: false,
    realityCheckEnabled: false,
    thoughtsEnabled: false,
    bombDuration: 5 * 60,
    dailyFreeLifelines: 1,
    ...extra,
  };
}

async function boot(extra) {
  await wipeDb();
  await seedState({ settings: baseSettings(extra || {}), lastActiveDate: YDAY, dailyStudyKey: YDAY });
  await seedTasks([{ category: 'study', name: 'Maths', duration: 30 * 60, icon: '\u{1F4D6}', color: '#5B4FE8' }]);
  return bootApp({ now: T0 });
}

function domOriginalLayout(app, tag) {
  const bombCard = app.win.document.getElementById('bombTimerCard');
  const btnRow = app.win.document.getElementById('pomoBtnRow');
  const pomoCard = app.win.document.getElementById('pomoCard');
  const streakCard = app.win.document.getElementById('streakCard');
  check(tag + '.1 Bomb card present in the document', !!bombCard && bombCard.isConnected, 'connected', bombCard ? ('connected=' + bombCard.isConnected) : 'missing');
  check(tag + '.2 Bomb card inside the Day Streak column (col-stack)', !!streakCard && bombCard && bombCard.parentNode === streakCard.parentNode && bombCard.parentNode.classList.contains('col-stack'), 'col-stack', bombCard && bombCard.parentNode ? bombCard.parentNode.className : 'missing');
  check(tag + '.3 buttons inside the Study card', !!btnRow && btnRow.parentNode === pomoCard, 'pomoCard', btnRow && btnRow.parentNode ? btnRow.parentNode.id || btnRow.parentNode.className : 'missing');
  check(tag + '.4 L-shape slot hidden', app.$('#bombOffBtnSlot').style.display === 'none', 'none', app.$('#bombOffBtnSlot').style.display);
  check(tag + '.5 footer notice hidden', app.$('#bombOffFooterNote').style.display === 'none', 'none', app.$('#bombOffFooterNote').style.display);
  check(tag + '.6 grid WITHOUT the bomb-off join class', !app.win.document.getElementById('homeTimerGrid').classList.contains('bomb-off'), 'absent', app.win.document.getElementById('homeTimerGrid').className);
}

// jsdom cannot implement window.scrollTo (the settings save handler calls it in a
// real browser too); such harness noise is not an application error.
function realPageErrors(app) {
  return app.pageErrors.filter((e) => !/Not implemented/.test(String(e)));
}

function domBombOffLayout(app, tag) {
  const bombCard = app.win.document.getElementById('bombTimerCard');
  const btnRow = app.win.document.getElementById('pomoBtnRow');
  const slot = app.win.document.getElementById('bombOffBtnSlot');
  const streakCard = app.win.document.getElementById('streakCard');
  const footer = app.win.document.getElementById('bombOffFooterNote');
  check(tag + '.1 Bomb card REMOVED from the document', bombCard === null, 'null', bombCard ? 'still present' : 'null');
  check(tag + '.2 buttons relocated into the slot under Day Streak', !!btnRow && btnRow.parentNode === slot && btnRow.isConnected, 'slot + connected', btnRow ? String(btnRow.parentNode && btnRow.parentNode.id) : 'missing');
  check(tag + '.3 Day Streak card untouched in its original position', !!streakCard && streakCard.isConnected && streakCard.parentNode && streakCard.parentNode.classList.contains('col-stack'), 'col-stack', streakCard && streakCard.parentNode ? streakCard.parentNode.className : 'missing');
  check(tag + '.4 slot visible', slot.style.display === '', 'visible', slot.style.display);
  check(tag + '.5 footer notice visible', !!footer && footer.style.display === '' && footer.isConnected, 'visible', footer ? footer.style.display : 'missing');
  const footerText = footer ? footer.textContent : '';
  check(tag + '.6 footer text correct', /Bomb Timer Mode Disabled\. Enable from Settings\./.test(footerText), 'exact sentence', footerText);
  check(tag + '.7 footer has a tiny bomb SVG icon', !!footer && !!footer.querySelector('svg'), 'svg', footer ? String(!!footer.querySelector('svg')) : 'missing');
  check(tag + '.8 grid HAS the bomb-off join class (fused L-shape CSS)', app.win.document.getElementById('homeTimerGrid').classList.contains('bomb-off'), 'present', app.win.document.getElementById('homeTimerGrid').className);
}

/* ------------------------------------------------------------------ */
async function bl1_bombOnRendersOriginalLayout() {
  suite('BL1 Bomb ON (default) renders the original layout untouched');
  const app = await boot(); // default settings: bombChallengeMode defaults to true
  domOriginalLayout(app, 'BL1');
  check('BL1.6 no page errors', realPageErrors(app).length === 0, 0, realPageErrors(app).length);
  app.close();
}

/* ------------------------------------------------------------------ */
async function bl2_bombOffRendersLShape() {
  suite('BL2 Bomb OFF renders the L-shape and removes the Bomb card');
  const app = await boot({ bombChallengeMode: false });
  domBombOffLayout(app, 'BL2');
  // The relocated buttons must still work (listeners survive the DOM move).
  await app.click('#btnStart');
  await flushReal(6);
  const st = await app.readState();
  check('BL2.8 moved START button still starts a session', !!(st && st.activeTimer && st.activeTimer.type === 'study'), 'study', st && st.activeTimer ? st.activeTimer.type : 'none');
  check('BL2.9 no page errors', realPageErrors(app).length === 0, 0, realPageErrors(app).length);
  app.close();
}

/* ------------------------------------------------------------------ */
async function bl3_midSessionToggleRestoresExactLayout() {
  suite('BL3 mid-session toggle via the real Settings save flow');
  const app = await boot(); // Bomb ON
  domOriginalLayout(app, 'BL3-ON');

  // Turn Bomb Mode OFF through the REAL settings save path.
  const bombToggle = app.$('#setBombMode');
  bombToggle.checked = false;
  await app.click('#saveSettingsBtn');
  await flushReal(12);
  let st = await app.readState();
  check('BL3.1 bombChallengeMode persisted as false', st && st.settings && st.settings.bombChallengeMode === false, 'false', st && st.settings ? String(st.settings.bombChallengeMode) : 'no state');
  domBombOffLayout(app, 'BL3-OFF');

  // Turn Bomb Mode back ON — the EXACT original structure must come back.
  app.$('#setBombMode').checked = true;
  app.$('#setBomb').value = '20';        // Bomb Duration (minutes) — required when enabling
  app.$('#setDailyFree').value = '1';
  app.$('#setHeartsEvery').value = '4';
  await app.click('#saveSettingsBtn');
  await flushReal(12);
  st = await app.readState();
  check('BL3.2 bombChallengeMode persisted as true again', st && st.settings && st.settings.bombChallengeMode === true, 'true', st && st.settings ? String(st.settings.bombChallengeMode) : 'no state');
  domOriginalLayout(app, 'BL3-RESTORED');
  check('BL3.3 no page errors', realPageErrors(app).length === 0, 0, realPageErrors(app).length);
  app.close();
}

/* ------------------------------------------------------------------ */
async function main() {
  await bl1_bombOnRendersOriginalLayout();
  await bl2_bombOffRendersLShape();
  await bl3_midSessionToggleRestoresExactLayout();

  const pass = results.filter((r) => r.pass).length;
  console.log(`\n==== BOMB-LAYOUT SUMMARY: ${pass}/${results.length} passed, ${results.length - pass} failed ====`);
  for (const r of results.filter((x) => !x.pass)) console.log('FAILED: [' + r.suite + '] ' + r.name + ' expected=' + r.expected + ' actual=' + r.actual);
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
