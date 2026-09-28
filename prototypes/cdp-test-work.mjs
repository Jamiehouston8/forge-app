// The 2.0 Work page (www/work/work.js) inside the real forges.html, backend stubbed.
// Run: node prototypes/cdp-test-work.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PAGE = 'file:///' + resolve('www/forges.html').replace(/\\/g, '/') + '?beta=on';
const SHOTS = process.env.SHOTS || '.';
const port = 9337;
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
    state = defaultState(); state.onboarded = true; state.xp = 1000;
    state.hustles = [
      { id: 111, name: 'Forge', income: '10 real users by December', tasks: [{ label: 'Post on r/getdisciplined', done: false }, { label: 'Fix onboarding copy', done: true }, { label: '', done: false }], incomeLogged: 0, xpEarned: 10 },
      { id: 222, name: '<i>Freelance</i>', income: '', tasks: [{ label: 'Invoice client', done: false }], incomeLogged: 120, xpEarned: 0 },
    ];
    window.save = () => {};
    hideAuthScreen();
    showPage('hustles');
  })()`);
  await sleep(400);
  ok('new work page shown, old hidden', await ev(`document.getElementById('work2-root').style.display === '' && document.getElementById('page-hustles').classList.contains('v2')`));
  ok('stats: 2 projects, 1 task done, £120, 10 XP', /2PROJECTS1TASKSDONE£120INCOME10WORKXP/.test((await text('.fw .sum-grid')).replace(/\s+/g, '')), (await text('.fw .sum-grid')).replace(/\s+/g, ''));
  ok('next up = first unticked task', /Post on r\/getdisciplined/.test(await text('.fw .next')));
  ok('project name with HTML stays text', !(await ev(`!!document.querySelector('.fw .pj-title i')`)) && /<i>Freelance<\/i>/.test(await text('.fw')));
  const xp0 = await ev('state.xp');
  await ev(`document.querySelector('.fw .next [data-tog]').click()`); await sleep(150);
  ok('next-up Done ticks it (+10 XP, project XP up)', (await ev('state.xp')) === xp0 + 10 && await ev('state.hustles[0].tasks[0].done && state.hustles[0].xpEarned === 20'));
  ok('next up moves to the next task', /Invoice client/.test(await text('.fw .next')));
  await ev(`(() => { const i = document.querySelector('.fw [data-inc="222"]'); i.value = '49.99'; document.querySelector('.fw [data-log="222"]').click(); })()`); await sleep(100);
  ok('income logged', await ev('state.hustles[1].incomeLogged === 169.99') && /£169.99/.test(await text('.fw .sub')), await text('.fw .sub'));
  await ev(`document.querySelector('.fw [data-addtask="111"]').click()`); await sleep(100);
  await ev(`(() => { const ins = document.querySelectorAll('.fw [data-edit^="111,"]'); const i = ins[ins.length - 1]; i.value = 'Record demo'; i.dispatchEvent(new Event('change', { bubbles: true })); i.blur(); })()`); await sleep(100);
  ok('add + rename task', await ev(`state.hustles[0].tasks.length === 4 && state.hustles[0].tasks[3].label === 'Record demo'`));
  await ev(`document.querySelector('.fw [data-collapse="222"]').click()`); await sleep(100);
  ok('collapse hides tasks', await ev(`state.hustles[1].minimized === true && !document.querySelector('.fw [data-tog^="222,"]')`));
  await shot('work-1', 1400);
  await ev(`document.querySelector('.fw [data-act="new"]').click()`); await sleep(100);
  await ev(`document.querySelector('.fw .np-name').value = 'Etsy shop'; document.querySelector('.fw .np-note').value = '£200/month'; document.querySelector('.fw [data-act="create"]').click()`); await sleep(100);
  ok('new project created with 3 empty tasks', await ev(`state.hustles.length === 3 && state.hustles[2].name === 'Etsy shop' && state.hustles[2].tasks.length === 3`));
  await ev(`document.querySelector('.fw [data-remove="222"]').click()`); await sleep(100);
  ok('delete project', await ev(`state.hustles.length === 2 && !state.hustles.some(h => h.id === 222)`));
  await ev(`state.hustles = []; showPage('hustles')`); await sleep(100);
  ok('empty state shows the new-project form', !!(await ev(`!!document.querySelector('.fw .np-name')`)));
} catch (e) {
  results.push('ERROR ' + e.message);
} finally {
  console.log(results.join('\n'));
  try { ws && ws.close(); } catch {}
  chrome.kill();
}
