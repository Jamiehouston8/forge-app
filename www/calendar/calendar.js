// Forge Calendar (2.0): week planner + events, in the Gym style (gym.css .fg + calendar.css .fc).
//
// Forge keeps two kinds of plan and this page shows both on one timeline:
//   activities  state.idealRoutine.dayActivities['day_<0-6>'] = [{ id, name, desc, time:'HH:MM', colour }]
//               done-ness is per date: idealRoutine.completions[<toDateString>][id]
//   hour tasks  state.schedule[<0-6>][<6-22>] = { task, done }   (older grid; ticking one = +10 XP)
//
// ForgeCal.mount(el, host). host (supplied by forges.html):
//   host.days            → ['Monday', ... 'Sunday'];  host.todayIdx() → 0-6
//   host.items(day)      → merged, sorted [{ kind:'act'|'hour', id, time, name, desc, colour, done }]
//   host.toggle(item)    → mark done / undone (today)
//   host.remove(item, day)
//   host.add(day|'all', { name, time, desc, colour })
//   host.clearDay(day)
//   host.events()        → state.events [{ id, name, date:'YYYY-MM-DD', note }]
//   host.addEvent({ name, date, note }), host.removeEvent(id)

const ForgeCal = (function () {
  let host, root, day = null, adding = false, addingEvent = false, colour = 'white', clock = null;
  const COLOURS = { white: '#e8e8e8', yellow: '#ffd166', red: '#ff4d4d', blue: '#4dc9ff' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const fmtTime = t => { const [h, m] = String(t).split(':').map(Number); return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h < 12 ? 'am' : 'pm'}`; };
  const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  function nowNext() {
    const items = host.items(host.todayIdx()), t = hm(new Date());
    let now = null, next = null;
    for (const it of items) { if (it.time <= t) now = it; else { next = it; break; } }
    // "now" only counts if it started within the last 2 hours
    if (now) { const [h, m] = now.time.split(':').map(Number); if ((new Date().getHours() * 60 + new Date().getMinutes()) - (h * 60 + m) > 120) now = null; }
    return { now, next };
  }

  function nowCard() {
    const { now, next } = nowNext();
    const d = new Date();
    return `<div class="card coach nowcard">
      <div class="nc-clock"><b class="fc-clock">${hm(d)}</b><span>${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</span></div>
      <div class="nc-rows">
        <div><span class="who">NOW</span><p>${now ? esc(now.name) + (now.done ? ' ✓' : '') : 'Free time'}</p></div>
        <div><span class="who">NEXT</span><p>${next ? `${esc(next.name)} <small>${fmtTime(next.time)}</small>` : 'Nothing else today'}</p></div>
      </div></div>`;
  }

  function dayStrip() {
    const ti = host.todayIdx();
    return `<div class="daystrip">${host.days.map((n, i) => {
      const c = host.items(i).length;
      return `<button data-day="${i}" class="${i === day ? 'active' : ''}${i === ti ? ' today' : ''}"><b>${n.slice(0, 3)}</b><span>${c ? '●'.repeat(Math.min(c, 3)) : '·'}</span></button>`;
    }).join('')}</div>`;
  }

  function timeline() {
    const items = host.items(day), isToday = day === host.todayIdx();
    const done = items.filter(i => i.done).length, t = hm(new Date());
    const nowIdx = isToday ? items.findIndex(i => i.time > t) : -1;
    let rows = items.map((it, k) => `${k === nowIdx ? '<div class="nowline"><span>NOW</span></div>' : ''}<div class="slot${it.done ? ' done' : ''}${isToday && it.time <= t && !it.done ? ' past' : ''}" style="--c:${COLOURS[it.colour] || COLOURS.white}">
        <span class="sl-t">${fmtTime(it.time)}</span>
        <div class="sl-main"><b>${esc(it.name)}</b>${it.desc ? `<small>${esc(it.desc)}</small>` : ''}</div>
        ${isToday || it.kind === 'hour' ? `<button class="sl-chk" data-tog="${it.kind}:${it.id}" aria-label="${it.done ? 'Undo' : 'Done'}">${it.done ? '✓' : ''}</button>` : '<span></span>'}
        <button class="sl-x" data-rm="${it.kind}:${it.id}" aria-label="Remove">×</button>
      </div>`).join('');
    if (isToday && items.length && nowIdx === -1) rows += '<div class="nowline"><span>NOW</span></div>';
    return `<div class="dayhead"><h2 style="margin:0">${host.days[day].toUpperCase()}${isToday ? ' · TODAY' : ''}</h2>
        <span class="small muted">${items.length ? `${done}/${items.length} done` : ''}</span></div>
      ${items.length ? `<div class="bar" style="margin:8px 0 10px"><div style="width:${Math.round(done / items.length * 100)}%;background:var(--fg-good)"></div></div>` : ''}
      <div class="card tl">${rows || `<div class="empty" style="padding:22px 10px">Nothing planned for ${host.days[day]}.<br/>Add something, or ask your mentor to plan it.</div>`}</div>
      ${adding ? addForm() : `<div class="row2"><button class="btn btn-primary" data-act="add">+ Add to ${host.days[day]}</button>${items.length ? '<button class="btn btn-ghost" data-act="clear">Clear day</button>' : ''}</div>`}`;
  }

  function addForm() {
    return `<div class="card addform">
      <div class="field"><label>WHAT</label><input class="af-name" maxlength="50" placeholder="e.g. Gym: legs, Deep work, Read"/></div>
      <div class="af-row">
        <div class="field"><label>TIME</label><input class="af-time" type="time" value="${String(Math.min(22, new Date().getHours() + 1)).padStart(2, '0')}:00"/></div>
        <div class="field"><label>COLOUR</label><div class="swatches">${Object.entries(COLOURS).map(([k, v]) => `<button data-col="${k}" class="${k === colour ? 'on' : ''}" style="background:${v}" aria-label="${k}"></button>`).join('')}</div></div>
      </div>
      <div class="field"><label>NOTE (OPTIONAL)</label><input class="af-desc" maxlength="80" placeholder="Anything to remember"/></div>
      <label class="af-every"><input type="checkbox" class="af-all"/> Every day this week</label>
      <div class="row2"><button class="btn btn-primary" data-act="save">Add</button><button class="btn btn-ghost" data-act="cancel">Cancel</button></div>
    </div>`;
  }

  function eventsCard() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const evs = (host.events() || []).slice().sort((a, b) => a.date.localeCompare(b.date))
      .map(e => ({ e, diff: Math.round((new Date(e.date + 'T00:00:00') - today) / 864e5) }))
      .filter(x => x.diff >= -7);
    return `<h2>EVENTS</h2><div class="card" style="padding:4px 14px">
      ${evs.length ? evs.map(({ e, diff }) => `<div class="evrow${diff < 0 ? ' pastev' : ''}">
          <span class="cd${diff >= 0 && diff <= 3 ? ' soon' : ''}">${diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff > 0 ? `${diff} days` : `${-diff}d ago`}</span>
          <div class="ev-main"><b>${esc(e.name)}</b><small>${new Date(e.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}${e.note ? ' · ' + esc(e.note) : ''}</small></div>
          <button class="sl-x" data-rmev="${e.id}" aria-label="Delete event">×</button></div>`).join('')
        : '<div class="small muted" style="padding:14px 0">No upcoming events. Add deadlines, races, appointments.</div>'}
      ${addingEvent ? `<div class="evform">
          <input class="ev-name" maxlength="60" placeholder="Event name"/>
          <div class="af-row"><input class="ev-date" type="date" value="${iso(new Date())}"/><input class="ev-note" maxlength="60" placeholder="Note (optional)"/></div>
          <div class="row2"><button class="btn btn-primary" data-act="evsave">Add event</button><button class="btn btn-ghost" data-act="evcancel">Cancel</button></div></div>`
        : '<button class="add-set" data-act="evadd" style="margin:6px 0 10px">+ ADD EVENT</button>'}
    </div>`;
  }

  function render() {
    if (!root) return;
    if (day === null) day = host.todayIdx();
    root.innerHTML = `
      <div class="fg-head"><div><div class="brand">CALENDAR</div><div class="sub">Plan the week · ${host.items(host.todayIdx()).length} today</div></div></div>
      ${nowCard()}${dayStrip()}${timeline()}${eventsCard()}`;
  }

  function findItem(key) { const [kind, id] = key.split(':'); return host.items(day).find(i => i.kind === kind && String(i.id) === id); }

  function onClick(ev) {
    const t = ev.target.closest('button');
    if (!t) return;
    const d = t.dataset;
    if (d.day !== undefined) { day = +d.day; adding = false; return render(); }
    if (d.tog) { const it = findItem(d.tog); if (it) { host.toggle(it, day); render(); } return; }
    if (d.rm) { const it = findItem(d.rm); if (it) { host.remove(it, day); render(); } return; }
    if (d.rmev) { host.removeEvent(Number(d.rmev)); return render(); }
    if (d.col) { colour = d.col; root.querySelectorAll('.swatches button').forEach(b => b.classList.toggle('on', b === t)); return; }
    switch (d.act) {
      case 'add': adding = true; render(); root.querySelector('.af-name').focus(); return;
      case 'cancel': adding = false; return render();
      case 'clear': if (confirm(`Clear everything planned for ${host.days[day]}?`)) { host.clearDay(day); render(); } return;
      case 'save': {
        const name = root.querySelector('.af-name').value.trim(), time = root.querySelector('.af-time').value;
        if (!name) { root.querySelector('.af-name').focus(); return; }
        if (!/^\d{2}:\d{2}$/.test(time)) { root.querySelector('.af-time').focus(); return; }
        host.add(root.querySelector('.af-all').checked ? 'all' : day, { name, time, desc: root.querySelector('.af-desc').value.trim(), colour });
        adding = false; return render();
      }
      case 'evadd': addingEvent = true; render(); root.querySelector('.ev-name').focus(); return;
      case 'evcancel': addingEvent = false; return render();
      case 'evsave': {
        const name = root.querySelector('.ev-name').value.trim(), date = root.querySelector('.ev-date').value;
        if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { root.querySelector(name ? '.ev-date' : '.ev-name').focus(); return; }
        host.addEvent({ name, date, note: root.querySelector('.ev-note').value.trim() });
        addingEvent = false; return render();
      }
    }
  }

  function mount(el, h) {
    host = h; root = el;
    root.classList.add('fg', 'fc');
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter') return;
      if (ev.target.closest('.addform')) root.querySelector('[data-act="save"]').click();
      else if (ev.target.closest('.evform')) root.querySelector('[data-act="evsave"]').click();
    });
    clearInterval(clock);
    clock = setInterval(() => { const c = root.querySelector('.fc-clock'); if (c) c.textContent = hm(new Date()); }, 15000);
    render();
  }
  function show() { day = host ? host.todayIdx() : null; adding = false; addingEvent = false; render(); }

  return { mount, render, show };
})();
