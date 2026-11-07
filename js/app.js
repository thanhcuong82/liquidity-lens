import { analyze, DEFAULTS, fmt, fmtZone, decimalsFor } from './analysis.js';
import * as api from './binance.js';

const $ = id => document.getElementById(id);
const LC = window.LightweightCharts;
const QUOTES = ['USDT', 'FDUSD', 'USDC', 'BTC', 'ETH', 'BNB', 'TRY', 'EUR'];
const TZ = -new Date().getTimezoneOffset() * 60; // show local time on the chart

// ---------- storage (best effort) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('ll:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ll:' + k, JSON.stringify(v)); } catch {} },
};

const state = {
  symbol: 'BTCUSDT', interval: '4h',
  candles: [], daily: [], weekly: [], result: null,
  settings: { ...DEFAULTS, ...store.get('settings', {}) },
  alerts: { near: false, nearPct: 1, sweep: false, ...store.get('alerts', {}) },
  watch: store.get('watch', ['BTCUSDT', 'ETHUSDT', 'ZECUSDT']),
  symbols: new Set(),
  stopStream: null, priceLines: [], notified: new Set(), lastSweepAt: -1, loadId: 0,
};

// ---------- chart ----------
const dark = matchMedia('(prefers-color-scheme: dark)');
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const chart = LC.createChart($('chart'), {
  autoSize: true,
  layout: { background: { color: 'transparent' }, textColor: css('--muted'), fontSize: 11 },
  grid: { vertLines: { visible: false }, horzLines: { color: css('--line') } },
  rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.08 } },
  timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 6 },
  crosshair: { mode: LC.CrosshairMode.Normal },
});
const series = chart.addCandlestickSeries({
  upColor: css('--up'), downColor: css('--down'), wickUpColor: css('--up'), wickDownColor: css('--down'), borderVisible: false,
});
const retheme = () => chart.applyOptions({ layout: { textColor: css('--muted') }, grid: { horzLines: { color: css('--line') } } });
dark.addEventListener?.('change', retheme);

const toChart = c => ({ time: c.time + TZ, open: c.open, high: c.high, low: c.low, close: c.close });

function drawAnalysis() {
  const r = state.result;
  state.priceLines.forEach(l => series.removePriceLine(l));
  state.priceLines = [];
  if (!r) return;
  const add = o => state.priceLines.push(series.createPriceLine({ axisLabelVisible: true, lineWidth: 1, lineStyle: LC.LineStyle.Solid, ...o }));
  const zoneLines = (z, color) => {
    const w = z.strength >= 3 ? 2 : 1;
    const title = z.labels.slice(0, 2).join(' · ');
    if (Math.abs(z.hi - z.lo) / z.lo < 1e-9) add({ price: z.lo, color, lineWidth: w, title });
    else {
      add({ price: z.hi, color, lineWidth: w, title });
      add({ price: z.lo, color, lineWidth: w, title: '', axisLabelVisible: false, lineStyle: LC.LineStyle.Dotted });
    }
  };
  r.zones.above.forEach(z => zoneLines(z, css('--above')));
  r.zones.below.forEach(z => zoneLines(z, css('--below')));
  (r.zones.inside || []).filter(z => !z.onlyRound).forEach(z => zoneLines(z, css('--accent')));
  r.recentSweeps.slice(-4).forEach(e => add({ price: e.price, color: css('--swept'), lineStyle: LC.LineStyle.Dashed, title: 'đã quét', axisLabelVisible: false }));

  const markers = r.events
    .filter(e => e.type === 'swept' && e.at >= state.candles.length - 150)
    .map(e => ({ time: state.candles[e.at].time + TZ, position: e.side === 'high' ? 'aboveBar' : 'belowBar', color: '#ba7517', shape: e.side === 'high' ? 'arrowDown' : 'arrowUp', text: 'quét' }))
    .sort((a, b) => a.time - b.time);
  // one marker per bar
  series.setMarkers(markers.filter((m, i) => i === 0 || m.time !== markers[i - 1].time || m.position !== markers[i - 1].position));
}

