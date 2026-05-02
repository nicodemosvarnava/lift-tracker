// Tiny SVG chart renderers — no deps. Returns SVG markup strings.

const COLORS = {
  bg: '#0a0a0a',
  surface: '#141414',
  surface2: '#1e1e1e',
  border: '#2a2a2a',
  accent: '#c8f135',
  accent2: '#ff6b35',
  text: '#f0f0f0',
  muted: '#666',
};

// Brzycki estimated 1RM
export function estimated1RM(weight, reps) {
  const w = parseFloat(weight);
  const r = parseInt(reps, 10);
  if (!isFinite(w) || !isFinite(r) || w <= 0 || r <= 0 || r >= 37) return null;
  return w * (36 / (37 - r));
}

// Best e1RM across an exercise's sets (skipping warm-up if labelled).
export function bestE1RM(ex) {
  if (!ex || !Array.isArray(ex.sets)) return null;
  let best = null;
  let bestSet = null;
  ex.sets.forEach((s, i) => {
    if (i === 0 && s && s.label === 'Warm-up') return;
    const e = estimated1RM(s.weight, s.reps);
    if (e != null && (best == null || e > best)) {
      best = e;
      bestSet = s;
    }
  });
  return best == null ? null : { value: best, set: bestSet };
}

// points: [{ date: Date, value: number, label?: string }]
export function lineChart(points, opts = {}) {
  const width = opts.width || 320;
  const height = opts.height || 180;
  const pad = { top: 12, right: 12, bottom: 28, left: 36 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  if (!points.length) {
    return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" class="chart-svg">
      <text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="${COLORS.muted}" font-family="DM Mono, monospace" font-size="11">No data yet</text>
    </svg>`;
  }

  const xs = points.map((p) => p.date.getTime());
  const ys = points.map((p) => p.value);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const xSpan = maxX - minX || 1;
  const ySpan = (maxY - minY) || 1;
  const yPad = ySpan * 0.1;
  const yLo = minY - yPad;
  const yHi = maxY + yPad;
  const yRange = (yHi - yLo) || 1;

  const x = (d) => pad.left + ((d.getTime() - minX) / xSpan) * innerW;
  const y = (v) => pad.top + innerH - ((v - yLo) / yRange) * innerH;

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(' ');

  // y ticks (3)
  const ticks = 3;
  const tickEls = [];
  for (let i = 0; i <= ticks; i++) {
    const v = yLo + ((yHi - yLo) * i) / ticks;
    const yy = y(v);
    tickEls.push(`<line x1="${pad.left}" x2="${width - pad.right}" y1="${yy}" y2="${yy}" stroke="${COLORS.border}" stroke-width="0.5"/>`);
    tickEls.push(`<text x="${pad.left - 6}" y="${yy + 3}" text-anchor="end" fill="${COLORS.muted}" font-family="DM Mono, monospace" font-size="9">${Math.round(v)}</text>`);
  }

  // x labels: first and last
  const fmt = (d) => `${d.getDate()}/${d.getMonth() + 1}`;
  const xLabels = `
    <text x="${pad.left}" y="${height - 8}" fill="${COLORS.muted}" font-family="DM Mono, monospace" font-size="9">${fmt(points[0].date)}</text>
    <text x="${width - pad.right}" y="${height - 8}" text-anchor="end" fill="${COLORS.muted}" font-family="DM Mono, monospace" font-size="9">${fmt(points[points.length - 1].date)}</text>
  `;

  const dots = points.map((p) => {
    return `<circle cx="${x(p.date).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3" fill="${COLORS.accent}"/>`;
  }).join('');

  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" class="chart-svg">
    ${tickEls.join('')}
    <path d="${pathD}" fill="none" stroke="${COLORS.accent}" stroke-width="1.5"/>
    ${dots}
    ${xLabels}
  </svg>`;
}

// Heatmap: weeks × 7 days. cells: Map<YYYY-MM-DD, { A: count, B: count }>
export function heatmap(cells, { weeks = 12, today = new Date() } = {}) {
  const cellSize = 14;
  const gap = 3;
  const colWidth = cellSize + gap;
  const rowHeight = cellSize + gap;
  const width = weeks * colWidth + 24; // padding for day labels
  const height = 7 * rowHeight + 20; // padding for week labels

  // start from monday of (today - (weeks-1) weeks)
  const end = new Date(today);
  end.setHours(0, 0, 0, 0);
  // align end to sunday of this week
  const dayOfWeek = (end.getDay() + 6) % 7; // 0 = Mon ... 6 = Sun
  const sundayDelta = 6 - dayOfWeek;
  end.setDate(end.getDate() + sundayDelta);
  const start = new Date(end);
  start.setDate(start.getDate() - (weeks * 7 - 1));

  const dayLabels = ['M', '', 'W', '', 'F', '', 'S'];
  const labelEls = dayLabels.map((d, i) => {
    if (!d) return '';
    return `<text x="0" y="${20 + i * rowHeight + 11}" fill="${COLORS.muted}" font-family="DM Mono, monospace" font-size="9">${d}</text>`;
  }).join('');

  let cellsHTML = '';
  let monthLabels = '';
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(start.getDate() + w * 7 + d);
      if (date > today) continue;
      const key = isoDate(date);
      const cell = cells.get(key);
      const x = 16 + w * colWidth;
      const y = 20 + d * rowHeight;
      let fill = COLORS.surface2;
      if (cell) {
        const aOnly = cell.A > 0 && (cell.B || 0) === 0;
        const bOnly = (cell.B || 0) > 0 && (cell.A || 0) === 0;
        if (aOnly) fill = COLORS.accent;
        else if (bOnly) fill = COLORS.accent2;
        else fill = `url(#splitFill)`;
      }
      cellsHTML += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="2" fill="${fill}"><title>${key}${cell ? ` · A:${cell.A || 0} B:${cell.B || 0}` : ''}</title></rect>`;

      // month label on first row of each new month
      if (d === 0) {
        const m = date.getMonth();
        if (m !== lastMonth) {
          lastMonth = m;
          const monthShort = date.toLocaleDateString('en-GB', { month: 'short' });
          monthLabels += `<text x="${x}" y="14" fill="${COLORS.muted}" font-family="DM Mono, monospace" font-size="9">${monthShort}</text>`;
        }
      }
    }
  }

  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" class="heatmap-svg">
    <defs>
      <linearGradient id="splitFill" x1="0" y1="0" x2="1" y2="1">
        <stop offset="50%" stop-color="${COLORS.accent}"/>
        <stop offset="50%" stop-color="${COLORS.accent2}"/>
      </linearGradient>
    </defs>
    ${monthLabels}
    ${labelEls}
    ${cellsHTML}
  </svg>`;
}

export function isoDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
