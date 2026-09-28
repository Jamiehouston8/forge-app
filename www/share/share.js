// Forge share cards — achievement images for Instagram / TikTok stories.
//
// ForgeShare.open(variants) renders one or more cards to a 1080×1920 canvas and
// shows a preview with Share / Save. `variants` is a list of { type, data, label }.
// Card types: workout, pr, belt, ranks, quest, skill.
// Share uses the Web Share API with an image file where supported (phones),
// otherwise it downloads the PNG. In the iOS/Android apps (Capacitor) neither
// works inside the WebView, so the PNG is written to the app cache with the
// Filesystem plugin and handed to the native share sheet (Share plugin), which
// also offers Save Image. No personal details are drawn on the cards.
// Needs exercises.js (BELTS, MUSCLES) and bodymap.js (BODY_* shapes) for gym cards.

const ForgeShare = (function () {
  const W = 1080, H = 1920;
  const C = { bg: '#0a0a0a', text: '#ffffff', muted: '#8a8a8a', dim: '#262626', xp: '#7c6cff', pr: '#ff8c42', good: '#3ddc84' };
  const HUD = 'Orbitron, monospace', MONO = '"Share Tech Mono", monospace', UI = 'Inter, -apple-system, "Segoe UI", sans-serif';

  let overlay = null, current = [], idx = 0, lastCanvas = null;
  const SHARE_TEXT = 'Built with Forge · forge-app.co.uk';

  // Native share needs both plugins; builds without them fall back to the web path.
  function nativePlugins() {
    const cap = window.Capacitor;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform() || !cap.Plugins) return null;
    const { Share, Filesystem } = cap.Plugins;
    return Share && Filesystem ? { Share, Filesystem } : null;
  }

  async function loadFonts() {
    if (!document.fonts || !document.fonts.load) return;
    try {
      await Promise.all(['900 100px Orbitron', '700 40px Orbitron', '40px "Share Tech Mono"', '700 40px Inter', '600 40px Inter']
        .map(f => document.fonts.load(f)));
    } catch (e) { /* fall back to system fonts */ }
  }

  // ───────── drawing helpers ─────────
  function txt(ctx, s, x, y, o) {
    o = o || {};
    ctx.save();
    ctx.font = o.font || `40px ${UI}`;
    ctx.fillStyle = o.color || C.text;
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.baseline || 'alphabetic';
    if ('letterSpacing' in ctx) ctx.letterSpacing = (o.spacing || 0) + 'px';
    if (o.maxWidth) {
      // shrink to fit rather than overflow
      let size = parseInt(ctx.font.match(/(\d+)px/)[1], 10);
      while (size > 20 && ctx.measureText(s).width > o.maxWidth) {
        size -= 4;
        ctx.font = ctx.font.replace(/\d+px/, size + 'px');
      }
    }
    ctx.fillText(s, x, y);
    ctx.restore();
  }
  function wrap(ctx, s, maxW, font, maxLines) {
    ctx.save(); ctx.font = font;
    const words = String(s).split(/\s+/), lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    }
    if (line) lines.push(line);
    ctx.restore();
    if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…'; }
    return lines;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function panel(ctx, x, y, w, h) {
    roundRect(ctx, x, y, w, h, 28);
    ctx.fillStyle = 'rgba(255,255,255,0.045)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.09)'; ctx.lineWidth = 2; ctx.stroke();
  }
  function background(ctx, accent) {
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W / 2, 260, 40, W / 2, 260, 1000);
    g.addColorStop(0, hexA(accent, 0.34)); g.addColorStop(0.55, hexA(accent, 0.07)); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // faint HUD grid
    ctx.strokeStyle = 'rgba(255,255,255,0.035)'; ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 90) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 90) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  }
  function brand(ctx) {
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(90, H - 250, W - 180, 2);
    txt(ctx, 'FORGE', W / 2, H - 150, { font: `900 64px ${HUD}`, align: 'center', spacing: 18 });
    txt(ctx, 'forge-app.co.uk', W / 2, H - 92, { font: `34px ${MONO}`, align: 'center', color: C.muted, spacing: 3 });
  }
  function kicker(ctx, s, color, y) {
    txt(ctx, s, W / 2, y || 250, { font: `700 36px ${HUD}`, align: 'center', color, spacing: 10 });
  }
  function hexA(hex, a) {
    const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function beltBar(ctx, belt, cx, y, w, h) {
    roundRect(ctx, cx - w / 2, y, w, h, 10);
    ctx.fillStyle = belt.color; ctx.fill();
    if (belt.name === 'Black') { ctx.strokeStyle = '#9a9a9a'; ctx.lineWidth = 4; ctx.stroke(); }
    // belt knot
    ctx.fillStyle = belt.name === 'Black' ? '#1c1c1c' : 'rgba(0,0,0,0.22)';
    ctx.fillRect(cx - h * 0.45, y - 8, h * 0.9, h + 16);
  }
  function fmt(n) { return Math.round(n).toLocaleString('en-GB'); }
  function kg(n) { return (Math.round((Number(n) || 0) * 10) / 10) + 'kg'; }
  function dur(ms) { const m = Math.round(ms / 60000); return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm'; }

  // Body map drawn as a standalone SVG image (CSS classes don't apply inside
  // canvas images, so fills are inlined).
  function bodyImage(side, fill) {
    const map = side === 'front' ? BODY_FRONT : BODY_BACK;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="30 0 140 400" width="560" height="1600">`;
    for (const sh of BODY_SHELL) {
      s += `<${sh.t} ${sh.a} fill="#171717"/>`;
      if (sh.m && sh.t === 'polygon') s += `<polygon points="${mirror(sh.a.match(/points="([^"]+)"/)[1])}" fill="#171717"/>`;
    }
    for (const [m, polys] of Object.entries(map)) {
      const c = fill(m) || '#262626';
      for (const p of polys) {
        s += `<polygon points="${p}" fill="${c}" stroke="#0a0a0a" stroke-width="1.2" stroke-linejoin="round"/>`;
        s += `<polygon points="${mirror(p)}" fill="${c}" stroke="#0a0a0a" stroke-width="1.2" stroke-linejoin="round"/>`;
      }
    }
    s += '</svg>';
    return new Promise(res => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
    });
  }
  async function drawBodies(ctx, fill, y, h) {
    const [f, b] = await Promise.all([bodyImage('front', fill), bodyImage('back', fill)]);
    const w = h * 0.35;
    if (f) ctx.drawImage(f, W / 2 - w - 30, y, w, h);
    if (b) ctx.drawImage(b, W / 2 + 30, y, w, h);
  }
  const beltColor = b => b.name === 'Black' ? '#f2f2f2' : b.color;

  // ───────── cards ─────────
  const CARDS = {
    async workout(ctx, d) {
      background(ctx, C.xp);
      kicker(ctx, 'WORKOUT COMPLETE', C.xp);
      txt(ctx, d.name.toUpperCase(), W / 2, 420, { font: `900 140px ${HUD}`, align: 'center', spacing: 6, maxWidth: W - 160 });
      txt(ctx, d.date, W / 2, 490, { font: `34px ${MONO}`, align: 'center', color: C.muted, spacing: 2 });
      const stats = [[dur(d.ms), 'TIME'], [String(d.sets), 'SETS'], [fmt(d.volume), 'KG MOVED']];
      stats.forEach(([v, l], i) => {
        const x = 90 + i * 310;
        panel(ctx, x, 570, 280, 200);
        txt(ctx, v, x + 140, 675, { font: `700 64px ${HUD}`, align: 'center', maxWidth: 250 });
        txt(ctx, l, x + 140, 735, { font: `700 22px ${HUD}`, align: 'center', color: C.muted, spacing: 5 });
      });
      const rows = d.lifts.slice(0, 7);
      panel(ctx, 90, 830, W - 180, 110 + rows.length * 92);
      rows.forEach((r, i) => {
        const y = 920 + i * 92;
        txt(ctx, r.name, 140, y, { font: `600 44px ${UI}`, maxWidth: 560 });
        txt(ctx, (r.pr ? '★ ' : '') + r.best, W - 140, y, { font: `40px ${MONO}`, align: 'right', color: r.pr ? C.pr : '#d0d0d0' });
      });
      let y = 830 + 110 + rows.length * 92 + 110;
      txt(ctx, `+${d.xp} XP`, W / 2, y, { font: `900 96px ${HUD}`, align: 'center', color: C.xp });
      if (d.prs) txt(ctx, `${d.prs} NEW PR${d.prs > 1 ? 'S' : ''}`, W / 2, y + 80, { font: `700 34px ${HUD}`, align: 'center', color: C.pr, spacing: 8 });
      brand(ctx);
    },
    async pr(ctx, d) {
      background(ctx, C.pr);
      kicker(ctx, 'NEW PERSONAL RECORD', C.pr);
      const lines = wrap(ctx, d.exercise, W - 180, `700 96px ${UI}`, 2);
      lines.forEach((l, i) => txt(ctx, l, W / 2, 470 + i * 110, { font: `700 96px ${UI}`, align: 'center' }));
      const top = 470 + lines.length * 110 + 190;
      txt(ctx, d.bw && !d.weight ? `${d.reps} REPS` : `${kg(d.weight).toUpperCase()} × ${d.reps}`, W / 2, top, { font: `900 150px ${HUD}`, align: 'center', maxWidth: W - 120 });
      txt(ctx, `Estimated 1-rep max ${kg(d.e1rm)}`, W / 2, top + 110, { font: `40px ${MONO}`, align: 'center', color: C.muted });
      if (d.belt) {
        beltBar(ctx, d.belt, W / 2, top + 260, 560, 64);
        txt(ctx, `${d.belt.name.toUpperCase()} BELT LIFT`, W / 2, top + 420, { font: `700 44px ${HUD}`, align: 'center', color: beltColor(d.belt), spacing: 8 });
      }
      brand(ctx);
    },
    async belt(ctx, d) {
      const col = beltColor(d.belt);
      background(ctx, d.belt.name === 'White' || d.belt.name === 'Black' ? '#bbbbbb' : d.belt.color);
      kicker(ctx, 'BELT UP', col);
      txt(ctx, d.muscleName.toUpperCase(), W / 2, 420, { font: `900 130px ${HUD}`, align: 'center', spacing: 6, maxWidth: W - 140 });
      beltBar(ctx, d.belt, W / 2, 500, 620, 70);
      txt(ctx, `${d.belt.name.toUpperCase()} BELT`, W / 2, 680, { font: `700 56px ${HUD}`, align: 'center', color: col, spacing: 10 });
      await drawBodies(ctx, m => m === d.muscle ? col : null, 760, 820);
      txt(ctx, `${d.lift} · est. max ${kg(d.e1rm)}`, W / 2, 1640, { font: `38px ${MONO}`, align: 'center', color: C.muted, maxWidth: W - 160 });
      brand(ctx);
    },
    async ranks(ctx, d) {
      const col = d.overall ? beltColor(d.overall) : C.muted;
      background(ctx, d.overall && d.overall.name !== 'White' && d.overall.name !== 'Black' ? d.overall.color : '#9a9a9a');
      kicker(ctx, 'MY GYM RANK', col);
      txt(ctx, d.overall ? `${d.overall.name.toUpperCase()} BELT` : 'UNRANKED', W / 2, 400, { font: `900 110px ${HUD}`, align: 'center', color: col, spacing: 4, maxWidth: W - 140 });
      txt(ctx, `${d.ranked} of ${d.total} muscle groups ranked`, W / 2, 470, { font: `34px ${MONO}`, align: 'center', color: C.muted });
      await drawBodies(ctx, m => d.colors[m] || null, 530, 900);
      // legend
      const shown = BELTS.filter(b => Object.values(d.colors).includes(beltColor(b)));
      const lw = shown.length * 170;
      shown.forEach((b, i) => {
        const x = W / 2 - lw / 2 + i * 170;
        roundRect(ctx, x, 1490, 36, 22, 5); ctx.fillStyle = beltColor(b); ctx.fill();
        txt(ctx, b.name, x + 48, 1509, { font: `30px ${MONO}`, color: '#bbb' });
      });
      brand(ctx);
    },
    async quest(ctx, d) {
      background(ctx, C.good);
      kicker(ctx, 'QUEST COMPLETE', C.good);
      const lines = wrap(ctx, d.topic, W - 180, `700 100px ${UI}`, 2);
      lines.forEach((l, i) => txt(ctx, l, W / 2, 440 + i * 112, { font: `700 100px ${UI}`, align: 'center' }));
      const top = 440 + lines.length * 112;
      txt(ctx, `${d.steps.length} STEPS · ${d.level.toUpperCase()}`, W / 2, top + 20, { font: `700 32px ${HUD}`, align: 'center', color: C.muted, spacing: 6 });
      const steps = d.steps.slice(0, 8);
      panel(ctx, 90, top + 80, W - 180, 60 + steps.length * 100);
      steps.forEach((s, i) => {
        const y = top + 160 + i * 100;
        ctx.beginPath(); ctx.arc(160, y - 14, 26, 0, Math.PI * 2); ctx.fillStyle = C.good; ctx.fill();
        txt(ctx, '✓', 160, y - 2, { font: `700 32px ${UI}`, align: 'center', color: '#000' });
        txt(ctx, wrap(ctx, s, W - 360, `600 40px ${UI}`, 1)[0], 215, y, { font: `600 40px ${UI}`, color: '#e8e8e8' });
      });
      brand(ctx);
    },
    async skill(ctx, d) {
      background(ctx, C.xp);
      kicker(ctx, 'LEVEL UP', C.xp);
      const lines = wrap(ctx, d.name, W - 180, `700 110px ${UI}`, 2);
      lines.forEach((l, i) => txt(ctx, l, W / 2, 480 + i * 120, { font: `700 110px ${UI}`, align: 'center' }));
      const top = 480 + lines.length * 120 + 120;
      txt(ctx, 'LEVEL', W / 2, top + 60, { font: `700 44px ${HUD}`, align: 'center', color: C.muted, spacing: 14 });
      txt(ctx, String(d.level), W / 2, top + 400, { font: `900 380px ${HUD}`, align: 'center', color: C.xp });
      // level pips
      for (let i = 0; i < 10; i++) {
        const x = W / 2 - 5 * 78 + i * 78 + 8;
        roundRect(ctx, x, top + 480, 62, 18, 6);
        ctx.fillStyle = i < d.level ? C.xp : 'rgba(255,255,255,0.1)'; ctx.fill();
      }
      txt(ctx, `${d.hours} hours of practice`, W / 2, top + 590, { font: `40px ${MONO}`, align: 'center', color: C.muted });
      brand(ctx);
    },
  };

  // ── main-app cards ──
  CARDS.streak = async (ctx, d) => {
    background(ctx, '#ff8c42');
    kicker(ctx, 'STREAK', C.pr);
    txt(ctx, String(d.days), W / 2, 820, { font: `900 440px ${HUD}`, align: 'center', color: C.text });
    txt(ctx, 'DAYS IN A ROW', W / 2, 950, { font: `700 60px ${HUD}`, align: 'center', color: C.pr, spacing: 12 });
    // last 14 days as dots, lit for the streak
    const n = Math.min(14, d.days);
    for (let i = 0; i < 14; i++) {
      const x = W / 2 - 7 * 64 + i * 64 + 32;
      ctx.beginPath(); ctx.arc(x, 1110, 20, 0, Math.PI * 2);
      ctx.fillStyle = i >= 14 - n ? C.pr : 'rgba(255,255,255,0.1)'; ctx.fill();
    }
    if (d.line) wrap(ctx, d.line, W - 200, `600 48px ${UI}`, 3).forEach((l, i) => txt(ctx, l, W / 2, 1300 + i * 66, { font: `600 48px ${UI}`, align: 'center', color: '#d8d8d8' }));
    if (d.best > d.days) txt(ctx, `Best: ${d.best} days`, W / 2, 1560, { font: `36px ${MONO}`, align: 'center', color: C.muted });
    brand(ctx);
  };
  CARDS.level = async (ctx, d) => {
    background(ctx, C.xp);
    kicker(ctx, 'LEVEL UP', C.xp);
    // XP ring
    ctx.save(); ctx.lineWidth = 34; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.arc(W / 2, 760, 300, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = C.xp; ctx.beginPath(); ctx.arc(W / 2, 760, 300, -Math.PI / 2, Math.PI * 1.5); ctx.stroke();
    ctx.restore();
    txt(ctx, 'LEVEL', W / 2, 640, { font: `700 44px ${HUD}`, align: 'center', color: C.muted, spacing: 14 });
    txt(ctx, String(d.level), W / 2, 890, { font: `900 280px ${HUD}`, align: 'center' });
    txt(ctx, `${fmt(d.xp)} XP EARNED`, W / 2, 1210, { font: `700 56px ${HUD}`, align: 'center', color: C.xp, spacing: 6 });
    if (d.streak) txt(ctx, `${d.streak}-day streak`, W / 2, 1300, { font: `40px ${MONO}`, align: 'center', color: C.muted });
    txt(ctx, 'Earned by showing up, one goal at a time.', W / 2, 1480, { font: `600 44px ${UI}`, align: 'center', color: '#cfcfcf' });
    brand(ctx);
  };
  CARDS.day = async (ctx, d) => {
    background(ctx, C.good);
    kicker(ctx, 'PERFECT DAY', C.good);
    txt(ctx, d.date.toUpperCase(), W / 2, 330, { font: `36px ${MONO}`, align: 'center', color: C.muted, spacing: 4 });
    const rows = [['GOALS', d.goals, d.goalsTotal], ['NON-NEGOTIABLES', d.nn, d.nnTotal]].filter(r => r[2] > 0);
    rows.forEach(([l, a, b], i) => {
      const y = 460 + i * 380;
      panel(ctx, 90, y, W - 180, 320);
      txt(ctx, `${a}/${b}`, W / 2, y + 190, { font: `900 170px ${HUD}`, align: 'center', color: a >= b ? C.good : C.text });
      txt(ctx, l, W / 2, y + 270, { font: `700 34px ${HUD}`, align: 'center', color: C.muted, spacing: 10 });
    });
    const y = 460 + rows.length * 380 + 90;
    if (d.streak) txt(ctx, `🔥 ${d.streak}-day streak`, W / 2, y, { font: `700 56px ${UI}`, align: 'center' });
    if (d.xp) txt(ctx, `+${d.xp} XP today`, W / 2, y + 90, { font: `700 48px ${HUD}`, align: 'center', color: C.xp });
    brand(ctx);
  };
  CARDS.week = async (ctx, d) => {
    background(ctx, C.xp);
    kicker(ctx, 'MY WEEK', C.xp);
    txt(ctx, d.range.toUpperCase(), W / 2, 330, { font: `36px ${MONO}`, align: 'center', color: C.muted, spacing: 3 });
    const tiles = [
      [d.goalsPct === null ? '—' : d.goalsPct + '%', 'GOALS HIT'],
      [String(d.streak || 0), 'DAY STREAK'],
      [d.xp === null ? '—' : '+' + fmt(d.xp), 'XP EARNED'],
      [String(d.workouts || 0), 'WORKOUTS'],
      [d.volume ? fmt(d.volume) : '—', 'KG LIFTED'],
      [d.sleep ? d.sleep.toFixed(1) + 'h' : '—', 'AVG SLEEP'],
    ];
    tiles.forEach(([v, l], i) => {
      const x = 90 + (i % 2) * 460, y = 420 + Math.floor(i / 2) * 300;
      panel(ctx, x, y, 440, 260);
      txt(ctx, v, x + 220, y + 150, { font: `900 96px ${HUD}`, align: 'center', maxWidth: 400 });
      txt(ctx, l, x + 220, y + 215, { font: `700 28px ${HUD}`, align: 'center', color: C.muted, spacing: 6 });
    });
    if (d.pr) {
      panel(ctx, 90, 1350, W - 180, 180);
      txt(ctx, 'BEST LIFT', 140, 1420, { font: `700 28px ${HUD}`, color: C.pr, spacing: 6 });
      txt(ctx, d.pr, 140, 1490, { font: `600 50px ${UI}`, maxWidth: W - 280 });
    }
    brand(ctx);
  };

  async function render(v) {
    await loadFonts();
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    await CARDS[v.type](ctx, v.data);
    return canvas;
  }

  // ───────── preview + share ─────────
  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'forge-share';
    overlay.innerHTML = `
      <style>
        #forge-share{position:fixed;inset:0;z-index:9800;background:rgba(0,0,0,0.88);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;gap:14px;font-family:Inter,-apple-system,sans-serif;}
        #forge-share.hidden{display:none;}
        #forge-share .fs-img{max-height:62vh;max-width:100%;aspect-ratio:9/16;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,0.6);background:#111;}
        #forge-share .fs-tabs{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;}
        #forge-share .fs-tabs button{font:12px Inter,sans-serif;padding:7px 12px;border-radius:999px;border:1px solid #333;background:none;color:#aaa;cursor:pointer;}
        #forge-share .fs-tabs button.on{background:#fff;color:#000;border-color:#fff;}
        #forge-share .fs-btns{display:flex;gap:10px;width:100%;max-width:380px;}
        #forge-share .fs-btns button{flex:1;padding:14px;border-radius:12px;font:700 15px Inter,sans-serif;cursor:pointer;border:none;}
        #forge-share .fs-share{background:#fff;color:#000;}
        #forge-share .fs-save{background:#1c1c1c;color:#ddd;border:1px solid #333!important;}
        #forge-share .fs-close{position:absolute;top:14px;right:16px;background:none;border:none;color:#aaa;font-size:26px;cursor:pointer;}
        #forge-share .fs-note{font:12px 'Share Tech Mono',monospace;color:#666;text-align:center;}
      </style>
      <button class="fs-close" aria-label="Close">✕</button>
      <div class="fs-tabs"></div>
      <img class="fs-img" alt="Share card preview"/>
      <div class="fs-btns">${nativePlugins() ? '' : '<button class="fs-save">Save image</button>'}<button class="fs-share">${nativePlugins() ? 'Share or save' : 'Share'}</button></div>
      <div class="fs-note">Post it to your story. Nothing personal is on the card.</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => {
      const t = e.target;
      if (t === overlay || t.classList.contains('fs-close')) return close();
      if (t.dataset.v !== undefined) { idx = +t.dataset.v; return show(); }
      if (t.classList.contains('fs-share')) return share();
      if (t.classList.contains('fs-save')) return download();
    });
    return overlay;
  }
  function close() { if (overlay) overlay.classList.add('hidden'); }
  async function show() {
    const o = ensureOverlay();
    o.classList.remove('hidden');
    o.querySelector('.fs-tabs').innerHTML = current.length > 1
      ? current.map((v, i) => `<button data-v="${i}" class="${i === idx ? 'on' : ''}">${v.label}</button>`).join('') : '';
    const img = o.querySelector('.fs-img');
    img.style.opacity = '0.4';
    lastCanvas = await render(current[idx]);
    img.src = lastCanvas.toDataURL('image/png');
    img.style.opacity = '1';
  }
  function fileName() { return 'forge-' + current[idx].type + '.png'; }
  function blob() { return new Promise(r => lastCanvas.toBlob(r, 'image/png')); }
  async function share() {
    if (!lastCanvas) return;
    const native = nativePlugins();
    if (native) return shareNative(native);
    const b = await blob();
    const file = new File([b], fileName(), { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text: SHARE_TEXT }); } catch (e) { /* user cancelled */ }
    } else {
      download();
    }
  }
  async function shareNative({ Share, Filesystem }) {
    const btn = overlay && overlay.querySelector('.fs-share');
    if (btn) btn.disabled = true;
    try {
      const data = lastCanvas.toDataURL('image/png').split(',')[1];
      const { uri } = await Filesystem.writeFile({ path: fileName(), data, directory: 'CACHE' });
      await Share.share({ files: [uri], text: SHARE_TEXT, dialogTitle: 'Share your Forge card' });
    } catch (e) {
      // closing the share sheet rejects with "Share canceled"; anything else is a real failure
      if (!/cancel/i.test(String(e && (e.message || e)))) {
        console.log('Native share failed:', e);
        alertBox("Couldn't open sharing. Try again.");
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }
  function alertBox(msg) {
    const n = overlay && overlay.querySelector('.fs-note');
    if (n) { const old = n.textContent; n.textContent = msg; setTimeout(() => { n.textContent = old; }, 3000); }
  }
  async function download() {
    if (!lastCanvas) return;
    const b = await blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = fileName();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function open(variants) {
    current = (variants || []).filter(v => v && CARDS[v.type]);
    if (!current.length) return;
    idx = 0;
    show();
  }

  return { open, render };
})();