// ---------- side panel ----------
function renderPanel() {
  const r = state.result;
  $('summary').innerHTML = r ? r.summary.map(s => `<li>${esc(s)}</li>`).join('') : '';
  const zoneHtml = (zs, side) => zs.length ? zs.map(z => `
    <div class="zone ${side}">
      <span class="p">${fmtZone(z)}</span>
      <span class="d">${side === 'above' ? '+' : '−'}${z.distance.toFixed(2)}%</span>
      <span class="l">${esc(z.labels.join(' · '))}<span class="bar" style="width:${Math.min(60, z.strength * 12)}px;color:var(--${side})" title="Độ mạnh ${z.strength}"></span></span>
    </div>`).join('') : '<div class="empty">Không có vùng nào trong phạm vi.</div>';
  $('zonesAbove').innerHTML = r ? zoneHtml(r.zones.above, 'above') : '';
  $('zonesBelow').innerHTML = r ? zoneHtml(r.zones.below, 'below') : '';
  const sw = r ? r.events.filter(e => e.type === 'swept').slice(-6).reverse() : [];
  $('sweeps').innerHTML = sw.length ? sw.map(e => `<div class="s"><span>${e.side === 'high' ? '▼ Quét đỉnh' : '▲ Quét đáy'} ${fmt(e.price)}</span><span class="muted">${timeStr(state.candles[e.at].time)}</span></div>`).join('') : '<div class="empty">Chưa có cú quét nào trong dữ liệu.</div>';
}

function renderPrice(p) {
  $('price').textContent = fmt(p);
  document.title = `${fmt(p)} ${state.symbol} — LiquidityLens`;
}

// ---------- data flow ----------
async function load(symbol, interval) {
  const id = ++state.loadId;
  state.symbol = symbol; state.interval = interval;
  store.set('last', { symbol, interval });
  history.replaceState(null, '', `#${symbol}/${interval}`);
  $('symTitle').textContent = prettySym(symbol);
  document.querySelectorAll('.tf button').forEach(b => b.classList.toggle('active', b.dataset.tf === interval));
  renderStar(); renderWatch();
  $('chartMsg').textContent = 'Đang tải dữ liệu…';
  state.stopStream?.(); state.stopStream = null;
  state.notified.clear(); state.lastSweepAt = -1;

  try {
    const [candles, daily, weekly] = await Promise.all([
      api.klines(symbol, interval, 500),
      api.klines(symbol, '1d', 3).catch(() => []),
      api.klines(symbol, '1w', 3).catch(() => []),
    ]);
    if (id !== state.loadId) return;
    state.candles = candles; state.daily = daily; state.weekly = weekly;
    const p = candles[candles.length - 1].close, d = decimalsFor(p);
    series.applyOptions({ priceFormat: { type: 'price', precision: d, minMove: 1 / 10 ** d } });
    series.setData(candles.map(toChart));
    chart.timeScale().setVisibleLogicalRange({ from: candles.length - 120, to: candles.length + 5 });
    reanalyze(true);
    renderPrice(p);
    $('chartMsg').textContent = '';
    refreshTicker();
    state.stopStream = api.streamKlines(symbol, interval, onKline, s => {
      $('live').className = 'live ' + (s === 'live' ? 'on' : 'off');
      $('live').textContent = s === 'live' ? 'Trực tiếp' : 'Đang kết nối lại…';
    });
  } catch (e) {
    if (id !== state.loadId) return;
    $('chartMsg').textContent = e.message.includes('Invalid symbol') ? `Không tìm thấy cặp ${symbol} trên Binance Spot.` : e.message;
    state.result = null; renderPanel(); drawAnalysis(); series.setData([]);
  }
}

function reanalyze(initial = false) {
  try {
    state.result = analyze(state.candles, { daily: state.daily, weekly: state.weekly, settings: state.settings });
  } catch (e) { state.result = null; toast(e.message); }
  drawAnalysis(); renderPanel();
  const last = state.result?.recentSweeps.at(-1);
  if (last) {
    if (!initial && state.alerts.sweep && last.at > state.lastSweepAt && last.at >= state.candles.length - 2) {
      notify(`${prettySym(state.symbol)}: ${last.side === 'high' ? 'quét đỉnh' : 'quét đáy'} ${fmt(last.price)}`, 'Râu nến xuyên qua rồi đóng cửa quay lại.');
    }
    state.lastSweepAt = Math.max(state.lastSweepAt, last.at);
  }
}

