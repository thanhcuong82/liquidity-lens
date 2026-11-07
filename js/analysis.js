// Liquidity analysis engine — pure functions, no DOM, no network.
// Candle shape: { time (unix seconds), open, high, low, close }

export const DEFAULTS = {
  fractal: 3,          // bars each side to confirm a swing high/low
  equalTol: 1.0,       // % difference to treat two highs/lows as "equal"
  mergeTol: 0.8,       // % distance to merge nearby levels into one zone
  maxZonesPerSide: 6,
  maxDistance: 30,     // % — ignore zones further than this from price
};

// ---------- swings ----------
export function findSwings(c, n = DEFAULTS.fractal) {
  const highs = [], lows = [];
  for (let i = n; i < c.length - n; i++) {
    let isH = true, isL = true;
    for (let k = i - n; k <= i + n; k++) {
      if (k === i) continue;
      if (c[k].high > c[i].high) isH = false;
      if (c[k].low < c[i].low) isL = false;
    }
    if (isH) highs.push({ i, time: c[i].time, price: c[i].high });
    if (isL) lows.push({ i, time: c[i].time, price: c[i].low });
  }
  return { highs, lows };
}

// What happened to a level after it formed?
//  intact  – never traded through
//  swept   – first touch was a wick through with close back inside (liquidity grab)
//  broken  – first touch closed beyond the level
export function levelStatus(c, from, price, side) {
  for (let j = from + 1; j < c.length; j++) {
    const k = c[j];
    if (side === 'high' && k.high > price) {
      return { status: k.close <= price ? 'swept' : 'broken', at: j, time: k.time };
    }
    if (side === 'low' && k.low < price) {
      return { status: k.close >= price ? 'swept' : 'broken', at: j, time: k.time };
    }
  }
  return { status: 'intact' };
}

// ---------- equal highs / lows ----------
export function groupEqual(levels, tolPct) {
  const sorted = [...levels].sort((a, b) => a.price - b.price);
  const groups = [];
  let cur = [];
  for (const l of sorted) {
    if (cur.length && pct(l.price, cur[0].price) > tolPct) {
      if (cur.length >= 2) groups.push(cur);
      cur = [];
    }
    cur.push(l);
  }
  if (cur.length >= 2) groups.push(cur);
  return groups;
}

// ---------- round numbers ----------
export function roundStep(p) {
  const mag = Math.pow(10, Math.floor(Math.log10(p)));
  const r = p / mag;
  return (mag / 10) * (r < 2 ? 1 : r < 5 ? 2.5 : 5);
}
export function roundLevels(p, each = 2) {
  const step = roundStep(p);
  const out = [];
  const below = Math.floor(p / step) * step;
  for (let k = 0; k < each; k++) out.push(+(below - k * step).toPrecision(12));
  for (let k = 1; k <= each; k++) out.push(+(below + k * step).toPrecision(12));
  return out.filter(v => v > 0 && v !== p);
}

// ---------- structure ----------
export function structure(swings) {
  const h = swings.highs.slice(-2), l = swings.lows.slice(-2);
  if (h.length < 2 || l.length < 2) return { trend: 'unknown', label: 'Chưa đủ dữ liệu' };
  const hh = h[1].price > h[0].price, hl = l[1].price > l[0].price;
  if (hh && hl) return { trend: 'up', label: 'Tăng (đỉnh cao dần, đáy cao dần)' };
  if (!hh && !hl) return { trend: 'down', label: 'Giảm (đỉnh thấp dần, đáy thấp dần)' };
  return { trend: 'range', label: hh ? 'Giằng co (đỉnh cao hơn nhưng đáy thấp hơn)' : 'Giằng co (đáy cao hơn nhưng đỉnh thấp hơn)' };
}

