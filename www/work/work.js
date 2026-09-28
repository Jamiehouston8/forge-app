// Forge Work (2.0): side projects with tasks and logged income, in the Gym style
// (gym.css .fg + work.css .fw). Ticking / XP go through Forge's existing functions.
//
// ForgeWork.mount(el, host). host (supplied by forges.html):
//   host.projects()                 → state.hustles [{ id, name, income, tasks:[{label,done}], incomeLogged, xpEarned, minimized }]
//   host.toggleTask(id, i)          → tick/untick (awards / removes XP like the old page)
//   host.editTask(id, i, label), host.addTask(id), host.toggleCollapse(id)
//   host.addProject(name, note), host.removeProject(id), host.logIncome(id, amount)

const ForgeWork = (function () {
  let host, root, adding = false;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '£' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-GB');

  function nextUp(ps) {
    for (const p of ps) { const i = p.tasks.findIndex(t => t.label && !t.done); if (i >= 0) return { p, i, t: p.tasks[i] }; }
    return null;
  }

  function projectCard(p) {
    const filled = p.tasks.filter(t => t.label), done = p.tasks.filter(t => t.done).length;
    const pct = Math.round(done / Math.max(filled.length || p.tasks.length, 1) * 100);
    return `<div class="card proj${pct >= 100 && filled.length ? ' complete' : ''}">
      <div class="pj-head">
        <button class="pj-title" data-collapse="${p.id}"><b>${esc(p.name)}</b>${p.income ? `<span>${esc(p.income)}</span>` : ''}</button>
        <div class="pj-money"><b>${money(p.incomeLogged)}</b><span>logged</span></div>
        <button class="pj-x" data-remove="${p.id}" aria-label="Delete project">×</button>
      </div>
      <div class="pj-prog"><div class="bar"><div style="width:${Math.min(100, pct)}%;background:${pct >= 100 ? 'var(--fg-good)' : 'var(--fg-xp)'}"></div></div>
        <span>${done}/${filled.length || p.tasks.length} tasks · +${p.xpEarned || 0} XP</span><button class="pj-fold" data-collapse="${p.id}">${p.minimized ? 'Show ▾' : 'Hide ▴'}</button></div>
      ${p.minimized ? '' : `<div class="pj-body">
        ${p.tasks.map((t, i) => `<div class="hk${t.done ? ' done' : ''}">
          <button class="hk-chk" data-tog="${p.id},${i}" aria-label="${t.done ? 'Untick' : 'Tick'}">${t.done ? '✓' : ''}</button>
          <input class="hk-in" data-edit="${p.id},${i}" value="${esc(t.label)}" placeholder="Task ${i + 1}"/>
          <span class="hk-xp">${t.done ? '+10' : ''}</span></div>`).join('')}
        <div class="pj-actions">
          <button class="add-set" data-addtask="${p.id}">+ TASK</button>
          <div class="pj-income"><input inputmode="decimal" class="inc-in" data-inc="${p.id}" placeholder="£0.00"/><button class="btn btn-ghost" data-log="${p.id}">Log £</button></div>
        </div>
      </div>`}
    </div>`;
  }

  function render() {
    if (!root) return;
    if (document.activeElement && root.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    const ps = host.projects() || [];
    const tasksDone = ps.reduce((a, p) => a + p.tasks.filter(t => t.done).length, 0);
    const income = ps.reduce((a, p) => a + (Number(p.incomeLogged) || 0), 0);
    const xp = ps.reduce((a, p) => a + (p.xpEarned || 0), 0);
    const n = nextUp(ps);
    root.innerHTML = `
      <div class="fg-head">
        <div><div class="brand">WORK</div><div class="sub">${ps.length} project${ps.length === 1 ? '' : 's'} · ${money(income)} logged</div></div>
        <div class="head-right"><button class="icon-btn" data-act="new" aria-label="New project">+</button></div>
      </div>
      <div class="sum-grid four">
        <div><b>${ps.length}</b><span>PROJECTS</span></div><div><b>${tasksDone}</b><span>TASKS DONE</span></div>
        <div><b>${money(income)}</b><span>INCOME</span></div><div><b>${xp}</b><span>WORK XP</span></div>
      </div>
      ${n ? `<div class="card coach next"><div class="who">NEXT UP · ${esc(n.p.name.toUpperCase())}</div>
          <div class="next-row"><p>${esc(n.t.label)}</p><button class="btn btn-primary" data-tog="${n.p.id},${n.i}">Done ✓</button></div></div>` : ''}
      ${adding || !ps.length ? `<h2>NEW PROJECT</h2><div class="card">
          <div class="field"><label>NAME</label><input class="np-name" maxlength="40" placeholder="e.g. Forge, Freelance design"/></div>
          <div class="field"><label>GOAL OR NOTE (OPTIONAL)</label><input class="np-note" maxlength="60" placeholder="e.g. £500/month by December"/></div>
          <button class="btn btn-primary" data-act="create">Create project</button>
          ${ps.length ? '<button class="btn btn-ghost" data-act="cancel">Cancel</button>' : '<div class="small muted" style="margin-top:10px;line-height:1.6">Each task you tick earns 10 XP. Your AI mentor can add tasks to projects too.</div>'}
        </div>` : ''}
      ${ps.length ? `<h2>PROJECTS</h2>${ps.map(projectCard).join('')}` : ''}`;
  }

  function onClick(ev) {
    const t = ev.target.closest('button');
    if (!t) return;
    const d = t.dataset;
    const id = v => Number(v);
    if (d.tog) { const [p, i] = d.tog.split(','); host.toggleTask(id(p), +i); return render(); }
    if (d.collapse) { host.toggleCollapse(id(d.collapse)); return render(); }
    if (d.addtask) { host.addTask(id(d.addtask)); render(); const ins = root.querySelectorAll(`[data-edit^="${d.addtask},"]`); if (ins.length) ins[ins.length - 1].focus(); return; }
    if (d.remove) {
      const p = host.projects().find(x => x.id === id(d.remove));
      if (p && confirm(`Delete "${p.name}" and its tasks? Logged income and XP stay in your totals.`)) { host.removeProject(p.id); render(); }
      return;
    }
    if (d.log) {
      const i = root.querySelector(`[data-inc="${d.log}"]`), v = parseFloat(((i && i.value) || '').replace(/[£,]/g, ''));
      if (!(v > 0)) return;
      host.logIncome(id(d.log), Math.round(v * 100) / 100); i.value = ''; i.blur(); return render();
    }
    if (d.act === 'new') { adding = true; render(); const i = root.querySelector('.np-name'); if (i) i.focus(); return; }
    if (d.act === 'cancel') { adding = false; return render(); }
    if (d.act === 'create') {
      const name = (root.querySelector('.np-name').value || '').trim();
      if (!name) { root.querySelector('.np-name').focus(); return; }
      host.addProject(name, (root.querySelector('.np-note').value || '').trim());
      adding = false; document.activeElement && document.activeElement.blur(); return render();
    }
  }

  function mount(el, h) {
    host = h; root = el;
    root.classList.add('fg', 'fw');
    root.addEventListener('click', onClick);
    root.addEventListener('change', ev => { const d = ev.target.dataset; if (d.edit) { const [p, i] = d.edit.split(','); host.editTask(Number(p), +i, ev.target.value.trim()); } });
    root.addEventListener('focusout', ev => { if (ev.target.dataset && ev.target.dataset.edit) setTimeout(render, 0); });
    root.addEventListener('keydown', ev => {
      if (ev.key !== 'Enter') return;
      const d = ev.target.dataset;
      if (d.inc) root.querySelector(`[data-log="${d.inc}"]`).click();
      else if (d.edit) ev.target.blur();
      else if (ev.target.classList.contains('np-name') || ev.target.classList.contains('np-note')) root.querySelector('[data-act="create"]').click();
    });
    render();
  }

  return { mount, render };
})();
