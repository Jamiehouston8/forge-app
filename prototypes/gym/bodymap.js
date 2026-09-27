// Forge Gym — front/back body map.
// Low-poly figure in a 200×400 box. Only the LEFT half of each muscle is drawn
// here; it's mirrored around x=100 for the right side. `fill(muscle)` returns
// the colour for a muscle id (from MUSCLES), or null for "untrained".

const BODY_FRONT = {
  shoulders: ['74,70 60,77 54,97 64,104 74,92 79,76'],
  chest:     ['100,72 79,76 74,92 78,110 100,114'],
  traps:     ['100,58 88,60 76,69 100,66'],
  biceps:    ['60,105 54,99 48,127 52,141 60,139 65,113'],
  forearms:  ['48,144 60,142 58,162 51,192 43,190 42,162'],
  abs:       ['100,117 87,117 88,178 100,186', '78,112 86,116 87,178 82,175 76,140'],
  quads:     ['82,192 99,196 97,216 94,272 84,283 76,271 74,222'],
  calves:    ['78,294 92,294 92,340 87,372 81,372 76,330'],
};

const BODY_BACK = {
  traps:      ['100,56 80,66 90,100 100,108'],
  shoulders:  ['78,68 62,76 56,96 65,103 74,90 84,74'],
  triceps:    ['60,104 55,110 52,139 60,141 66,113'],
  forearms:   ['48,144 60,142 58,162 51,192 43,190 42,162'],
  back:       ['89,101 76,95 72,113 83,151 100,157 100,110'],
  lowerback:  ['100,157 84,153 86,178 100,181'],
  glutes:     ['100,183 81,180 76,201 84,217 100,215'],
  hamstrings: ['78,220 98,222 96,274 86,285 76,272'],
  calves:     ['78,292 94,292 95,332 89,372 81,372 74,332'],
};

// Non-muscle parts (head, hands, feet...) drawn dim so the figure reads as a body.
const BODY_SHELL = [
  { t: 'ellipse', a: 'cx="100" cy="32" rx="16" ry="20"' },
  { t: 'polygon', a: 'points="93,50 107,50 108,60 92,60"' },
  { t: 'polygon', a: 'points="43,192 51,194 50,210 42,208"', m: true },
  { t: 'polygon', a: 'points="81,374 88,374 90,392 76,392"', m: true },
  { t: 'polygon', a: 'points="84,283 94,274 93,292 79,292"', m: true },
];

function mirror(points) {
  return points.split(' ').map(p => {
    const [x, y] = p.split(',').map(Number);
    return (200 - x) + ',' + y;
  }).join(' ');
}

function bodySVG(side, fill, opts) {
  const map = side === 'front' ? BODY_FRONT : BODY_BACK;
  const selected = opts && opts.selected;
  let out = `<svg viewBox="30 0 140 400" class="bodymap" role="img" aria-label="${side} body map">`;
  for (const s of BODY_SHELL) {
    out += `<${s.t} ${s.a} class="shell"/>`;
    if (s.m && s.t === 'polygon') {
      const pts = s.a.match(/points="([^"]+)"/)[1];
      out += `<polygon points="${mirror(pts)}" class="shell"/>`;
    }
  }
  for (const [muscle, polys] of Object.entries(map)) {
    const c = fill(muscle);
    const cls = 'muscle' + (c ? '' : ' untrained') + (selected === muscle ? ' selected' : '');
    const style = c ? ` style="fill:${c}"` : '';
    for (const pts of polys) {
      out += `<polygon points="${pts}" class="${cls}" data-m="${muscle}"${style}/>`;
      out += `<polygon points="${mirror(pts)}" class="${cls}" data-m="${muscle}"${style}/>`;
    }
  }
  if (side === 'front') {
    // six-pack lines so the core reads as abs
    out += '<g class="detail"><line x1="100" y1="119" x2="100" y2="182"/>' +
           '<line x1="88" y1="136" x2="112" y2="136"/><line x1="88" y1="156" x2="112" y2="156"/></g>';
  }
  return out + '</svg>';
}
