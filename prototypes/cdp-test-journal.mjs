// The 2.0 Journal (www/journal/journal.js) inside the real forges.html, backend stubbed.
// Run: node prototypes/cdp-test-journal.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PAGE = 'file:///' + resolve('www/forges.html').replace(/\\/g, '/') + '?beta=on';
const SHOTS = process.env.SHOTS || '.';
const port = 9338;
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
    state = defaultState(); state.onboarded = true;
    const d = n => { const x = new Date(); x.setDate(x.getDate() - n); return x.toLocaleDateString('en-GB'); };
    state.notes = [
      { id: 3, title: 'Race plan', content: 'Sub-25 5k by December. Three runs a week.', created: d(1) },
      { id: 2, title: '<img src=x onerror="window.__xss=true">', content: '<b>bold?</b> not really', created: d(2) },
      { id: 1, title: 'Why I started Forge', content: 'Because I kept quitting things.', created: d(3) },
      { id: 0, title: 'Old', content: 'long ago', created: '01/01/2026' },
    ];
    window.save = () => { window.__saves = (window.__saves || 0) + 1; };
    hideAuthScreen();
    showPage('journal');
  })()`);
  await sleep(400);
  ok('new journal shown, old hidden', await ev(`document.getElementById('journal2-root').style.display === '' && document.getElementById('page-journal').classList.contains('v2')`));
  ok('header: 4 entries, 3-day streak', /4 entries/.test(await text('.fj .sub')) && /3-day streak/.test(await text('.fj .head-right')), (await text('.fj .fg-head')).replace(/\s+/g, ' '));
  ok('prompt card', /TODAY'S PROMPT/.test(await text('.fj .coach')) && /\?/.test(await text('.fj .coach p')));
  ok('entries listed newest first with Yesterday label', (await ev(`[...document.querySelectorAll('.fj .entry b')].map(b => b.textContent)`))[0] === 'Race plan' && /Yesterday/.test(await text('.fj .entry')));
  ok('HTML in titles/content stays text', !(await ev('!!window.__xss')) && !(await ev(`!!document.querySelector('.fj .entry img, .fj .entry p b')`)));
  await ev(`(() => { const s = document.querySelector('.fj .fj-search'); s.value = 'forge'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(100);
  ok('search matches content + title', (await ev(`document.querySelectorAll('.fj .entry').length`)) === 1 && /Why I started Forge/.test(await text('.fj .entry')));
  await ev(`(() => { const s = document.querySelector('.fj .fj-search'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(100);
  await shot('journal-1', 1200);
  await ev(`document.querySelector('.fj [data-act="prompt"]').click()`); await sleep(150);
  ok('prompt creates an entry titled with the prompt, editor open', await ev(`state.notes.length === 5 && state.notes[0].title.endsWith('?') && !!document.querySelector('.fj .fj-body')`));
  await ev(`(() => { const b = document.querySelector('.fj .fj-body'); b.value = 'I avoided the gym because I was tired. Going first thing tomorrow.'; b.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  ok('word count updates live', (await text('.fj .fj-wc')) === '12', await text('.fj .fj-wc'));
  await sleep(800);
  ok('autosaves while typing', await ev(`state.notes[0].content.startsWith('I avoided the gym')`) && /Saved/.test(await text('.fj .fj-saved')));
  await shot('journal-2');
  await ev(`(() => { const t = document.querySelector('.fj .fj-title'); t.value = 'Gym avoidance'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await ev(`document.querySelector('.fj [data-act="back"]').click()`); await sleep(100);
  ok('back saves title immediately and shows the list', await ev(`state.notes[0].title === 'Gym avoidance' && !!document.querySelector('.fj .entry')`));
  ok('wrote today → streak 4, button says Write another', /4-day streak/.test(await text('.fj .head-right')) && /Write another/.test(await text('.fj .coach')));
  await ev(`document.querySelector('.fj [data-open="3"]').click()`); await sleep(100);
  await ev(`(() => { const b = document.querySelector('.fj .fj-body'); b.value += ' Edited.'; b.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await ev(`showPage('home')`); await sleep(100);
  ok('leaving the page mid-typing still saves', await ev(`state.notes.find(n => n.id === 3).content.endsWith('Edited.')`));
  await ev(`showPage('journal')`); await sleep(100);
  await ev(`document.querySelector('.fj [data-del="3"]').click()`); await sleep(100);
  ok('delete entry', await ev(`!state.notes.some(n => n.id === 3) && !!document.querySelector('.fj .entry')`));
} catch (e) {
  results.push('ERROR ' + e.message);
} finally {
  console.log(results.join('\n'));
  try { ws && ws.close(); } catch {}
  chrome.kill();
}
