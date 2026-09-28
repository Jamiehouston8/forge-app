// The 2.0 Calendar (www/calendar/calendar.js) inside the real forges.html, backend stubbed.
// Run: node prototypes/cdp-test-calendar.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PAGE = 'file:///' + resolve('www/forges.html').replace(/\\/g, '/') + '?beta=on';
const SHOTS = process.env.SHOTS || '.';
const port = 9339;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, '--window-size=430,932',
  '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'cdp-')), '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, nextId = 1;
const pending = new Map();
const send = (method, params = {}) => { const id = nextId++; ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => pending.set(id, { res, rej })); };
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function shot(name, h = 932) {
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: h, deviceScaleFactor: 1, mobile: true });
  await sleep(150);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 1, mobile: true });
}
const results = [];
const ok = (n, c, x) => results.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  [' + (typeof x === 'string' ? x : JSON.stringify(x)) + ']' : ''));
const text = sel => ev(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);

try {
  let target;
  for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch {} }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); } });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: PAGE });
  await sleep(2500);

  await ev(`(() => {
    window.fetch = () => Promise.resolve(new Response('[]', { status: 200 }));
    window.confirm = () => true;
    isGuest = false; currentUser = { id: 'u-me', email: 'me@example.com' }; userToken = 'fake-token';
    state = defaultState(); state.onboarded = true; state.xp = 500;
    const ti = getTodayIdx(), other = (ti + 2) % 7;
    window.__ti = ti; window.__other = other;
    const pad = n => String(n).padStart(2, '0');
    const h = new Date().getHours();
    state.idealRoutine = { setup: true, completions: {}, dayActivities: {
      ['day_' + ti]: [
        { id: 11, name: 'Morning run', desc: '5k easy', time: '07:00', colour: 'yellow' },
        { id: 12, name: '<img src=x onerror="window.__xss=true">Deep work', desc: '', time: pad(Math.max(6, h)) + ':30', colour: 'blue' },
        { id: 13, name: 'Read', desc: '', time: '22:00', colour: 'white' },
      ],
      ['day_' + other]: [{ id: 21, name: 'Gym: legs', desc: '', time: '18:00', colour: 'red' }],
    } };
    initSched(); state.schedule[ti][20] = { task: 'Call mum', done: false };
    state.events = [
      { id: 1, name: 'Parkrun', date: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10), note: 'Bring watch' },
      { id: 2, name: 'Old thing', date: '2026-01-01', note: '' },
    ];
    window.save = () => {};
    hideAuthScreen();
    showPage('selfimprove');
  })()`);
  await sleep(400);
  ok('new calendar shown, old hidden', await ev(`document.getElementById('cal2-root').style.display === '' && document.getElementById('page-selfimprove').classList.contains('v2')`));
  ok('today selected in the day strip', await ev(`document.querySelector('.fc .daystrip button.active').dataset.day == window.__ti`));
  const names = await ev(`[...document.querySelectorAll('.fc .slot b')].map(b => b.textContent)`);
  ok('timeline merges activities + hour task, sorted by time', names.length === 4 && names[0] === 'Morning run' && names.includes('Call mum') && names[names.length - 1] === 'Read', names);
  ok('HTML in a name stays text', !(await ev('!!window.__xss')) && !(await ev(`!!document.querySelector('.fc .slot img')`)));
  ok('NOW line shown on today', await ev(`!!document.querySelector('.fc .nowline')`));
  ok('now/next card filled', /NOW/.test(await text('.fc .nowcard')) && /NEXT/.test(await text('.fc .nowcard')));
  await ev(`document.querySelector('.fc [data-tog="act:11"]').click()`); await sleep(100);
  ok('ticking an activity marks it done for today', await ev(`!!state.idealRoutine.completions[new Date().toDateString()][11] && document.querySelector('.fc [data-tog="act:11"]').closest('.slot').classList.contains('done')`));
  const xp0 = await ev('state.xp');
  await ev(`document.querySelector('.fc [data-tog="hour:20"]').click()`); await sleep(100);
  ok('ticking an hour task gives +10 XP like before', (await ev('state.xp')) === xp0 + 10 && await ev('state.schedule[window.__ti][20].done'));
  await shot('cal-1', 1500);

  await ev(`document.querySelector('.fc .daystrip [data-day="' + window.__other + '"]').click()`); await sleep(100);
  ok('switching day shows that day', /Gym: legs/.test(await text('.fc .tl')) && !(await ev(`!!document.querySelector('.fc .nowline')`)));
  await ev(`document.querySelector('.fc [data-act="add"]').click()`); await sleep(100);
  await ev(`document.querySelector('.fc .af-name').value = 'Stretch'; document.querySelector('.fc .af-time').value = '06:45'; document.querySelector('.fc [data-col="blue"]').click(); document.querySelector('.fc [data-act="save"]').click()`); await sleep(100);
  ok('add activity to the viewed day (sorted, colour kept)', await ev(`(() => { const a = state.idealRoutine.dayActivities['day_' + window.__other]; return a[0].name === 'Stretch' && a[0].time === '06:45' && a[0].colour === 'blue'; })()`));
  await ev(`document.querySelector('.fc [data-act="add"]').click()`); await sleep(100);
  await ev(`document.querySelector('.fc .af-name').value = 'Water'; document.querySelector('.fc .af-time').value = '09:00'; document.querySelector('.fc .af-all').checked = true; document.querySelector('.fc [data-act="save"]').click()`); await sleep(100);
  ok('"every day" adds to all 7 days', await ev(`[0,1,2,3,4,5,6].every(d => (state.idealRoutine.dayActivities['day_' + d] || []).some(a => a.name === 'Water'))`));
  await ev(`document.querySelector('.fc [data-rm="act:21"]').click()`); await sleep(100);
  ok('remove activity', await ev(`!state.idealRoutine.dayActivities['day_' + window.__other].some(a => a.id === 21)`));
  await ev(`document.querySelector('.fc [data-act="clear"]').click()`); await sleep(100);
  ok('clear day empties it', await ev(`calItems(window.__other).length === 0`) && /Nothing planned/.test(await text('.fc .tl')));

  ok('events: upcoming with countdown, old ones hidden', /2 days/.test(await text('.fc')) && /Parkrun/.test(await text('.fc')) && !/Old thing/.test(await text('.fc')));
  await ev(`document.querySelector('.fc [data-act="evadd"]').click()`); await sleep(100);
  await ev(`document.querySelector('.fc .ev-name').value = 'Dentist'; document.querySelector('.fc .ev-date').value = new Date().toISOString().slice(0,10); document.querySelector('.fc [data-act="evsave"]').click()`); await sleep(100);
  ok('add event (shows Today)', await ev(`state.events.some(e => e.name === 'Dentist')`) && /Today/.test(await text('.fc .evrow')));
  await ev(`document.querySelector('.fc [data-rmev="1"]').click()`); await sleep(100);
  ok('delete event', await ev(`!state.events.some(e => e.id === 1)`));
  await ev(`showPage('home'); showPage('selfimprove')`); await sleep(100);
  ok('reopening jumps back to today', await ev(`document.querySelector('.fc .daystrip button.active').dataset.day == window.__ti`));
} catch (e) {
  results.push('ERROR ' + e.message);
} finally {
  console.log(results.join('\n'));
  try { ws && ws.close(); } catch {}
  chrome.kill();
}
