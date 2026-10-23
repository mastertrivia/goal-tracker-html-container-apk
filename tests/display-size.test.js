'use strict';
/**
 * Display Size regression suite (v4.11 evidence — 1–10 level picker).
 * Runs the REAL index.html in the jsdom harness and verifies the pre-paint
 * viewport engine (gtDisplaySize), its native persistence contract
 * (getDisplayScale/setDisplayScale), and the Android Shell Settings cell.
 *
 * Contract under test:
 *   - Levels 1..10; level 6 = the app's normal size, restored EXACTLY
 *     (byte-equal stock viewport meta, as if the setting never existed).
 *   - Default level = 2. Each neighbouring level is ~8% apart
 *     (scale(n) = 1.08^(n-6)).
 *   - Every rewritten meta satisfies the browser-zoom invariant
 *     layoutViewport * initialScale ≈ deviceWidth (keeps the responsive
 *     layout overflow-free), with a 280px layout safety floor.
 *   - Legacy 4-size values (xsmall/small/medium/large) migrate to levels.
 *   - The setting never touches app business state.
 */
const { bootApp, wipeDb } = require('./harness');
const { findBy } = require('./bridge-mock');

const results = [];
let currentSuite = '';
function suite(name) { currentSuite = name; console.log('\n=== ' + name + ' ==='); }
function check(name, cond, expected, actual) {
  const pass = !!cond;
  results.push({ suite: currentSuite, name, pass, expected: String(expected), actual: String(actual) });
  console.log((pass ? 'PASS' : 'FAIL') + ' | ' + name + ' | expected=' + expected + ' actual=' + actual);
}

/** The exact pre-v4.11 viewport content — level 6 must restore it byte-for-byte. */
const META_DEFAULT = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
const STEP = 1.08;
const DEFAULT_LEVEL = '2';
const scaleOf = (n) => Math.pow(STEP, n - 6);

function metaOf(app) {
  const m = app.win.document.querySelector('meta[name="viewport"]');
  return m ? m.getAttribute('content') : null;
}
function parseMeta(c) {
  if (!c) return {};
  return {
    width: (c.match(/(?:^|,\s*)width=([\w-]+)/) || [])[1],
    initial: (c.match(/initial-scale=([\d.]+)/) || [])[1],
    maximum: (c.match(/maximum-scale=([\d.]+)/) || [])[1],
    userScalable: /user-scalable=no/.test(c),
    viewportFit: /viewport-fit=cover/.test(c),
  };
}
/** Same device-width resolution the engine uses (kept independent of it). */
function deviceW(win) {
  if (win.screen && win.screen.width) return win.screen.width;
  if (win.visualViewport && win.visualViewport.width) return win.visualViewport.width * (win.visualViewport.scale || 1);
  return win.innerWidth || 360;
}
/** Browser-zoom invariant: layoutWidth * scale ≈ real device width. */
function invariant(app) {
  const p = parseMeta(metaOf(app));
  const dev = deviceW(app.win);
  const init = Number(p.initial);
  const layoutW = p.width === 'device-width' ? dev : Number(p.width);
  return { p, init, layoutW, dev, err: Math.abs(layoutW * init - dev) };
}

async function bootFresh(opts = {}) {
  await wipeDb(); // isolate: fake-IndexedDB is process-global
  return bootApp({ now: new Date(2026, 9, 20, 10, 0, 0).getTime(), ...opts });
}

/* ------------------------------------------------------------------ */
async function ds1_browserDefaultIs2() {
  suite('DS1 plain browser (no bridge): default level 2, meta scaled');
  const app = await bootFresh();
  const { p, init, err } = invariant(app);
  const exp = scaleOf(2);
  check('DS1.1 default level is 2', app.win.gtDisplaySize && app.win.gtDisplaySize.get() === DEFAULT_LEVEL, DEFAULT_LEVEL, app.win.gtDisplaySize && app.win.gtDisplaySize.get());
  check('DS1.2 scale = 1.08^(2-6)', Math.abs(init - exp) < 1e-9, exp, init);
  check('DS1.3 maximum-scale pinned to scale', p.maximum === p.initial, p.initial, p.maximum);
  check('DS1.4 zoom invariant holds', err <= 1.5, '<=1.5', err.toFixed(3));
  check('DS1.5 isNative false without bridge', app.win.gtDisplaySize.isNative() === false, 'false', app.win.gtDisplaySize.isNative());
  app.close();
}

