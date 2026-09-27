// Forge Interests (2.0) — taste shelf with cover art, hobbies, skill levels,
// learning quests and AI discovery.
//
// ForgeInterests.mount(rootElement, host) renders the whole section. It reuses
// the gym's styles (gym/gym.css, scoped under .fg) plus interests.css (.fi).
//   host.get() / host.put(data)   → the data object (Forge: state.interestsV2)
//   host.legacy()                 → optional; old Forge interests data to import once
//   host.toast(msg)
//   host.awardXP(n, reason)       → optional
//   host.ai(prompt, maxTokens)    → optional; resolves to the model's text reply
//   host.share(variants)          → optional; opens share cards (share/share.js)
//
// Cover art comes from Apple's iTunes Search API (music, TV, books, podcasts;
// free, no key, CORS-enabled). Films come from Wikipedia search (title + year);
// film posters aren't freely available, so films get a generated poster card.

const ForgeInterests = (function () {
  const KINDS = {
    album:   { label: 'Album',   group: 'music', shape: 'sq' },
    artist:  { label: 'Artist',  group: 'music', shape: 'sq' },
    song:    { label: 'Song',    group: 'music', shape: 'sq' },
    film:    { label: 'Film',    group: 'screen', shape: 'tall' },
    tv:      { label: 'TV show', group: 'screen', shape: 'tall' },
    book:    { label: 'Book',    group: 'books', shape: 'tall' },
    podcast: { label: 'Podcast', group: 'podcasts', shape: 'sq' },
    other:   { label: 'Other',   group: 'other', shape: 'sq' },
  };
  const GROUPS = [
    { id: 'all', label: 'All' }, { id: 'music', label: 'Music' }, { id: 'screen', label: 'Film & TV' },
    { id: 'books', label: 'Books' }, { id: 'podcasts', label: 'Podcasts' },
  ];
  // Skill level thresholds in hours of logged practice (level 1 → 10).
  const SKILL_HOURS = [0, 1, 3, 6, 10, 16, 25, 40, 60, 100];
  const XP = { practicePer30: 10, step: 15, questDone: 50, hobby: 5 };
  const DAY = 86400000;

  let host, root, sheet, D;
  let tab = 'taste', group = 'all', searchKind = 'album', searchTimer = null, searchSeq = 0;
  let busy = {};   // AI calls in flight, keyed by id

  function fresh() { return { shelf: [], hobbies: [], skills: [], learn: [], discover: null, imported: false }; }
  function save() { host.put(D); }
  const $ = s => root.querySelector(s);
  const uid = () => Math.random().toString(36).slice(2, 10);
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function dayKey(t) {
    const d = new Date(t === undefined ? Date.now() : t);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ───────── import old Forge interests (once) ─────────
  function importLegacy() {
    if (D.imported || !host.legacy) return;
    const c = host.legacy() || {};
    const creative = c.creative || {};
    const musicKind = { Albums: 'album', Artists: 'artist', Songs: 'song', Playlists: 'other', Podcasts: 'podcast' };
    const filmKind = { Films: 'film', 'TV Shows': 'tv', Documentaries: 'film', Actors: 'other', Directors: 'other' };
    ((creative.music || {}).items || []).forEach(i => i.title && D.shelf.push({ id: uid(), kind: musicKind[i.cat] || 'other', title: i.title, note: i.opinion || '', added: Date.now() }));
    ((creative.film || {}).items || []).forEach(i => i.title && D.shelf.push({ id: uid(), kind: filmKind[i.cat] || 'film', title: i.title, note: i.opinion || '', added: Date.now() }));
    (creative.hobbies || []).forEach(h => { const name = typeof h === 'string' ? h : (h && (h.name || h.title)); if (name) D.hobbies.push({ id: uid(), name, last: null, count: 0 }); });
    const sk = creative.skills || {};
    [...(sk.learning || []), ...(sk.favourite || [])].forEach(s => {
      const name = typeof s === 'string' ? s : (s && (s.name || s.title));
      if (name && !D.skills.some(x => x.name.toLowerCase() === name.toLowerCase())) D.skills.push({ id: uid(), name, minutes: 0, log: [] });
    });
    (c.education || []).forEach(e => {
      if (!e || !e.topic) return;
      const steps = String(e.path || '').split('\n').map(l => l.replace(/^[\s*#\-\d.)]+/, '').replace(/\*\*/g, '').trim()).filter(l => l.length > 6).slice(0, 10).map(t => ({ t, done: false }));
      D.learn.push({ id: uid(), topic: e.topic, level: e.level || 'beginner', steps, created: Date.now() });
    });
    D.imported = true;
    save();
  }

  // ───────── cover art search ─────────
  function bigArt(u) { return u ? u.replace(/\/\d+x\d+bb\./, '/300x300bb.') : ''; }
  async function itunes(params, country) {
    const url = 'https://itunes.apple.com/search?' + params + '&limit=12&country=' + (country || 'GB');
    const r = await fetch(url);
    if (!r.ok) throw new Error('search failed');
    return (await r.json()).results || [];
  }
  async function wikiFilms(q) {
    const url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=12&prop=description&gsrsearch=' + encodeURIComponent(q + ' film');
    const r = await fetch(url);
    const pages = Object.values(((await r.json()).query || {}).pages || {}).sort((a, b) => a.index - b.index);
    return pages.filter(p => /film/i.test(p.description || '') && !/soundtrack|album|song/i.test(p.description || ''))
      .map(p => {
        const y = (p.description.match(/\b(18|19|20)\d{2}\b/) || [])[0] || '';
        const by = (p.description.match(/ by (.+)$/) || [])[1] || '';
        return { kind: 'film', title: p.title.replace(/\s*\((?:\d{4} )?film\)$/i, ''), sub: by, year: y, art: '' };
      });
  }
  async function search(kind, q) {
    const t = encodeURIComponent(q);
    if (kind === 'album') return (await itunes('media=music&entity=album&term=' + t)).map(r => ({ kind, title: r.collectionName.replace(/ - (Single|EP)$/, ''), sub: r.artistName, year: (r.releaseDate || '').slice(0, 4), art: bigArt(r.artworkUrl100) }));
    if (kind === 'song') return (await itunes('media=music&entity=song&term=' + t)).map(r => ({ kind, title: r.trackName, sub: r.artistName, year: (r.releaseDate || '').slice(0, 4), art: bigArt(r.artworkUrl100) }));
    if (kind === 'artist') {
      // artist results carry no image, so use each artist's top album cover
      const albums = await itunes('media=music&entity=album&attribute=artistTerm&term=' + t);
      const seen = new Set(), out = [];
      for (const r of albums) {
        if (seen.has(r.artistId)) continue;
        seen.add(r.artistId);
        out.push({ kind, title: r.artistName, sub: r.primaryGenreName || 'Artist', year: '', art: bigArt(r.artworkUrl100) });
      }
      return out;
    }
    if (kind === 'tv') return (await itunes('media=tvShow&entity=tvSeason&term=' + t, 'US')).map(r => ({ kind, title: r.artistName || r.collectionName, sub: r.collectionName, year: (r.releaseDate || '').slice(0, 4), art: bigArt(r.artworkUrl100) }))
      .filter((r, i, a) => a.findIndex(x => x.title === r.title) === i);
    if (kind === 'book') return (await itunes('media=ebook&entity=ebook&term=' + t)).map(r => ({ kind, title: r.trackName, sub: r.artistName, year: (r.releaseDate || '').slice(0, 4), art: bigArt(r.artworkUrl100) }));
    if (kind === 'podcast') return (await itunes('media=podcast&entity=podcast&term=' + t)).map(r => ({ kind, title: r.collectionName, sub: r.artistName, year: '', art: bigArt(r.artworkUrl600 || r.artworkUrl100) }));
    if (kind === 'film') return wikiFilms(q);
    return [];
  }

  // Generated cover for items without artwork (films, imports, "other").
  function hue(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
  function cover(item, cls) {
    const shape = (KINDS[item.kind] || KINDS.other).shape;
    if (item.art) {
      // Tiles are all square so rows line up. Tall art (posters, book covers)
      // sits uncropped inside the square on a blurred copy of itself.
      const img = `<img src="${esc(item.art)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.querySelectorAll('img').forEach(i=>i.remove())"`;
      return `<div class="fi-cover ${shape} ${cls || ''}">${shape === 'tall' ? img + ' class="blur"/>' + img + ' class="fit"/>' : img + '/>'}<span class="fi-fallback">${esc(item.title)}</span></div>`;
    }
    const h = hue(item.title);
    return `<div class="fi-cover ${shape} gen ${cls || ''}" style="background:linear-gradient(160deg,hsl(${h},45%,26%),hsl(${(h + 40) % 360},50%,10%))">
      <span class="fi-gen-kind">${esc((KINDS[item.kind] || KINDS.other).label.toUpperCase())}</span>
      <span class="fi-gen-title">${esc(item.title)}</span>${item.year ? `<span class="fi-gen-year">${esc(item.year)}</span>` : ''}</div>`;
  }

  // ───────── skills ─────────
  function skillLevel(min) {
    const h = min / 60;
    let lvl = 1;
    while (lvl < SKILL_HOURS.length && h >= SKILL_HOURS[lvl]) lvl++;
    const lo = SKILL_HOURS[lvl - 1], hi = SKILL_HOURS[lvl];
    return { lvl, progress: hi ? (h - lo) / (hi - lo) : 1, toNext: hi ? Math.max(0, hi - h) : 0 };
  }
  function logPractice(id, mins) {
    const s = D.skills.find(x => x.id === id); if (!s) return;
    const before = skillLevel(s.minutes).lvl;
    s.minutes += mins;
    s.log.push({ date: dayKey(), min: mins });
    if (s.log.length > 200) s.log.shift();
    const after = skillLevel(s.minutes).lvl;
    save(); render();
    const xp = Math.round(mins / 30 * XP.practicePer30);
    if (host.awardXP) host.awardXP(xp, s.name + ' practice');
    if (after > before) setTimeout(() => host.toast(`${s.name} is now level ${after}!`), 900);
  }

  // ───────── AI ─────────
  function parseJSON(text) {
    const m = String(text).match(/\[[\s\S]*\]/);
    if (!m) throw new Error('No list in reply');
    return JSON.parse(m[0]);
  }
  // lower-case, no punctuation or leading "the", for matching titles
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/^the /, '').replace(/\s+/g, ' ').trim(); }
  function shelfSummary() {
    return D.shelf.slice(-40).map(i => `${KINDS[i.kind] ? KINDS[i.kind].label : 'Item'}: ${i.title}${i.sub ? ' (' + i.sub + ')' : ''}`).join('; ') || 'nothing yet';
  }
  async function generatePath(q) {
    if (!host.ai) return host.toast('AI is not available here');
    busy[q.id] = true; render();
    try {
      const txt = await host.ai(`Create a learning path for "${q.topic}" for a ${q.level} learner. Return ONLY a JSON array of 6 to 8 steps, in order, each {"t": "short step title (max 9 words)", "d": "one sentence on what to do, naming a specific free resource where useful"}. No other text.`, 900);
      const steps = parseJSON(txt).filter(s => s && s.t).slice(0, 10).map(s => ({ t: String(s.t), d: String(s.d || ''), done: false }));
      if (!steps.length) throw new Error('empty');
      q.steps = steps; save();
    } catch (e) { host.toast("Couldn't generate a path. Try again."); }
    busy[q.id] = false; render();
  }
  function toggleStep(qid, i) {
    const q = D.learn.find(x => x.id === qid); if (!q) return;
    const st = q.steps[i]; st.done = !st.done;
    const allDone = q.steps.length && q.steps.every(s => s.done);
    save(); render();
    if (st.done && host.awardXP) {
      host.awardXP(XP.step + (allDone ? XP.questDone : 0), allDone ? q.topic + ' quest complete' : q.topic + ' step');
    }
  }
  async function discover(kind) {
    if (!host.ai) return host.toast('AI is not available here');
    busy.discover = true; D.discover = { kind, items: [] }; render();
    try {
      const label = { album: 'albums', film: 'films', tv: 'TV shows', book: 'books', podcast: 'podcasts', any: 'albums, films, TV shows, books or podcasts' }[kind];
      const txt = await host.ai(`Someone's taste shelf: ${shelfSummary()}. Recommend 6 ${label} they would probably love but don't already have. Be specific, not generic. Return ONLY a JSON array of objects {"title": "...", "by": "artist/director/author or empty", "kind": one of "album","film","tv","book","podcast", "why": "one short sentence tying it to their taste"}. No other text.`, 900);
      const recs = parseJSON(txt).filter(r => r && r.title).slice(0, 6);
      D.discover = { kind, items: recs.map(r => ({ kind: KINDS[r.kind] ? r.kind : (kind === 'any' ? 'other' : kind), title: String(r.title), sub: String(r.by || ''), why: String(r.why || ''), art: '' })) };
      save(); render();
      // Look up artwork for each suggestion in the background. Only accept a
      // result whose title really matches: the top search hit is often a
      // different thing ("The Bear" → "The Polar Bear Family & Me").
      await Promise.all(D.discover.items.map(async it => {
        if (it.kind === 'film' || it.kind === 'other') return;
        try {
          const want = norm(it.title);
          const res = await search(it.kind, it.title + (it.sub ? ' ' + it.sub : ''));
          const hit = res.find(r => norm(r.title) === want) ||
            res.find(r => norm(r.title).startsWith(want) && (!it.sub || norm(r.sub).includes(norm(it.sub).split(' ')[0])));
          if (hit) { it.art = hit.art; if (!it.sub) it.sub = hit.sub; }
        } catch (e) {}
      }));
      save();
    } catch (e) { host.toast("Couldn't get suggestions. Try again."); D.discover = null; }
    busy.discover = false; render();
  }

  // ───────── render ─────────
  function render() {
    if (!root) return;
    root.querySelectorAll('.fg-tabs button').forEach(b => b.classList.toggle('active', b.dataset.itab === tab));
    const counts = `${D.shelf.length} on your shelf · ${D.skills.length} skill${D.skills.length === 1 ? '' : 's'} · ${D.learn.length} quest${D.learn.length === 1 ? '' : 's'}`;
    $('.fg-sub').textContent = counts;
    const v = $('.fg-view');
    v.innerHTML = tab === 'taste' ? tasteHTML() : tab === 'hobbies' ? hobbiesHTML() : tab === 'skills' ? skillsHTML() : tab === 'learn' ? learnHTML() : discoverHTML();
  }

  function tasteHTML() {
    const items = D.shelf.filter(i => group === 'all' || (KINDS[i.kind] || KINDS.other).group === group).slice().reverse();
    const chips = `<div class="chips">${GROUPS.map(g => `<button data-group="${g.id}" class="${group === g.id ? 'active' : ''}">${g.label}</button>`).join('')}</div>`;
    const empty = !items.length ? `<div class="empty">${D.shelf.length ? 'Nothing in this section yet.' : 'Your shelf is empty. Add the albums, films, shows, books and podcasts that make you <i>you</i>.'}
        <br/><br/><button class="btn btn-ghost" data-act="add">+ Add something</button>
        <button class="btn btn-ghost" data-discover="${{ music: 'album', screen: 'film', books: 'book', podcasts: 'podcast' }[group] || 'any'}">✨ Suggest things I'd like</button></div>` : '';
    return `<div class="fi-bar"><h2 style="margin:0">YOUR SHELF</h2><button class="fi-add" data-act="add">+ Add</button></div>
      ${chips}${empty}
      <div class="fi-shelf">${items.map(i => `<button class="fi-item" data-item="${i.id}">${cover(i)}<b>${esc(i.title)}</b><span>${esc(i.sub || (KINDS[i.kind] || KINDS.other).label)}</span></button>`).join('')}</div>`;
  }

  function hobbiesHTML() {
    const today = dayKey();
    return `<div class="fi-bar"><h2 style="margin:0">HOBBIES</h2></div>
      <div class="fi-inline"><input class="fi-in hobby-in" placeholder="Add a hobby, e.g. Kickboxing" maxlength="40"/><button class="btn btn-primary" data-act="add-hobby">Add</button></div>
      ${D.hobbies.length ? D.hobbies.map(h => {
        const days = h.last ? Math.round((new Date(today) - new Date(h.last)) / DAY) : null;
        const when = days === null ? 'Not logged yet' : days === 0 ? 'Did it today' : days === 1 ? 'Yesterday' : `${days} days ago`;
        return `<div class="card fi-hobby">
          <div><b>${esc(h.name)}</b><span class="${days !== null && days > 14 ? 'c-pr' : ''}">${when}${h.count ? ` · ${h.count} time${h.count === 1 ? '' : 's'}` : ''}</span></div>
          <button class="fi-did ${days === 0 ? 'done' : ''}" data-hobby="${h.id}">${days === 0 ? '✓ Today' : 'Did it'}</button>
          <button class="ex-x" data-rmhobby="${h.id}" aria-label="Remove">×</button>
        </div>`;
      }).join('') : '<div class="empty">What do you do for fun? Add a hobby and tap "Did it" whenever you do it. It keeps a streak and earns XP.</div>'}`;
  }

  function skillsHTML() {
    return `<div class="fi-bar"><h2 style="margin:0">SKILLS</h2></div>
      <div class="fi-inline"><input class="fi-in skill-in" placeholder="Add a skill, e.g. Guitar" maxlength="40"/><button class="btn btn-primary" data-act="add-skill">Add</button></div>
      ${D.skills.length ? D.skills.map(s => {
        const L = skillLevel(s.minutes);
        const hrs = s.minutes / 60;
        return `<div class="card fi-skill">
          <div class="fi-skill-top"><div><b>${esc(s.name)}</b><span>${hrs < 1 ? s.minutes + ' min' : hrs.toFixed(1) + ' h'} practised</span></div>
            <div class="fi-lvl">LV <b>${L.lvl}</b></div><button class="ex-x" data-rmskill="${s.id}" aria-label="Remove">×</button></div>
          <div class="bar"><div style="width:${Math.round(L.progress * 100)}%;background:var(--fg-xp)"></div></div>
          <div class="small muted" style="margin:6px 0 10px">${L.lvl >= 10 ? 'Max level. Mastery.' : `${L.toNext < 1 ? Math.ceil(L.toNext * 60) + ' min' : L.toNext.toFixed(1) + ' h'} to level ${L.lvl + 1}`}</div>
          <div class="fi-log">${[15, 30, 60].map(m => `<button data-practice="${s.id},${m}">+${m < 60 ? m + 'm' : '1h'}</button>`).join('')}</div>
          ${host.share && L.lvl >= 2 ? `<button class="link small" style="margin-top:10px" data-shareskill="${s.id}">Share level ${L.lvl} ↗</button>` : ''}
        </div>`;
      }).join('') : '<div class="empty">Add something you\'re getting better at, like guitar, coding or cooking. Log practice and watch it level up from 1 to 10.</div>'}`;
  }

  function learnHTML() {
    return `<div class="fi-bar"><h2 style="margin:0">LEARNING QUESTS</h2></div>
      <div class="card" style="margin-bottom:14px">
        <input class="fi-in learn-in" placeholder="What do you want to learn?" maxlength="60" style="width:100%"/>
        <div class="fi-inline" style="margin-top:8px">
          <div class="seg">${['beginner', 'intermediate', 'advanced'].map(l => `<button data-level="${l}" class="${(root && root.dataset.level || 'beginner') === l ? 'active' : ''}">${l[0].toUpperCase() + l.slice(1)}</button>`).join('')}</div>
          <button class="btn btn-primary" data-act="add-quest">Start</button>
        </div>
      </div>
      ${D.learn.length ? D.learn.slice().reverse().map(q => {
        const done = q.steps.filter(s => s.done).length, total = q.steps.length;
        return `<div class="card fi-quest">
          <div class="fi-skill-top"><div><b>${esc(q.topic)}</b><span>${q.level} · ${total ? `${done}/${total} steps` : 'no path yet'}</span></div>
            <button class="ex-x" data-rmquest="${q.id}" aria-label="Remove">×</button></div>
          ${total ? `<div class="bar" style="margin:8px 0"><div style="width:${Math.round(done / total * 100)}%;background:var(--fg-good)"></div></div>
            <div class="fi-steps">${q.steps.map((s, i) => `<button class="fi-step ${s.done ? 'done' : ''}" data-step="${q.id},${i}"><i>${s.done ? '✓' : i + 1}</i><div><b>${esc(s.t)}</b>${s.d ? `<span>${esc(s.d)}</span>` : ''}</div></button>`).join('')}</div>
            ${done === total ? `<div class="beltup">🏆 Quest complete. Pick your next topic.${host.share ? ` <button class="link" data-sharequest="${q.id}" style="margin-left:6px">Share ↗</button>` : ''}</div>` : `<div class="small muted" style="margin-top:8px">+${XP.step} XP per step · +${XP.questDone} XP when you finish</div>`}`
          : `<button class="btn btn-ghost" style="margin-top:10px" data-path="${q.id}" ${busy[q.id] ? 'disabled' : ''}>${busy[q.id] ? 'Building your path…' : '✨ Generate learning path'}</button>`}
        </div>`;
      }).join('') : '<div class="empty">Pick something to learn. Forge builds a step-by-step path, and every step you tick off earns XP.</div>'}`;
  }

  function discoverHTML() {
    const opts = [['album', 'Music'], ['film', 'Films'], ['tv', 'TV'], ['book', 'Books'], ['podcast', 'Podcasts'], ['any', 'Surprise me']];
    const d = D.discover;
    return `<div class="card coach"><div class="who">DISCOVER</div><p>Recommendations based on everything on your shelf${D.shelf.length ? ` (${D.shelf.length} items)` : ''}. The more you add, the better they get.</p></div>
      <div class="fi-disc">${opts.map(([k, l]) => `<button data-discover="${k}" ${busy.discover ? 'disabled' : ''} class="${d && d.kind === k ? 'active' : ''}">${l}</button>`).join('')}</div>
      ${busy.discover && (!d || !d.items.length) ? '<div class="empty">Finding things you\'ll like…</div>' : ''}
      ${d && d.items.length ? `<div class="fi-recs">${d.items.map((r, i) => {
        const have = D.shelf.some(x => x.title.toLowerCase() === r.title.toLowerCase());
        return `<div class="fi-rec">${cover(r, 'small')}<div><b>${esc(r.title)}</b><span>${esc(r.sub)}</span><p>${esc(r.why)}</p></div>
          <button class="fi-add-rec ${have ? 'done' : ''}" data-addrec="${i}" ${have ? 'disabled' : ''}>${have ? '✓' : '+'}</button></div>`;
      }).join('')}</div>` : ''}`;
  }

  // ───────── sheets ─────────
  function openSheet(html) { sheet.querySelector('.sheet-inner').innerHTML = html; sheet.classList.remove('hidden'); }
  function closeSheet() { sheet.classList.add('hidden'); }

  function openAdd() {
    const kinds = ['album', 'artist', 'song', 'film', 'tv', 'book', 'podcast'];
    openSheet(`<div class="sheet-title">ADD TO SHELF <button data-act="close">✕</button></div>
      <div class="chips fi-kinds">${kinds.map(k => `<button data-kind="${k}" class="${searchKind === k ? 'active' : ''}">${KINDS[k].label}</button>`).join('')}</div>
      <input class="search fi-q" placeholder="Search ${KINDS[searchKind].label.toLowerCase()}s" autocomplete="off"/>
      <div class="fi-results"><div class="empty small">Type to search.${searchKind === 'film' ? ' Film posters aren\'t available, so films get a designed cover.' : ''}</div></div>
      <button class="btn btn-ghost fi-manual" data-act="manual" style="margin-top:10px">Can't find it? Add it by name</button>`);
    const q = sheet.querySelector('.fi-q');
    q.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 350); });
    q.focus();
  }
  let lastResults = [];
  async function runSearch() {
    const q = (sheet.querySelector('.fi-q') || {}).value || '';
    const box = sheet.querySelector('.fi-results');
    if (!box) return;
    if (q.trim().length < 2) { box.innerHTML = '<div class="empty small">Type to search.</div>'; return; }
    const seq = ++searchSeq;
    box.innerHTML = '<div class="empty small">Searching…</div>';
    try {
      const res = await search(searchKind, q.trim());
      if (seq !== searchSeq) return;
      lastResults = res;
      box.innerHTML = res.length ? `<div class="fi-grid">${res.map((r, i) => `<button class="fi-item" data-pickres="${i}">${cover(r)}<b>${esc(r.title)}</b><span>${esc([r.sub, r.year].filter(Boolean).join(' · '))}</span></button>`).join('')}</div>`
        : '<div class="empty small">No results. Try different words, or add it by name below.</div>';
    } catch (e) {
      if (seq === searchSeq) box.innerHTML = '<div class="empty small">Search is unavailable right now. You can still add it by name below.</div>';
    }
  }
  function addToShelf(r) {
    if (D.shelf.some(x => x.title.toLowerCase() === r.title.toLowerCase() && x.kind === r.kind)) { host.toast('Already on your shelf'); return false; }
    D.shelf.push({ id: uid(), kind: r.kind, title: r.title, sub: r.sub || '', year: r.year || '', art: r.art || '', note: '', added: Date.now() });
    save(); host.toast('Added to your shelf');
    return true;
  }
  function openItem(id) {
    const i = D.shelf.find(x => x.id === id); if (!i) return;
    openSheet(`<div class="sheet-title">${esc((KINDS[i.kind] || KINDS.other).label.toUpperCase())} <button data-act="close">✕</button></div>
      <div class="fi-detail">${cover(i)}<div><b>${esc(i.title)}</b><span>${esc([i.sub, i.year].filter(Boolean).join(' · '))}</span>
        <div class="fi-stars">${[1, 2, 3, 4, 5].map(n => `<button data-rate="${i.id},${n}" class="${(i.rating || 0) >= n ? 'on' : ''}">★</button>`).join('')}</div></div></div>
      <div class="field" style="margin-top:14px"><label>WHAT YOU THINK OF IT</label><input class="fi-note" value="${esc(i.note || '')}" placeholder="Your take, in a line" maxlength="140"/></div>
      <button class="btn btn-primary" data-savenote="${i.id}">Save</button>
      <button class="btn btn-danger" data-rmitem="${i.id}">Remove from shelf</button>`);
  }

  // ───────── events ─────────
  function onClick(ev) {
    const t = ev.target.closest('button, a');
    if (!t) { if (ev.target === sheet) closeSheet(); return; }
    const d = t.dataset;
    if (d.itab) { tab = d.itab; return render(); }
    if (d.group) { group = d.group; return render(); }
    if (d.item) return openItem(d.item);
    if (d.kind) {
      searchKind = d.kind;
      sheet.querySelectorAll('.fi-kinds button').forEach(b => b.classList.toggle('active', b.dataset.kind === d.kind));
      const q = sheet.querySelector('.fi-q'); q.placeholder = 'Search ' + KINDS[d.kind].label.toLowerCase() + 's';
      return runSearch();
    }
    if (d.pickres) { if (addToShelf(lastResults[+d.pickres])) { closeSheet(); render(); } return; }
    if (d.rate) { const [id, n] = d.rate.split(','); const i = D.shelf.find(x => x.id === id); if (i) { i.rating = i.rating === +n ? 0 : +n; save(); openItem(id); render(); } return; }
    if (d.savenote) { const i = D.shelf.find(x => x.id === d.savenote); if (i) { i.note = sheet.querySelector('.fi-note').value.trim(); save(); } closeSheet(); return host.toast('Saved'); }
    if (d.rmitem) { if (!confirm('Remove this from your shelf?')) return; D.shelf = D.shelf.filter(x => x.id !== d.rmitem); save(); closeSheet(); return render(); }
    if (d.hobby) {
      const h = D.hobbies.find(x => x.id === d.hobby); if (!h) return;
      if (h.last === dayKey()) return host.toast('Already logged today');
      h.last = dayKey(); h.count = (h.count || 0) + 1; save(); render();
      if (host.awardXP) host.awardXP(XP.hobby, h.name);
      return;
    }
    if (d.rmhobby) { D.hobbies = D.hobbies.filter(x => x.id !== d.rmhobby); save(); return render(); }
    if (d.practice) { const [id, m] = d.practice.split(','); return logPractice(id, +m); }
    if (d.rmskill) { if (!confirm('Remove this skill and its practice history?')) return; D.skills = D.skills.filter(x => x.id !== d.rmskill); save(); return render(); }
    if (d.level) { root.dataset.level = d.level; root.querySelectorAll('[data-level]').forEach(b => b.classList.toggle('active', b.dataset.level === d.level)); return; }
    if (d.path) { const q = D.learn.find(x => x.id === d.path); if (q) generatePath(q); return; }
    if (d.step) { const [id, i] = d.step.split(','); return toggleStep(id, +i); }
    if (d.sharequest) {
      const q = D.learn.find(x => x.id === d.sharequest);
      if (q && host.share) host.share([{ type: 'quest', label: 'Quest', data: { topic: q.topic, level: q.level, steps: q.steps.map(s => s.t) } }]);
      return;
    }
    if (d.shareskill) {
      const s = D.skills.find(x => x.id === d.shareskill);
      if (s && host.share) host.share([{ type: 'skill', label: 'Level', data: { name: s.name, level: skillLevel(s.minutes).lvl, hours: (Math.round(s.minutes / 6) / 10).toString() } }]);
      return;
    }
    if (d.rmquest) { if (!confirm('Remove this quest?')) return; D.learn = D.learn.filter(x => x.id !== d.rmquest); save(); return render(); }
    if (d.discover) { tab = 'discover'; return discover(d.discover); }
    if (d.addrec) { const r = D.discover && D.discover.items[+d.addrec]; if (r && addToShelf(r)) render(); return; }
    switch (d.act) {
      case 'add': return openAdd();
      case 'close': return closeSheet();
      case 'manual': {
        const q = (sheet.querySelector('.fi-q') || {}).value || '';
        if (q.trim().length < 1) { host.toast('Type the name first'); return; }
        if (addToShelf({ kind: searchKind, title: q.trim() })) { closeSheet(); render(); }
        return;
      }
      case 'add-hobby': {
        const v = ($('.hobby-in') || {}).value || '';
        if (!v.trim()) return;
        D.hobbies.push({ id: uid(), name: v.trim(), last: null, count: 0 }); save(); return render();
      }
      case 'add-skill': {
        const v = ($('.skill-in') || {}).value || '';
        if (!v.trim()) return;
        D.skills.push({ id: uid(), name: v.trim(), minutes: 0, log: [] }); save(); return render();
      }
      case 'add-quest': {
        const v = ($('.learn-in') || {}).value || '';
        if (!v.trim()) return host.toast('What do you want to learn?');
        const q = { id: uid(), topic: v.trim(), level: root.dataset.level || 'beginner', steps: [], created: Date.now() };
        D.learn.push(q); save(); render();
        return generatePath(q);
      }
    }
  }
  function onKey(ev) {
    if (ev.key !== 'Enter') return;
    const c = ev.target.classList;
    const act = c.contains('hobby-in') ? 'add-hobby' : c.contains('skill-in') ? 'add-skill' : c.contains('learn-in') ? 'add-quest' : null;
    if (act) { const b = root.querySelector(`[data-act="${act}"]`); if (b) b.click(); }
  }

  function mount(el, hostApi) {
    host = hostApi; root = el;
    D = Object.assign(fresh(), host.get() || {});
    importLegacy();
    root.classList.add('fg', 'fi');
    root.innerHTML = `
      <div class="fg-head"><div><div class="brand">INTERESTS</div><div class="sub fg-sub"></div></div></div>
      <div class="fg-tabs">
        <button data-itab="taste">Taste</button><button data-itab="hobbies">Hobbies</button><button data-itab="skills">Skills</button><button data-itab="learn">Learn</button><button data-itab="discover">Discover</button>
      </div>
      <div class="fg-view"></div>`;
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.className = 'fg fi fg-sheet hidden';
      sheet.innerHTML = '<div class="sheet-inner"></div>';
      document.body.appendChild(sheet);
      sheet.addEventListener('click', onClick);
    }
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKey);
    render();
  }
  function refresh() { if (!root) return; D = Object.assign(fresh(), host.get() || {}); importLegacy(); render(); }

  function mentorSummary() {
    if (!D) return 'n/a';
    const skills = D.skills.map(s => `${s.name} LV${skillLevel(s.minutes).lvl}`).join(', ');
    const quests = D.learn.map(q => `${q.topic} ${q.steps.filter(s => s.done).length}/${q.steps.length}`).join(', ');
    const taste = D.shelf.slice(-8).map(i => i.title).join(', ');
    return `Skills: ${skills || 'none'}. Learning: ${quests || 'none'}. Recently added to taste shelf: ${taste || 'nothing'}.`;
  }

  return { mount, refresh, render, mentorSummary };
})();