// ---------- main ----------
// candles: chart timeframe. daily / weekly: at least 2 candles each (last = current period), optional.
export function analyze(candles, { daily = [], weekly = [], settings = {} } = {}) {
  const s = { ...DEFAULTS, ...settings };
  const c = candles;
  if (!c || c.length < s.fractal * 2 + 2) throw new Error('Không đủ nến để phân tích');
  const price = c[c.length - 1].close;
  const swings = findSwings(c, s.fractal);

  const levels = []; // every candidate level with status
  const events = []; // sweeps / breaks for markers

  for (const sw of swings.highs) {
    const st = levelStatus(c, sw.i, sw.price, 'high');
    levels.push({ price: sw.price, kind: 'swingHigh', label: 'Đỉnh swing', time: sw.time, ...st });
    if (st.status !== 'intact') events.push({ type: st.status, side: 'high', price: sw.price, time: st.time, at: st.at, formed: sw.time });
  }
  for (const sw of swings.lows) {
    const st = levelStatus(c, sw.i, sw.price, 'low');
    levels.push({ price: sw.price, kind: 'swingLow', label: 'Đáy swing', time: sw.time, ...st });
    if (st.status !== 'intact') events.push({ type: st.status, side: 'low', price: sw.price, time: st.time, at: st.at, formed: sw.time });
  }

  // Previous day / week high & low (from higher-timeframe candles)
  const htf = (arr, hiLabel, loLabel, kindH, kindL) => {
    if (arr.length < 2) return;
    const prev = arr[arr.length - 2], cur = arr[arr.length - 1];
    levels.push({ price: prev.high, kind: kindH, label: hiLabel, status: cur.high > prev.high ? 'swept' : 'intact' });
    levels.push({ price: prev.low, kind: kindL, label: loLabel, status: cur.low < prev.low ? 'swept' : 'intact' });
  };
  htf(daily, 'Đỉnh hôm qua (PDH)', 'Đáy hôm qua (PDL)', 'pdh', 'pdl');
  htf(weekly, 'Đỉnh tuần trước (PWH)', 'Đáy tuần trước (PWL)', 'pwh', 'pwl');

  for (const r of roundLevels(price)) levels.push({ price: r, kind: 'round', label: 'Số tròn', status: 'intact' });

  // Equal highs / lows among intact swings
  const intactHighs = levels.filter(l => l.kind === 'swingHigh' && l.status === 'intact');
  const intactLows = levels.filter(l => l.kind === 'swingLow' && l.status === 'intact');
  const equals = [
    ...groupEqual(intactHighs, s.equalTol).map(g => ({ g, kind: 'eqHigh', label: `Đỉnh bằng ×${g.length}` })),
    ...groupEqual(intactLows, s.equalTol).map(g => ({ g, kind: 'eqLow', label: `Đáy bằng ×${g.length}` })),
  ];
  for (const e of equals) {
    const ps = e.g.map(x => x.price);
    levels.push({ price: (Math.min(...ps) + Math.max(...ps)) / 2, lo: Math.min(...ps), hi: Math.max(...ps), kind: e.kind, label: e.label, status: 'intact' });
  }

  // Build zones from intact levels
  const weight = { eqHigh: 3, eqLow: 3, pwh: 2.5, pwl: 2.5, pdh: 2, pdl: 2, swingHigh: 1, swingLow: 1, round: 0.5 };
  const cand = levels
    .filter(l => l.status === 'intact')
    .map(l => ({ lo: l.lo ?? l.price, hi: l.hi ?? l.price, kind: l.kind, label: l.label }))
    .filter(l => pct(mid(l), price) <= s.maxDistance)
    .sort((a, b) => a.lo - b.lo);

  const zones = [];
  for (const l of cand) {
    const z = zones[zones.length - 1];
    if (z && pct(l.lo, z.hi) <= s.mergeTol) {
      z.hi = Math.max(z.hi, l.hi); z.lo = Math.min(z.lo, l.lo);
      z.parts.push(l);
    } else zones.push({ lo: l.lo, hi: l.hi, parts: [l] });
  }
  for (const z of zones) {
    // de-duplicate swing parts already represented by an equal group
    const hasEqH = z.parts.some(p => p.kind === 'eqHigh'), hasEqL = z.parts.some(p => p.kind === 'eqLow');
    z.parts = z.parts.filter(p => !(hasEqH && p.kind === 'swingHigh') && !(hasEqL && p.kind === 'swingLow'));
    z.strength = z.parts.reduce((a, p) => a + weight[p.kind], 0);
    z.side = mid(z) > price ? 'above' : 'below';
    z.distance = z.side === 'above' ? pct(z.lo, price) : pct(z.hi, price);
    if (z.lo <= price && price <= z.hi) { z.side = 'inside'; z.distance = 0; }
    z.labels = [...new Set(z.parts.map(p => p.label))];
    z.onlyRound = z.parts.every(p => p.kind === 'round');
  }
  const meaningful = zones.filter(z => !z.onlyRound || z.distance < 3);
  const above = meaningful.filter(z => z.side !== 'below').sort((a, b) => a.distance - b.distance).slice(0, s.maxZonesPerSide);
  const below = meaningful.filter(z => z.side === 'below').sort((a, b) => a.distance - b.distance).slice(0, s.maxZonesPerSide);

  events.sort((a, b) => a.at - b.at);
  const recentSweeps = events.filter(e => e.type === 'swept' && e.at >= c.length - 30);

  const st = structure(swings);
  return { price, swings, levels, zones: { above, below }, events, recentSweeps, structure: st, summary: summarize(price, above, below, recentSweeps, st, swings, c) };
}

