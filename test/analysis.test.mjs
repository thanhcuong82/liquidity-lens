import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyze, findSwings, levelStatus, roundLevels, roundStep } from '../js/analysis.js';

const raw = JSON.parse(readFileSync(new URL('./zec-4h.json', import.meta.url)));
const candles = raw.candles.map(([time, open, high, low, close]) => ({ time, open, high, low, close }));
const agg = (sec) => {
  const m = new Map();
  for (const k of candles) {
    const key = Math.floor(k.time / sec) * sec;
    const a = m.get(key);
    if (!a) m.set(key, { ...k, time: key });
    else { a.high = Math.max(a.high, k.high); a.low = Math.min(a.low, k.low); a.close = k.close; }
  }
  return [...m.values()];
};
const daily = agg(86400);
const r = analyze(candles, { daily });
const find = (p) => r.levels.find(l => Math.abs(l.price - p) < 1e-6);

test('swing high 1398.14 and 1388 are intact', () => {
  assert.equal(find(1398.14).status, 'intact');
  assert.equal(find(1388).status, 'intact');
});

test('1351.55 was swept (wick through, close back below) on 2026-11-06 12:00 UTC', () => {
  const l = find(1351.55);
  assert.equal(l.status, 'swept');
  assert.equal(new Date(l.time * 1000).toISOString(), '2026-11-06T12:00:00.000Z');
});

test('equal highs zone 1388–1398 is the nearest strong zone above', () => {
  const z = r.zones.above.find(z => z.lo <= 1388 && z.hi >= 1398.14);
  assert.ok(z, 'zone exists');
  assert.ok(z.labels.some(s => s.startsWith('Đỉnh bằng')));
  assert.ok(z.labels.includes('Số tròn'), '1400 merged in');
});

test('equal lows 1110–1120 detected below', () => {
  const z = r.zones.below.find(z => z.lo <= 1111 && z.hi >= 1120);
  assert.ok(z);
  assert.ok(z.labels.some(s => s.startsWith('Đáy bằng')));
});

test('previous-day low 1247.83 appears as a zone below', () => {
  assert.ok(r.zones.below.some(z => z.lo <= 1247.83 && z.hi >= 1247.83 && z.labels.includes('Đáy hôm qua (PDL)')));
});

test('structure is up and summary is produced', () => {
  assert.equal(r.structure.trend, 'up');
  assert.ok(r.summary.length >= 3);
});

test('round numbers', () => {
  assert.equal(roundStep(1314), 100);
  assert.deepEqual(roundLevels(1314).sort((a,b)=>a-b), [1200, 1300, 1400, 1500]);
  assert.equal(roundStep(104000), 10000);
  assert.ok(roundStep(0.00001234) < 1e-5);
});

test('levelStatus basics', () => {
  const c = [{high:10,low:5,close:8},{high:12,low:6,close:9},{high:11,low:7,close:10}];
  assert.deepEqual(levelStatus(c, 0, 10, 'high').status, 'swept');
  const c2 = [{high:10,low:5,close:8},{high:12,low:6,close:11}];
  assert.equal(levelStatus(c2, 0, 10, 'high').status, 'broken');
});
