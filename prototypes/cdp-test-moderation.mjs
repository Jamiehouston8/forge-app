// Drives www/forges.html in headless Chrome over the DevTools protocol to test
// report/block and username escaping, with fetch stubbed (no real backend).
// Run: node prototypes/cdp-test-moderation.mjs   (screenshots → $SHOTS or cwd)
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PAGE = 'file:///' + resolve('www/forges.html').replace(/\\/g, '/');
const SHOTS = process.env.SHOTS || '.';
const port = 9333;
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, '--window-size=430,932',
  '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'cdp-')), '--allow-file-access-from-files', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let ws, nextId = 1;
const pending = new Map();
function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
}
const results = [];
const ok = (n, c, x) => results.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  [' + x + ']' : ''));

try {
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch {}
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: PAGE });
  await sleep(2500);

  // Sign in as a fake user and stub the backend.
  await ev(`(() => {
    window.__reports = []; window.__xss = false; window.alert = () => { window.__xss = true; };
    const EVIL = '<img src=x onerror="window.__xss=true">evil#6666';
    const rows = [
      { user_id: 'u-me', username: 'me#0001', is_private: false, xp: 900, streak: 3, best_streak: 5, goals_done: 2, nonneg_done: 1, longterm_done: 0, interests: [] },
      { user_id: 'u-alice', username: 'alice#1111', is_private: false, xp: 5000, streak: 9, best_streak: 9, goals_done: 4, nonneg_done: 2, longterm_done: 1, interests: ['music'] },
      { user_id: 'u-evil', username: EVIL, is_private: false, xp: 3000, streak: 1, best_streak: 1, goals_done: 1, nonneg_done: 0, longterm_done: 0, interests: ['<b>x</b>'] },
      { user_id: 'u-bob', username: 'bob#2222', is_private: false, xp: 400, streak: 0, best_streak: 2, goals_done: 0, nonneg_done: 0, longterm_done: 0, interests: [] },
      { user_id: 'u-cat', username: 'cat#3333', is_private: false, xp: 100, streak: 0, best_streak: 0, goals_done: 0, nonneg_done: 0, longterm_done: 0, interests: [] },
    ];
    const json = (b, s = 200) => Promise.resolve(new Response(b === null ? null : JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } }));
    window.fetch = (url, opt = {}) => {
      url = String(url);
      if (url.includes('/rpc/public_profiles')) {
        const m = url.match(/(user_id|username)=eq\\.([^&]+)/);
        return json(m ? rows.filter(r => String(r[m[1]]) === decodeURIComponent(m[2])) : rows);
      }
      if (url.includes('/rest/v1/reports')) { window.__reports.push(JSON.parse(opt.body)); return json(null, 201); }
      if (url.includes('/rest/v1/notifications')) return json([
        { id: 'n1', type: 'friend_request', from_user_id: 'u-evil', from_username: EVIL, status: 'pending' },
        { id: 'n2', type: '<img src=x onerror="window.__xss=true">', from_user_id: 'u-bob', from_username: 'bob#2222', status: 'pending' },
      ]);
      return json([]);
    };
    isGuest = false; currentUser = { id: 'u-me', email: 'me@example.com' }; userToken = 'fake-token';
    state = defaultState(); state.onboarded = true; state.profile = Object.assign(state.profile || {}, { username: 'me#0001' });
    state.friends = [{ userId: 'u-evil', username: EVIL }, { userId: 'u-alice', username: 'alice#1111' }];
    window.save = () => {};
    hideAuthScreen();
    return true;
  })()`);

  await ev(`showPage('leaderboard')`); await sleep(800);
  const lb = await ev(`document.getElementById('page-leaderboard').innerHTML`);
  ok('leaderboard lists the evil user by a cleaned name', /img srcx onerror/.test(lb) && !/<img src=x/.test(lb));
  ok('no script ran', !(await ev('window.__xss')));
  ok('⋯ buttons on other players', (await ev(`document.querySelectorAll('#page-leaderboard [data-ua-uid]').length`)) === 4);
  ok('no ⋯ on my own entry', !(await ev(`!!document.querySelector('#page-leaderboard [data-ua-uid="u-me"]')`)));
  await shot('mod-1-leaderboard');

  await ev(`document.querySelector('#page-leaderboard [data-ua-uid="u-evil"]').click()`); await sleep(200);
  ok('actions sheet opens', await ev(`document.getElementById('ua-modal').style.display === 'flex'`));
  await shot('mod-2-actions');
  await ev(`[...document.querySelectorAll('#ua-modal button')].find(b => /REPORT/.test(b.textContent)).click()`); await sleep(200);
  await ev(`document.querySelector('input[name="ua-reason"][value="harassment"]').click(); document.getElementById('ua-details').value = 'spams me'`);
  await shot('mod-3-report');
  await ev(`document.getElementById('ua-send').click()`); await sleep(400);
  const rep = await ev('window.__reports[0]');
  ok('report sent with reason + details', rep && rep.reported_user_id === 'u-evil' && rep.reason === 'harassment' && rep.details === 'spams me', JSON.stringify(rep));
  ok('report thanks screen offers block', /REPORT SENT/.test(await ev(`document.getElementById('ua-modal').textContent`)));
  await shot('mod-4-sent');
  await ev(`[...document.querySelectorAll('#ua-modal button')].find(b => /BLOCK/.test(b.textContent)).click()`); await sleep(600);
  ok('blocked user saved', await ev(`state.blocked.length === 1 && state.blocked[0].userId === 'u-evil'`));
  ok('blocked user removed from friends', await ev(`!state.friends.some(f => f.userId === 'u-evil')`));
  ok('blocked user gone from leaderboard', !(await ev(`document.getElementById('page-leaderboard').innerHTML.includes('evil#')`)));
  await shot('mod-5-after-block');

  // friend search finds the blocked user → told they're blocked
  await ev(`document.getElementById('account-friend-search').value = decodeURIComponent('%3Cimg%20src%3Dx%20onerror%3D%22window.__xss%3Dtrue%22%3Eevil%236666'); accountSearchFriend()`); await sleep(400);
  ok('friend search says blocked', /You blocked this user/.test(await ev(`document.getElementById('account-friend-result').textContent`)));

  // notifications: blocked sender hidden, bad type escaped
  await ev(`renderNotifications()`); await sleep(400);
  const notif = await ev(`document.getElementById('notif-list').innerHTML`);
  ok('blocked sender hidden in notifications', !/evil/.test(notif));
  ok('notification type escaped', /&lt;img/.test(notif));
  ok('still no script ran', !(await ev('window.__xss')));

  // account page: blocked list + unblock
  await ev(`showPage('account')`); await sleep(400);
  ok('account lists blocked user', /img srcx/.test(await ev(`document.getElementById('blocked-list').textContent`)));
  await shot('mod-6-account');
  await ev(`[...document.querySelectorAll('#blocked-list button')][0].click()`); await sleep(400);
  ok('unblock works', await ev(`(state.blocked || []).length === 0`));

  // friend profile has the report/block link
  await ev(`openFriendProfile('u-alice', 'alice#1111')`); await sleep(400);
  ok('friend profile has report/block link', await ev(`!!document.querySelector('#friend-profile-content [data-ua-uid="u-alice"]')`));
  ok('friend profile shows XP belt', /Blue Belt/.test(await ev(`document.getElementById('friend-profile-content').textContent`)));
  await ev(`closeFriendProfile()`);

  // username filter
  await ev(`window.__toast = []; const t = toast; toast = (m) => { window.__toast.push(m); }; changeUsername('fuckface')`); await sleep(200);
  ok('offensive username rejected', /isn't allowed/.test((await ev('window.__toast')).join('|')));
} catch (e) {
  results.push('ERROR ' + e.message);
} finally {
  console.log(results.join('\n'));
  try { ws && ws.close(); } catch {}
  chrome.kill();
}
