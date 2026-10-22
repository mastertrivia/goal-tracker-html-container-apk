'use strict';
const { bootApp, seedState, seedTasks } = require('./harness');
const T0 = new Date(2026, 9, 20, 9, 0, 0).getTime();
(async () => {
  await seedState({
    settings: { wakeHour: 9, telegramEnabled: false, realityCheckEnabled: false, thoughtsEnabled: false, bombDuration: 300, dailyFreeLifelines: 0 },
    lastActiveDate: '2026-10-19', dailyStudyKey: '2026-10-19', hearts: 0,
  });
  await seedTasks([{ category: 'study', name: 'Maths', duration: 1800, icon: 'x', color: '#5B4FE8' }]);
  const app = await bootApp({ now: T0 });
  console.log('after boot, clock.now =', app.now(), 'delta=', app.now() - T0);
  for (let i = 0; i < 5; i++) { await app.advance(1000); console.log('tick', i, 'now delta=', app.now() - T0); }
  const st = await app.readState();
  console.log('activeTimer:', JSON.stringify(st.activeTimer));
  console.log('bombLocked:', st.bombLocked, 'bombDormant:', st.bombDormant, 'wakeAnchorTs:', st.wakeAnchorTs, 'wakeReplayDate:', st.wakeReplayDate);
  console.log('bombRemainingMs:', st.bombRemainingMs, 'lastSeenWall:', st.lastSeenWall, 'hourStreakSecAtDayStart:', st.hourStreakSecAtDayStart);
  console.log('settings.wakeHour:', st.settings.wakeHour, 'dayResetHour:', st.settings.dayResetHour, 'bombDuration:', st.settings.bombDuration);
  console.log('T0 =', T0, 'bootDelta =', app.now() - T0);
  console.log('bombExplodedToday:', st.bombExplodedToday, 'bombLockedTs:', st.bombLockedTs, 'hearts:', st.hearts, '_bombWasTicking:', st._bombWasTicking);
  console.log('timeline:', JSON.stringify(await app.readTimeline()));
  console.log('breach shown:', app.win.document.getElementById('breachScreen').className);
  console.log('LOGS:'); app.logs.slice(0, 40).forEach(l => console.log('  ', l[0], l[1].slice(0, 200)));
  app.close();
})().catch(e => { console.error(e); process.exit(1); });
