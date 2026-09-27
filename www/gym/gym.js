// Forge Gym — the gym section of Forge.
//
// A self-contained module: ForgeGym.mount(rootElement, host) renders the whole
// section inside rootElement. `host` connects it to wherever it's running:
//   host.get()              → the gym data object (Forge: state.gym)
//   host.put(data)          → persist it (Forge: state.gym = data; save())
//   host.toast(msg)         → show a short message
//   host.awardXP(n, reason) → optional; Forge adds it to the main XP/level
//   host.dev                → optional; shows prototype tools (demo data)
// Needs exercises.js and bodymap.js loaded first.

const ForgeGym = (function () {
  const XP = { set: 5, pr: 25, finish: 20 };
  const DAY = 86400000;

  let host, root, sheet, G;
  let restTimer = null, clockTimer = null, restEnd = 0, restTotal = 0;
  let tab = 'train', bodyMode = 'rank', selectedMuscle = null, pickerFilter = 'all';

  function fresh() { return { bodyweight: 80, rest: 90, xp: 0, workouts: [], active: null }; }
  function save() { host.put(G); }
  const $ = sel => root.querySelector(sel);

  // ───────── maths ─────────
  const uid = () => Math.random().toString(36).slice(2, 10);
  const round = (n, step) => Math.round(n / step) * step;

  // Estimated one-rep max (Epley). Beyond ~12 reps it's guesswork, so cap it.
  function e1rm(load, reps) {
    if (!load || !reps) return 0;
    const r = Math.min(reps, 12);
    return r === 1 ? load : load * (1 + r / 30);
  }
  function setLoad(exId, set) {
    const ex = EX[exId];
    return (ex && ex.bw ? G.bodyweight : 0) + (Number(set.w) || 0);
  }
  function setE1rm(exId, set) { return e1rm(setLoad(exId, set), Number(set.r) || 0); }

  // Best estimated 1RM across finished workouts (optionally ignoring one).
  function bestE1rm(exId, excludeId) {
    let best = 0, bestSet = null;
    for (const w of G.workouts) {
      if (w.id === excludeId) continue;
      for (const e of w.exercises) {
        if (e.id !== exId) continue;
        for (const s of e.sets) {
          if (!s.done) continue;
          const v = setE1rm(exId, s);
          if (v > best) { best = v; bestSet = s; }
        }
      }
    }
    return { value: best, set: bestSet };
  }

  function beltFor(exId, value) {
    const ex = EX[exId];
    if (!ex || !ex.std || !value) return null;
    const ratio = value / G.bodyweight / ex.std;
    let i = 0;
    while (i + 1 < BELTS.length && ratio >= BELTS[i + 1].at) i++;
    const next = BELTS[i + 1];
    const progress = next ? (ratio - BELTS[i].at) / (next.at - BELTS[i].at) : 1;
    const needE1rm = next ? next.at * ex.std * G.bodyweight : 0;
    return { index: i, belt: BELTS[i], next, progress: Math.max(0, Math.min(1, progress)), ratio, needE1rm };
  }

  // A muscle's rank = its best-ranked lift among exercises that train it as primary.
  function muscleRank(m) {
    let best = null;
    for (const ex of EXERCISES) {
      if (!ex.std || !ex.muscles.p.includes(m)) continue;
      const b = bestE1rm(ex.id);
      if (!b.value) continue;
      const belt = beltFor(ex.id, b.value);
      if (!best || belt.index + belt.progress > best.index + best.progress) {
        best = Object.assign({ exId: ex.id, e1rm: b.value, set: b.set }, belt);
      }
    }
    return best;
  }

  function overallRank() {
    const ranks = Object.keys(MUSCLES).map(muscleRank).filter(Boolean);
    if (!ranks.length) return null;
    const avg = ranks.reduce((a, r) => a + r.index, 0) / ranks.length;
    return { belt: BELTS[Math.floor(avg)], avg, ranked: ranks.length };
  }

  // Sets per muscle in the last 7 days (primary = 1, secondary = 0.5).
  function weeklySets() {
    const since = Date.now() - 7 * DAY, out = {};
    for (const m in MUSCLES) out[m] = 0;
    for (const w of G.workouts) {
      if (w.end < since) continue;
      for (const e of w.exercises) {
        const ex = EX[e.id]; if (!ex) continue;
        const n = e.sets.filter(s => s.done).length;
        ex.muscles.p.forEach(m => out[m] += n);
        ex.muscles.s.forEach(m => out[m] += n * 0.5);
      }
    }
    return out;
  }

  function lastSession(exId, excludeId) {
    for (let i = G.workouts.length - 1; i >= 0; i--) {
      const w = G.workouts[i];
      if (w.id === excludeId) continue;
      const e = w.exercises.find(x => x.id === exId);
      if (e && e.sets.some(s => s.done)) return e.sets.filter(s => s.done);
    }
    return null;
  }

  // Coach: double progression in the 8–12 rep range. Hit 12 on your top set →
  // add weight and drop to 8. Otherwise same weight, one more rep.
  function suggestion(exId) {
    const sets = lastSession(exId);
    if (!sets) return null;
    const top = sets.reduce((a, s) => (setE1rm(exId, s) > setE1rm(exId, a) ? s : a));
    const w = Number(top.w) || 0, r = Number(top.r) || 0;
    const ex = EX[exId];
    const step = /db_|curl|raise|fly|pushdown|face_pull/.test(exId) ? 1 : 2.5;
    if (ex.bw && !w) return { w: 0, r: r + 1, text: `Last time ${r} reps. Aim for ${r + 1}.` };
    if (r >= 12) {
      const nw = round(w + step, step === 1 ? 1 : 2.5);
      return { w: nw, r: 8, text: `You hit 12 reps at ${fmtKg(w)}. Go up to ${fmtKg(nw)} for 8.` };
    }
    return { w, r: r + 1, text: `Last time ${fmtKg(w)} × ${r}. Beat it: ${fmtKg(w)} × ${r + 1}.` };
  }

  function fmtKg(n) { n = Number(n) || 0; return (Math.round(n * 10) / 10) + 'kg'; }
  function fmtDur(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
  }
  function fmtDate(t) { return new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function beltChip(b, label) {
    if (!b) return '<span class="belt"><i style="background:#262626"></i>Unranked</span>';
    const cls = b.name === 'Black' ? ' class="black"' : '';
    return `<span class="belt"><i${cls} style="background:${b.color}"></i>${label || b.name}</span>`;
  }
  function musclesOf(exId) { return EX[exId].muscles.p.map(m => MUSCLES[m]).join(' · '); }

  // ───────── workout actions ─────────
  function startWorkout(tplId) {
    const tpl = TEMPLATES.find(t => t.id === tplId);
    G.active = { id: uid(), name: tpl ? tpl.name : 'Workout', start: Date.now(), exercises: [] };
    if (tpl) tpl.exercises.forEach(id => addExercise(id, true));
    save(); showTab('train');
  }

  function addExercise(exId, quiet) {
    const s = suggestion(exId);
    const sets = [];
    for (let i = 0; i < 3; i++) sets.push({ w: s ? s.w : '', r: s ? s.r : '', done: false });
    G.active.exercises.push({ id: exId, sets });
    if (!quiet) { save(); render(); }
  }

  function toggleSet(ei, si) {
    const ex = G.active.exercises[ei];
    const set = ex.sets[si];
    if (!set.done && (!Number(set.r) || (!EX[ex.id].bw && !Number(set.w)))) { host.toast('Enter weight and reps first'); return; }
    set.done = !set.done;
    set.pr = false;
    if (set.done) {
      // PR = beats every earlier finished workout AND earlier sets this session
      const prev = bestE1rm(ex.id, G.active.id).value;
      const v = setE1rm(ex.id, set);
      const earlier = G.active.exercises.flatMap((e, i) => e.id === ex.id
        ? e.sets.filter((s, j) => s.done && s !== set && (i < ei || j < si)) : []);
      const sessionBest = Math.max(0, ...earlier.map(s => setE1rm(ex.id, s)));
      if (prev > 0 && v > prev && v > sessionBest) { set.pr = true; host.toast('New PR! ' + EX[ex.id].name); }
      startRest();
    }
    save(); render();
  }

  function finishWorkout() {
    const w = G.active;
    const kept = w.exercises.map(e => ({ id: e.id, sets: e.sets.filter(s => s.done) })).filter(e => e.sets.length);
    if (!kept.length) { host.toast('Tick off at least one set first'); return; }
    const before = Object.fromEntries(Object.keys(MUSCLES).map(m => [m, muscleRank(m)]));
    w.exercises = kept;
    w.end = Date.now();
    const sets = kept.reduce((a, e) => a + e.sets.length, 0);
    const prs = kept.reduce((a, e) => a + e.sets.filter(s => s.pr).length, 0);
    w.xp = sets * XP.set + prs * XP.pr + XP.finish;
    G.xp += w.xp;
    G.workouts.push(w);
    G.active = null;
    stopRest();
    save();
    const beltUps = [];
    for (const m in MUSCLES) {
      const a = before[m], b = muscleRank(m);
      if (b && (!a || b.index > a.index)) beltUps.push({ m, belt: b.belt });
    }
    showSummary(w, sets, prs, beltUps);
    render();
    if (host.awardXP) host.awardXP(w.xp, 'Workout complete');
  }

  function discardWorkout() {
    if (!confirm('Discard this workout? Nothing will be saved.')) return;
    G.active = null; stopRest(); save(); render();
  }

  // ───────── rest timer ─────────
  function startRest() {
    restTotal = G.rest * 1000;
    restEnd = Date.now() + restTotal;
    $('.fg-rest').classList.remove('hidden');
    clearInterval(restTimer);
    restTimer = setInterval(tickRest, 250);
    tickRest();
  }
  function tickRest() {
    const left = restEnd - Date.now();
    if (left <= 0) { stopRest(); host.toast('Rest over. Next set!'); if (navigator.vibrate) navigator.vibrate(200); return; }
    $('.fg-rest-time').textContent = fmtDur(left);
    $('.fg-rest-fill').style.width = Math.max(0, left / restTotal * 100) + '%';
  }
  function stopRest() {
    clearInterval(restTimer);
    if (root) $('.fg-rest').classList.add('hidden');
  }

  // ───────── render ─────────
  function render() {
    if (!root) return;
    const o = overallRank();
    $('.fg-rank').innerHTML = beltChip(o && o.belt, o ? o.belt.name + ' belt' : null);
    $('.fg-sub').textContent = `${G.xp.toLocaleString()} gym XP · ${G.workouts.length} workout${G.workouts.length === 1 ? '' : 's'}`;
    root.querySelectorAll('.fg-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    const view = $('.fg-view');
    clearInterval(clockTimer);
    if (tab === 'train') view.innerHTML = trainHTML();
    else if (tab === 'body') view.innerHTML = bodyHTML();
    else if (tab === 'ranks') view.innerHTML = ranksHTML();
    else view.innerHTML = historyHTML();
    if (tab === 'train' && G.active) {
      clockTimer = setInterval(() => {
        const c = $('.wk-time');
        if (c && G.active) c.textContent = fmtDur(Date.now() - G.active.start);
      }, 1000);
    }
  }

  function showTab(name) { tab = name; render(); }

  function trainHTML() {
    if (!G.active) {
      return `${coachCard()}
        <h2>START A WORKOUT</h2>
        <div class="grid2">
          ${TEMPLATES.map(t => `<button class="tpl" data-start="${t.id}"><b>${t.name}</b><span>${t.note}</span></button>`).join('')}
        </div>
        <button class="btn btn-ghost" style="margin-top:10px" data-start="">Start empty workout</button>
        ${G.workouts.length ? '' : `<div class="empty">New here? Pick a template, log your sets,<br/>and your body map and belts fill in as you train.</div>`}`;
    }
    const w = G.active;
    const doneSets = w.exercises.reduce((a, e) => a + e.sets.filter(s => s.done).length, 0);
    const vol = w.exercises.reduce((a, e) => a + e.sets.filter(s => s.done).reduce((b, s) => b + setLoad(e.id, s) * (Number(s.r) || 0), 0), 0);
    return `
      <div class="wk-head"><div class="wk-name">${esc(w.name)}</div><div class="wk-time">${fmtDur(Date.now() - w.start)}</div></div>
      <div class="wk-stats"><span><b>${doneSets}</b> sets</span><span><b>${Math.round(vol).toLocaleString()}</b> kg volume</span><span><b>+${doneSets * XP.set}</b> XP so far</span></div>
      ${w.exercises.map((e, ei) => exerciseCard(e, ei)).join('')}
      <button class="btn btn-ghost" data-act="pick">+ Add exercise</button>
      <button class="btn btn-primary" style="margin-top:18px" data-act="finish">Finish workout</button>
      <button class="btn btn-danger" data-act="discard">Discard</button>`;
  }

  function exerciseCard(e, ei) {
    const ex = EX[e.id];
    const prev = lastSession(e.id, G.active.id) || [];
    const s = suggestion(e.id);
    return `<div class="ex">
      <div class="ex-head">
        <div><div class="ex-name">${esc(ex.name)}</div><div class="ex-musc">${musclesOf(e.id)}${ex.bw ? ' · + bodyweight' : ''}</div></div>
        <button class="ex-x" data-rmex="${ei}" aria-label="Remove">×</button>
      </div>
      ${s ? `<div class="ex-hint">Coach: ${esc(s.text)}</div>` : ''}
      <table class="sets">
        <tr><th>SET</th><th>LAST</th><th>${ex.bw ? '+KG' : 'KG'}</th><th>REPS</th><th></th></tr>
        ${e.sets.map((st, si) => `<tr class="${st.done ? 'done' : ''}">
          <td class="n">${si + 1}${st.pr ? '<span class="pr-tag">PR</span>' : ''}</td>
          <td class="prev">${prev[si] ? (Number(prev[si].w) || 0) + '×' + prev[si].r : '—'}</td>
          <td><input inputmode="decimal" data-in="w" data-e="${ei}" data-s="${si}" value="${st.w}" placeholder="0"/></td>
          <td><input inputmode="numeric" data-in="r" data-e="${ei}" data-s="${si}" value="${st.r}" placeholder="0"/></td>
          <td><button class="chk" data-chk="${ei},${si}" aria-label="Done">✓</button></td>
        </tr>`).join('')}
      </table>
      <button class="add-set" data-addset="${ei}">+ ADD SET</button>
    </div>`;
  }

  function coachCard() {
    if (!G.workouts.length) {
      return `<div class="card coach"><div class="who">COACH</div><p>Log your first workout and I'll start tracking every lift, spotting PRs and telling you exactly what to beat next time.</p></div>`;
    }
    const vol = weeklySets();
    let best = null;
    for (const t of TEMPLATES) {
      const ms = new Set(t.exercises.flatMap(id => EX[id].muscles.p));
      const score = [...ms].reduce((a, m) => a + vol[m], 0) / ms.size;
      if (!best || score < best.score) best = { t, score };
    }
    const neglected = Object.entries(vol).sort((a, b) => a[1] - b[1]).slice(0, 2).map(([m]) => MUSCLES[m].toLowerCase());
    const last = G.workouts[G.workouts.length - 1];
    const daysAgo = Math.max(0, Math.floor((Date.now() - last.end) / DAY));
    return `<div class="card coach"><div class="who">COACH</div>
      <p>${daysAgo === 0 ? 'Good session today.' : daysAgo === 1 ? 'Last workout was yesterday.' : `It's been ${daysAgo} days since your last workout.`}
      Your ${neglected.join(' and ')} have had the least work this week.</p>
      <p>Next up: <b>${best.t.name}</b>. <a href="#" data-start="${best.t.id}" class="link">Start it →</a></p></div>`;
  }

  function bodyHTML() {
    const vol = weeklySets();
    const ranks = Object.fromEntries(Object.keys(MUSCLES).map(m => [m, muscleRank(m)]));
    const fill = m => {
      if (bodyMode === 'rank') { const r = ranks[m]; return r ? (r.belt.name === 'Black' ? '#f5f5f5' : r.belt.color) : null; }
      const v = vol[m];
      if (!v) return null;
      return `rgba(255,140,66,${Math.min(1, 0.25 + v / 16).toFixed(2)})`;
    };
    const legend = bodyMode === 'rank'
      ? BELTS.map(b => `<span><i style="background:${b.name === 'Black' ? '#f5f5f5' : b.color}"></i>${b.name}</span>`).join('')
      : `<span><i style="background:rgba(255,140,66,0.3)"></i>1–4 sets</span><span><i style="background:rgba(255,140,66,0.6)"></i>5–10</span><span><i style="background:rgba(255,140,66,1)"></i>12+ sets / week</span>`;
    let info = '<div class="muted small" style="margin-top:14px;text-align:center">Tap a muscle to see its details.</div>';
    if (selectedMuscle) {
      const r = ranks[selectedMuscle];
      const v = vol[selectedMuscle];
      info = `<div class="card muscle-info">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <b class="mi-name">${MUSCLES[selectedMuscle]}</b>${beltChip(r && r.belt)}</div>
        <div class="small muted" style="margin-top:8px;line-height:1.6">
          ${r ? `Best lift: ${EX[r.exId].name}, est. max ${fmtKg(r.e1rm)}${r.next ? `<br/>${r.next.name} belt at est. max ${fmtKg(r.needE1rm)}` : '<br/>Top rank reached.'}` : 'No ranked lifts yet for this muscle.'}
          <br/>This week: ${v % 1 ? v.toFixed(1) : v} sets
        </div></div>`;
    }
    return `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2 style="margin:0">BODY MAP</h2>
        <div class="seg"><button data-mode="rank" class="${bodyMode === 'rank' ? 'active' : ''}">Rank</button><button data-mode="volume" class="${bodyMode === 'volume' ? 'active' : ''}">This week</button></div>
      </div>
      <div class="maps">
        <figure>${bodySVG('front', fill, { selected: selectedMuscle })}<figcaption>FRONT</figcaption></figure>
        <figure>${bodySVG('back', fill, { selected: selectedMuscle })}<figcaption>BACK</figcaption></figure>
      </div>
      <div class="legend">${legend}</div>
      ${info}`;
  }

  function ranksHTML() {
    const o = overallRank();
    const rows = Object.keys(MUSCLES).map(m => ({ m, r: muscleRank(m) }))
      .sort((a, b) => (b.r ? b.r.index + b.r.progress : -1) - (a.r ? a.r.index + a.r.progress : -1));
    return `
      <div class="card overall">
        <div class="big-belt" style="background:${o ? o.belt.color : '#262626'};${o && o.belt.name === 'Black' ? 'box-shadow:0 0 0 1px #888 inset' : ''}"></div>
        <div><div class="t">${o ? o.belt.name.toUpperCase() + ' BELT' : 'UNRANKED'}</div>
        <div class="small muted" style="margin-top:4px">${o ? `Overall gym rank · ${o.ranked}/${Object.keys(MUSCLES).length} muscles ranked` : 'Log a main lift to earn your first belt.'}</div></div>
      </div>
      <h2>MUSCLE RANKS</h2>
      <div class="card" style="padding:4px 14px">
        ${rows.map(({ m, r }) => `<div class="rank-row">
          <div class="m">${MUSCLES[m]}</div>${beltChip(r && r.belt)}
          <div class="d">${r ? `${EX[r.exId].name} · est. max ${fmtKg(r.e1rm)}${r.next ? ` · ${fmtKg(Math.max(0, r.needE1rm - r.e1rm))} to ${r.next.name}` : ' · top rank'}` : 'No ranked lift yet'}</div>
          <div class="bar"><div style="width:${r ? Math.round(r.progress * 100) : 0}%;background:${r ? (r.next ? r.next.color : r.belt.color) : '#333'}"></div></div>
        </div>`).join('')}
      </div>
      <div class="small muted" style="margin-top:12px;line-height:1.6">Ranks compare your estimated one-rep max to your bodyweight (${fmtKg(G.bodyweight)}). Change it in gym settings ⚙.</div>`;
  }

  function historyHTML() {
    if (!G.workouts.length) return '<div class="empty">No workouts yet.<br/>Finished workouts show up here.</div>';
    return '<h2>HISTORY</h2>' + G.workouts.slice().reverse().map(w => {
      const sets = w.exercises.reduce((a, e) => a + e.sets.length, 0);
      const prs = w.exercises.reduce((a, e) => a + e.sets.filter(s => s.pr).length, 0);
      const vol = w.exercises.reduce((a, e) => a + e.sets.reduce((b, s) => b + setLoad(e.id, s) * s.r, 0), 0);
      return `<div class="card hist" data-hist="${w.id}">
        <div class="hist-top"><div class="hist-name">${esc(w.name)}</div><div class="hist-date">${fmtDate(w.end)}</div></div>
        <div class="hist-meta"><span>${fmtDur(w.end - w.start)}</span><span>${sets} sets</span><span>${Math.round(vol).toLocaleString()} kg</span>${prs ? `<span class="c-pr">${prs} PR${prs > 1 ? 's' : ''}</span>` : ''}<span class="c-xp">+${w.xp} XP</span></div>
        <div class="hist-body hidden">${w.exercises.map(e => `${esc(EX[e.id].name)}: ${e.sets.map(s => `${Number(s.w) || 0}×${s.r}${s.pr ? '★' : ''}`).join(', ')}`).join('<br/>')}</div>
      </div>`;
    }).join('');
  }

  // ───────── sheets (picker / settings / summary) ─────────
  function openSheet(html) { sheet.querySelector('.sheet-inner').innerHTML = html; sheet.classList.remove('hidden'); }
  function closeSheet() { sheet.classList.add('hidden'); }

  function openPicker() {
    openSheet(`<div class="sheet-title">ADD EXERCISE <button data-act="close">✕</button></div>
      <input class="search" placeholder="Search exercises" autocomplete="off"/>
      <div class="chips">${['all', ...Object.keys(MUSCLES)].map(m => `<button data-filter="${m}" class="${pickerFilter === m ? 'active' : ''}">${m === 'all' ? 'All' : MUSCLES[m]}</button>`).join('')}</div>
      <div class="pick-list"></div>`);
    renderPickList();
    sheet.querySelector('.search').addEventListener('input', renderPickList);
  }
  function renderPickList() {
    const q = (sheet.querySelector('.search') || {}).value || '';
    const list = EXERCISES.filter(e => (pickerFilter === 'all' || e.muscles.p.includes(pickerFilter) || e.muscles.s.includes(pickerFilter))
      && e.name.toLowerCase().includes(q.toLowerCase()));
    sheet.querySelector('.pick-list').innerHTML = list.map(e => `<button class="pick" data-pick="${e.id}">
        <div><b>${esc(e.name)}</b><span>${musclesOf(e.id)}</span></div><span>${e.std ? '★ ranked' : ''}</span></button>`).join('')
      || '<div class="empty">No matches.</div>';
  }

  function openSettings() {
    openSheet(`<div class="sheet-title">GYM SETTINGS <button data-act="close">✕</button></div>
      <div class="field"><label>BODYWEIGHT (KG)</label><input class="set-bw" inputmode="decimal" value="${G.bodyweight}"/></div>
      <div class="field"><label>REST TIMER (SECONDS)</label><input class="set-rest" inputmode="numeric" value="${G.rest}"/></div>
      <button class="btn btn-primary" data-act="save-settings">Save</button>
      ${host.dev ? `<h2>PROTOTYPE TOOLS</h2>
      <button class="btn btn-ghost" data-act="demo">Load 5 weeks of demo data</button>
      <button class="btn btn-danger" data-act="reset">Reset all gym data</button>` : ''}`);
  }

  function showSummary(w, sets, prs, beltUps) {
    const vol = w.exercises.reduce((a, e) => a + e.sets.reduce((b, s) => b + setLoad(e.id, s) * s.r, 0), 0);
    openSheet(`<div class="sheet-title">WORKOUT COMPLETE <button data-act="close">✕</button></div>
      <div class="xp-big">+${w.xp} XP</div>
      <div class="small muted" style="text-align:center">${sets} sets × ${XP.set}${prs ? ` · ${prs} PR × ${XP.pr}` : ''} · finish bonus ${XP.finish}</div>
      <div class="sum-grid"><div><b>${fmtDur(w.end - w.start)}</b><span>TIME</span></div><div><b>${sets}</b><span>SETS</span></div><div><b>${Math.round(vol).toLocaleString()}</b><span>KG MOVED</span></div></div>
      ${beltUps.map(b => `<div class="beltup">🥋 <b>${MUSCLES[b.m]}</b> is now ${b.belt.name} belt.</div>`).join('')}
      ${prs ? `<div class="card" style="margin-top:10px">${w.exercises.flatMap(e => e.sets.filter(s => s.pr).map(s => `<div class="small">★ PR · ${esc(EX[e.id].name)} ${Number(s.w) || 0}kg × ${s.r}</div>`)).join('')}</div>` : ''}
      <button class="btn btn-primary" style="margin-top:16px" data-act="close">Done</button>`);
  }

  // Five weeks of push/pull/legs with steady progression (prototype testing only).
  function loadDemo() {
    const now = Date.now();
    const base = { bench: 70, ohp: 42.5, incline_bench: 55, lat_raise: 8, pushdown: 25, deadlift: 120, pullup: 0, row: 60, face_pull: 15, curl: 30, squat: 95, rdl: 80, leg_press: 160, leg_curl: 35, calf_raise: 70 };
    const workouts = [];
    let day = 35, k = 0;
    while (day > 0) {
      const tpl = TEMPLATES[k % 3];
      const week = Math.floor((35 - day) / 7);
      const start = now - day * DAY + 6 * 3600000;
      workouts.push({
        id: uid(), name: tpl.name, start, end: start + 62 * 60000, xp: 0,
        exercises: tpl.exercises.map(id => {
          const w = base[id] + week * (EX[id].bw ? 0 : (/lat_raise|face_pull|curl|pushdown/.test(id) ? 1 : 2.5));
          const reps = EX[id].bw ? 6 + week : 8 + (k % 2);
          return { id, sets: [0, 1, 2].map(i => ({ w, r: Math.max(5, reps - i), done: true, pr: i === 0 && week > 0 && k % 3 === 0 })) };
        }),
      });
      k++; day -= (k % 3 === 0 ? 3 : 2);
    }
    workouts.forEach(w => { w.xp = w.exercises.reduce((a, e) => a + e.sets.length, 0) * XP.set + XP.finish; });
    G = Object.assign(fresh(), { bodyweight: G.bodyweight, rest: G.rest, workouts, xp: workouts.reduce((a, w) => a + w.xp, 0) });
    save(); closeSheet(); render(); host.toast('Demo data loaded');
  }

  // ───────── events ─────────
  function onClick(ev) {
    const t = ev.target.closest('button, a, [data-hist], polygon');
    if (!t) { if (ev.target === sheet) closeSheet(); return; }
    const d = t.dataset;
    if (d.tab) return showTab(d.tab);
    if ('start' in d) { ev.preventDefault(); return startWorkout(d.start); }
    if (d.chk) { const [e, s] = d.chk.split(',').map(Number); return toggleSet(e, s); }
    if (d.addset) {
      const ex = G.active.exercises[+d.addset], last = ex.sets[ex.sets.length - 1];
      ex.sets.push({ w: last ? last.w : '', r: last ? last.r : '', done: false }); save(); return render();
    }
    if (d.rmex) { G.active.exercises.splice(+d.rmex, 1); save(); return render(); }
    if (d.pick) { addExercise(d.pick); closeSheet(); return; }
    if (d.filter) {
      pickerFilter = d.filter;
      sheet.querySelectorAll('.chips button').forEach(b => b.classList.toggle('active', b.dataset.filter === d.filter));
      return renderPickList();
    }
    if (d.mode) { bodyMode = d.mode; return render(); }
    if (d.m) { selectedMuscle = selectedMuscle === d.m ? null : d.m; return render(); }
    if (d.hist) { t.querySelector('.hist-body').classList.toggle('hidden'); return; }
    if (d.rest) {
      if (d.rest === 'skip') return stopRest();
      restEnd += Number(d.rest) * 1000; restTotal = Math.max(restTotal, restEnd - Date.now()); return tickRest();
    }
    switch (d.act) {
      case 'settings': return openSettings();
      case 'pick': return openPicker();
      case 'finish': return finishWorkout();
      case 'discard': return discardWorkout();
      case 'close': return closeSheet();
      case 'demo': return loadDemo();
      case 'reset':
        if (confirm('Delete all gym data?')) { G = fresh(); save(); closeSheet(); render(); }
        return;
      case 'save-settings': {
        const bw = parseFloat(sheet.querySelector('.set-bw').value);
        const rest = parseInt(sheet.querySelector('.set-rest').value, 10);
        if (bw > 25 && bw < 300) G.bodyweight = bw;
        if (rest >= 15 && rest <= 600) G.rest = rest;
        save(); closeSheet(); render(); host.toast('Saved');
      }
    }
  }

  // Typing into a set updates the data without re-rendering (keeps the keyboard up).
  function onInput(ev) {
    const i = ev.target.dataset;
    if (!i.in || !G.active) return;
    G.active.exercises[+i.e].sets[+i.s][i.in] = ev.target.value.replace(',', '.');
    save();
  }

  function mount(el, hostApi) {
    host = hostApi;
    root = el;
    G = Object.assign(fresh(), host.get() || {});
    root.classList.add('fg');
    root.innerHTML = `
      <div class="fg-head">
        <div><div class="brand">GYM</div><div class="sub fg-sub"></div></div>
        <div class="head-right"><div class="fg-rank"></div><button class="icon-btn" data-act="settings" aria-label="Gym settings">⚙</button></div>
      </div>
      <div class="fg-tabs">
        <button data-tab="train">Train</button><button data-tab="body">Body</button><button data-tab="ranks">Ranks</button><button data-tab="history">History</button>
      </div>
      <div class="fg-view"></div>
      <div class="fg-rest hidden">
        <div class="rest-label">REST</div><div class="fg-rest-time rest-time">1:30</div>
        <div class="rest-bar"><div class="fg-rest-fill"></div></div>
        <button data-rest="-15">−15</button><button data-rest="15">+15</button><button data-rest="skip">Skip</button>
      </div>`;
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.className = 'fg fg-sheet hidden';
      sheet.innerHTML = '<div class="sheet-inner"></div>';
      document.body.appendChild(sheet);
      sheet.addEventListener('click', onClick);
      sheet.addEventListener('input', onInput);
    }
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    if (G.active) tab = 'train';
    render();
  }

  // Reload from the host (e.g. after Forge loads the account's data).
  function refresh() { if (!root) return; G = Object.assign(fresh(), host.get() || {}); render(); }

  // One-paragraph summary for the AI mentor's context.
  function mentorSummary() {
    if (!G || !G.workouts.length) return 'No gym workouts logged yet.';
    const last = G.workouts[G.workouts.length - 1];
    const days = Math.max(0, Math.floor((Date.now() - last.end) / DAY));
    const week = G.workouts.filter(w => w.end > Date.now() - 7 * DAY).length;
    const o = overallRank();
    const vol = weeklySets();
    const low = Object.entries(vol).sort((a, b) => a[1] - b[1]).slice(0, 3).map(([m]) => MUSCLES[m]).join(', ');
    const top = Object.keys(MUSCLES).map(m => ({ m, r: muscleRank(m) })).filter(x => x.r)
      .sort((a, b) => b.r.index - a.r.index).slice(0, 3)
      .map(x => `${MUSCLES[x.m]} ${x.r.belt.name} (${EX[x.r.exId].name} est. max ${fmtKg(x.r.e1rm)})`).join('; ');
    return `${G.workouts.length} workouts logged, ${week} in the last 7 days; last one "${last.name}" ${days === 0 ? 'today' : days + ' day(s) ago'}. ` +
      `Overall gym belt: ${o ? o.belt.name : 'unranked'}. Strongest: ${top || 'n/a'}. Least trained this week: ${low}. Bodyweight ${fmtKg(G.bodyweight)}.`;
  }

  return { mount, refresh, mentorSummary, render };
})();