let refreshTimer;
function onKline({ candle, closed }) {
  const cs = state.candles, last = cs[cs.length - 1];
  if (!last || candle.time < last.time) return;
  if (candle.time === last.time) cs[cs.length - 1] = candle; else cs.push(candle);
  series.update(toChart(candle));
  renderPrice(candle.close);
  checkNear(candle.close);
  if (closed) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      const [daily, weekly] = await Promise.all([api.klines(state.symbol, '1d', 3).catch(() => state.daily), api.klines(state.symbol, '1w', 3).catch(() => state.weekly)]);
      state.daily = daily; state.weekly = weekly;
      reanalyze();
    }, 500);
  }
}

async function refreshTicker() {
  try {
    const t = await api.ticker24h(state.symbol);
    const ch = +t.priceChangePercent;
    $('change').textContent = `${ch >= 0 ? '+' : ''}${ch.toFixed(2)}% 24h`;
    $('change').className = 'change ' + (ch >= 0 ? 'up' : 'down');
  } catch { $('change').textContent = ''; }
}
setInterval(() => document.visibilityState === 'visible' && refreshTicker(), 60000);

// ---------- alerts ----------
function checkNear(price) {
  if (!state.alerts.near || !state.result) return;
  const zs = [...state.result.zones.above, ...state.result.zones.below];
  for (const z of zs) {
    const edge = z.side === 'below' ? z.hi : z.lo;
    const dist = Math.abs(price - edge) / price * 100;
    const key = `${state.symbol}:${z.lo}`;
    if (dist <= state.alerts.nearPct && !state.notified.has(key)) {
      state.notified.add(key);
      notify(`${prettySym(state.symbol)} gần vùng ${fmtZone(z)}`, `${z.labels.join(' · ')} — cách ${dist.toFixed(2)}%`);
    }
  }
}
function notify(title, body) {
  toast(`${title} — ${body}`);
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      navigator.serviceWorker?.ready.then(r => r.showNotification(title, { body, icon: 'icons/icon-192.png', tag: title }))
        .catch(() => new Notification(title, { body }));
    }
  } catch {}
}
async function askPermission() {
  try { if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission(); } catch {}
}

// ---------- watchlist ----------
function renderWatch() {
  $('watchlist').innerHTML = state.watch.map(s => `<span class="chip ${s === state.symbol ? 'active' : ''}"><button class="go" data-go="${s}">${prettySym(s)}</button><button data-rm="${s}" aria-label="Bỏ ${s}">×</button></span>`).join('');
}
function renderStar() {
  const on = state.watch.includes(state.symbol);
  $('starBtn').textContent = on ? '★' : '☆';
  $('starBtn').classList.toggle('on', on);
}
$('watchlist').addEventListener('click', e => {
  const go = e.target.closest('[data-go]')?.dataset.go, rm = e.target.closest('[data-rm]')?.dataset.rm;
  if (go) load(go, state.interval);
  if (rm) { state.watch = state.watch.filter(s => s !== rm); store.set('watch', state.watch); renderWatch(); renderStar(); }
});
$('starBtn').addEventListener('click', () => {
  state.watch = state.watch.includes(state.symbol) ? state.watch.filter(s => s !== state.symbol) : [...state.watch, state.symbol];
  store.set('watch', state.watch); renderWatch(); renderStar();
});

// ---------- search ----------
function resolve(input) {
  const s = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s) return null;
  if (state.symbols.size === 0) return QUOTES.some(q => s.endsWith(q) && s.length > q.length) ? s : s + 'USDT';
  if (state.symbols.has(s)) return s;
  for (const q of QUOTES) if (state.symbols.has(s + q)) return s + q;
  return null;
}
// Typeahead (Android WebView ignores <datalist>, so we render our own list)
const input = $('symbolInput'), box = $('suggest');
let hl = -1, matches = [];
function suggestions(q) {
  q = q.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!q) return [];
  const all = [...state.symbols];
  if (!all.length) return [q.endsWith('USDT') ? q : q + 'USDT'];
  const rank = s => (s === q + 'USDT' ? 0 : s.startsWith(q) && s.endsWith('USDT') ? 1 : s === q ? 2 : s.startsWith(q) ? 3 : 9);
  return all.filter(s => s.startsWith(q)).sort((a, b) => rank(a) - rank(b) || a.length - b.length || a.localeCompare(b)).slice(0, 8);
}
function showSuggest() {
  matches = suggestions(input.value); hl = matches.length ? 0 : -1;
  if (!matches.length) { box.hidden = true; return; }
  box.innerHTML = matches.map((s, i) => {
    const q = QUOTES.find(q => s.endsWith(q) && s.length > q.length);
    return `<button type="button" role="option" data-sym="${s}" class="${i === hl ? 'hl' : ''}"><span>${q ? s.slice(0, -q.length) : s}</span><span class="q">${q || ''}</span></button>`;
  }).join('');
  box.hidden = false;
}
function pick(sym) {
  box.hidden = true; input.value = ''; input.blur();
  load(sym, state.interval);
}
input.addEventListener('input', showSuggest);
input.addEventListener('focus', showSuggest);
input.addEventListener('keydown', e => {
  if (box.hidden || !matches.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); hl = (hl + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
    [...box.children].forEach((b, i) => b.classList.toggle('hl', i === hl));
  } else if (e.key === 'Escape') box.hidden = true;
});
// pointerdown fires before the input loses focus, so the tap is never lost
box.addEventListener('pointerdown', e => { const b = e.target.closest('[data-sym]'); if (b) { e.preventDefault(); pick(b.dataset.sym); } });
input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
$('searchForm').addEventListener('submit', e => {
  e.preventDefault();
  const sym = (!box.hidden && matches[hl]) || resolve(input.value);
  if (!sym) { toast('Không tìm thấy coin này trên Binance Spot'); return; }
  pick(sym);
});
api.symbols().then(list => { state.symbols = new Set(list); if (document.activeElement === input) showSuggest(); }).catch(() => {});

