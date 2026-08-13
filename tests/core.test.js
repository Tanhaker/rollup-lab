/* ============================================================================
   Unit tests for assets/js/core.js

   Run with:  npm test        (or: node --test tests/)

   No dependencies and no test framework to install — this is Node's built-in
   runner, which is why CI can run it without an npm install step.

   The focus is the logic that would be silently wrong rather than loudly
   broken: integer money formatting, hash-prefix validation, the exact string a
   block commits to, and escaping of third-party strings.
   ============================================================================ */

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../assets/js/core.js');

/* --------------------------------------------------------------- hex parsing */

test('hexToNum parses hex quantities and defaults safely', () => {
  assert.equal(core.hexToNum('0x10'), 16);
  assert.equal(core.hexToNum('0x66eee'), 421614);   // Arbitrum Sepolia chain id
  assert.equal(core.hexToNum('0x0'), 0);
  assert.equal(core.hexToNum(''), 0);
  assert.equal(core.hexToNum(null), 0);
  assert.equal(core.hexToNum(undefined), 0);
  assert.equal(core.hexToNum('not-hex'), 0);
});

test('hexToBig keeps full precision for wei values', () => {
  // 1 ETH in wei — exceeds Number.MAX_SAFE_INTEGER, so this must be a BigInt.
  assert.equal(core.hexToBig('0xde0b6b3a7640000'), 1000000000000000000n);
  assert.equal(core.hexToBig('0x0'), 0n);
  assert.equal(core.hexToBig(null), 0n);
  assert.equal(core.hexToBig('garbage'), 0n);
});

/* ------------------------------------------------------------ unit formatting */

test('formatUnits does fixed-point maths without floats', () => {
  assert.equal(core.formatUnits(1000000000000000000n, 18, 4), '1.0000');
  assert.equal(core.formatUnits(1500000000000000000n, 18, 2), '1.50');
  assert.equal(core.formatUnits(0n, 18, 5), '0.00000');
  assert.equal(core.formatUnits(1n, 18, 18), '0.000000000000000001');
});

test('formatUnits truncates rather than rounding, and handles zero places', () => {
  // 1.999... must not become "2" — truncation keeps the displayed value honest.
  assert.equal(core.formatUnits(1999999999999999999n, 18, 2), '1.99');
  assert.equal(core.formatUnits(1999999999999999999n, 18, 0), '1');
});

test('formatUnits handles negative values', () => {
  assert.equal(core.formatUnits(-1500000000000000000n, 18, 2), '-1.50');
});

test('formatGwei converts wei to gwei at 9 decimals', () => {
  assert.equal(core.formatGwei(1000000000n, 3), '1.000');       // 1 gwei
  assert.equal(core.formatGwei(12345678n, 3), '0.012');
  assert.equal(core.formatGwei(25000000000n, 2), '25.00');      // typical L1 gas
});

/* --------------------------------------------------------------- presentation */

test('shortHash abbreviates long hashes and passes short input through', () => {
  const hash = '0x' + 'ab'.repeat(32);
  const short = core.shortHash(hash);
  assert.equal(short, '0xabababab…abababab');
  assert.ok(short.includes('…'));
  assert.equal(core.shortHash(''), '—');
  assert.equal(core.shortHash(null), '—');
});

test('shortAddress keeps the first 6 and last 4 characters', () => {
  assert.equal(
    core.shortAddress('0x1234567890abcdef1234567890abcdef12345678'),
    '0x1234…5678'
  );
  assert.equal(core.shortAddress(''), '');
});

test('relativeAge buckets by seconds, minutes, hours and days', () => {
  const now = 1_000_000;
  assert.equal(core.relativeAge(now - 5, now), '5s ago');
  assert.equal(core.relativeAge(now - 90, now), '1m ago');
  assert.equal(core.relativeAge(now - 7200, now), '2h ago');
  assert.equal(core.relativeAge(now - 172800, now), '2d ago');
  // A block timestamp slightly ahead of local clock skew must not go negative.
  assert.equal(core.relativeAge(now + 30, now), '0s ago');
});

