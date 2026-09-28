// End-to-end test of the mentor agent (www/mentor/agent.js) inside the real
// forges.html, with the Claude proxy replaced by a scripted fake. No API spend.
// Run: node prototypes/cdp-test-agent.mjs   (screenshots → $SHOTS or cwd)
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PAGE = 'file:///' + resolve('www/forges.html').replace(/\\/g, '/') + '?beta=on';
const SHOTS = process.env.SHOTS || '.';
const port = 9334;
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
async function shot(name) { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64')); }
const results = [];
const ok = (n, c, x) => results.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  [' + (typeof x === 'string' ? x : JSON.stringify(x)) + ']' : ''));

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

  // Signed-in fake user with a gym history; the proxy is a scripted fake Claude.
  await ev(`(() => {
    window.__req = [];
    let script = [];
    window.__setScript = s => { script = s.slice(); window.__req = []; };
    const reply = b => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    window.fetch = (url, opt = {}) => {
      url = String(url);
      if (url.includes('claude-proxy')) { window.__req.push(JSON.parse(opt.body)); return reply(script.shift() || { stop_reason: 'end_turn', content: [{ type: 'text', text: '(script ran out)' }] }); }
      return reply([]);
    };
    isGuest = false; currentUser = { id: 'u-me', email: 'me@example.com' }; userToken = 'fake-token';
    state = defaultState(); state.onboarded = true; state.aiConsent = true;
    try { localStorage.setItem('forge_ai_consent', 'yes'); localStorage.setItem('forge_ai_consent', '1'); } catch (e) {}
    state.profile = Object.assign(state.profile || {}, { name: 'Jamie', username: 'jamie#0001', coachStyle: 'Tactical' });
    state.goals[0] = { label: 'Deep work 2h', done: false };
    state.notes = [{ id: 1, title: 'Race plan', content: '<img src=x onerror="window.__xss=true"> Sub-25 5k by December', created: '1/9/2026' }];
    window.save = () => {};
    hideAuthScreen();
    mountGym();
    return BETA_ENABLED && gymMounted;
  })()`);
  ok('beta on and gym mounted', await ev('BETA_ENABLED && gymMounted'));
  await ev(`(() => { const d = 864e5, now = Date.now(); state.gym = { bodyweight: 80, rest: 90, bar: 20, xp: 0, active: null, weights: [], recovery: {}, custom: [], templates: [], workouts: [3, 1].map((ago, i) => ({ id: 'w' + i, name: 'Push', start: now - ago * d, end: now - ago * d + 3600e3, xp: 50, exercises: [{ id: 'bench', sets: [{ w: 60 + i * 2.5, r: 8, done: true }] }] })) }; ForgeGym.refresh(); initSched(); state.schedule[0][18] = { task: 'Football', done: false }; })()`);

  // ── Scenario 1: plan the week (read → parallel writes incl. a clash → reply)
  await ev(`__setScript([
    { stop_reason: 'tool_use', content: [
      { type: 'thinking', thinking: '', signature: 'sig-1' },
      { type: 'text', text: 'Let me look at your week.' },
      { type: 'tool_use', id: 'tu1', name: 'get_week_plan', input: {} } ] },
    { stop_reason: 'tool_use', content: [
      { type: 'thinking', thinking: '', signature: 'sig-2' },
      { type: 'tool_use', id: 'tu2', name: 'schedule_task', input: { day: 'Monday', hour: 18, task: 'Gym: Legs' } },
      { type: 'tool_use', id: 'tu3', name: 'schedule_task', input: { day: 'Wednesday', hour: 7, task: 'Gym: Upper' } },
      { type: 'tool_use', id: 'tu4', name: 'create_gym_plan', input: { name: 'Upper B', exercises: ['bench', 'row', 'ohp', 'not_real'] } } ] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done. **Wednesday 7:00** is your upper session; Monday 18:00 is football so I left it.' }] },
  ])`);
  await ev(`showPage('mentor')`); await sleep(300);
  await ev(`document.getElementById('mentor-page-input').value = 'Plan my gym sessions this week'; sendMentorMsg()`);
  await sleep(1500);
  const req = await ev('window.__req');
  ok('3 API calls for 3 steps', req.length === 3, req.length);
  const r0 = req[0] || {};
  ok('uses claude-opus-5 with adaptive thinking + medium effort', r0.model === 'claude-opus-5' && r0.thinking?.type === 'adaptive' && r0.output_config?.effort === 'medium');
  ok('refusal fallback + automatic caching requested', r0.fallbacks === 'default' && r0.cache_control?.type === 'ephemeral');
  ok('system = cached fixed block + live block', Array.isArray(r0.system) && r0.system.length === 2 && r0.system[0].cache_control?.type === 'ephemeral' && !r0.system[1].cache_control && /TODAY:/.test(r0.system[1].text) && !/TODAY:/.test(r0.system[0].text));
  ok('fixed prompt is identical across steps (cacheable)', req.every(r => r.system[0].text === r0.system[0].text));
  ok('tools include read, write and gym tools', ['get_week_plan', 'schedule_task', 'create_gym_plan', 'get_gym_data'].every(n => (r0.tools || []).some(t => t.name === n)), (r0.tools || []).map(t => t.name));
  ok('tool defs carry no internal fields', (r0.tools || []).every(t => Object.keys(t).sort().join() === 'description,input_schema,name'));
  ok('first message is the user text', r0.messages?.length === 1 && r0.messages[0].role === 'user' && /Plan my gym/.test(r0.messages[0].content));
  const r1 = req[1] || {}, r2 = req[2] || {};
  ok('assistant content (thinking signature) sent back unchanged', JSON.stringify(r1.messages?.[1]?.content || []).includes('sig-1'));
  const wp = r1.messages?.[2]?.content?.[0];
  ok('week plan returned to Claude', wp?.type === 'tool_result' && wp.tool_use_id === 'tu1' && /Football/.test(wp.content), wp && wp.content.slice(0, 120));
  const res2 = r2.messages?.[4]?.content || [];
  ok('parallel results in ONE user message', res2.length === 3 && res2.every(b => b.type === 'tool_result'), res2.length);
  const clash = res2.find(b => b.tool_use_id === 'tu2');
  ok('clash refused, marked is_error', clash?.is_error === true && /already has "Football"/.test(clash.content), clash && clash.content);
  ok('free slot scheduled', await ev(`state.schedule[2][7].task === 'Gym: Upper' && state.schedule[0][18].task === 'Football'`));
  ok('gym template saved, unknown id skipped', await ev(`JSON.parse(JSON.stringify(state.gym.templates[0])).name === 'Upper B' && state.gym.templates[0].exercises.join() === 'bench,row,ohp'`));
  const hist = await ev('state.mentorHistory.map(m => m.role + ":" + m.content.slice(0, 40))');
  ok('history: user, 2 actions, reply (plain text only)', hist.length === 4 && hist[1].startsWith('assistant:[ACTION] Scheduled') && hist[2].includes('Saved "Upper B"') && /Done\./.test(hist[3]), hist);
  const chat = await ev(`document.getElementById('mentor-chat-box').innerHTML`);
  ok('chat shows ✓ action lines and bold reply', /✓ Scheduled Wednesday 7:00/.test(chat) && /<strong>Wednesday 7:00<\/strong>/.test(chat));
  await shot('agent-1-week');

  // ── Scenario 2: notes search result with HTML stays inert; second turn keeps history text-only
  await ev(`__setScript([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'n1', name: 'search_notes', input: { query: 'race' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Your note says: <img src=x onerror="window.__xss=true"> Sub-25 5k by December.' }] },
  ])`);
  await ev(`document.getElementById('mentor-page-input').value = 'What was my race goal?'; sendMentorMsg()`); await sleep(1000);
  const q = await ev('window.__req');
  ok('turn 2 history sent as plain alternating text', q[0].messages.every((m, i) => typeof m.content === 'string' && m.role === (i % 2 ? 'assistant' : 'user')), q[0].messages.map(m => m.role));
  ok('HTML from a note does not run in the chat', !(await ev('!!window.__xss')) && /&lt;img/.test(await ev(`document.getElementById('mentor-chat-box').innerHTML`)));

  // ── Scenario 3: bad input, refusal, API error
  await ev(`__setScript([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'b1', name: 'add_event', input: { name: 'Race' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'What date is the race?' }] },
  ])`);
  await ev(`document.getElementById('mentor-page-input').value = 'Add my race'; sendMentorMsg()`); await sleep(800);
  const b = (await ev('window.__req'))[1].messages.slice(-1)[0].content[0];
  ok('missing required input → is_error result, nothing written', b.is_error === true && /Missing "date"/.test(b.content) && (await ev('(state.events||[]).length')) === 0, b.content);
  await ev(`__setScript([{ stop_reason: 'refusal', content: [], stop_details: { type: 'refusal', category: null } }])`);
  await ev(`document.getElementById('mentor-page-input').value = 'something'; sendMentorMsg()`); await sleep(600);
  ok('refusal handled politely', /can't help with that one/.test(await ev('state.mentorHistory[state.mentorHistory.length-1].content')));
  await ev(`window.fetch = () => Promise.resolve(new Response(JSON.stringify({ error: 'Sign in required' }), { status: 401 }))`);
  await ev(`document.getElementById('mentor-page-input').value = 'hello'; sendMentorMsg()`); await sleep(600);
  ok('API error shown, not thrown', /⚠ Sign in required/.test(await ev(`document.getElementById('mentor-chat-box').textContent`)));
} catch (e) {
  results.push('ERROR ' + e.message);
} finally {
  console.log(results.join('\n'));
  try { ws && ws.close(); } catch {}
  chrome.kill();
}