async function ds2_level6IsNormal() {
  suite('DS2 shell reports level 6: exact stock appearance');
  const app = await bootFresh({ bridge: { displayScale: { value: '6' } } });
  check('DS2.1 level 6', app.win.gtDisplaySize.get() === '6', '6', app.win.gtDisplaySize.get());
  check('DS2.2 meta byte-equal to pre-setting default', metaOf(app) === META_DEFAULT, META_DEFAULT, metaOf(app));
  check('DS2.3 scale exactly 1', app.win.gtDisplaySize.scaleOf('6') === 1, '1', app.win.gtDisplaySize.scaleOf('6'));
  app.close();
}

async function ds3_level10() {
  suite('DS3 shell reports level 10: zoom-style viewport rewrite');
  const app = await bootFresh({ bridge: { displayScale: { value: '10' } } });
  const { p, init, err } = invariant(app);
  const exp = scaleOf(10);
  check('DS3.1 level 10', app.win.gtDisplaySize.get() === '10', '10', app.win.gtDisplaySize.get());
  check('DS3.2 scale = 1.08^4', Math.abs(init - exp) < 1e-9, exp, init);
  check('DS3.3 maximum-scale pins to scale (pinch zoom still blocked)', p.maximum === p.initial, p.initial, p.maximum);
  check('DS3.4 user-scalable=no preserved', p.userScalable === true, 'true', p.userScalable);
  check('DS3.5 viewport-fit=cover preserved', p.viewportFit === true, 'true', p.viewportFit);
  check('DS3.6 zoom invariant holds', err <= 1.5, '<=1.5', 'err=' + err.toFixed(3) + ' w=' + p.width);
  app.close();
}

async function ds4_corruptAndLegacy() {
  suite('DS4 corrupt value falls back to default 2; legacy 4-size values migrate');
  const bad = await bootFresh({ bridge: { displayScale: { value: 'gigantic' } } });
  check('DS4.1 corrupt → default level 2', bad.win.gtDisplaySize.get() === DEFAULT_LEVEL, DEFAULT_LEVEL, bad.win.gtDisplaySize.get());
  bad.close();
  for (const [legacy, level] of [['xsmall', '4'], ['small', '6'], ['medium', '7'], ['large', '8']]) {
    const app = await bootFresh({ bridge: { displayScale: { value: legacy } } });
    check('DS4.' + legacy + ' migrates to ' + level, app.win.gtDisplaySize.get() === level, level, app.win.gtDisplaySize.get());
    if (level === '6') check('DS4.' + legacy + ' exact stock meta after migration', metaOf(app) === META_DEFAULT, META_DEFAULT, metaOf(app));
    app.close();
  }
}

async function ds5_setPersistsToBridge() {
  suite('DS5 gtDisplaySize.set(): instant apply + native persistence');
  const displayScale = { value: '2' };
  const app = await bootFresh({ bridge: { displayScale } });
  app.win.gtDisplaySize.set('8');
  const { p, init } = invariant(app);
  check('DS5.1 level switched to 8', app.win.gtDisplaySize.get() === '8', '8', app.win.gtDisplaySize.get());
  check('DS5.2 meta scale = 1.08^2', Math.abs(init - scaleOf(8)) < 1e-9, scaleOf(8), init);
  check('DS5.3 native persist called once', findBy(app.bridge.__calls, 'setDisplayScale', (c) => c[1] === '8').length === 1, '1', findBy(app.bridge.__calls, 'setDisplayScale').length);
  check('DS5.4 native store updated', displayScale.value === '8', '8', displayScale.value);
  let ls = null;
  try { ls = app.win.localStorage.getItem('gt_displaySize'); } catch (e) { ls = 'ERR:' + e.message; }
  check('DS5.5 browser fallback localStorage written', ls === '8', '8', ls);
  app.close();
  return displayScale;
}

