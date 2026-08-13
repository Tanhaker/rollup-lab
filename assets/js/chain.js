/* ============================================================================
   chain.js — the site's actual connection to Ethereum and Arbitrum.

   Everything before this file was a website *about* blockchains. This is the
   file that makes it a website *on* one. There is no library here: a JSON-RPC
   call is a POST with a JSON body, and doing it by hand is the whole point.

       POST https://sepolia-rollup.arbitrum.io/rpc
       { "jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": [] }

   Three things are wired up:

     1. THE NETWORK RAIL  (every page)
        Polls Arbitrum Sepolia for the current block height and block time and
        renders it in the sticky rail under the nav. This is a real chain
        advancing in real time, not an animation.

     2. THE LIVE BLOCK FEED  (simulator page)
        Pulls the last few real Arbitrum blocks — height, hash, timestamp — and
        shows them beside the simulated chain. The point of the pairing is that
        the real hashes look exactly like the ones you mine by hand.

     3. THE GAS COMPARISON  (prices page)
        Reads eth_gasPrice from Ethereum mainnet and from Arbitrum One and puts
        the two numbers side by side. This is the "one real-world benefit over
        mainnet" claim on the home page, measured live instead of asserted.

   All endpoints are public, CORS-enabled and need no API key. Every call is
   defensive: if an endpoint is down the UI degrades to a dash rather than
   throwing, and the rail marks itself offline.
   ============================================================================ */

