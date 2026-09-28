// Forge Home (2.0). Same look as Gym and the leaderboard (gym.css .fg + home.css .fh).
// Presentation only: ticking, XP and labels go through Forge's existing functions.
//
// ForgeHome.mount(el, host). host (supplied by forges.html):
//   host.state()               → Forge state (goals, nonneg, longterm, streakData, goalHistory, events, health, profile)
//   host.toggle(key, i)        → tick/untick a goal (awards XP like the old home)
//   host.edit(key, i, label)   → rename a goal
//   host.level(xp)             → { level, from, to } XP band of the current level
//   host.belt(xp)              → { name, color } XP belt
//   host.gym()                 → { workouts, belt } this week, or null when Gym is off
//   host.go(page, tab)         → open another page (tab: gym sub-tab)
//   host.refreshBrief()        → regenerate the AI daily brief (written into #debrief-text)
//   host.askMentor(text)       → open the mentor with this message
//   host.openPics(), host.picsCount()
// The brief and mentor lines are mirrored from the old home's elements
// (#debrief-text, #home-mentor-text), which Forge still fills.

const ForgeHome = (function () {
  let host, root, clock = null, observer = null;
  const LISTS = [
    { key: 'goals', title: 'GOALS TODAY', ph: 'Goal', count: true },
    { key: 'nonneg', title: 'NON-NEGOTIABLES', ph: 'Non-negotiable', count: true },
    { key: 'longterm', title: 'LONG-TERM', ph: 'Long-term goal', count: false },
  ];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const src = id => { const e = document.getElementById(id); return e ? e.textContent.trim() : ''; };

  function greeting(name) {
    const h = new Date().getHours(), n = name ? ', ' + esc(name) : '';
    return h >= 5 && h < 12 ? `Good morning${n}` : h < 17 && h >= 12 ? `Good afternoon${n}` : h >= 17 && h < 21 ? `Good evening${n}` : `Still up${n}?`;
  }

  function ringSVG(pct, level) {
    const r = 44, c = 2 * Math.PI * r;
    return `<svg viewBox="0 0 104 104" class="ring">
      <circle cx="52" cy="52" r="${r}" fill="none" stroke="#1f1f1f" stroke-width="8"/>
      <circle cx="52" cy="52" r="${r}" fill="none" stroke="var(--fg-xp)" stroke-width="8" stroke-linecap="round"
        stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - pct)).toFixed(1)}" transform="rotate(-90 52 52)"/>
      <text x="52" y="50" text-anchor="middle" class="ring-n">${level}</text>
      <text x="52" y="68" text-anchor="middle" class="ring-l">LEVEL</text>
    </svg>`;
  }

  function hero(s) {
    const xp = s.xp || 0, L = host.level(xp), b = host.belt(xp);
    const pct = L.to > L.from ? (xp - L.from) / (L.to - L.from) : 1;
    const done = k => (s[k] || []).filter(g => g.label && g.done).length;
    const total = k => (s[k] || []).filter(g => g.label).length;
    const streak = (s.streakData && s.streakData.current) || 0;
    return `<div class="card hero">
      ${ringSVG(Math.max(0, Math.min(1, pct)), L.level)}
      <div class="hero-stats">
        <div class="hs"><b>🔥 ${streak}</b><span>DAY STREAK</span></div>
        <div class="hs"><b>${done('goals')}/${total('goals') || 5}</b><span>GOALS</span></div>
        <div class="hs"><b>${done('nonneg')}/${total('nonneg') || 5}</b><span>NON-NEG</span></div>
      </div>
      <div class="hero-xp">
        <div class="bar"><div style="width:${Math.round(pct * 100)}%;background:var(--fg-xp)"></div></div>
        <div class="small muted">${xp.toLocaleString()} XP · ${(L.to - xp).toLocaleString()} to level ${L.level + 1}</div>
      </div>
    </div>`;
  }

  function briefCard() {
    const brief = src('debrief-text') || 'Tap ↻ for today\'s brief.';
    const mentor = src('home-mentor-text');
    return `<div class="card coach brief">
      <div class="who">DAILY BRIEF <button class="brief-refresh" data-act="brief" aria-label="New brief">↻</button></div>
      <p class="fh-brief">${esc(brief)}</p>
      ${mentor ? `<p class="fh-mentor">${esc(mentor)}</p>` : ''}
      <div class="ask"><input class="fh-ask" placeholder="Reply to your mentor…" autocomplete="off"/><button data-act="ask" aria-label="Send">↑</button></div>
    </div>`;
  }

  function listCard(cfg, s) {
    const items = s[cfg.key] || [];
    const filled = items.filter(g => g.label), done = filled.filter(g => g.done).length;
    const all = cfg.count && filled.length && done === filled.length;
    return `<h2>${cfg.title}${cfg.count ? ` <span class="h2-n">${done}/${filled.length || items.length}</span>` : ''}</h2>
      <div class="card list${all ? ' all-done' : ''}">${items.map((g, i) => `<div class="hk${g.done ? ' done' : ''}">
          <button class="hk-chk" data-tog="${cfg.key},${i}" aria-label="${g.done ? 'Untick' : 'Tick'}">${g.done ? '✓' : ''}</button>
          <input class="hk-in" data-edit="${cfg.key},${i}" value="${esc(g.label)}" placeholder="${cfg.ph} ${i + 1}"/>
          ${cfg.count ? `<span class="hk-xp">${g.done ? '+10' : ''}</span>` : ''}
        </div>`).join('')}
        ${all ? '<div class="all-note">All done. Locked in. 🔒</div>' : ''}
      </div>`;
  }

  function weekCard(s) {
    // rolling last 7 days, today on the right (a calendar week looks empty every Monday)
    const hist = s.goalHistory || [];
    const cells = [6, 5, 4, 3, 2, 1, 0].map(ago => {
      const d = new Date(); d.setDate(d.getDate() - ago);
      let ratio;
      if (ago === 0) { const f = (s.goals || []).filter(g => g.label); ratio = f.length ? f.filter(g => g.done).length / f.length : 0; }
      else { const h = hist.find(x => x.date === d.toDateString()); ratio = h && h.goalsTotal ? h.goalsDone / h.goalsTotal : null; }
      const col = ratio === null ? '#1a1a1a' : ratio >= 1 ? 'var(--fg-good)' : ratio > 0 ? 'var(--fg-xp)' : '#262626';
      const label = ago === 0 ? 'Today' : d.toLocaleDateString('en-GB', { weekday: 'narrow' });
      return `<div class="wk${ago === 0 ? ' today' : ''}"><i style="height:${ratio === null ? 8 : Math.max(8, Math.round(ratio * 100))}%;background:${col}"></i><span>${label}</span></div>`;
    }).join('');
    const days = hist.filter(h => Date.now() - new Date(h.date).getTime() < 7 * 864e5 && h.goalsTotal && h.goalsDone >= h.goalsTotal).length;
    return `<h2>LAST 7 DAYS</h2><div class="card"><div class="week">${cells}</div>
      <div class="small muted">${days ? `All goals done on ${days} of the last 6 days.` : 'Goals completed each day · green = all done'}</div></div>`;
  }

  function tiles(s) {
    const g = host.gym(), h = s.health || {};
    const today = new Date().toISOString().slice(0, 10);
    const evToday = (s.events || []).filter(e => e.date === today).length;
    const t = [];
    if (g) t.push(`<button class="tile" data-go="gym"><span class="t-ic">🏋</span><b>${g.workouts}</b><span>workout${g.workouts === 1 ? '' : 's'} this week</span></button>`);
    t.push(`<button class="tile" data-go="${g ? 'gym:recovery' : 'health'}"><span class="t-ic">🌙</span><b>${h.sleep ? h.sleep + 'h' : '—'}</b><span>sleep · ${h.water || 0} water</span></button>`);
    t.push(`<button class="tile" data-go="selfimprove"><span class="t-ic">📅</span><b>${evToday}</b><span>event${evToday === 1 ? '' : 's'} today</span></button>`);
    t.push(`<button class="tile" data-act="pics"><span class="t-ic">📸</span><b>${host.picsCount()}</b><span>progress pics</span></button>`);
    return `<div class="grid2 tiles">${t.join('')}</div>
      <div class="chips quick">${[['mentor', 'AI Mentor'], ['hustles', 'Work'], ['journal', 'Journal'], ['interests', 'Interests'], ['leaderboard', 'Leaderboard']]
        .map(([p, l]) => `<button data-go="${p}">${l}</button>`).join('')}</div>`;
  }

  function upcoming(s) {
    const today = new Date().toISOString().slice(0, 10), week = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    const ev = (s.events || []).filter(e => e.date >= today && e.date <= week).slice(0, 5);
    if (!ev.length) return '';
    return `<h2>COMING UP</h2><div class="card" style="padding:4px 14px">${ev.map(e => `<div class="ev">
      <span class="ev-d">${e.date === today ? 'Today' : new Date(e.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })}</span>
      <span class="ev-n">${esc(e.name)}${e.note ? `<small>${esc(e.note)}</small>` : ''}</span></div>`).join('')}</div>`;
  }

  function render() {
    if (!root) return;
    const focus = document.activeElement && root.contains(document.activeElement) && document.activeElement.dataset.edit;
    if (focus) return; // don't wipe an input the user is typing in
    const s = host.state(), now = new Date();
    root.innerHTML = `
      <div class="fg-head">
        <div><div class="brand">${now.toLocaleDateString('en-GB', { weekday: 'long' }).toUpperCase()}</div>
          <div class="sub fh-when">${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} · ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}</div></div>
        <div class="head-right"><span class="belt"><i style="background:${host.belt(s.xp || 0).color}"></i>${esc(host.belt(s.xp || 0).name)} belt</span></div>
      </div>
      <div class="hello">${greeting(s.profile && s.profile.name)}</div>
      ${hero(s)}
      ${briefCard()}
      ${LISTS.map(c => listCard(c, s)).join('')}
      ${weekCard(s)}
      <h2>QUICK</h2>${tiles(s)}
      ${upcoming(s)}`;
  }

  function onClick(ev) {
    const t = ev.target.closest('button');
    if (!t) return;
    const d = t.dataset;
    if (d.tog) { const [k, i] = d.tog.split(','); host.toggle(k, +i); return render(); }
    if (d.go) { const [p, tab] = d.go.split(':'); return host.go(p, tab); }
    if (d.act === 'brief') { host.refreshBrief(); return; }
    if (d.act === 'pics') return host.openPics();
    if (d.act === 'ask') {
      const i = root.querySelector('.fh-ask'), v = (i && i.value || '').trim();
      if (v) { i.value = ''; host.askMentor(v); }
    }
  }
  function onChange(ev) {
    const d = ev.target.dataset;
    if (d.edit) { const [k, i] = d.edit.split(','); host.edit(k, +i, ev.target.value.trim()); }
  }

  function mount(el, h) {
    host = h; root = el;
    root.classList.add('fg', 'fh');
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('focusout', ev => { if (ev.target.dataset && ev.target.dataset.edit) setTimeout(render, 0); });
    root.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter') return;
      if (ev.target.classList.contains('fh-ask')) root.querySelector('[data-act="ask"]').click();
      else if (ev.target.dataset.edit) ev.target.blur();
    });
    // mirror the brief / mentor lines as Forge (re)writes them, without a full re-render
    observer = new MutationObserver(() => {
      const b = root.querySelector('.fh-brief'); if (b) b.textContent = src('debrief-text') || b.textContent;
      const m = root.querySelector('.fh-mentor'); if (m) m.textContent = src('home-mentor-text');
      else if (src('home-mentor-text') && !root.contains(document.activeElement)) render();
    });
    ['debrief-text', 'home-mentor-text'].forEach(id => { const e = document.getElementById(id); if (e) observer.observe(e, { childList: true, characterData: true, subtree: true }); });
    clearInterval(clock);
    clock = setInterval(() => { const w = root.querySelector('.fh-when'); const n = new Date(); if (w) w.textContent = `${n.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} · ${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`; }, 20000);
    render();
  }

  return { mount, render };
})();