// ---------- plain-language read-out ----------
function summarize(price, above, below, sweeps, st, swings, c) {
  const lines = [];
  lines.push(`Cấu trúc: ${st.label}.`);
  const strongestUp = pickTarget(above), strongestDown = pickTarget(below);
  if (strongestUp) lines.push(`Thanh khoản phía trên đáng chú ý nhất: ${fmtZone(strongestUp)} (${strongestUp.labels.join(', ')}), cách +${strongestUp.distance.toFixed(2)}%.`);
  if (strongestDown) lines.push(`Thanh khoản phía dưới đáng chú ý nhất: ${fmtZone(strongestDown)} (${strongestDown.labels.join(', ')}), cách −${strongestDown.distance.toFixed(2)}%.`);
  const last = sweeps[sweeps.length - 1];
  if (last) {
    const ago = c.length - 1 - last.at;
    lines.push(`Cú quét gần nhất: ${last.side === 'high' ? 'quét đỉnh' : 'quét đáy'} ${fmt(last.price)} cách đây ${ago} nến — râu xuyên qua nhưng đóng nến quay lại${last.side === 'high' ? ' bên dưới' : ' bên trên'}.`);
  }
  const lastLow = swings.lows[swings.lows.length - 1], lastHigh = swings.highs[swings.highs.length - 1];
  if (st.trend === 'up' && lastLow && strongestUp) lines.push(`Kịch bản tăng: giữ trên ${fmt(lastLow.price)} → mục tiêu ${fmtZone(strongestUp)}. Đóng nến dưới ${fmt(lastLow.price)} là dấu hiệu cấu trúc tăng bị phá.`);
  else if (st.trend === 'down' && lastHigh && strongestDown) lines.push(`Kịch bản giảm: còn dưới ${fmt(lastHigh.price)} → mục tiêu ${fmtZone(strongestDown)}. Đóng nến trên ${fmt(lastHigh.price)} là dấu hiệu cấu trúc giảm bị phá.`);
  else if (strongestUp && strongestDown) lines.push(`Giá đang nằm giữa hai khối thanh khoản; chờ xem phía nào bị quét trước và giá phản ứng ra sao.`);
  return lines;
}
function pickTarget(zs) {
  if (!zs.length) return null;
  // prefer strong zones, penalise distance
  return [...zs].sort((a, b) => (b.strength - b.distance * 0.15) - (a.strength - a.distance * 0.15))[0];
}

// ---------- helpers ----------
export function pct(a, b) { return Math.abs(a - b) / b * 100; }
function mid(z) { return (z.lo + z.hi) / 2; }
export function decimalsFor(p) {
  if (p >= 1000) return 2;
  if (p >= 1) return Math.min(4, 2 + (p < 10 ? 2 : p < 100 ? 1 : 0));
  return Math.min(8, Math.ceil(-Math.log10(p)) + 3);
}
export function fmt(p) { return Number(p).toLocaleString('en-US', { minimumFractionDigits: decimalsFor(p), maximumFractionDigits: decimalsFor(p) }); }
export function fmtZone(z) { return Math.abs(z.hi - z.lo) / z.lo < 1e-9 ? fmt(z.lo) : `${fmt(z.lo)} – ${fmt(z.hi)}`; }
