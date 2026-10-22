'use strict';
/* Smoke test: does the app boot under the harness? */
const { bootApp } = require('./harness');

(async () => {
  const t0 = Date.now();
  const app = await bootApp();
  console.log('boot wall time ms:', Date.now() - t0);
  console.log('body classes:', app.win.document.body.className);
  console.log('streakNum:', app.text('#streakNum'));
  console.log('breakTime:', app.text('#breakTime'));
  console.log('pomoTime:', app.text('#pomoTime'));
  const st = await app.readState();
  console.log('state keys:', st ? Object.keys(st).length : null, 'dailyStudyKey:', st && st.dailyStudyKey, 'bombRemainingMs:', st && st.bombRemainingMs);
  console.log('tasks:', (await app.readTasks()).length);
  console.log('pageErrors:', app.pageErrors.slice(0, 6));
  await app.advance(2000);
  console.log('after 2s advance — breakTime:', app.text('#breakTime'), 'streakNum:', app.text('#streakNum'));
  console.log('pageErrors after advance:', app.pageErrors.slice(0, 6));
  app.close();
})().catch((e) => { console.error('SMOKE FAIL', e); process.exit(1); });