(function () {
  'use strict';

  /* ------------------------------------------------------------- networks */

  const NETWORKS = {
    arbSepolia: {
      name: 'Arbitrum Sepolia',
      chainId: 421614,
      chainIdHex: '0x66eee',
      rpc: ['https://sepolia-rollup.arbitrum.io/rpc'],
      explorer: 'https://sepolia.arbiscan.io',
      currency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 }
    },
    arbOne: {
      name: 'Arbitrum One',
      chainId: 42161,
      rpc: ['https://arb1.arbitrum.io/rpc']
    },
    mainnet: {
      name: 'Ethereum',
      chainId: 1,
      // two endpoints so one bad host doesn't take the comparison down
      rpc: ['https://ethereum-rpc.publicnode.com', 'https://cloudflare-eth.com']
    }
  };

  const POLL_MS = 6000;        // block time on Arbitrum is ~0.25s; 6s is plenty
  const FEED_SIZE = 6;         // real blocks shown on the simulator page
  const GAS_REFRESH_MS = 60000;

  /* --------------------------------------------------------- rpc plumbing */

  let rpcId = 0;

  // One JSON-RPC call. Tries each endpoint for the network in order.
  async function rpc(network, method, params) {
    const endpoints = NETWORKS[network].rpc;
    let lastError;

    for (let i = 0; i < endpoints.length; i++) {
      try {
        const res = await fetch(endpoints[i], {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: ++rpcId,
            method: method,
            params: params || []
          })
        });

        if (!res.ok) throw new Error('HTTP ' + res.status);

        const json = await res.json();
        if (json.error) throw new Error(json.error.message || 'RPC error');
        return json.result;
      } catch (err) {
        lastError = err;   // try the next endpoint
      }
    }
    throw lastError || new Error('no endpoint responded');
  }

  /* ------------------------------------------------------------- helpers */

  // Hex quantity → Number. Safe for block numbers and gas prices, which are
  // far below Number.MAX_SAFE_INTEGER. Balances use hexToBig instead.
  function hexToNum(hex) {
    return hex ? parseInt(hex, 16) : 0;
  }

  // Hex quantity → BigInt, for wei values that would lose precision as Number.
  function hexToBig(hex) {
    return hex ? BigInt(hex) : 0n;
  }

  // wei (BigInt) → decimal string with `places` digits, no float rounding.
  function formatUnits(wei, decimals, places) {
    const base = 10n ** BigInt(decimals);
    const whole = wei / base;
    const frac = wei % base;
    if (places === 0) return whole.toString();
    const fracStr = frac.toString().padStart(decimals, '0').slice(0, places);
    return whole.toString() + '.' + fracStr;
  }

  function formatGwei(wei, places) {
    return formatUnits(wei, 9, places === undefined ? 3 : places);
  }

  function shortHash(hash) {
    if (!hash) return '—';
    return hash.slice(0, 10) + '…' + hash.slice(-8);
  }

  function relativeAge(unixSeconds) {
    const delta = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
    if (delta < 60) return delta + 's ago';
    if (delta < 3600) return Math.floor(delta / 60) + 'm ago';
    return Math.floor(delta / 3600) + 'h ago';
  }

  /* ------------------------------------------------- 1. the network rail */

  const rail = document.getElementById('netRail');

  function initRail() {
    if (!rail) return;

    const heightEl = document.getElementById('railHeight');
    const statusEl = document.getElementById('railStatus');
    const gasEl = document.getElementById('railGas');

    let lastHeight = 0;
    let failures = 0;

    async function tick() {
      try {
        // Two calls in parallel — height and the L2 gas price.
        const [heightHex, gasHex] = await Promise.all([
          rpc('arbSepolia', 'eth_blockNumber'),
          rpc('arbSepolia', 'eth_gasPrice')
        ]);

        const height = hexToNum(heightHex);
        failures = 0;
        rail.classList.add('is-live');
        rail.classList.remove('is-down');

        if (height !== lastHeight) {
          heightEl.textContent = height.toLocaleString();
          // Flash the number so you can see the chain actually moving.
          heightEl.classList.remove('tick-flash');
          void heightEl.offsetWidth;          // restart the animation
          heightEl.classList.add('tick-flash');
          lastHeight = height;
        }

        if (gasEl) gasEl.textContent = formatGwei(hexToBig(gasHex), 3) + ' gwei';
        if (statusEl) statusEl.textContent = 'live';
      } catch (err) {
        failures++;
        // One dropped poll is normal on a public endpoint; three is a problem.
        if (failures >= 3) {
          rail.classList.remove('is-live');
          rail.classList.add('is-down');
          if (statusEl) statusEl.textContent = 'unreachable';
        }
      }
    }

    tick();
    let timer = setInterval(tick, POLL_MS);

    // Don't poll a chain nobody is looking at.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        clearInterval(timer);
        timer = null;
      } else if (!timer) {
        tick();
        timer = setInterval(tick, POLL_MS);
      }
    });
  }

  /* --------------------------------------------- 2. live real-block feed */

  function initFeed() {
    const feedEl = document.getElementById('liveFeed');
    if (!feedEl) return;

    const noteEl = document.getElementById('feedNote');
    let knownTop = 0;
    // Tracked explicitly: the markup ships with a placeholder row, so counting
    // children would wrongly report "we already have data" and suppress the
    // error state forever when the RPC is unreachable.
    let hasRealData = false;
    let feedFailures = 0;

    async function loadFeed() {
      try {
        const topHex = await rpc('arbSepolia', 'eth_blockNumber');
        const top = hexToNum(topHex);
        if (top === knownTop) return;    // nothing new to draw

        // Ask for the newest N blocks at once. `false` means headers only —
        // we don't need full transaction bodies just to show hashes.
        const wanted = [];
        for (let i = 0; i < FEED_SIZE; i++) wanted.push(top - i);

        const blocks = await Promise.all(
          wanted.map(function (n) {
            return rpc('arbSepolia', 'eth_getBlockByNumber', ['0x' + n.toString(16), false])
              .catch(function () { return null; });
          })
        );

        feedEl.innerHTML = blocks
          .filter(Boolean)
          .map(function (block, i) {
            const number = hexToNum(block.number);
            const isNew = knownTop !== 0 && number > knownTop;
            return (
              '<div class="feed__row' + (isNew ? ' is-new' : '') + '">' +
                '<span class="feed__num">#' + number.toLocaleString() + '</span>' +
                '<span class="feed__hash" title="' + block.hash + '">' + shortHash(block.hash) + '</span>' +
                '<span class="feed__age">' + relativeAge(hexToNum(block.timestamp)) + '</span>' +
              '</div>'
            );
          })
          .join('');

        knownTop = top;
        hasRealData = true;
        feedFailures = 0;
        if (noteEl) {
          noteEl.textContent =
            'LAST ' + FEED_SIZE + ' BLOCKS FROM ARBITRUM SEPOLIA · UPDATED ' +
            new Date().toLocaleTimeString();
        }
      } catch (err) {
        feedFailures++;

        // Once we have real blocks on screen, a dropped poll is not worth
        // destroying them over — leave the last good data up. Only replace the
        // placeholder, and only after a couple of consecutive failures.
        if (!hasRealData && feedFailures >= 2) {
          feedEl.innerHTML =
            '<div class="notice notice--warn">Could not reach the Arbitrum Sepolia RPC just now — ' +
            'public endpoints rate-limit and occasionally drop requests. The simulated chain below ' +
            'runs entirely offline and is unaffected.</div>';
          if (noteEl) noteEl.textContent = 'LIVE FEED UNAVAILABLE · RETRYING IN THE BACKGROUND';
        }
      }
    }

    loadFeed();
    let timer = setInterval(loadFeed, POLL_MS);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { clearInterval(timer); timer = null; }
      else if (!timer) { loadFeed(); timer = setInterval(loadFeed, POLL_MS); }
    });
  }

  /* -------------------------------------------- 3. L1 vs L2 gas comparison */

  function initGas() {
    const l1El = document.getElementById('gasL1');
    const l2El = document.getElementById('gasL2');
    if (!l1El || !l2El) return;

    const l1Bar = document.getElementById('gasL1Bar');
    const l2Bar = document.getElementById('gasL2Bar');
    const noteEl = document.getElementById('gasNote');
    const l1Cost = document.getElementById('gasL1Cost');
    const l2Cost = document.getElementById('gasL2Cost');

    // A plain ETH transfer costs 21,000 gas on both networks, which makes it
    // the honest unit for a like-for-like comparison.
    const TRANSFER_GAS = 21000n;

    async function loadGas() {
      // Settled independently so one dead endpoint doesn't blank both sides.
      const [l1Result, l2Result] = await Promise.allSettled([
        rpc('mainnet', 'eth_gasPrice'),
        rpc('arbOne', 'eth_gasPrice')
      ]);

      let l1Wei = null;
      let l2Wei = null;

      if (l1Result.status === 'fulfilled') {
        l1Wei = hexToBig(l1Result.value);
        l1El.textContent = formatGwei(l1Wei, 2) + ' gwei';
        if (l1Cost) l1Cost.textContent = formatUnits(l1Wei * TRANSFER_GAS, 18, 6) + ' ETH per transfer';
      } else {
        l1El.textContent = '—';
      }

      if (l2Result.status === 'fulfilled') {
        l2Wei = hexToBig(l2Result.value);
        l2El.textContent = formatGwei(l2Wei, 3) + ' gwei';
        if (l2Cost) l2Cost.textContent = formatUnits(l2Wei * TRANSFER_GAS, 18, 8) + ' ETH per transfer';
      } else {
        l2El.textContent = '—';
      }

      // Scale both bars against the larger of the two, so the visual ratio is
      // the real ratio rather than two full-width bars.
      if (l1Wei !== null && l2Wei !== null && l1Wei > 0n && l2Wei > 0n) {
        const max = l1Wei > l2Wei ? l1Wei : l2Wei;
        const pct = function (v) {
          // integer maths, then a floor of 2% so a tiny bar is still visible
          return Math.max(2, Number((v * 100n) / max));
        };
        if (l1Bar) l1Bar.style.width = pct(l1Wei) + '%';
        if (l2Bar) l2Bar.style.width = pct(l2Wei) + '%';

        const ratio = Number(l1Wei * 100n / l2Wei) / 100;
        if (noteEl) {
          noteEl.textContent =
            ratio >= 1
              ? 'Right now Ethereum gas is about ' + ratio.toFixed(1) +
                '× the price of Arbitrum gas, read live from both chains.'
              : 'Ethereum gas is unusually cheap at the moment — the gap narrows when mainnet is quiet.';
        }
      } else if (noteEl) {
        noteEl.textContent = 'One of the two RPC endpoints did not answer. Refresh to try again.';
      }
    }

    loadGas();
    setInterval(loadGas, GAS_REFRESH_MS);
  }

  /* ------------------------------------------------------------- exports */

  // wallet.js needs the network table and the formatting helpers.
  window.RollupChain = {
    NETWORKS: NETWORKS,
    rpc: rpc,
    hexToNum: hexToNum,
    hexToBig: hexToBig,
    formatUnits: formatUnits,
    formatGwei: formatGwei,
    shortHash: shortHash
  };

  /* ---------------------------------------------------------------- boot */

  function boot() {
    initRail();
    initFeed();
    initGas();
  }

  if (document.readyState !== 'loading') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
