// Forge leaderboard (2.0). Same look as the Gym section (reuses gym.css .fg
// components) plus leaderboard.css (.flb).
//
// ForgeBoard.mount(el, host) renders into el. host (supplied by forges.html):
//   host.load()            → Promise of public profile rows (rpc/public_profiles)
//   host.meId()            → the signed-in user's id (or null)
//   host.friendIds()       → ids of the user's friends
//   host.isBlocked(id)     → hide blocked users
//   host.xpBelt(xp)        → { name, color, at, next } for the XP belt ladder
//   host.gymBelts          → BELTS from gym/exercises.js, or null when Gym is off
//   host.cleanName(s)      → safe display name
//   host.userActions(id, name), host.openProfile(id, name), host.addFriend(username),
//   host.manageFriends()   → the existing friends / challenges panel

const ForgeBoard = (function () {
  let host, root, rows = null, loading = false, error = null;
  let metric = 'xp', scope = 'all';

  const METRICS = {
    xp:     { tab: 'XP',     label: 'XP',            val: r => r.xp || 0,            fmt: v => v.toLocaleString() + ' XP' },
    streak: { tab: 'Streak', label: 'day streak',    val: r => r.streak || 0,        fmt: v => v + (v === 1 ? ' day' : ' days') },
    goals:  { tab: 'Goals',  label: 'goals today',   val: r => r.goals_done || 0,    fmt: v => v + (v === 1 ? ' goal' : ' goals') },
    habits: { tab: 'Habits', label: 'non-negotiables today', val: r => r.nonneg_done || 0, fmt: v => v + ' / 5' },
    gym:    { tab: 'Gym',    label: 'gym belt',
      val: r => (r.gym && r.gym.overall !== null && r.gym.overall !== undefined ? r.gym.overall * 100 + Math.min(99, r.gym.workouts7 || 0) : -1),
      fmt: (v, r) => { const b = gymBelt(r); return b ? b.name + ' belt' : 'Unranked'; } },
  };
  const gymBelt = r => (host.gymBelts && r.gym && r.gym.overall !== null && r.gym.overall !== undefined) ? host.gymBelts[r.gym.overall] || null : null;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initial = n => esc((n || '?').replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase() || '?');
  function beltChip(b, label) {
    if (!b) return '<span class="belt"><i style="background:#262626"></i>Unranked</span>';
    const cls = b.name === 'Black' ? ' class="black"' : '';
    return `<span class="belt"><i${cls} style="background:${b.color}"></i>${esc(label || b.name)}</span>`;
  }
  const ring = b => (b ? (b.name === 'Black' ? '#f5f5f5' : b.color) : '#333');

  function load(force) {
    if (loading || (rows && !force)) return;
    loading = true; error = null; render();
    Promise.resolve(host.load()).then(r => { rows = r || []; }).catch(e => { error = (e && e.message) || 'Could not load the leaderboard.'; })
      .then(() => { loading = false; render(); });
  }

  function ranked() {
    const me = host.meId(), friends = new Set(host.friendIds());
    const m = METRICS[metric];
    return (rows || [])
      .filter(r => !host.isBlocked(r.user_id))
      .filter(r => scope === 'all' || r.user_id === me || friends.has(r.user_id))
      .map(r => ({ r, name: host.cleanName(r.username) || 'Anonymous', me: r.user_id === me, v: m.val(r),
        // the ring/sub-line follow the tab: gym belts on Gym, XP belts everywhere else
        belt: metric === 'gym' ? gymBelt(r) : host.xpBelt(r.xp || 0) }))
      .filter(x => x.name !== 'Anonymous' || x.v > 0 || x.me)
      .sort((a, b) => b.v - a.v || (b.r.xp || 0) - (a.r.xp || 0))
      .map((x, i) => Object.assign(x, { rank: i + 1 }));
  }

  function podium(list) {
    const top = list.slice(0, 3);
    if (!top.length) return '';
    const order = [top[1], top[0], top[2]]; // 2nd · 1st · 3rd
    return `<div class="podium">${order.map(x => {
      if (!x) return '<div class="pod empty"></div>';
      return `<button class="pod p${x.rank}${x.me ? ' me' : ''}" data-profile="${esc(x.r.user_id)}" data-name="${esc(x.name)}">
        ${x.rank === 1 ? '<div class="crown">♛</div>' : ''}
        <div class="av" style="--ring:${ring(x.belt)}">${initial(x.name)}</div>
        <div class="pod-name">${x.me ? 'You' : esc(x.name)}</div>
        <div class="pod-score">${esc(METRICS[metric].fmt(x.v, x.r))}</div>
        <div class="stand"><span>${x.rank}</span></div>
      </button>`;
    }).join('')}</div>`;
  }

  function youCard(list) {
    const i = list.findIndex(x => x.me);
    if (i < 0) return '';
    const you = list[i], ahead = list[i - 1], m = METRICS[metric];
    let line, pct = 100;
    if (!ahead) line = list.length > 1 ? `You're top of ${scope === 'all' ? 'the leaderboard' : 'your friends'}. Stay there.` : 'Add friends to have someone to beat.';
    else if (metric === 'gym') line = `${esc(ahead.name)} is ahead on ${esc(m.fmt(ahead.v, ahead.r))}. Belt up to pass them.`;
    else {
      const gap = ahead.v - you.v;
      line = gap === 0 ? `Level with ${esc(ahead.name)}. One more to pass them.` : `${esc(m.fmt(gap).replace(' / 5', ''))} behind ${esc(ahead.name)} in #${ahead.rank}.`;
      pct = ahead.v ? Math.max(4, Math.min(100, you.v / ahead.v * 100)) : 0;
    }
    return `<div class="card you">
      <div class="you-rank">#${you.rank}<span>of ${list.length}</span></div>
      <div class="you-main"><div class="you-score">${esc(m.fmt(you.v, you.r))}</div>
        <div class="small muted">${line}</div>
        ${ahead && metric !== 'gym' ? `<div class="bar" style="margin-top:8px"><div style="width:${pct}%;background:var(--fg-xp)"></div></div>` : ''}</div>
    </div>`;
  }

  function listHTML(list) {
    const rest = list.slice(3);
    if (!rest.length) return '';
    return `<h2>RANKINGS</h2><div class="card" style="padding:2px 12px">${rest.map(x => `<div class="lb-row${x.me ? ' me' : ''}">
        <span class="lb-n">${x.rank}</span>
        <button class="lb-who" data-profile="${esc(x.r.user_id)}" data-name="${esc(x.name)}">
          <span class="av sm" style="--ring:${ring(x.belt)}">${initial(x.name)}</span>
          <span class="lb-name">${x.me ? 'You' : esc(x.name)}<small>${metric === 'gym' ? (x.r.gym ? `${x.r.gym.workouts7 || 0} workout${x.r.gym.workouts7 === 1 ? '' : 's'} this week` : 'No gym ranks yet') : `${esc(x.belt.name)} belt · ${x.r.streak || 0}d streak`}</small></span>
        </button>
        <span class="lb-score">${esc(METRICS[metric].fmt(x.v, x.r))}</span>
        ${x.me ? '<span></span>' : `<button class="lb-more" data-ua="${esc(x.r.user_id)}" data-name="${esc(x.name)}" aria-label="Report or block">⋯</button>`}
      </div>`).join('')}</div>`;
  }

  function journeyHTML() {
    const me = (rows || []).find(r => r.user_id === host.meId());
    if (!me) return '';
    const b = host.xpBelt(me.xp || 0);
    const pct = b.next ? Math.round(((me.xp || 0) - b.at) / (b.next.at - b.at) * 100) : 100;
    return `<h2>YOUR BELT</h2><div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center">${beltChip(b, b.name + ' belt')}
        <span class="small muted">${b.next ? `${(b.next.at - (me.xp || 0)).toLocaleString()} XP to ${esc(b.next.name)}` : 'Top belt'}</span></div>
      <div class="bar" style="margin-top:12px"><div style="width:${pct}%;background:${b.next ? ring(b.next) : ring(b)}"></div></div>
      <div class="ladder">${host.xpBelt.ladder.map(l => `<i title="${esc(l.name)}" class="${(me.xp || 0) >= l.at ? 'on' : ''}" style="--c:${ring(l)}"></i>`).join('')}</div>
    </div>`;
  }

  function render() {
    if (!root) return;
    const list = rows ? ranked() : [];
    const you = list.find(x => x.me);
    const m = METRICS[metric];
    const tabs = Object.keys(METRICS).filter(k => k !== 'gym' || host.gymBelts);
    root.innerHTML = `
      <div class="fg-head">
        <div><div class="brand">LEADERBOARD</div>
          <div class="sub">${rows ? `${list.length} ${scope === 'all' ? 'player' : 'friend'}${list.length === 1 ? '' : 's'}${you ? ` · you're #${you.rank} for ${m.label}` : ''}` : 'Global rankings'}</div></div>
        <div class="head-right">${you ? (metric === 'gym' ? beltChip(you.belt, you.belt ? 'Gym: ' + you.belt.name : null) : beltChip(you.belt, you.belt.name + ' belt')) : ''}<button class="icon-btn" data-act="reload" aria-label="Refresh">↻</button></div>
      </div>
      <div class="fg-tabs" style="grid-template-columns:repeat(${tabs.length},1fr)">${tabs.map(k => `<button data-metric="${k}" class="${k === metric ? 'active' : ''}">${METRICS[k].tab}</button>`).join('')}</div>
      <div class="seg scope"><button data-scope="all" class="${scope === 'all' ? 'active' : ''}">Everyone</button><button data-scope="friends" class="${scope === 'friends' ? 'active' : ''}">Friends</button></div>
      ${loading && !rows ? '<div class="empty">Loading rankings…</div>'
        : error ? `<div class="empty">${esc(error)}<br/><button class="link" data-act="reload">Try again</button></div>`
        : !list.length ? `<div class="empty">${scope === 'friends' ? 'No friends yet. Add someone below and race them.' : 'No players yet.'}</div>`
        : podium(list) + youCard(list) + listHTML(list)}
      <h2>ADD A FRIEND</h2>
      <div class="card">
        <div class="bw-log" style="margin-top:0"><input class="lb-add" placeholder="Username, e.g. jamie#0001" autocomplete="off"/><button class="btn btn-primary" data-act="add">Add</button></div>
        <button class="btn btn-ghost" style="margin-top:10px" data-act="friends">Friends & challenges</button>
      </div>
      ${journeyHTML()}`;
  }

  function onClick(ev) {
    const t = ev.target.closest('button');
    if (!t) return;
    const d = t.dataset;
    if (d.metric) { metric = d.metric; return render(); }
    if (d.scope) { scope = d.scope; return render(); }
    if (d.ua) return host.userActions(d.ua, d.name);
    if (d.profile) { if (d.profile !== host.meId()) host.openProfile(d.profile, d.name); return; }
    if (d.act === 'reload') return load(true);
    if (d.act === 'friends') return host.manageFriends();
    if (d.act === 'add') {
      const i = root.querySelector('.lb-add');
      const v = (i && i.value || '').trim();
      if (!v) return;
      Promise.resolve(host.addFriend(v)).then(() => { i.value = ''; });
    }
  }

  function mount(el, h) {
    host = h; root = el;
    root.classList.add('fg', 'flb');
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList.contains('lb-add')) root.querySelector('[data-act="add"]').click(); });
    load(true);
  }
  function refresh() { if (root) load(true); }

  return { mount, refresh, render };
})();