async function ds6_reloadRestores(nativeStore) {
  suite('DS6 WebView reload restores the persisted level (native)');
  const app = await bootFresh({ bridge: { displayScale: nativeStore } });
  const { init } = invariant(app);
  check('DS6.1 level restored from native store', app.win.gtDisplaySize.get() === '8', '8', app.win.gtDisplaySize.get());
  check('DS6.2 meta rewritten before first paint', Math.abs(init - scaleOf(8)) < 1e-9, scaleOf(8), init);
  app.close();
}

async function ds7_settingsCell() {
  suite('DS7 Settings → Android Shell Settings → Display Size cell');
  const displayScale = { value: '2' };
  const app = await bootFresh({ bridge: { displayScale } });
  const launcher = app.$('#settingsMain .goal-settings-launch[data-sub="subAndroid"]');
  check('DS7.1 launcher exists', !!launcher, 'element', launcher ? 'element' : 'missing');
  if (launcher) await app.click(launcher);
  const sel = app.$('#andDisplaySize');
  const desc = app.$('#andDisplaySizeDesc');
  check('DS7.2 cell rendered', !!sel && !!desc, 'elements', (sel ? 'select' : '!select') + (desc ? ' desc' : '!desc'));
  check('DS7.3 select offers levels 1–10', sel && sel.options.length === 10, '10', sel && sel.options.length);
  check('DS7.4 select reflects current level', sel && sel.value === '2', '2', sel && sel.value);
  check('DS7.5 description explains level 2', !!desc && /26% smaller than normal/i.test(desc.textContent) && /default/i.test(desc.textContent), '26% smaller + default', desc && desc.textContent);
  // User picks 6: exact normal, description says so.
  sel.value = '6';
  sel.dispatchEvent(new app.win.Event('change', { bubbles: true }));
  check('DS7.6 level 6 → exact stock meta', metaOf(app) === META_DEFAULT, META_DEFAULT, metaOf(app));
  check('DS7.7 description says Normal / as if never existed', !!desc && /Normal: exactly the size/i.test(desc.textContent), 'normal wording', desc && desc.textContent.slice(0, 70));
  // User picks 10: applied instantly, persisted natively.
  sel.value = '10';
  sel.dispatchEvent(new app.win.Event('change', { bubbles: true }));
  check('DS7.8 applied instantly on change', app.win.gtDisplaySize.get() === '10', '10', app.win.gtDisplaySize.get());
  check('DS7.9 persisted via bridge', displayScale.value === '10', '10', displayScale.value);
  check('DS7.10 description shows % larger', !!desc && /36% larger than normal/i.test(desc.textContent), '36% larger', desc && desc.textContent.slice(0, 70));
  const toast = app.$('#toast');
  check('DS7.11 in-app toast shown', !!toast && /display size updated/i.test(toast.textContent) && toast.classList.contains('show'), 'shown', toast ? toast.textContent : 'no #toast');
  app.close();
}

async function ds8_stateUnpolluted() {
  suite('DS8 the setting never touches app business state');
  const app = await bootFresh({ bridge: { displayScale: { value: '2' } } });
  app.win.gtDisplaySize.set('10');
  const st = await app.readState();
  const settingsKeys = st && st.settings ? Object.keys(st.settings).filter((k) => /display|scale/i.test(k)) : ['<no state>'];
  const topKeys = st ? Object.keys(st).filter((k) => /display|scale/i.test(k)) : [];
  check('DS8.1 no display/scale key in state', settingsKeys.length === 0, '[]', JSON.stringify(settingsKeys));
  check('DS8.2 no display/scale key at top level', topKeys.length === 0, '[]', JSON.stringify(topKeys));
  app.close();
}

async function ds9_allTenLevels() {
  suite('DS9 all ten levels produce a valid zoom-style meta');
  for (let n = 1; n <= 10; n++) {
    const app = await bootFresh({ bridge: { displayScale: { value: String(n) } } });
    const { p, init, layoutW, err } = invariant(app);
    const exp = scaleOf(n);
    const ok =
      app.win.gtDisplaySize.get() === String(n) &&
      (n === 6 ? metaOf(app) === META_DEFAULT : true) &&
      Math.abs(init - exp) < 1e-9 && p.maximum === p.initial && p.userScalable &&
      err <= 1.5 && layoutW >= 280;
    check('DS9.level-' + n + ' valid', ok, `scale=${n === 6 ? '1 (stock meta)' : exp.toFixed(4)} err<=1.5 w>=280`,
      `get=${app.win.gtDisplaySize.get()} init=${p.initial} err=${err.toFixed(2)} w=${layoutW} stock=${metaOf(app) === META_DEFAULT}`);
    app.close();
  }
}