document.querySelector('.tf').addEventListener('click', e => {
  const tf = e.target.closest('button')?.dataset.tf;
  if (tf && tf !== state.interval) load(state.symbol, tf);
});

// ---------- settings ----------
function bindSettings() {
  $('setFractal').value = state.settings.fractal;
  $('setEqual').value = state.settings.equalTol;
  $('setMerge').value = state.settings.mergeTol;
  $('alNear').checked = state.alerts.near;
  $('alNearPct').value = state.alerts.nearPct;
  $('alSweep').checked = state.alerts.sweep;
}
const num = (v, lo, hi, d) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
['setFractal', 'setEqual', 'setMerge'].forEach(id => $(id).addEventListener('change', () => {
  state.settings.fractal = Math.round(num($('setFractal').value, 1, 10, DEFAULTS.fractal));
  state.settings.equalTol = num($('setEqual').value, 0.05, 5, DEFAULTS.equalTol);
  state.settings.mergeTol = num($('setMerge').value, 0.05, 5, DEFAULTS.mergeTol);
  store.set('settings', state.settings); bindSettings(); reanalyze(true);
}));
$('resetSettings').addEventListener('click', () => { state.settings = { ...DEFAULTS }; store.set('settings', {}); bindSettings(); reanalyze(true); });
['alNear', 'alNearPct', 'alSweep'].forEach(id => $(id).addEventListener('change', async () => {
  state.alerts = { near: $('alNear').checked, nearPct: num($('alNearPct').value, 0.1, 10, 1), sweep: $('alSweep').checked };
  store.set('alerts', state.alerts); bindSettings();
  if (state.alerts.near || state.alerts.sweep) await askPermission();
  state.notified.clear();
}));

// ---------- utils ----------
function prettySym(s) { const q = QUOTES.find(q => s.endsWith(q) && s.length > q.length); return q ? `${s.slice(0, -q.length)}/${q}` : s; }
function timeStr(t) { return new Date(t * 1000).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function toast(msg) {
  const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg;
  $('toasts').appendChild(el); setTimeout(() => el.remove(), 5000);
}

// a phone may suspend the tab; reload fresh data when it comes back after a while
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 5 * 60e3) load(state.symbol, state.interval);
});

// ---------- boot ----------
bindSettings();
const fromHash = location.hash.slice(1).split('/');
const last = store.get('last', null);
const startSym = (fromHash[0] || last?.symbol || 'BTCUSDT').toUpperCase();
const startTf = ['15m', '1h', '4h', '1d', '1w'].includes(fromHash[1]) ? fromHash[1] : (last?.interval || '4h');
load(startSym, startTf);
window.addEventListener('hashchange', () => {
  const [s, tf] = location.hash.slice(1).split('/');
  if (s && (s.toUpperCase() !== state.symbol || (tf && tf !== state.interval))) load(s.toUpperCase(), tf || state.interval);
});

// Inside the Android app (Capacitor) files are bundled locally, so no service worker is needed.
const isNativeApp = !!window.Capacitor?.isNativePlatform?.();
if (!isNativeApp && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
