// Forge Journal (2.0): entries list + full-page editor, in the Gym style
// (gym.css .fg + journal.css .fj).
//
// ForgeJournal.mount(el, host). host (supplied by forges.html):
//   host.notes()                   → state.notes [{ id, title, content, created: 'dd/mm/yyyy' }]
//   host.add(title, content)       → creates an entry at the top, returns it
//   host.update(id, { title?, content? }) → saves (called while typing, debounced)
//   host.remove(id)

const ForgeJournal = (function () {
  let host, root, open = null, query = '', saveTimer = null;

  const PROMPTS = [
    'What did you avoid today, and why?',
    'What is one thing you did today that future you will thank you for?',
    'Where did your time actually go today?',
    'What drained your energy today? What gave it back?',
    'What would make tomorrow a 10/10 day?',
    'What are you proud of this week that nobody saw?',
    'What excuse did you hear yourself make today?',
    'What is one small promise you can keep tomorrow?',
    'Who did you help today, or who helped you?',
    'What did you learn today that surprised you?',
    'If you repeated today 100 times, where would you end up?',
    'What is the one thing you keep putting off? What is the first 5-minute step?',
    'What went better than expected today?',
    'What do you need to let go of?',
  ];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const words = t => (String(t || '').trim().match(/\S+/g) || []).length;
  const todayStr = () => new Date().toLocaleDateString('en-GB');
  const dayIndex = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 864e5);
  const prompt = () => PROMPTS[dayIndex() % PROMPTS.length];
  // 'dd/mm/yyyy' → Date (en-GB, as Forge stores it)
  function parse(d) { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d || ''); return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null; }
  function nice(d) {
    const dt = parse(d); if (!dt) return esc(d || '');
    const diff = Math.round((new Date().setHours(0, 0, 0, 0) - dt.getTime()) / 864e5);
    return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  // consecutive days (ending today or yesterday) with at least one entry
  function streak(notes) {
    const days = new Set(notes.map(n => { const d = parse(n.created); return d ? d.toDateString() : null; }).filter(Boolean));
    let n = 0; const d = new Date();
    if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
    while (days.has(d.toDateString())) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  function listHTML() {
    const all = host.notes() || [];
    const q = query.toLowerCase();
    const notes = q ? all.filter(n => (n.title + ' ' + n.content).toLowerCase().includes(q)) : all;
    const month = all.filter(n => { const d = parse(n.created); return d && d.getMonth() === new Date().getMonth() && d.getFullYear() === new Date().getFullYear(); }).length;
    const st = streak(all);
    const wroteToday = all.some(n => n.created === todayStr());
    return `
      <div class="fg-head">
        <div><div class="brand">JOURNAL</div><div class="sub">${all.length} entr${all.length === 1 ? 'y' : 'ies'} · ${month} this month</div></div>
        <div class="head-right">${st ? `<span class="belt">✍️ ${st}-day streak</span>` : ''}<button class="icon-btn" data-act="new" aria-label="New entry">+</button></div>
      </div>
      <div class="card coach"><div class="who">TODAY'S PROMPT</div><p>${esc(prompt())}</p>
        <button class="btn ${wroteToday ? 'btn-ghost' : 'btn-primary'}" style="margin-top:12px" data-act="prompt">${wroteToday ? 'Write another' : 'Write about it'}</button></div>
      ${all.length > 3 ? `<input class="search fj-search" placeholder="Search your journal" value="${esc(query)}" autocomplete="off"/>` : ''}
      ${notes.length ? `<h2>${q ? 'RESULTS' : 'ENTRIES'}</h2>${notes.map(n => `<button class="card entry" data-open="${n.id}">
          <div class="en-top"><b>${esc(n.title || 'Untitled')}</b><span>${nice(n.created)}</span></div>
          <p>${esc((n.content || '').slice(0, 180)) || '<i>Empty</i>'}</p>
          <span class="en-w">${words(n.content)} words</span></button>`).join('')}`
        : `<div class="empty">${q ? `Nothing matches "${esc(query)}".` : 'No entries yet.<br/>Start with today\'s prompt.'}</div>`}`;
  }

  function editorHTML(n) {
    return `
      <div class="fj-bar"><button class="fj-back" data-act="back">← Journal</button>
        <span class="fj-saved small muted">Saved</span>
        <button class="fj-del" data-del="${n.id}">Delete</button></div>
      <textarea class="fj-title" rows="1" placeholder="Title" maxlength="80">${esc(n.title)}</textarea>
      <div class="small muted fj-meta">${nice(n.created)} · <span class="fj-wc">${words(n.content)}</span> words</div>
      <textarea class="fj-body" placeholder="Write freely. Nobody else sees this.">${esc(n.content)}</textarea>`;
  }

  function render() {
    if (!root) return;
    const n = open !== null && (host.notes() || []).find(x => x.id === open);
    if (open !== null && !n) open = null;
    root.innerHTML = n ? editorHTML(n) : listHTML();
    if (n) { grow(root.querySelector('.fj-body')); growTitle(root.querySelector('.fj-title')); }
  }
  function growTitle(t) { if (!t) return; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
  function grow(t) { if (!t) return; t.style.height = 'auto'; t.style.height = Math.max(320, t.scrollHeight) + 'px'; }

  function openEntry(id, focusBody) {
    open = id; render(); window.scrollTo(0, 0);
    const el = root.querySelector(focusBody ? '.fj-body' : '.fj-title');
    if (el && focusBody) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }
  function flush() {
    clearTimeout(saveTimer); saveTimer = null;
    if (open === null) return;
    const t = root.querySelector('.fj-title'), b = root.querySelector('.fj-body');
    if (t && b) host.update(open, { title: t.value.trim() || 'Untitled', content: b.value });
    const s = root.querySelector('.fj-saved'); if (s) s.textContent = 'Saved';
  }

  function onClick(ev) {
    const t = ev.target.closest('button');
    if (!t) return;
    const d = t.dataset;
    if (d.open) return openEntry(Number(d.open), false);
    if (d.act === 'back') { flush(); open = null; return render(); }
    if (d.act === 'new') { const n = host.add(todayStr(), ''); return openEntry(n.id, true); }
    if (d.act === 'prompt') { const n = host.add(prompt(), ''); return openEntry(n.id, true); }
    if (d.del) {
      const n = (host.notes() || []).find(x => x.id === Number(d.del));
      if (n && confirm(`Delete "${n.title || 'Untitled'}"? This can't be undone.`)) { clearTimeout(saveTimer); host.remove(n.id); open = null; render(); }
    }
  }
  function onInput(ev) {
    const c = ev.target.classList;
    if (c.contains('fj-search')) {
      query = ev.target.value; const pos = ev.target.selectionStart;
      render(); const s = root.querySelector('.fj-search'); if (s) { s.focus(); s.setSelectionRange(pos, pos); }
      return;
    }
    if (c.contains('fj-body') || c.contains('fj-title')) {
      if (c.contains('fj-title')) { ev.target.value = ev.target.value.replace(/\n/g, ' '); growTitle(ev.target); }
      if (c.contains('fj-body')) { grow(ev.target); const w = root.querySelector('.fj-wc'); if (w) w.textContent = words(ev.target.value); }
      const s = root.querySelector('.fj-saved'); if (s) s.textContent = 'Saving…';
      clearTimeout(saveTimer); saveTimer = setTimeout(flush, 600);
    }
  }

  function mount(el, h) {
    host = h; root = el;
    root.classList.add('fg', 'fj');
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    // Enter in the title jumps to the body instead of adding a line break
    root.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.classList.contains('fj-title')) { ev.preventDefault(); root.querySelector('.fj-body').focus(); } });
    root.addEventListener('focusout', ev => { if (ev.target.classList && (ev.target.classList.contains('fj-body') || ev.target.classList.contains('fj-title'))) flush(); });
    render();
  }
  // leaving the page: save anything pending
  function leave() { if (saveTimer) flush(); }

  return { mount, render, leave };
})();
