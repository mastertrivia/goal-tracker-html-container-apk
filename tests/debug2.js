'use strict';
const { bootApp, seedState, seedTasks, wipeDb, flushReal } = require('./harness');
const T0 = new Date(2026, 9, 20, 9, 0, 0).getTime();
(async () => {
  await wipeDb();
  await seedState({
    settings: { wakeHour: 9, telegramEnabled: false, realityCheckEnabled: false, thoughtsEnabled: false, bombDuration: 300, dailyFreeLifelines: 0 },
    lastActiveDate: '2026-10-19', dailyStudyKey: '2026-10-19', hearts: 0,
  });
  await seedTasks([{ category: 'study', name: 'Maths', duration: 1800, icon: 'x', color: '#5B4FE8' }]);
  let app = await bootApp({ now: T0 });
  let st = await app.readState();
  console.log('after boot  :', '_idleStartTs=', st._idleStartTs, 'activeTimer=', st.activeTimer && st.activeTimer.type);
  await app.click('#btnStart');
  st = await app.readState();
  console.log('after start :', '_idleStartTs=', st._idleStartTs, 'activeTimer=', st.activeTimer && st.activeTimer.type);
  await app.advance(60_000);
  await app.click('#btnStop');
  st = await app.readState();
  console.log('after stop  :', '_idleStartTs=', st._idleStartTs, 'activeTimer=', st.activeTimer && st.activeTimer.type, 'now=', app.now());
  await app.advance(4000); // let a recovery pass run
  st = await app.readState();
  console.log('after +4s   :', '_idleStartTs=', st._idleStartTs, 'activeTimer=', st.activeTimer && st.activeTimer.type);
  app.close();
})().catch(e => { console.error(e); process.exit(1); });
