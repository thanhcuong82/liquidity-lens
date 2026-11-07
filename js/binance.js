// Binance public market data (no API key). Tries the main host first and falls back
// to Binance's public market-data mirror, which works in more regions.

const REST_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];
const WS_HOSTS = ['wss://stream.binance.com:9443/ws', 'wss://data-stream.binance.vision/ws'];
let restIdx = 0, wsIdx = 0;

async function get(path) {
  let lastErr;
  for (let n = 0; n < REST_HOSTS.length; n++) {
    const host = REST_HOSTS[(restIdx + n) % REST_HOSTS.length];
    try {
      const res = await fetch(host + path);
      if (res.status === 400) {
        const body = await res.json().catch(() => ({}));
        throw Object.assign(new Error(body.msg || 'Yêu cầu không hợp lệ'), { fatal: true });
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      restIdx = (restIdx + n) % REST_HOSTS.length;
      return await res.json();
    } catch (e) {
      if (e.fatal) throw e;
      lastErr = e;
    }
  }
  throw new Error('Không kết nối được Binance (' + (lastErr?.message || 'lỗi mạng') + ')');
}

const toCandle = k => ({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] });

export async function klines(symbol, interval, limit = 500) {
  const rows = await get(`/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  return rows.map(toCandle);
}

export async function symbols() {
  const rows = await get('/api/v3/ticker/price');
  return rows.map(r => r.symbol);
}

export async function ticker24h(symbol) {
  return get(`/api/v3/ticker/24hr?symbol=${symbol}`);
}

// Live kline stream. Returns a close() function. onKline gets { candle, closed }.
export function streamKlines(symbol, interval, onKline, onStatus = () => {}) {
  let ws, closed = false, retry = 0, timer;
  const open = () => {
    const url = `${WS_HOSTS[wsIdx % WS_HOSTS.length]}/${symbol.toLowerCase()}@kline_${interval}`;
    ws = new WebSocket(url);
    ws.onopen = () => { retry = 0; onStatus('live'); };
    ws.onmessage = ev => {
      const k = JSON.parse(ev.data).k;
      if (!k) return;
      onKline({ candle: { time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v }, closed: k.x });
    };
    ws.onclose = () => {
      if (closed) return;
      onStatus('reconnecting');
      retry++;
      if (retry % 2 === 0) wsIdx++; // switch host every second failure
      timer = setTimeout(open, Math.min(30000, 1000 * 2 ** Math.min(retry, 5)));
    };
    ws.onerror = () => ws.close();
  };
  open();
  return () => { closed = true; clearTimeout(timer); ws && ws.close(); };
}
