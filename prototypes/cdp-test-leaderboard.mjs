// The 2.0 leaderboard (www/leaderboard/leaderboard.js) inside the real forges.html,
// with rpc/public_profiles stubbed. Run: node prototypes/cdp-test-leaderboard.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PAGE = 'file:///' + resolve('www/forges.html').replace(/\\/g, '/') + '?beta=on';
const SHOTS = process.env.SHOTS || '.';
const port = 9335;
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
    window.__xss = false;
    const P = (id, name, xp, streak, goals, nn, gym) => ({ user_id: id, username: name, is_private: false, xp, streak, best_streak: streak, goals_done: goals, nonneg_done: nn, longterm_done: 0, interests: [], gym });
    const rows = [
      P('u-alice', 'alice#1111', 16200, 21, 5, 5, { overall: 5, workouts7: 4, ranks: {} }),
      P('u-bob', 'bob#2222', 7400, 3, 2, 3, null),
      P('u-cat', 'cat#3333', 3900, 12, 4, 4, { overall: 3, workouts7: 2, ranks: {} }),
      P('u-me', 'jamie#0001', 3100, 7, 3, 2, { overall: 4, workouts7: 3, ranks: {} }),
      P('u-evil', '<img src=x onerror="window.__xss=true">evil', 2600, 1, 1, 0, null),
      P('u-dan', 'dan#4444', 900, 0, 0, 1, null),
      P('u-eve', 'eve#5555', 450, 2, 1, 1, null),
      P('u-anon', null, 0, 0, 0, 0, null),
    ];
    const json = b => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    window.fetch = url => String(url).includes('/rpc/public_profiles') ? json(rows) : json([]);
    isGuest = false; currentUser = { id: 'u-me', email: 'me@example.com' }; userToken = 'fake-token';
    state = defaultState(); state.onboarded = true; state.xp = 3100;
    state.profile = Object.assign(state.profile || {}, { username: 'jamie#0001' });
    state.friends = [{ userId: 'u-cat', username: 'cat#3333' }, { userId: 'u-dan', username: 'dan#4444' }];
    window.save = () => {};
    hideAuthScreen();
    showPage('leaderboard');
  })()`);
  await sleep(700);
  ok('new leaderboard shown, old layout hidden', await ev(`document.getElementById('lb2-root').style.display === '' && document.getElementById('lb-old-header').style.display === 'none'`));
  ok('podium order 2-1-3 with alice first', (await ev(`[...document.querySelectorAll('.flb .pod-name')].map(e => e.textContent)`)).join() === 'bob#2222,alice#1111,cat#3333');
  ok('you are #4 of 7 (anonymous 0-XP hidden)', /#4of 7/.test(await text('.flb .you-rank')), await text('.flb .you-rank'));
  ok('gap to next player shown', /800 XP behind cat#3333/.test(await text('.flb .you')), await text('.flb .you .small'));
  ok('header belt = Blue (3,100 XP)', /Blue belt/.test(await text('.flb .head-right')));
  ok('evil name shown as text, no script', !(await ev('window.__xss')) && /img srcx/.test(await text('.flb')));
  await shot('lb-1-xp', 1500);

  await ev(`document.querySelector('.flb [data-metric="streak"]').click()`);
  ok('streak tab reorders (cat 12d second)', (await ev(`[...document.querySelectorAll('.flb .pod-name')].map(e => e.textContent)`)).join() === 'cat#3333,alice#1111,You');
  await ev(`document.querySelector('.flb [data-metric="gym"]').click()`);
  ok('gym tab ranks by gym belt', (await ev(`[...document.querySelectorAll('.flb .pod-score')].map(e => e.textContent)`)).join() === 'Blue belt,Purple belt,Green belt');
  await shot('lb-2-gym');
  await ev(`document.querySelector('.flb [data-metric="xp"]').click(); document.querySelector('.flb [data-scope="friends"]').click()`);
  ok('friends scope = you + 2 friends', /3 friends/.test(await text('.flb .sub')) && (await ev(`document.querySelectorAll('.flb .pod:not(.empty)').length`)) === 3);
  await ev(`document.querySelector('.flb [data-scope="all"]').click()`);

  await ev(`document.querySelector('.flb [data-ua="u-bob"]') ? document.querySelector('.flb [data-ua="u-bob"]').click() : document.querySelector('.flb .lb-more').click()`);
  ok('⋯ opens report/block sheet', await ev(`document.getElementById('ua-modal').style.display === 'flex'`));
  await ev(`[...document.querySelectorAll('#ua-modal button')].find(b => /BLOCK/.test(b.textContent)).click()`); await sleep(100);
  await ev(`[...document.querySelectorAll('#ua-modal button')].find(b => b.textContent === 'BLOCK').click()`); await sleep(300);
  const blockedWho = await ev('state.blocked[0] && state.blocked[0].userId');
  ok('blocked player disappears', blockedWho && !(await ev(`!!document.querySelector('.flb [data-ua="${'${blockedWho}'}"], .flb [data-profile="' + state.blocked[0].userId + '"]')`)), blockedWho);
  await ev(`document.querySelector('.flb [data-act="friends"]').click()`); await sleep(200);
  ok('friends & challenges opens the friends panel', await ev(`document.getElementById('friends-panel').style.display === 'block'`));
} catch (e) {
  results.push('ERROR ' + e.message);
} finally {
  console.log(results.join('\n'));
  try { ws && ws.close(); } catch {}
  chrome.kill();
}
