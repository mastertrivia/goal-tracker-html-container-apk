'use strict';
/**
 * Display Size — REAL rendering diagnostic (root-cause investigation for
 * "levels 1-5 don't shrink on device, 7-10 enlarge fine").
 *
 * jsdom only asserts the meta STRING; it has no layout and ignores the
 * viewport meta entirely. This script loads the real index.html in Chromium
 * with mobile emulation (isMobile honors the viewport meta exactly like
 * Android WebView's renderer) at a 427 CSS-px-wide phone, and measures:
 *   - window.innerWidth / visualViewport.scale  (did the zoom apply?)
 *   - the meta content after the app's 150ms resize re-apply
 *     (is the engine's own resize handler rewriting it?)
 *   - screen.width before/after zoom (is it zoom-aware -> feedback loop?)
 *
 * Three phases:
 *   1. BOOT path: localStorage level set pre-paint, full reload per level.
 *   2. LIVE path: gtDisplaySize.set() without reload (the dropdown's flow).
 *   3. INGREDIENT probe: each meta variant set directly, to isolate which
 *      part of the string the renderer refuses for scale < 1.
 *
 * Exit code 0 = ran; interpretation is by printed table.
 */
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

const APP = pathToFileURL(path.resolve(__dirname, '..', 'app', 'src', 'main', 'assets', 'app', 'index.html')).href;
const W = 427, H = 900;           // baseline phone: deviceCssWidth() ~ 427 CSS px
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7 Pro) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

async function probe(page) {
  return page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 450)); // let the app's 150ms resize debounce settle
    const meta = document.querySelector('meta[name="viewport"]');
    const app = document.querySelector('#app');
    const rect = app ? app.getBoundingClientRect() : null;
    const vv = window.visualViewport;
    const scale = vv ? vv.scale : 1;
    return {
      level: window.gtDisplaySize ? String(window.gtDisplaySize.get()) : '?',
      innerWidth: Math.round(window.innerWidth),
      vvScale: Math.round(scale * 1000) / 1000,
      screenWidth: window.screen ? window.screen.width : null,
      dpr: window.devicePixelRatio,
      appCssW: rect ? Math.round(rect.width) : null,
      appDipH: rect ? Math.round(rect.height * scale) : null, // physical height on screen
      bodyFs: getComputedStyle(document.body).fontSize,
      meta: meta ? meta.getAttribute('content') : null,
    };
  });
}

function row(label, p) {
  console.log(
    `${label.padEnd(26)} | lvl=${String(p.level).padEnd(2)} innerW=${String(p.innerWidth).padEnd(4)} ` +
    `vvScale=${String(p.vvScale).padEnd(6)} screenW=${String(p.screenWidth).padEnd(5)} ` +
    `appCssW=${String(p.appCssW).padEnd(4)} appDipH=${String(p.appDipH).padEnd(5)} bodyFs=${p.bodyFs}`
  );
  console.log(`${' '.repeat(26)} | meta: ${p.meta}`);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: ANDROID_UA,
  });

  console.log('=== PHASE 1: BOOT path (localStorage level set pre-paint, reload) ===');
  for (const lvl of ['8', '5', '4', '1', '7', '9']) {
    const page = await ctx.newPage();
    await page.addInitScript((l) => { try { localStorage.setItem('gt_displaySize', l); localStorage.setItem('gt_displaySizeScheme', '2'); } catch (e) {} }, lvl);
    await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForFunction(() => !!window.gtDisplaySize, null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(600); // fonts / boot
    row(`boot level ${lvl}`, await probe(page));
    await page.close();
  }

  console.log('\n=== PHASE 2: LIVE path (dropdown flow: set() without reload) ===');
  const live = await ctx.newPage();
  await live.addInitScript(() => { try { localStorage.setItem('gt_displaySize', '6'); localStorage.setItem('gt_displaySizeScheme', '2'); } catch (e) {} });
  await live.goto(APP, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await live.waitForFunction(() => !!window.gtDisplaySize, null, { timeout: 10000 }).catch(() => {});
  await live.waitForTimeout(600);
  row('live start', await probe(live));
  for (const lvl of ['6', '5', '4', '3', '2', '1', '7', '9']) {
    await live.evaluate((l) => window.gtDisplaySize.set(l), lvl);
    row(`live set -> ${lvl}`, await probe(live));
  }
  await live.close();

  console.log('\n=== PHASE 1b: v4.12 migration probe (raw v4.11 value, NO scheme marker) ===');
  {
    const page = await ctx.newPage();
    await page.addInitScript(() => { try { localStorage.setItem('gt_displaySize', '3'); localStorage.removeItem('gt_displaySizeScheme'); } catch (e) {} });
    await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForFunction(() => !!window.gtDisplaySize, null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(600);
    row('boot old "3" -> lvl (expect 5)', await probe(page));
    await page.close();
  }

  console.log('\n=== PHASE 3: INGREDIENT probe (raw documents, no app logic) ===');
  const ing = await ctx.newPage();
  const variants = [
    ['shipped shrink  ', 'width=462, initial-scale=0.924, maximum-scale=0.924, user-scalable=no, viewport-fit=cover'],
    ['no max/us      ', 'width=462, initial-scale=0.924'],
    ['drop max<1     ', 'width=462, initial-scale=0.924, maximum-scale=1.0, user-scalable=no'],
    ['device-width   ', 'width=device-width, initial-scale=0.924'],
    ['width only     ', 'width=462'],
    ['initial only   ', 'initial-scale=0.924'],
    ['shipped enlarge', 'width=395, initial-scale=1.08, maximum-scale=1.08, user-scalable=no, viewport-fit=cover'],
    ['stock default  ', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'],
  ];
  for (const [label, content] of variants) {
    await ing.setContent(
      '<!doctype html><html><head><meta name="viewport" content="' + content + '"></head>' +
      '<body style="margin:0"><div style="width:400px;height:600px;background:#adf">probe</div></body></html>'
    );
    await ing.waitForTimeout(350);
    const p = await ing.evaluate(() => ({
      innerWidth: Math.round(window.innerWidth),
      vvScale: Math.round((window.visualViewport ? window.visualViewport.scale : 1) * 1000) / 1000,
      screenWidth: window.screen ? window.screen.width : null,
    }));
    console.log(
      `${label} | innerW=${String(p.innerWidth).padEnd(4)} vvScale=${String(p.vvScale).padEnd(6)} screenW=${String(p.screenWidth)}`
    );
  }
  await ing.close();

  await browser.close();
  console.log('\nDone.');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