test('escapeHtml neutralises markup from third-party strings', () => {
  assert.equal(
    core.escapeHtml('<img src=x onerror="alert(1)">'),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
  );
  assert.equal(core.escapeHtml("O'Brien & co"), 'O&#39;Brien &amp; co');
  assert.equal(core.escapeHtml(null), '');
  // Ampersands must be escaped first, or the other entities get double-escaped.
  assert.equal(core.escapeHtml('&lt;'), '&amp;lt;');
});

/* ----------------------------------------------------------------- the chain */

test('serializeBlock produces the exact committed string', () => {
  const block = { index: 1, data: 'Alice pays Bob 5 ETH', nonce: 42, prevHash: core.GENESIS_PREV };
  assert.equal(
    core.serializeBlock(block),
    '1|Alice pays Bob 5 ETH|42|' + '0'.repeat(64)
  );
});

test('serializeBlock changes when any single field changes', () => {
  const base = { index: 1, data: 'a', nonce: 0, prevHash: 'x' };
  const original = core.serializeBlock(base);

  assert.notEqual(core.serializeBlock({ ...base, data: 'b' }), original);
  assert.notEqual(core.serializeBlock({ ...base, nonce: 1 }), original);
  assert.notEqual(core.serializeBlock({ ...base, prevHash: 'y' }), original);
  assert.notEqual(core.serializeBlock({ ...base, index: 2 }), original);
});

test('genesis previous hash is 64 zeros', () => {
  assert.equal(core.GENESIS_PREV.length, 64);
  assert.match(core.GENESIS_PREV, /^0{64}$/);
});

test('meetsDifficulty checks the leading-zero prefix', () => {
  assert.equal(core.meetsDifficulty('00abcdef', 2), true);
  assert.equal(core.meetsDifficulty('00abcdef', 3), false);
  assert.equal(core.meetsDifficulty('000abcde', 3), true);
  assert.equal(core.meetsDifficulty('abcdef00', 2), false);   // zeros must lead
  assert.equal(core.meetsDifficulty('', 2), false);
  assert.equal(core.meetsDifficulty(null, 2), false);
});

test('fallbackHex is deterministic, 64 hex chars, and avalanches', () => {
  const a = core.fallbackHex('Alice pays Bob 5 ETH');
  const b = core.fallbackHex('Alice pays Bob 5 ETH');
  const c = core.fallbackHex('Alice pays Bob 6 ETH');

  assert.equal(a, b, 'same input must give the same hash');
  assert.notEqual(a, c, 'a one-character change must change the hash');
  assert.equal(a.length, 64);
  assert.match(a, /^[0-9a-f]{64}$/);
});

/* ----------------------------------------------------------------- sparkline */

test('sparklinePoints maps a series into the given box', () => {
  const pts = core.sparklinePoints([1, 2, 3, 4, 5], 100, 40);
  assert.equal(pts.length, 5);

  // First point pinned to x=0, last to x=width.
  assert.ok(pts[0].startsWith('0.0,'));
  assert.ok(pts[pts.length - 1].startsWith('100.0,'));

  // Every y must land inside the box.
  pts.forEach((p) => {
    const y = parseFloat(p.split(',')[1]);
    assert.ok(y >= 0 && y <= 40, `y out of range: ${y}`);
  });
});

test('sparklinePoints inverts the axis so a rising series goes up', () => {
  const pts = core.sparklinePoints([1, 5], 100, 40);
  const firstY = parseFloat(pts[0].split(',')[1]);
  const lastY = parseFloat(pts[1].split(',')[1]);
  // SVG y grows downward, so a higher price means a smaller y.
  assert.ok(lastY < firstY, 'rising prices should render higher on screen');
});

test('sparklinePoints survives a flat series without dividing by zero', () => {
  const pts = core.sparklinePoints([7, 7, 7, 7], 100, 40);
  assert.equal(pts.length, 4);
  pts.forEach((p) => {
    const y = parseFloat(p.split(',')[1]);
    assert.ok(Number.isFinite(y), 'flat series must not produce NaN');
  });
});

test('sparklinePoints returns nothing for unusable input', () => {
  assert.deepEqual(core.sparklinePoints([], 100, 40), []);
  assert.deepEqual(core.sparklinePoints([5], 100, 40), []);
  assert.deepEqual(core.sparklinePoints(null, 100, 40), []);
});
