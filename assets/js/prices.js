/* ============================================================
   prices.js — live crypto dashboard backed by the CoinGecko public API.

   Primary endpoint: /coins/markets — one request returns name, symbol,
   logo, price, 24h change, market cap and a 7-day sparkline for every coin.
   Fallback endpoint: /simple/price — used if the markets call fails, so the
   page still shows prices (without sparklines) rather than an empty grid.

   Extras beyond the brief:
     · USD / INR / EUR switching via vs_currency
     · optional 60-second auto-refresh
     · coin list, currency and auto-refresh preference kept in localStorage
     · board-wide totals, and a flash when a price actually moved
   ============================================================ */

(function () {
  const API = 'https://api.coingecko.com/api/v3';
  const REFRESH_COOLDOWN_MS = 10000;   // free tier is rate-limited; don't hammer it
  const AUTO_REFRESH_MS = 60000;
  const STORE_KEY = 'rollup-lab:prices';

  const DEFAULT_IDS = ['bitcoin', 'ethereum', 'arbitrum', 'solana'];

  // Everything CoinGecko needs plus what Intl needs to format the result.
  const CURRENCIES = {
    usd: { code: 'USD', locale: 'en-US' },
    inr: { code: 'INR', locale: 'en-IN' },
    eur: { code: 'EUR', locale: 'de-DE' }
  };

  const grid = document.getElementById('coinGrid');
  const statusEl = document.getElementById('status');
  const alertEl = document.getElementById('alert');
  const refreshBtn = document.getElementById('refreshBtn');
  const addBtn = document.getElementById('addBtn');
  const searchInput = document.getElementById('searchInput');
  const currencySeg = document.getElementById('currencySeg');
  const autoRefreshEl = document.getElementById('autoRefresh');

  const statCoins = document.getElementById('statCoins');
  const statCap = document.getElementById('statCap');
  const statUp = document.getElementById('statUp');
  const statBest = document.getElementById('statBest');

  let trackedIds = DEFAULT_IDS.slice();
  let currency = 'usd';
  let lastFetchAt = 0;
  let autoTimer = null;
  let lastPrices = {};   // id → previous price, so we can flash only real moves

  /* ---------- preferences (localStorage, best effort) ---------- */

  function loadPrefs() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      if (Array.isArray(saved.ids) && saved.ids.length) trackedIds = saved.ids;
      if (CURRENCIES[saved.currency]) currency = saved.currency;
      if (saved.auto) autoRefreshEl.checked = true;
    } catch (err) {
      /* private mode or corrupted value — defaults are fine */
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        ids: trackedIds,
        currency: currency,
        auto: autoRefreshEl.checked
      }));
    } catch (err) { /* storage unavailable; the page still works */ }
  }

  /* ---------- formatting helpers ---------- */

  function formatPrice(value) {
    if (value === null || value === undefined) return '—';
    const cur = CURRENCIES[currency];
    // Sub-dollar coins need more decimals than BTC does.
    const decimals = value >= 1 ? 2 : 6;
    return new Intl.NumberFormat(cur.locale, {
      style: 'currency',
      currency: cur.code,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(value);
  }

  function formatCompact(value) {
    if (!value) return '—';
    const cur = CURRENCIES[currency];
    return new Intl.NumberFormat(cur.locale, {
      style: 'currency',
      currency: cur.code,
      notation: 'compact',
      maximumFractionDigits: 2
    }).format(value);
  }

  // Coin names and symbols come from a third party, so never trust them as markup.
  function escapeHtml(text) {
    return String(text === null || text === undefined ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function showAlert(message, isError) {
    alertEl.innerHTML =
      '<div class="notice' + (isError ? ' notice--error' : '') + '">' + escapeHtml(message) + '</div>';
  }

  function clearAlert() {
    alertEl.innerHTML = '';
  }

  /* ---------- sparkline: turn a price array into a small SVG path ---------- */

  function sparkline(prices, isUp) {
    if (!prices || prices.length < 2) return '';

    // Thin the series so the path stays light (7 days of hourly data is ~168 points)
    const points = prices.filter((_, i) => i % 3 === 0);
    const min = Math.min.apply(null, points);
    const max = Math.max.apply(null, points);
    const range = max - min || 1;
    const W = 240;
    const H = 42;

    const coords = points.map((p, i) => {
      const x = (i / (points.length - 1)) * W;
      const y = H - ((p - min) / range) * (H - 6) - 3;
      return x.toFixed(1) + ',' + y.toFixed(1);
    });

    const stroke = isUp ? '#42d392' : '#ff5c6c';
    const fill = isUp ? 'rgba(66,211,146,0.12)' : 'rgba(255,92,108,0.12)';

    return (
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
        '<polygon fill="' + fill + '" points="0,' + H + ' ' + coords.join(' ') + ' ' + W + ',' + H + '"></polygon>' +
        '<polyline fill="none" stroke="' + stroke + '" stroke-width="1.5" points="' + coords.join(' ') + '"></polyline>' +
      '</svg>'
    );
  }

  /* ---------- rendering ---------- */

  function coinCard(coin) {
    const change = coin.change24h;
    const isUp = change >= 0;
    const arrow = isUp ? '▲' : '▼';
    const changeClass = isUp ? 'up' : 'down';
    const changeText = change === null || change === undefined
      ? '—'
      : (isUp ? '+' : '') + change.toFixed(2) + '%';

    // Flash the border green/red only when the price genuinely changed since last poll.
    const previous = lastPrices[coin.id];
    let flash = '';
    if (previous !== undefined && coin.price !== previous) {
      flash = coin.price > previous ? ' flash-up' : ' flash-down';
    }

    const logo = coin.image
      ? '<img class="coin__logo" src="' + escapeHtml(coin.image) + '" alt="" loading="lazy" />'
      : '<span class="coin__logo"></span>';

    const rank = coin.rank ? '<span class="coin__rank">#' + coin.rank + '</span>' : '';

    return (
      '<article class="coin' + flash + '">' +
        '<div class="coin__top">' + logo +
          '<div>' +
            '<div class="coin__name">' + escapeHtml(coin.name) + '</div>' +
            '<div class="coin__sym">' + escapeHtml((coin.symbol || '').toUpperCase()) + '</div>' +
          '</div>' + rank +
        '</div>' +
        '<div class="coin__price">' + formatPrice(coin.price) + '</div>' +
        '<div class="coin__change ' + changeClass + '"><span aria-hidden="true">' + arrow + '</span> ' +
          changeText + ' <span style="color:var(--muted)">24h</span></div>' +
        '<div class="coin__spark">' + sparkline(coin.sparkline, isUp) + '</div>' +
        '<div class="coin__meta">' +
          '<span>MCAP ' + formatCompact(coin.marketCap) + '</span>' +
          '<button class="coin__remove" type="button" data-remove="' + escapeHtml(coin.id) + '">REMOVE</button>' +
        '</div>' +
      '</article>'
    );
  }

  function renderStats(coins) {
    if (!coins.length) {
      statCoins.textContent = '0';
      statCap.textContent = '—';
      statUp.textContent = '—';
      statBest.textContent = '—';
      return;
    }

    const totalCap = coins.reduce((sum, c) => sum + (c.marketCap || 0), 0);
    const up = coins.filter(c => (c.change24h || 0) >= 0).length;
    const best = coins.reduce((a, b) => ((b.change24h || 0) > (a.change24h || 0) ? b : a));

    statCoins.textContent = String(coins.length);
    statCap.textContent = formatCompact(totalCap);
    statUp.textContent = up + ' / ' + coins.length;
    statBest.textContent = (best.symbol || '').toUpperCase() +
      ' ' + ((best.change24h || 0) >= 0 ? '+' : '') + (best.change24h || 0).toFixed(1) + '%';
  }

  function render(coins) {
    grid.setAttribute('aria-busy', 'false');

    if (!coins.length) {
      grid.innerHTML = '<div class="notice">No coins tracked. Add one with the search box above.</div>';
      renderStats([]);
      return;
    }

    // Biggest first — the board reads like a market table rather than insertion order.
    coins.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));

    grid.innerHTML = coins.map(coinCard).join('');
    renderStats(coins);

    coins.forEach(c => { lastPrices[c.id] = c.price; });

    grid.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        trackedIds = trackedIds.filter(id => id !== btn.dataset.remove);
        savePrefs();
        loadPrices(true);
      });
    });
  }

  /* ---------- data fetching ---------- */

  async function fetchMarkets(ids) {
    const url = API + '/coins/markets?vs_currency=' + currency + '&ids=' + ids.join(',') +
                '&sparkline=true&price_change_percentage=24h';
    const res = await fetch(url);
    if (!res.ok) throw new Error('markets ' + res.status);
    const data = await res.json();

    return data.map(c => ({
      id: c.id,
      name: c.name,
      symbol: c.symbol,
      image: c.image,
      rank: c.market_cap_rank,
      price: c.current_price,
      change24h: c.price_change_percentage_24h,
      marketCap: c.market_cap,
      sparkline: c.sparkline_in_7d ? c.sparkline_in_7d.price : null
    }));
  }

  // Fallback to the simpler endpoint suggested in the brief.
  async function fetchSimple(ids) {
    const url = API + '/simple/price?ids=' + ids.join(',') +
                '&vs_currencies=' + currency + '&include_24hr_change=true&include_market_cap=true';
    const res = await fetch(url);
    if (!res.ok) throw new Error('simple ' + res.status);
    const data = await res.json();

    return ids.filter(id => data[id]).map(id => ({
      id: id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      symbol: id.slice(0, 4),
      image: null,
      rank: null,
      price: data[id][currency],
      change24h: data[id][currency + '_24h_change'],
      marketCap: data[id][currency + '_market_cap'],
      sparkline: null
    }));
  }

  async function loadPrices(force) {
    const now = Date.now();
    if (!force && now - lastFetchAt < REFRESH_COOLDOWN_MS) {
      const wait = Math.ceil((REFRESH_COOLDOWN_MS - (now - lastFetchAt)) / 1000);
      statusEl.textContent = 'Wait ' + wait + 's before refreshing again';
      return;
    }

    if (!trackedIds.length) {
      render([]);
      statusEl.textContent = '';
      return;
    }

    lastFetchAt = now;
    refreshBtn.disabled = true;
    grid.setAttribute('aria-busy', 'true');
    statusEl.textContent = 'Fetching…';

    try {
      let coins;
      try {
        coins = await fetchMarkets(trackedIds);
      } catch (primaryError) {
        // Keep the page useful even if the richer endpoint is unavailable.
        coins = await fetchSimple(trackedIds);
        showAlert('Sparklines unavailable right now — showing prices from the simple endpoint instead.', false);
      }
      render(coins);
      statusEl.textContent = 'Updated ' + new Date().toLocaleTimeString() +
                             ' · ' + CURRENCIES[currency].code;
      if (grid.querySelector('.coin')) clearAlert();
    } catch (err) {
      grid.setAttribute('aria-busy', 'false');
      statusEl.textContent = 'Failed';
      showAlert(
        'Could not reach CoinGecko. The free API rate-limits heavy use — wait about a minute and refresh. ' +
        '(Error: ' + err.message + ')',
        true
      );
    } finally {
      refreshBtn.disabled = false;
    }
  }

  /* ---------- coin search ---------- */

  async function addCoin() {
    const query = searchInput.value.trim();
    if (!query) return;

    addBtn.disabled = true;
    statusEl.textContent = 'Searching…';

    try {
      const res = await fetch(API + '/search?query=' + encodeURIComponent(query));
      if (!res.ok) throw new Error('search ' + res.status);
      const data = await res.json();

      if (!data.coins || !data.coins.length) {
        showAlert('No coin named "' + query + '" on CoinGecko. Try the full name, like "polygon".', true);
        statusEl.textContent = '';
        return;
      }

      const match = data.coins[0];
      if (trackedIds.includes(match.id)) {
        showAlert(match.name + ' is already on the board.', false);
        statusEl.textContent = '';
      } else {
        trackedIds.push(match.id);
        savePrefs();
        clearAlert();
        searchInput.value = '';
        await loadPrices(true);
      }
    } catch (err) {
      showAlert('Search failed: ' + err.message, true);
    } finally {
      addBtn.disabled = false;
    }
  }

  /* ---------- auto-refresh ---------- */

  function syncAutoRefresh() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    if (autoRefreshEl.checked) {
      autoTimer = setInterval(() => loadPrices(true), AUTO_REFRESH_MS);
    }
    savePrefs();
  }

  /* ---------- wiring ---------- */

  refreshBtn.addEventListener('click', () => loadPrices(false));
  addBtn.addEventListener('click', addCoin);
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') addCoin();
  });

  currencySeg.addEventListener('click', e => {
    const btn = e.target.closest('[data-cur]');
    if (!btn || btn.dataset.cur === currency) return;

    currency = btn.dataset.cur;
    currencySeg.querySelectorAll('[data-cur]').forEach(b => {
      b.classList.toggle('is-on', b === btn);
    });
    lastPrices = {};        // prices are in a new unit; old ones aren't comparable
    savePrefs();
    loadPrices(true);       // a currency change must never be blocked by the cooldown
  });

  autoRefreshEl.addEventListener('change', syncAutoRefresh);

  // A background tab shouldn't keep polling a rate-limited free API.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    } else if (autoRefreshEl.checked && !autoTimer) {
      syncAutoRefresh();
      loadPrices(false);
    }
  });

  /* ---------- boot ---------- */

  loadPrefs();
  currencySeg.querySelectorAll('[data-cur]').forEach(b => {
    b.classList.toggle('is-on', b.dataset.cur === currency);
  });
  syncAutoRefresh();
  loadPrices(true);
})();
