// Forge Gym — the gym section of Forge.
//
// A self-contained module: ForgeGym.mount(rootElement, host) renders the whole
// section inside rootElement. `host` connects it to wherever it's running:
//   host.get()              → the gym data object (Forge: state.gym)
//   host.put(data)          → persist it (Forge: state.gym = data; save())
//   host.toast(msg)         → show a short message
//   host.awardXP(n, reason) → optional; Forge adds it to the main XP/level
//   host.dev                → optional; shows prototype tools (demo data)
//   host.share(variants)    → optional; opens share cards (see share/share.js)
//   host.health             → optional { get() → {sleep, water}, set({sleep?, water?}) }
//                             Forge passes its daily state.health so the home
//                             screen and mentor see what's logged in Recovery.
// Needs exercises.js and bodymap.js loaded first.

const ForgeGym = (function () {
  const XP = { set: 5, pr: 25, finish: 20 };
  const DAY = 86400000;

  let host, root, sheet, G;
  let restTimer = null, clockTimer = null, restEnd = 0, restTotal = 0;
  let lastSummary = null;
  let tab = 'train', bodyMode = 'rank', selectedMuscle = null, pickerFilter = 'all', sleepCustomOpen = false;
  let historyMode = 'workouts', editing = null, tplSource = null, newEx = null;

  function fresh() { return { bodyweight: 80, rest: 90, bar: 20, xp: 0, workouts: [], active: null, weights: [], recovery: {}, custom: [], templates: [] }; }
  function save() { host.put(G); }

  // Load from the host, fill in fields older saves don't have, register custom exercises.
  function load() {
    G = Object.assign(fresh(), host.get() || {});
    ['weights', 'custom', 'templates'].forEach(k => { if (!Array.isArray(G[k])) G[k] = []; });
    if (!G.recovery) G.recovery = {};
    syncCustom();
  }
  // Custom exercises live in G.custom and are mirrored into EXERCISES / EX so
  // everything else can treat them like built-in ones. Removed ones that are still
  // in the history stay registered with hidden: true so old workouts still render.
  function syncCustom() {
    for (let i = EXERCISES.length - 1; i >= 0; i--) if (EXERCISES[i].custom) { delete EX[EXERCISES[i].id]; EXERCISES.splice(i, 1); }
    for (const c of G.custom) { const ex = Object.assign({ std: null }, c, { custom: true }); EXERCISES.push(ex); EX[ex.id] = ex; }
  }
  const allTemplates = () => G.templates.concat(TEMPLATES);
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
  function dayKey(t) {
    const d = new Date(t === undefined ? Date.now() : t);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function beltChip(b, label) {
    if (!b) return '<span class="belt"><i style="background:#262626"></i>Unranked</span>';
    const cls = b.name === 'Black' ? ' class="black"' : '';
    return `<span class="belt"><i${cls} style="background:${b.color}"></i>${label || b.name}</span>`;
  }
  function musclesOf(exId) { return EX[exId].muscles.p.map(m => MUSCLES[m]).join(' · '); }

  // ───────── workout actions ─────────
  function startWorkout(tplId) {
    const tpl = allTemplates().find(t => t.id === tplId);
    G.active = { id: uid(), name: tpl ? tpl.name : 'Workout', start: Date.now(), exercises: [] };
    if (tpl) tpl.exercises.filter(id => EX[id]).forEach(id => addExercise(id, true));
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
    lastSummary = { w, sets, prs, beltUps };
    showSummary(w, sets, prs, beltUps);
    render();
    if (host.awardXP) host.awardXP(w.xp, 'Workout complete');
  }

  function discardWorkout() {
    if (!confirm('Discard this workout? Nothing will be saved.')) return;
    G.active = null; stopRest(); save(); render();
  }

  // ───────── editing history ─────────
  // After an edit or delete, PR flags can move (a later set may now be the PR),
  // so re-flag them in date order. XP only changes for the workout that was
  // touched: older workouts keep what they earned (bodyweight lifts' maxes use
  // today's bodyweight, so re-scoring old sessions would shift XP at random).
  function reflagPRs() {
    G.workouts.sort((a, b) => a.end - b.end);
    const best = {};
    for (const w of G.workouts) for (const e of w.exercises) for (const s of e.sets) {
      const v = setE1rm(e.id, s);
      s.pr = best[e.id] > 0 && v > best[e.id];
      best[e.id] = Math.max(best[e.id] || 0, v);
    }
  }
  function workoutXP(w) {
    const sets = w.exercises.reduce((a, e) => a + e.sets.length, 0);
    const prs = w.exercises.reduce((a, e) => a + e.sets.filter(s => s.pr).length, 0);
    return sets * XP.set + prs * XP.pr + XP.finish;
  }
  function applyXPDelta(delta, reason) {
    G.xp = Math.max(0, G.xp + delta);
    save(); render();
    if (delta && host.awardXP) host.awardXP(delta, reason);
  }

  function deleteWorkout(id) {
    const w = G.workouts.find(x => x.id === id);
    if (!w || !confirm(`Delete "${w.name}" from ${fmtDate(w.end)}? Its XP comes off too.`)) return;
    G.workouts = G.workouts.filter(x => x.id !== id);
    reflagPRs();
    applyXPDelta(-(w.xp || 0), 'Workout deleted');
    host.toast('Workout deleted');
  }

  function openEditor(id) {
    const w = G.workouts.find(x => x.id === id);
    if (!w) return;
    editing = JSON.parse(JSON.stringify(w));
    renderEditor();
  }
  function renderEditor() {
    const w = editing;
    openSheet(`<div class="sheet-title">EDIT WORKOUT <button data-act="close">✕</button></div>
      <div class="field"><label>NAME</label><input data-ed="name" value="${esc(w.name)}"/></div>
      <div class="small muted" style="margin:-6px 0 12px">${fmtDate(w.end)} · ${fmtDur(w.end - w.start)}</div>
      ${w.exercises.map((e, ei) => `<div class="ex">
        <div class="ex-head"><div class="ex-name">${esc(EX[e.id].name)}</div><button class="ex-x" data-edrmex="${ei}" aria-label="Remove exercise">×</button></div>
        <table class="sets">
          <tr><th>SET</th><th>${EX[e.id].bw ? '+KG' : 'KG'}</th><th>REPS</th><th></th></tr>
          ${e.sets.map((s, si) => `<tr>
            <td class="n">${si + 1}</td>
            <td><input inputmode="decimal" data-ed="w" data-e="${ei}" data-s="${si}" value="${s.w}" placeholder="0"/></td>
            <td><input inputmode="numeric" data-ed="r" data-e="${ei}" data-s="${si}" value="${s.r}" placeholder="0"/></td>
            <td><button class="chk" data-edrm="${ei},${si}" aria-label="Remove set">×</button></td>
          </tr>`).join('')}
        </table>
        <button class="add-set" data-edadd="${ei}">+ ADD SET</button>
      </div>`).join('')}
      <button class="btn btn-primary" data-act="ed-save">Save changes</button>
      <button class="btn btn-ghost" data-act="close">Cancel</button>`);
  }
  function saveEditor() {
    const w = editing;
    w.name = (w.name || '').trim() || 'Workout';
    w.exercises = w.exercises
      .map(e => ({ id: e.id, sets: e.sets.filter(s => Number(s.r) > 0).map(s => ({ w: s.w === '' ? 0 : s.w, r: Number(s.r), done: true })) }))
      .filter(e => e.sets.length);
    if (!w.exercises.length) { host.toast('No sets left. Use Delete to remove the workout.'); return; }
    const i = G.workouts.findIndex(x => x.id === w.id);
    if (i < 0) return;
    const oldXP = G.workouts[i].xp || 0;
    G.workouts[i] = w;
    reflagPRs();
    w.xp = workoutXP(w);
    editing = null;
    closeSheet();
    applyXPDelta(w.xp - oldXP, 'Workout edited');
    host.toast('Workout saved');
  }

  // ───────── your templates ─────────
  function openSaveTemplate(fromId) {
    const src = fromId ? G.workouts.find(w => w.id === fromId) : G.active;
    if (!src || !src.exercises.length) { host.toast('Add some exercises first'); return; }
    tplSource = [...new Set(src.exercises.map(e => e.id))];
    openSheet(`<div class="sheet-title">SAVE AS TEMPLATE <button data-act="close">✕</button></div>
      <div class="field"><label>TEMPLATE NAME</label><input class="tpl-name" maxlength="30" value="${esc(src.name)}"/></div>
      <div class="small muted" style="margin-bottom:14px;line-height:1.6">${tplSource.map(id => esc(EX[id].name)).join(' · ')}</div>
      <button class="btn btn-primary" data-act="tpl-save">Save template</button>`);
  }
  function saveTemplate() {
    const name = (sheet.querySelector('.tpl-name').value || '').trim();
    if (!name) { host.toast('Give it a name'); return; }
    const ms = [...new Set(tplSource.flatMap(id => EX[id].muscles.p))].slice(0, 3).map(m => MUSCLES[m].toLowerCase());
    G.templates.unshift({ id: 't_' + uid(), name, note: `${tplSource.length} exercises · ${ms.join(' · ')}`, exercises: tplSource });
    save(); closeSheet(); render();
    host.toast('Template saved. Find it under Train.');
  }
  function deleteTemplate(id) {
    const t = G.templates.find(x => x.id === id);
    if (!t || !confirm(`Delete the "${t.name}" template? Past workouts stay.`)) return;
    G.templates = G.templates.filter(x => x.id !== id);
    save(); render();
  }

  // ───────── custom exercises ─────────
  function openNewExercise() {
    newEx = newEx || { name: (sheet.querySelector('.search') || {}).value || '', p: pickerFilter !== 'all' ? pickerFilter : null, bw: false };
    openSheet(`<div class="sheet-title">NEW EXERCISE <button data-act="pick-back">←</button></div>
      <div class="field"><label>NAME</label><input class="nx-name" maxlength="40" placeholder="e.g. Pec Deck" value="${esc(newEx.name)}"/></div>
      <div class="field"><label>MAIN MUSCLE</label>
        <div class="chips wrap">${Object.keys(MUSCLES).map(m => `<button data-nxm="${m}" class="${newEx.p === m ? 'active' : ''}">${MUSCLES[m]}</button>`).join('')}</div></div>
      <div class="field"><label>TYPE</label>
        <div class="seg"><button data-nxbw="0" class="${newEx.bw ? '' : 'active'}">Weights</button><button data-nxbw="1" class="${newEx.bw ? 'active' : ''}">Bodyweight</button></div></div>
      <button class="btn btn-primary" data-act="nx-save">${G.active ? 'Create and add' : 'Create exercise'}</button>
      <div class="small muted" style="margin-top:10px;line-height:1.6">Custom exercises count toward your weekly volume and body map, but don't set a belt rank.</div>`);
  }
  function saveNewExercise() {
    const name = newEx.name.trim();
    if (!name) { host.toast('Give it a name'); return; }
    if (!newEx.p) { host.toast('Pick the main muscle'); return; }
    if (EXERCISES.some(e => !e.hidden && e.name.toLowerCase() === name.toLowerCase())) { host.toast('That exercise already exists'); return; }
    const c = { id: 'c_' + uid(), name, muscles: { p: [newEx.p], s: [] }, bw: newEx.bw };
    G.custom.push(c);
    syncCustom();
    newEx = null;
    if (G.active) { addExercise(c.id); closeSheet(); host.toast(name + ' added'); }
    else { save(); closeSheet(); host.toast('Exercise created'); }
  }
  function removeCustom(id) {
    const c = G.custom.find(x => x.id === id);
    if (!c || !confirm(`Remove "${c.name}"? Past workouts keep it.`)) return;
    const used = G.workouts.some(w => w.exercises.some(e => e.id === id)) || (G.active && G.active.exercises.some(e => e.id === id));
    if (used) c.hidden = true; else G.custom = G.custom.filter(x => x.id !== id);
    G.templates.forEach(t => { t.exercises = t.exercises.filter(x => x !== id); });
    G.templates = G.templates.filter(t => t.exercises.length);
    syncCustom(); save(); openSettings(); render();
  }

  // ───────── lift progress ─────────
  // One point per session: the best set by estimated max. Bodyweight lifts done
  // without added weight track reps instead (an est. max of a plank means nothing).
  function liftSessions(exId) {
    const out = [];
    for (const w of G.workouts) {
      const sets = w.exercises.filter(e => e.id === exId).flatMap(e => e.sets.filter(s => s.done));
      if (!sets.length) continue;
      const top = sets.reduce((a, s) => (setE1rm(exId, s) > setE1rm(exId, a) ? s : a));
      out.push({ t: w.end, top, e1rm: setE1rm(exId, top), reps: Math.max(...sets.map(s => Number(s.r) || 0)), sets: sets.length, pr: sets.some(s => s.pr),
        vol: sets.reduce((a, s) => a + setLoad(exId, s) * (Number(s.r) || 0), 0) });
    }
    return out.sort((a, b) => a.t - b.t);
  }
  const liftMetric = (exId, ss) => EX[exId].bw && ss.every(x => !Number(x.top.w)) ? 'reps' : 'e1rm';
  const setText = (exId, s) => EX[exId].bw && !Number(s.w) ? `${s.r} reps` : `${Number(s.w) || 0}kg × ${s.r}`;

  function lineChart(vals, W, H, opts) {
    opts = opts || {};
    if (vals.length < 2) return '';
    let min = Math.min(...vals), max = Math.max(...vals);
    if (max - min < 1) { min -= 1; max += 1; }
    const pad = opts.dots ? 8 : 3;
    const xy = vals.map((v, i) => [pad + i / (vals.length - 1) * (W - pad * 2), H - pad - (v - min) / (max - min) * (H - pad * 2)]);
    const pts = xy.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ');
    const area = opts.area ? `<polygon points="${xy[0][0].toFixed(1)},${H} ${pts} ${xy[xy.length - 1][0].toFixed(1)},${H}" fill="rgba(124,108,255,0.12)"/>` : '';
    const dots = opts.dots ? xy.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.6" fill="#7c6cff"/>`).join('') : '';
    return `<svg viewBox="0 0 ${W} ${H}" class="${opts.cls || ''}" preserveAspectRatio="none">${area}<polyline points="${pts}" fill="none" stroke="#7c6cff" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>${dots}</svg>`;
  }

  function openLift(exId) {
    const ex = EX[exId];
    if (!ex) return;
    const ss = liftSessions(exId);
    if (!ss.length) {
      openSheet(`<div class="sheet-title">${esc(ex.name.toUpperCase())} <button data-act="close">✕</button></div>
        <div class="empty">No finished sets yet.<br/>Your progress chart starts after your first session.</div>`);
      return;
    }
    const metric = liftMetric(exId, ss);
    const vals = ss.map(x => metric === 'reps' ? x.reps : Math.round(x.e1rm * 10) / 10);
    const fmt = v => metric === 'reps' ? v + ' reps' : fmtKg(v);
    const best = ss.reduce((a, x) => (x.e1rm > a.e1rm ? x : a));
    const first = vals[0], last = vals[vals.length - 1], peak = Math.max(...vals);
    const change = last - first;
    const belt = metric === 'e1rm' ? beltFor(exId, bestE1rm(exId).value) : null;
    openSheet(`<div class="sheet-title">${esc(ex.name.toUpperCase())} <button data-act="close">✕</button></div>
      <div class="small muted" style="margin:-8px 0 12px">${musclesOf(exId)}${ex.custom ? ' · custom' : ''}</div>
      <div class="sum-grid">
        <div><b>${fmt(peak)}</b><span>${metric === 'reps' ? 'BEST REPS' : 'EST. MAX'}</span></div>
        <div><b style="color:${change > 0 ? 'var(--fg-good)' : change < 0 ? 'var(--fg-pr)' : '#fff'}">${change > 0 ? '+' : ''}${metric === 'reps' ? change : fmtKg(change)}</b><span>SINCE FIRST</span></div>
        <div><b>${ss.length}</b><span>SESSIONS</span></div>
      </div>
      <div class="card lift-card">
        <div class="small muted">${metric === 'reps' ? 'Most reps' : 'Estimated one-rep max'} per session</div>
        ${ss.length > 1 ? lineChart(vals, 300, 120, { cls: 'lift-chart', dots: true, area: true }) : '<div class="small muted" style="padding:24px 0;text-align:center">One more session and your chart appears.</div>'}
        <div class="lift-axis"><span>${fmtDate(ss[0].t)}</span><span>${fmtDate(ss[ss.length - 1].t)}</span></div>
      </div>
      <div class="card small" style="line-height:1.7">
        Best set: <b>${setText(exId, best.top)}</b> · ${fmtDate(best.t)}
        ${belt ? `<br/>Belt: ${belt.belt.name}${belt.next ? ` · ${belt.next.name} at est. max ${fmtKg(belt.needE1rm)}` : ' · top rank'}` : ''}
        ${suggestion(exId) ? `<br/><span class="c-xp">Coach: ${esc(suggestion(exId).text)}</span>` : ''}
      </div>
      <h2>RECENT SESSIONS</h2>
      <div class="card" style="padding:4px 14px">${ss.slice(-8).reverse().map(x => `<div class="lift-row">
        <span>${fmtDate(x.t)}</span><span>${setText(exId, x.top)}${x.pr ? ' <span class="c-pr">★</span>' : ''}</span><span class="muted">${x.sets} set${x.sets > 1 ? 's' : ''}</span></div>`).join('')}</div>`);
  }

  function liftsHTML() {
    const ids = [...new Set(G.workouts.flatMap(w => w.exercises.map(e => e.id)))].filter(id => EX[id]);
    if (!ids.length) return '<div class="empty">No lifts yet.</div>';
    const rows = ids.map(id => ({ id, ss: liftSessions(id) })).filter(r => r.ss.length)
      .sort((a, b) => b.ss[b.ss.length - 1].t - a.ss[a.ss.length - 1].t);
    return `<div class="card" style="padding:4px 14px">${rows.map(({ id, ss }) => {
      const metric = liftMetric(id, ss);
      const vals = ss.slice(-10).map(x => metric === 'reps' ? x.reps : x.e1rm);
      const peak = Math.max(...ss.map(x => metric === 'reps' ? x.reps : x.e1rm));
      return `<button class="lift-item" data-lift="${id}">
        <div><b>${esc(EX[id].name)}</b><span>${ss.length} session${ss.length > 1 ? 's' : ''} · ${metric === 'reps' ? peak + ' reps best' : 'est. max ' + fmtKg(peak)}</span></div>
        ${lineChart(vals, 70, 26, { cls: 'spark' })}</button>`;
    }).join('')}</div>`;
  }

  // ───────── plate calculator ─────────
  const PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];
  const PLATE_COLORS = { 25: '#e0453a', 20: '#3b7ddd', 15: '#e8c33a', 10: '#3ba55c', 5: '#eeeeee', 2.5: '#555555', 1.25: '#999999' };
  function platesFor(total, bar) {
    let side = (total - bar) / 2;
    const out = [];
    if (side < 0) return { out, left: side };
    for (const p of PLATES) while (side >= p - 1e-9) { out.push(p); side -= p; }
    return { out, left: Math.round(side * 100) / 100 };
  }
  function openPlates(kg) {
    openSheet(`<div class="sheet-title">PLATE CALCULATOR <button data-act="close">✕</button></div>
      <div class="field"><label>TOTAL WEIGHT (KG)</label><input class="plate-in" inputmode="decimal" value="${kg || ''}" placeholder="e.g. 100"/></div>
      <div class="field"><label>BAR</label><div class="seg">${[20, 15, 10].map(b => `<button data-bar="${b}" class="${G.bar === b ? 'active' : ''}">${b}kg</button>`).join('')}</div></div>
      <div class="plate-out"></div>`);
    renderPlates();
  }
  function renderPlates() {
    const out = sheet.querySelector('.plate-out');
    if (!out) return;
    const kg = parseFloat((sheet.querySelector('.plate-in').value || '').replace(',', '.'));
    if (!(kg > 0)) { out.innerHTML = '<div class="small muted">Enter a weight to see what goes on each side.</div>'; return; }
    const r = platesFor(kg, G.bar);
    if (r.left < 0) { out.innerHTML = `<div class="small muted">That's less than the ${G.bar}kg bar.</div>`; return; }
    const loaded = G.bar + 2 * r.out.reduce((a, p) => a + p, 0);
    out.innerHTML = `<div class="card">
      <div class="small muted">EACH SIDE</div>
      <div class="plate-bar">${r.out.length ? r.out.map(p => `<i style="height:${40 + p * 2.4}px;background:${PLATE_COLORS[p]}" title="${p}kg"></i>`).join('') : '<span class="small muted">Just the bar.</span>'}<b></b></div>
      <div class="plate-list">${r.out.length ? Object.entries(r.out.reduce((a, p) => (a[p] = (a[p] || 0) + 1, a), {})).sort((a, b) => b[0] - a[0]).map(([p, n]) => `<span>${n} × ${p}kg</span>`).join('') : ''}</div>
      ${r.left > 0 ? `<div class="small c-pr" style="margin-top:8px">Can't make ${fmtKg(kg)} exactly with standard plates. Closest: ${fmtKg(loaded)}.</div>` : ''}
    </div>`;
  }

  // ───────── recovery (sleep, water, bodyweight) ─────────
  const WATER_GOAL = 8;
  function todayRecovery() {
    const k = dayKey();
    const r = Object.assign({ sleep: null, water: 0 }, G.recovery[k] || {});
    if (host.health) {
      const h = host.health.get() || {};
      if (h.sleep) r.sleep = h.sleep;
      if (h.water) r.water = h.water;
    }
    return r;
  }
  function setRecovery(patch) {
    const k = dayKey();
    G.recovery[k] = Object.assign(todayRecovery(), patch);
    // keep ~120 days of history
    const keys = Object.keys(G.recovery).sort();
    while (keys.length > 120) delete G.recovery[keys.shift()];
    save();
    if (host.health) host.health.set(patch);
    render();
  }
  function logWeight(kg) {
    const k = dayKey();
    G.weights = (G.weights || []).filter(w => w.date !== k);
    G.weights.push({ date: k, kg });
    G.weights.sort((a, b) => a.date < b.date ? -1 : 1);
    G.bodyweight = kg;
    save(); render();
    host.toast('Bodyweight logged. Belt ranks updated.');
  }
  function sleepAvg(days) {
    const vals = [];
    for (let i = 0; i < days; i++) {
      const r = G.recovery[dayKey(Date.now() - i * DAY)];
      if (r && r.sleep) vals.push(r.sleep);
    }
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
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
    else if (tab === 'recovery') view.innerHTML = recoveryHTML();
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
        ${G.templates.length ? `<h2>YOUR TEMPLATES</h2>
        <div class="grid2">
          ${G.templates.map(t => `<div class="tpl-wrap"><button class="tpl" data-start="${t.id}"><b>${esc(t.name)}</b><span>${esc(t.note)}</span></button><button class="tpl-x" data-deltpl="${t.id}" aria-label="Delete template">×</button></div>`).join('')}
        </div>` : ''}
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
      ${w.exercises.length ? '<button class="btn btn-ghost" data-act="save-tpl">Save as template</button>' : ''}
      <button class="btn btn-danger" data-act="discard">Discard</button>`;
  }

  function exerciseCard(e, ei) {
    const ex = EX[e.id];
    const prev = lastSession(e.id, G.active.id) || [];
    const s = suggestion(e.id);
    return `<div class="ex">
      <div class="ex-head">
        <button class="ex-title" data-lift="${e.id}"><div class="ex-name">${esc(ex.name)} <span class="ex-more">›</span></div><div class="ex-musc">${musclesOf(e.id)}${ex.bw ? ' · + bodyweight' : ''}</div></button>
        <div class="ex-tools">${ex.bb ? `<button class="ex-plates" data-plates="${ei}">Plates</button>` : ''}<button class="ex-x" data-rmex="${ei}" aria-label="Remove">×</button></div>
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
        ${rows.map(({ m, r }) => `<div class="rank-row"${r ? ` data-lift="${r.exId}"` : ''}>
          <div class="m">${MUSCLES[m]}</div>${beltChip(r && r.belt)}
          <div class="d">${r ? `${EX[r.exId].name} · est. max ${fmtKg(r.e1rm)}${r.next ? ` · ${fmtKg(Math.max(0, r.needE1rm - r.e1rm))} to ${r.next.name}` : ' · top rank'}` : 'No ranked lift yet'}</div>
          <div class="bar"><div style="width:${r ? Math.round(r.progress * 100) : 0}%;background:${r ? (r.next ? r.next.color : r.belt.color) : '#333'}"></div></div>
        </div>`).join('')}
      </div>
      ${host.share && o ? '<button class="btn btn-ghost" style="margin-top:12px" data-act="share-ranks">Share my rank ↗</button>' : ''}
      <div class="small muted" style="margin-top:12px;line-height:1.6">Ranks compare your estimated one-rep max to your bodyweight (${fmtKg(G.bodyweight)}). Change it in gym settings ⚙.</div>`;
  }

  function recoveryHTML() {
    const today = todayRecovery();
    const avg = sleepAvg(7);
    // last 7 nights, oldest first
    const nights = [];
    for (let i = 6; i >= 0; i--) {
      const t = Date.now() - i * DAY, r = G.recovery[dayKey(t)];
      nights.push({ label: new Date(t).toLocaleDateString('en-GB', { weekday: 'narrow' }), h: (i === 0 ? today.sleep : r && r.sleep) || 0 });
    }
    const ws = G.weights || [];
    const cur = ws.length ? ws[ws.length - 1] : null;
    const monthAgo = ws.filter(w => w.date <= dayKey(Date.now() - 28 * DAY)).pop();
    const change = cur && monthAgo ? cur.kg - monthAgo.kg : null;
    let tip;
    if (avg !== null && avg < 7) tip = `You're averaging ${avg.toFixed(1)}h of sleep. Under 7 hours slows strength gains and recovery. An earlier night is the cheapest PR you'll get.`;
    else if (today.water < 4 && new Date().getHours() >= 14) tip = `Only ${today.water} glass${today.water === 1 ? '' : 'es'} of water so far today. Get two down before your next session.`;
    else if (!cur) tip = 'Log your bodyweight. Your belt ranks are measured against it, so it keeps them accurate.';
    else tip = 'Recovery is where the gains happen. Keep sleep at 7+ hours and hit your water every day.';
    const changeTxt = change === null
      ? (cur ? 'Logged ' + fmtDate(new Date(cur.date + 'T12:00:00').getTime()) : 'Not logged yet')
      : `${change > 0 ? '+' : ''}${change.toFixed(1)}kg in 4 weeks`;
    const changeStyle = change === null ? '' : `color:${change > 0 ? 'var(--fg-pr)' : 'var(--fg-good)'}`;
    return `
      <div class="card coach"><div class="who">COACH</div><p>${esc(tip)}</p></div>

      <h2>SLEEP LAST NIGHT</h2>
      <div class="card">
        <div class="pills">${[5, 6, 7, 8, 9].map(h => `<button data-sleep="${h}" class="${today.sleep === h ? 'active' : ''}">${h}h</button>`).join('')}${(() => {
          const custom = today.sleep && ![5, 6, 7, 8, 9].includes(today.sleep);
          return `<button data-act="sleep-custom" class="${custom || sleepCustomOpen ? 'active' : ''}">${custom ? today.sleep + 'h' : 'Custom'}</button>`;
        })()}</div>
        ${sleepCustomOpen ? `<div class="bw-log" style="margin-top:10px"><input class="sleep-in" inputmode="decimal" placeholder="Hours slept, e.g. 7.5" value="${today.sleep && ![5, 6, 7, 8, 9].includes(today.sleep) ? today.sleep : ''}"/><button class="btn btn-primary" data-act="sleep-save">Save</button></div>` : ''}
        <div class="sleep-bars">${nights.map(n => `<div><i style="height:${Math.min(100, n.h / 10 * 100)}%;background:${n.h >= 7 ? 'var(--fg-good)' : n.h ? 'var(--fg-pr)' : 'transparent'}"></i><span>${n.label}</span></div>`).join('')}</div>
        <div class="small muted">${avg !== null ? `7-day average <b style="color:#fff">${avg.toFixed(1)}h</b> · aim for 7–9h` : 'Tap your hours each morning to build your sleep history.'}</div>
      </div>

      <h2>WATER TODAY</h2>
      <div class="card water">
        <button data-water="-1" aria-label="One less glass">−</button>
        <div><div class="water-n">${today.water} <span>/ ${WATER_GOAL} glasses</span></div>
          <div class="bar" style="margin-top:8px"><div style="width:${Math.min(100, today.water / WATER_GOAL * 100)}%;background:#4d9fff"></div></div></div>
        <button data-water="1" aria-label="One more glass">+</button>
      </div>

      <h2>BODYWEIGHT</h2>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <div class="bw-now">${fmtKg(G.bodyweight)}</div>
          <div class="small${change === null ? ' muted' : ''}" style="${changeStyle}">${changeTxt}</div>
        </div>
        ${weightChart(ws)}
        <div class="bw-log"><input class="bw-in" inputmode="decimal" placeholder="Today's weight (kg)"/><button class="btn btn-primary" data-act="log-weight">Log</button></div>
        <div class="small muted" style="margin-top:8px">Weigh in once a week, same time of day. Your belt ranks use this.</div>
      </div>`;
  }

  function weightChart(ws) {
    const pts = ws.slice(-16);
    if (pts.length < 2) return '';
    const min = Math.min(...pts.map(p => p.kg)) - 0.5, max = Math.max(...pts.map(p => p.kg)) + 0.5;
    const W = 300, H = 90;
    const xy = pts.map((p, i) => [i / (pts.length - 1) * (W - 12) + 6, H - 8 - (p.kg - min) / (max - min) * (H - 16)]);
    return `<svg viewBox="0 0 ${W} ${H}" class="bw-chart" preserveAspectRatio="none">
      <polyline points="${xy.map(p => p.join(',')).join(' ')}" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    </svg>`;
  }

  function historyHTML() {
    if (!G.workouts.length) return '<div class="empty">No workouts yet.<br/>Finished workouts show up here.</div>';
    const head = `<div style="display:flex;justify-content:space-between;align-items:center;margin:4px 0 12px">
        <h2 style="margin:0">HISTORY</h2>
        <div class="seg"><button data-hmode="workouts" class="${historyMode === 'workouts' ? 'active' : ''}">Workouts</button><button data-hmode="lifts" class="${historyMode === 'lifts' ? 'active' : ''}">Lifts</button></div>
      </div>`;
    if (historyMode === 'lifts') return head + liftsHTML();
    return head + G.workouts.slice().reverse().map(w => {
      const sets = w.exercises.reduce((a, e) => a + e.sets.length, 0);
      const prs = w.exercises.reduce((a, e) => a + e.sets.filter(s => s.pr).length, 0);
      const vol = w.exercises.reduce((a, e) => a + e.sets.reduce((b, s) => b + setLoad(e.id, s) * s.r, 0), 0);
      return `<div class="card hist" data-hist="${w.id}">
        <div class="hist-top"><div class="hist-name">${esc(w.name)}</div><div class="hist-date">${fmtDate(w.end)}</div></div>
        <div class="hist-meta"><span>${fmtDur(w.end - w.start)}</span><span>${sets} sets</span><span>${Math.round(vol).toLocaleString()} kg</span>${prs ? `<span class="c-pr">${prs} PR${prs > 1 ? 's' : ''}</span>` : ''}<span class="c-xp">+${w.xp} XP</span></div>
        <div class="hist-body hidden">${w.exercises.map(e => `<a href="#" class="hist-lift" data-lift="${e.id}">${esc(EX[e.id].name)}</a>: ${e.sets.map(s => `${Number(s.w) || 0}×${s.r}${s.pr ? '★' : ''}`).join(', ')}`).join('<br/>')}
          <div class="hist-actions"><button data-edit="${w.id}">Edit</button><button data-tplfrom="${w.id}">Save as template</button><button class="del" data-delw="${w.id}">Delete</button></div></div>
      </div>`;
    }).join('');
  }

  // ───────── share cards ─────────
  function shareWorkout() {
    if (!host.share || !lastSummary) return;
    const { w, sets, prs, beltUps } = lastSummary;
    const variants = [];
    for (const b of beltUps) {
      const r = muscleRank(b.m);
      variants.push({ type: 'belt', label: MUSCLES[b.m] + ' belt', data: { muscle: b.m, muscleName: MUSCLES[b.m], belt: b.belt, lift: r ? EX[r.exId].name : '', e1rm: r ? r.e1rm : 0 } });
    }
    for (const e of w.exercises) {
      for (const s of e.sets.filter(x => x.pr).slice(0, 1)) {
        const v = setE1rm(e.id, s);
        const b = beltFor(e.id, v);
        variants.push({ type: 'pr', label: 'PR · ' + EX[e.id].name, data: { exercise: EX[e.id].name, weight: Number(s.w) || 0, reps: Number(s.r) || 0, bw: !!EX[e.id].bw, e1rm: v, belt: b ? b.belt : null } });
      }
    }
    const vol = w.exercises.reduce((a, e) => a + e.sets.reduce((b, s) => b + setLoad(e.id, s) * s.r, 0), 0);
    variants.push({ type: 'workout', label: 'Workout', data: {
      name: w.name, date: new Date(w.end).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
      ms: w.end - w.start, sets, volume: vol, xp: w.xp, prs,
      lifts: w.exercises.map(e => {
        const top = e.sets.reduce((a, s) => (setE1rm(e.id, s) > setE1rm(e.id, a) ? s : a));
        return { name: EX[e.id].name, best: (EX[e.id].bw && !Number(top.w) ? '' : (Number(top.w) || 0) + 'kg × ') + top.r + (EX[e.id].bw && !Number(top.w) ? ' reps' : ''), pr: e.sets.some(s => s.pr) };
      }),
    } });
    host.share(variants);
  }
  function shareRanks() {
    if (!host.share) return;
    const o = overallRank();
    const colors = {};
    for (const m of Object.keys(MUSCLES)) { const r = muscleRank(m); if (r) colors[m] = r.belt.name === 'Black' ? '#f2f2f2' : r.belt.color; }
    host.share([{ type: 'ranks', label: 'My rank', data: { overall: o ? o.belt : null, ranked: o ? o.ranked : 0, total: Object.keys(MUSCLES).length, colors } }]);
  }

  // ───────── sheets (picker / settings / summary) ─────────
  function openSheet(html) { sheet.querySelector('.sheet-inner').innerHTML = html; sheet.classList.remove('hidden'); }
  function closeSheet() { sheet.classList.add('hidden'); }

  function openPicker() {
    openSheet(`<div class="sheet-title">ADD EXERCISE <button data-act="close">✕</button></div>
      <input class="search" placeholder="Search exercises" autocomplete="off"/>
      <div class="chips">${['all', ...Object.keys(MUSCLES)].map(m => `<button data-filter="${m}" class="${pickerFilter === m ? 'active' : ''}">${m === 'all' ? 'All' : MUSCLES[m]}</button>`).join('')}</div>
      <div class="pick-list"></div>
      <button class="btn btn-ghost" style="margin-top:12px" data-act="nx-open">+ Create your own exercise</button>`);
    renderPickList();
    sheet.querySelector('.search').addEventListener('input', renderPickList);
  }
  function renderPickList() {
    const q = (sheet.querySelector('.search') || {}).value || '';
    const list = EXERCISES.filter(e => !e.hidden && (pickerFilter === 'all' || e.muscles.p.includes(pickerFilter) || e.muscles.s.includes(pickerFilter))
      && e.name.toLowerCase().includes(q.toLowerCase()));
    sheet.querySelector('.pick-list').innerHTML = list.map(e => `<button class="pick" data-pick="${e.id}">
        <div><b>${esc(e.name)}</b><span>${musclesOf(e.id)}</span></div><span>${e.std ? '★ ranked' : e.custom ? 'custom' : ''}</span></button>`).join('')
      || `<div class="empty">No matches.${q ? '<br/>Create it with the button below.' : ''}</div>`;
  }

  function openSettings() {
    openSheet(`<div class="sheet-title">GYM SETTINGS <button data-act="close">✕</button></div>
      <div class="field"><label>BODYWEIGHT (KG)</label><input class="set-bw" inputmode="decimal" value="${G.bodyweight}"/></div>
      <div class="field"><label>REST TIMER (SECONDS)</label><input class="set-rest" inputmode="numeric" value="${G.rest}"/></div>
      <button class="btn btn-primary" data-act="save-settings">Save</button>
      <button class="btn btn-ghost" data-plates="">Plate calculator</button>
      ${G.custom.some(c => !c.hidden) ? `<h2>YOUR EXERCISES</h2><div class="card" style="padding:4px 14px">${G.custom.filter(c => !c.hidden).map(c => `<div class="lift-row"><span>${esc(c.name)}</span><span class="muted">${MUSCLES[c.muscles.p[0]]}</span><button class="c-pr" data-delcx="${c.id}">Remove</button></div>`).join('')}</div>` : ''}
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
      ${host.share ? `<button class="btn btn-primary" style="margin-top:16px" data-act="share-workout">Share ${beltUps.length ? 'your belt' : prs ? 'your PR' : 'workout'} ↗</button>` : ''}
      <button class="btn ${host.share ? 'btn-ghost' : 'btn-primary'}" style="margin-top:${host.share ? 10 : 16}px" data-act="close">Done</button>`);
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
    const weights = [], recovery = {};
    for (let wk = 5; wk >= 0; wk--) weights.push({ date: dayKey(now - wk * 7 * DAY), kg: Math.round((82.4 - (5 - wk) * 0.3) * 10) / 10 });
    [7, 6.5, 8, 7.5, 6, 7, 8, 7.5, 6.5, 7].forEach((h, i) => { recovery[dayKey(now - (i + 1) * DAY)] = { sleep: h, water: 5 + (i % 4) }; });
    G = Object.assign(fresh(), { bodyweight: weights[weights.length - 1].kg, rest: G.rest, bar: G.bar, custom: G.custom, templates: G.templates, workouts, weights, recovery, xp: workouts.reduce((a, w) => a + w.xp, 0) });
    save(); closeSheet(); render(); host.toast('Demo data loaded');
  }

  // ───────── events ─────────
  function onClick(ev) {
    const t = ev.target.closest('button, a, [data-lift], [data-hist], polygon');
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
    if (d.sleep) { sleepCustomOpen = false; return setRecovery({ sleep: Number(d.sleep) }); }
    if (d.water) return setRecovery({ water: Math.max(0, todayRecovery().water + Number(d.water)) });
    if (d.lift) { ev.preventDefault(); return openLift(d.lift); }
    if (d.hmode) { historyMode = d.hmode; return render(); }
    if (d.edit) return openEditor(d.edit);
    if (d.delw) return deleteWorkout(d.delw);
    if (d.tplfrom) return openSaveTemplate(d.tplfrom);
    if (d.deltpl) return deleteTemplate(d.deltpl);
    if (d.delcx) return removeCustom(d.delcx);
    if ('plates' in d) {
      let kg = '';
      if (d.plates !== '' && G.active) {
        const sets = G.active.exercises[+d.plates].sets;
        const s = sets.find(x => !x.done && Number(x.w)) || sets.filter(x => Number(x.w)).pop();
        kg = s ? s.w : '';
      }
      return openPlates(kg);
    }
    if (d.bar) { G.bar = Number(d.bar); save(); sheet.querySelectorAll('[data-bar]').forEach(b => b.classList.toggle('active', b === t)); return renderPlates(); }
    if (d.nxm) { newEx.p = d.nxm; sheet.querySelectorAll('[data-nxm]').forEach(b => b.classList.toggle('active', b === t)); return; }
    if (d.nxbw) { newEx.bw = d.nxbw === '1'; sheet.querySelectorAll('[data-nxbw]').forEach(b => b.classList.toggle('active', b === t)); return; }
    if (d.edrm) { const [e, s] = d.edrm.split(',').map(Number); editing.exercises[e].sets.splice(s, 1); if (!editing.exercises[e].sets.length) editing.exercises.splice(e, 1); return renderEditor(); }
    if (d.edrmex) { editing.exercises.splice(+d.edrmex, 1); return renderEditor(); }
    if (d.edadd) { const sets = editing.exercises[+d.edadd].sets, l = sets[sets.length - 1]; sets.push({ w: l ? l.w : '', r: l ? l.r : '', done: true }); return renderEditor(); }
    if (d.hist) { t.querySelector('.hist-body').classList.toggle('hidden'); return; }
    if (d.rest) {
      if (d.rest === 'skip') return stopRest();
      restEnd += Number(d.rest) * 1000; restTotal = Math.max(restTotal, restEnd - Date.now()); return tickRest();
    }
    switch (d.act) {
      case 'settings': return openSettings();
      case 'share-workout': return shareWorkout();
      case 'share-ranks': return shareRanks();
      case 'sleep-custom':
        sleepCustomOpen = !sleepCustomOpen; render();
        if (sleepCustomOpen) { const i = $('.sleep-in'); if (i) i.focus(); }
        return;
      case 'sleep-save': {
        const h = parseFloat((($('.sleep-in') || {}).value || '').replace(',', '.'));
        if (!(h >= 0 && h <= 16)) { host.toast('Enter hours between 0 and 16'); return; }
        sleepCustomOpen = false;
        return setRecovery({ sleep: Math.round(h * 4) / 4 });
      }
      case 'log-weight': {
        const kg = parseFloat(($('.bw-in') || {}).value);
        if (!(kg > 25 && kg < 300)) { host.toast('Enter your weight in kg'); return; }
        return logWeight(Math.round(kg * 10) / 10);
      }
      case 'pick': return openPicker();
      case 'nx-open': newEx = null; return openNewExercise();
      case 'nx-save': return saveNewExercise();
      case 'pick-back': newEx = null; return G.active ? openPicker() : closeSheet();
      case 'ed-save': return saveEditor();
      case 'save-tpl': return openSaveTemplate();
      case 'tpl-save': return saveTemplate();
      case 'finish': return finishWorkout();
      case 'discard': return discardWorkout();
      case 'close': editing = null; return closeSheet();
      case 'demo': return loadDemo();
      case 'reset':
        if (confirm('Delete all gym data?')) { G = fresh(); syncCustom(); save(); closeSheet(); render(); }
        return;
      case 'save-settings': {
        const bw = parseFloat(sheet.querySelector('.set-bw').value);
        const rest = parseInt(sheet.querySelector('.set-rest').value, 10);
        if (bw > 25 && bw < 300 && bw !== G.bodyweight) { if (rest >= 15 && rest <= 600) G.rest = rest; closeSheet(); return logWeight(bw); }
        if (rest >= 15 && rest <= 600) G.rest = rest;
        save(); closeSheet(); render(); host.toast('Saved');
      }
    }
  }

  // Typing into a set updates the data without re-rendering (keeps the keyboard up).
  function onInput(ev) {
    const i = ev.target.dataset;
    if (i.ed && editing) {
      if (i.ed === 'name') editing.name = ev.target.value;
      else editing.exercises[+i.e].sets[+i.s][i.ed] = ev.target.value.replace(',', '.');
      return;
    }
    if (ev.target.classList.contains('plate-in')) return renderPlates();
    if (ev.target.classList.contains('nx-name') && newEx) { newEx.name = ev.target.value; return; }
    if (!i.in || !G.active) return;
    G.active.exercises[+i.e].sets[+i.s][i.in] = ev.target.value.replace(',', '.');
    save();
  }

  function mount(el, hostApi) {
    host = hostApi;
    root = el;
    load();
    root.classList.add('fg');
    root.innerHTML = `
      <div class="fg-head">
        <div><div class="brand">GYM</div><div class="sub fg-sub"></div></div>
        <div class="head-right"><div class="fg-rank"></div><button class="icon-btn" data-act="settings" aria-label="Gym settings">⚙</button></div>
      </div>
      <div class="fg-tabs">
        <button data-tab="train">Train</button><button data-tab="body">Body</button><button data-tab="ranks">Ranks</button><button data-tab="recovery">Recovery</button><button data-tab="history">History</button>
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
  function refresh() { if (!root) return; load(); render(); }

  // One-paragraph summary for the AI mentor's context.
  function mentorSummary() {
    if (!G || !G.workouts.length) return 'No gym workouts logged yet.' + (G && sleepAvg(7) !== null ? ` Sleep 7-day avg ${sleepAvg(7).toFixed(1)}h.` : '');
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
      `Overall gym belt: ${o ? o.belt.name : 'unranked'}. Strongest: ${top || 'n/a'}. Least trained this week: ${low}. Bodyweight ${fmtKg(G.bodyweight)}.` +
      (sleepAvg(7) !== null ? ` Sleep 7-day avg ${sleepAvg(7).toFixed(1)}h.` : '');
  }

  // Last-7-days numbers for the weekly recap share card.
  function weekStats() {
    if (!G) return null;
    const since = Date.now() - 7 * DAY;
    const ws = G.workouts.filter(w => w.end > since);
    let volume = 0, best = null;
    for (const w of ws) for (const e of w.exercises) for (const s of e.sets) {
      volume += setLoad(e.id, s) * (Number(s.r) || 0);
      const v = setE1rm(e.id, s);
      if (EX[e.id] && EX[e.id].std && (!best || v > best.v)) best = { v, text: `${EX[e.id].name} ${Number(s.w) || 0}kg × ${s.r}` };
    }
    return { workouts: ws.length, volume, bestLift: best ? best.text : '', sleepAvg: sleepAvg(7) };
  }

  function openTab(name) { tab = name; render(); }

  return { mount, refresh, mentorSummary, render, openTab, weekStats };
})();
