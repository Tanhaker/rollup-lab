/* ============================================================================
   core.js — the pure functions the rest of the site is built on.

   Everything in here is deterministic: same input, same output, no DOM, no
   network, no clock (the one time-dependent function takes "now" as an
   argument). That is deliberate — it makes this the one file that can be unit
   tested, and `tests/core.test.js` does exactly that with Node's built-in test
   runner.

   The UMD-ish wrapper at the bottom means the same file works as a plain
   <script> in the browser (exposing window.RollupCore) and as a CommonJS
   module in Node, with no build step and no duplication between the two.
   ============================================================================ */

(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RollupCore = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /* ------------------------------------------------------------ hex / units */

  // Hex quantity → Number. Safe for block numbers and gas prices, which sit far
  // below Number.MAX_SAFE_INTEGER. Use hexToBig for wei.
  function hexToNum(hex) {
    if (hex === null || hex === undefined || hex === '') return 0;
    const n = parseInt(hex, 16);
    return Number.isNaN(n) ? 0 : n;
  }

  // Hex quantity → BigInt, for values that would lose precision as a Number.
  function hexToBig(hex) {
    if (hex === null || hex === undefined || hex === '') return 0n;
    try {
      return BigInt(hex);
    } catch (err) {
      return 0n;
    }
  }

  // wei (BigInt) → fixed-point decimal string. Pure integer maths, so there is
  // no float rounding anywhere in the money path.
  function formatUnits(wei, decimals, places) {
    const value = typeof wei === 'bigint' ? wei : BigInt(wei || 0);
    const negative = value < 0n;
    const abs = negative ? -value : value;

    const base = 10n ** BigInt(decimals);
    const whole = abs / base;
    const frac = abs % base;

    let out;
    if (!places) {
      out = whole.toString();
    } else {
      const fracStr = frac.toString().padStart(decimals, '0').slice(0, places);
      out = whole.toString() + '.' + fracStr;
    }
    return negative ? '-' + out : out;
  }

  function formatGwei(wei, places) {
    return formatUnits(wei, 9, places === undefined ? 3 : places);
  }

  /* ---------------------------------------------------------- presentation */

  function shortHash(hash) {
    if (!hash || hash.length < 20) return hash || '—';
    return hash.slice(0, 10) + '…' + hash.slice(-8);
  }

  function shortAddress(address) {
    if (!address || address.length < 12) return address || '';
    return address.slice(0, 6) + '…' + address.slice(-4);
  }

  // `now` is injected rather than read from the clock, so this is testable.
  function relativeAge(unixSeconds, nowSeconds) {
    const now = nowSeconds === undefined ? Math.floor(Date.now() / 1000) : nowSeconds;
    const delta = Math.max(0, Math.floor(now - unixSeconds));
    if (delta < 60) return delta + 's ago';
    if (delta < 3600) return Math.floor(delta / 60) + 'm ago';
    if (delta < 86400) return Math.floor(delta / 3600) + 'h ago';
    return Math.floor(delta / 86400) + 'd ago';
  }

  // Third-party strings (coin names, symbols) are never trusted as markup.
  function escapeHtml(text) {
    return String(text === null || text === undefined ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ----------------------------------------------------------- block chain */

  const GENESIS_PREV = '0'.repeat(64);

  // The exact string a block commits to. Change any part and the hash changes.
  // This is shown verbatim on the simulator page under every block.
  function serializeBlock(block) {
    return block.index + '|' + block.data + '|' + block.nonce + '|' + block.prevHash;
  }

  function meetsDifficulty(hash, difficulty) {
    if (!hash) return false;
    return hash.startsWith('0'.repeat(difficulty));
  }

  // Deterministic non-cryptographic fallback: four FNV-1a passes with different
  // seeds, concatenated to 64 hex characters. Only used when crypto.subtle is
  // unavailable (some browsers block it on file:// pages), so the cascade demo
  // still works. Clearly labelled in the UI when active.
  function fallbackHex(text) {
    const seeds = [0x811c9dc5, 0x1000193, 0xdeadbeef, 0xcafebabe];
    return seeds
      .map(function (seed) {
        let h = seed >>> 0;
        for (let i = 0; i < text.length; i++) {
          h ^= text.charCodeAt(i);
          h = Math.imul(h, 0x01000193) >>> 0;
        }
        let out = '';
        for (let r = 0; r < 4; r++) {
          h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
          out += h.toString(16).padStart(8, '0');
        }
        return out;
      })
      .join('')
      .slice(0, 64);
  }

  /* ------------------------------------------------------------- sparkline */

  // Turn a price series into "x,y" coordinate strings for an SVG polyline.
  // Separated from rendering so the maths can be checked directly.
  function sparklinePoints(prices, width, height, everyNth) {
    if (!prices || prices.length < 2) return [];

    const step = everyNth || 1;
    const points = prices.filter(function (_, i) { return i % step === 0; });
    if (points.length < 2) return [];

    const min = Math.min.apply(null, points);
    const max = Math.max.apply(null, points);
    const range = max - min || 1;

    return points.map(function (p, i) {
      const x = (i / (points.length - 1)) * width;
      const y = height - ((p - min) / range) * (height - 6) - 3;
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
  }

  return {
    GENESIS_PREV: GENESIS_PREV,
    hexToNum: hexToNum,
    hexToBig: hexToBig,
    formatUnits: formatUnits,
    formatGwei: formatGwei,
    shortHash: shortHash,
    shortAddress: shortAddress,
    relativeAge: relativeAge,
    escapeHtml: escapeHtml,
    serializeBlock: serializeBlock,
    meetsDifficulty: meetsDifficulty,
    fallbackHex: fallbackHex,
    sparklinePoints: sparklinePoints
  };
});