async function ds10_stepSpacing() {
  suite('DS10 coherent scale curve: strictly monotonic, ~8% per step, 6 = 1');
  const scales = [];
  for (let n = 1; n <= 10; n++) scales.push(scaleOf(String(n)));
  check('DS10.1 level 6 exactly 1', scales[5] === 1, '1', scales[5]);
  const monotonic = scales.every((s, i) => i === 0 || s > scales[i - 1]);
  check('DS10.2 strictly increasing', monotonic, 'true', monotonic);
  const ratios = scales.slice(1).map((s, i) => s / scales[i]);
  const allSteps = ratios.every((r) => Math.abs(r - STEP) < 1e-9);
  check('DS10.3 every adjacent step = 1.08', allSteps, '1.08 each', ratios.map((r) => r.toFixed(3)).join(','));
  check('DS10.4 widest level span (10/1)', Math.abs(scales[9] / scales[0] - Math.pow(STEP, 9)) < 1e-9, Math.pow(STEP, 9).toFixed(3), (scales[9] / scales[0]).toFixed(3));
}

async function ds11_debugReadout() {
  suite('DS11 temporary on-device debug readout (full scale chain)');
  const displayScale = { value: '5' };
  const app = await bootFresh({ bridge: { displayScale } });
  const launcher = app.$('#settingsMain .goal-settings-launch[data-sub="subAndroid"]');
  if (launcher) await app.click(launcher);
  const box = app.$('#dsDebug');
  check('DS11.1 readout box exists and is visible', !!box && box.style.display !== 'none', 'visible', box ? 'display=' + box.style.display : 'missing');
  const txt = box ? box.textContent : '';
  check('DS11.2 shows level + computed scale', /level=5\s+scale=0\.926/.test(txt), 'level=5 scale=0.926', txt.split('\n')[0]);
  check('DS11.3 shows the written viewport meta', /meta: width=\d+, initial-scale=0\.9259/.test(txt), 'meta width=N, initial-scale=0.9259', (txt.match(/meta: .*/) || [''])[0].slice(0, 70));
  check('DS11.4 shows rendered viewport values', /innerWidth=\d+/.test(txt) && /vv\.scale=/.test(txt), 'innerWidth + vv.scale', (txt.match(/innerWidth=.*$/) || [])[0]);
  check('DS11.5 shows native viewport settings (fix fields)', /native: level=5\s+wideVP=true\s+overview=true\s+textZoom=100/.test(txt), 'native wideVP=true overview=true textZoom=100', (txt.match(/native: .*/) || [''])[0]);
  const sel = app.$('#andDisplaySize');
  sel.value = '3';
  sel.dispatchEvent(new app.win.Event('change', { bubbles: true }));
  check('DS11.6 readout refreshes on level change', /level=3\s+scale=0\.794/.test(box.textContent), 'level=3 scale=0.794', box.textContent.split('\n')[0]);
  app.close();
}

/* ------------------------------------------------------------------ */
async function main() {
  await ds1_browserDefaultIs2();
  await ds2_level6IsNormal();
  await ds3_level10();
  await ds4_corruptAndLegacy();
  const store = await ds5_setPersistsToBridge();
  await ds6_reloadRestores(store);
  await ds7_settingsCell();
  await ds8_stateUnpolluted();
  await ds9_allTenLevels();
  await ds10_stepSpacing();
  await ds11_debugReadout();

  const pass = results.filter((r) => r.pass).length;
  console.log(`\n==== DISPLAY-SIZE SUMMARY: ${pass}/${results.length} passed, ${results.length - pass} failed ====`);
  for (const r of results.filter((x) => !x.pass)) console.log('FAILED: [' + r.suite + '] ' + r.name + ' expected=' + r.expected + ' actual=' + r.actual);
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
