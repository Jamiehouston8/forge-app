// The 2.0 Home (www/home/home.js) inside the real forges.html, backend stubbed.
// Run: node prototypes/cdp-test-home.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PAGE = 'file:///' + resolve('www/forges.html').replace(/\\/g, '/') + '?beta=on';
const SHOTS = process.env.SHOTS || '.';
const port = 9336;
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
    const json = b => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    window.fetch = () => json([]);
    isGuest = false; currentUser = { id: 'u-me', email: 'me@example.com' }; userToken = 'fake-token';
    state = defaultState(); state.onboarded = true; state.xp = 3100;
    state.profile = Object.assign(state.profile || {}, { name: 'Jamie', username: 'jamie#0001' });
    state.goals = [{ label: 'Deep work 2h', done: true }, { label: 'Gym: legs', done: false }, { label: '<b>x</b> read 20 pages', done: false }, { label: '', done: false }, { label: '', done: false }];
    state.nonneg = [{ label: 'No phone before 9', done: true }, { label: '3L water', done: true }, { label: '', done: false }, { label: '', done: false }, { label: '', done: false }];
    state.longterm = [{ label: 'Sub-25 5k', done: false }];
    state.streakData = { current: 6, best: 9, lastDate: '', history: [] };
    const d = n => { const x = new Date(); x.setDate(x.getDate() - n); return x.toDateString(); };
    state.goalHistory = [1, 2, 3, 4, 5, 6].map(n => ({ date: d(n), goalsDone: n % 3 === 0 ? 5 : n % 2 ? 3 : 1, goalsTotal: 5, nnDone: 3, nnTotal: 5, xp: 3000 }));
    state.health = { sleep: 7.5, water: 5, steps: null, calories: null };
    state.events = [{ id: 1, name: 'Dentist', date: new Date().toISOString().slice(0, 10), note: '3pm' }, { id: 2, name: 'Parkrun', date: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10), note: '' }];
    window.save = () => {};
    hideAuthScreen();
    showPage('home');
    document.getElementById('debrief-text').textContent = 'Two goals left. Legs first, then read.';
  })()`);
  await sleep(500);
  ok('new home shown, old home hidden', await ev(`document.getElementById('home2-root').style.display === '' && getComputedStyle(document.querySelector('#page-home > div:not(#home2-root):not(#pics-modal):not(#weekly-modal)')).display === 'none'`));
  ok('greeting + level ring', /Good (morning|afternoon|evening), Jamie|Still up, Jamie/.test(await text('.fh .hello')) && /LEVEL/.test(await text('.fh .ring')));
  ok('hero counts: streak 6, goals 1/3, non-neg 2/2', /🔥 6/.test(await text('.fh .hero')) && /1\/3GOALS/.test(await text('.fh .hero')) && /2\/2NON-NEG/.test(await text('.fh .hero')), await text('.fh .hero-stats'));
  ok('brief mirrored from the old element', /Legs first/.test(await text('.fh .fh-brief')));
  await ev(`document.getElementById('debrief-text').textContent = 'Updated brief text.'`); await sleep(100);
  ok('brief updates live', /Updated brief/.test(await text('.fh .fh-brief')));
  ok('goal label with HTML stays text', await ev(`!document.querySelector('.fh .hk-in b') && [...document.querySelectorAll('.fh .hk-in')].some(i => i.value.startsWith('<b>x</b>'))`));
  const xp0 = await ev('state.xp');
  await ev(`document.querySelector('.fh [data-tog="goals,1"]').click()`); await sleep(200);
  ok('ticking a goal awards 10 XP and re-renders', (await ev('state.xp')) === xp0 + 10 && await ev(`state.goals[1].done && document.querySelector('.fh [data-tog="goals,1"]').closest('.hk').classList.contains('done')`), (await ev('state.xp')) - xp0);
  await ev(`(() => { const i = document.querySelector('.fh [data-edit="goals,3"]'); i.focus(); i.value = 'Call mum'; i.dispatchEvent(new Event('change', { bubbles: true })); i.blur(); })()`); await sleep(100);
  ok('editing an empty slot saves the goal', await ev(`state.goals[3].label === 'Call mum'`));
  ok('last-7-days strip, today on the right', await ev(`document.querySelectorAll('.fh .wk').length === 7 && document.querySelectorAll('.fh .wk.today').length === 1`));
  ok('tiles: sleep 7.5h, 1 event today', /7.5h/.test(await text('.fh .tiles')) && /1event today/.test(await text('.fh .tiles')), await text('.fh .tiles'));
  ok('coming up lists both events', /Dentist/.test(await text('.fh')) && /Parkrun/.test(await text('.fh')));
  await shot('home-1', 1900);
  await ev(`document.querySelector('.fh .fh-ask').value = 'hi coach'; window.sendMentorMsg = () => { window.__sent = document.getElementById('mentor-page-input').value; }; document.querySelector('.fh [data-act="ask"]').click()`); await sleep(200);
  ok('mentor reply opens mentor with the message', await ev(`document.getElementById('page-mentor').classList.contains('active') && window.__sent === 'hi coach'`));
  await ev(`showPage('home')`); await sleep(100);
  ok('back to home re-renders', await ev(`document.getElementById('page-home').classList.contains('active') && !!document.querySelector('.fh .hero')`));
} catch (e) {
  results.push('ERROR ' + e.message);
} finally {
  console.log(results.join('\n'));
  try { ws && ws.close(); } catch {}
  chrome.kill();
}
