/* ============================================================
   prices.js — live crypto dashboard backed by the CoinGecko public API.

   Primary endpoint: /coins/markets — one request returns name, symbol,
   logo, price, 24h change and a 7-day sparkline for every coin we track.
   Fallback endpoint: /simple/price — used if the markets call fails, so the
   page still shows prices (without sparklines) rather than an empty grid.
   ============================================================ */

(function () {
  const API = 'https://api.coingecko.com/api/v3';
  const REFRESH_COOLDOWN_MS = 10000; // free tier is rate-limited; don't hammer it

  // Coins tracked by default. ARB is here because this whole site is about Arbitrum.
  let trackedIds = ['bitcoin', 'ethereum', 'arbitrum', 'solana'];

  const grid = document.getElementById('coinGrid');
  const statusEl = document.getElementById('status');
  const alertEl = document.getElementById('alert');
  const refreshBtn = document.getElementById('refreshBtn');
  const addBtn = document.getElementById('addBtn');
  const searchInput = document.getElementById('searchInput');

  let lastFetchAt = 0;

  /* ---------- formatting helpers ---------- */

  function formatPrice(value) {
    if (value === null || value === undefined) return '—';
    const decimals = value >= 1000 ? 2 : value >= 1 ? 2 : 6;
    return '$' + value.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function formatCompact(value) {
    if (!value) return '—';
    if (value >= 1e12) return '$' + (value / 1e12).toFixed(2) + 'T';
    if (value >= 1e9) return '$' + (value / 1e9).toFixed(2) + 'B';
    if (value >= 1e6) return '$' + (value / 1e6).toFixed(2) + 'M';
    return '$' + value.toLocaleString('en-US');
  }

  function showAlert(message, isError) {
    alertEl.innerHTML =
      '<div class="notice' + (isError ? ' notice--error' : '') + '">' + message + '</div>';
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
    const changeText = (isUp ? '+' : '') + (change === null ? '—' : change.toFixed(2) + '%');

    const logo = coin.image
      ? '<img class="coin__logo" src="' + coin.image + '" alt="" loading="lazy" />'
      : '<span class="coin__logo"></span>';

    return (
      '<article class="coin">' +
        '<div class="coin__top">' + logo +
          '<div>' +
            '<div class="coin__name">' + coin.name + '</div>' +
            '<div class="coin__sym">' + (coin.symbol || '').toUpperCase() + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="coin__price">' + formatPrice(coin.price) + '</div>' +
        '<div class="coin__change ' + changeClass + '"><span aria-hidden="true">' + arrow + '</span> ' +
          changeText + ' <span style="color:var(--muted)">24h</span></div>' +
        '<div class="coin__spark">' + sparkline(coin.sparkline, isUp) + '</div>' +
        '<div class="coin__meta">' +
          '<span>MCAP ' + formatCompact(coin.marketCap) + '</span>' +
          '<button class="coin__remove" type="button" data-remove="' + coin.id + '">REMOVE</button>' +
        '</div>' +
      '</article>'
    );
  }

  function render(coins) {
    if (!coins.length) {
      grid.innerHTML = '<div class="notice">No coins tracked. Add one with the search box above.</div>';
      return;
    }
    grid.innerHTML = coins.map(coinCard).join('');

    grid.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        trackedIds = trackedIds.filter(id => id !== btn.dataset.remove);
        loadPrices(true);
      });
    });
  }

  /* ---------- data fetching ---------- */

  async function fetchMarkets(ids) {
    const url = API + '/coins/markets?vs_currency=usd&ids=' + ids.join(',') +
                '&sparkline=true&price_change_percentage=24h';
    const res = await fetch(url);
    if (!res.ok) throw new Error('markets ' + res.status);
    const data = await res.json();

    return data.map(c => ({
      id: c.id,
      name: c.name,
      symbol: c.symbol,
      image: c.image,
      price: c.current_price,
      change24h: c.price_change_percentage_24h,
      marketCap: c.market_cap,
      sparkline: c.sparkline_in_7d ? c.sparkline_in_7d.price : null
    }));
  }

  // Fallback to the simpler endpoint suggested in the brief.
  async function fetchSimple(ids) {
    const url = API + '/simple/price?ids=' + ids.join(',') +
                '&vs_currencies=usd&include_24hr_change=true&include_market_cap=true';
    const res = await fetch(url);
    if (!res.ok) throw new Error('simple ' + res.status);
    const data = await res.json();

    return ids.filter(id => data[id]).map(id => ({
      id: id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      symbol: id.slice(0, 4),
      image: null,
      price: data[id].usd,
      change24h: data[id].usd_24h_change,
      marketCap: data[id].usd_market_cap,
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
      statusEl.textContent = 'Updated ' + new Date().toLocaleTimeString();
      if (grid.querySelector('.coin')) clearAlert();
    } catch (err) {
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
      } else {
        trackedIds.push(match.id);
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

  /* ---------- wiring ---------- */

  refreshBtn.addEventListener('click', () => loadPrices(false));
  addBtn.addEventListener('click', addCoin);
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') addCoin();
  });

  loadPrices(true);
})();
