# Rollup Lab — a field guide to Ethereum Layer 2

A four-page website built for the **Arbitrum Builder Pods** assignment (Lampros DAO).
The theme is *Arbitrum / Layer 2 overview*, and every page builds on the same idea: Ethereum
is secure but scarce, rollups make that scarcity affordable, and a chain resists tampering
because each block commits to the one before it.

Plain HTML, CSS and JavaScript. No build step, no framework, no dependencies.

---

## Pages

| # | File | What it does |
|---|------|--------------|
| 1 | `index.html` | Landing page. Hero with an animated rollup batcher (canvas) showing L2 transactions being compressed into a single batch posted to L1, a stat band, a three-step explainer covering why Ethereum needed Layer 2, what Arbitrum is, and one real benefit over mainnet, three feature cards, a four-step transaction lifecycle, and a footer. |
| 2 | `concepts.html` | Four side-by-side comparison cards: Web2 vs Web3, Ethereum vs Bitcoin, public key vs private key, blockchain vs traditional database. A jump bar links straight to each card, and a recap table closes the page with one line per comparison. |
| 3 | `prices.html` | Live crypto dashboard using the CoinGecko public API. Price, 24h change with a green/red arrow, a 7-day sparkline and market cap for BTC, ETH, ARB and SOL. USD/INR/EUR switching, manual refresh (throttled to 10s), optional 60-second auto-refresh, a search box to add any coin CoinGecko lists, and board-wide totals. |
| 4 | `simulator.html` | Proof-of-work simulator using real SHA-256 via the Web Crypto API. Mine each block until its hash starts with N zeros, then edit an earlier block's data and watch every block after it turn invalid. The chain grows from 3 to 6 blocks, and a one-click *Tamper* button demonstrates the cascade. |

All four pages share one navigation bar, one stylesheet, and one visual language. The current
page is highlighted in the nav, and on narrow screens the nav collapses into a menu button.

---

## Project structure

```
rollup-lab/
├── index.html            # Page 1 — home / landing
├── concepts.html         # Page 2 — concept comparisons
├── prices.html           # Page 3 — live prices
├── simulator.html        # Page 4 — block simulator
├── assets/
│   ├── css/
│   │   └── site.css      # single stylesheet shared by all pages
│   └── js/
│       ├── ui.js         # shared: mobile nav, sticky header, scroll reveal
│       ├── batcher.js    # hero canvas animation (home)
│       ├── prices.js     # CoinGecko fetching, sparklines, search, currency
│       └── simulator.js  # SHA-256 mining and chain validation
├── screenshots/          # one screenshot per page
└── README.md
```

---

## Run it locally

Clone the repo and open it. Because everything is static, no install step is required:

```bash
git clone https://github.com/tanhaker/rollup-lab.git
cd rollup-lab
```

**Recommended — serve over HTTP** (guarantees the Web Crypto API and CoinGecko fetches work):

```bash
# Python 3
python -m http.server 5500
# then open http://localhost:5500
```

or use the **Live Server** extension in VS Code and click *Go Live*.

Opening `index.html` directly by double-clicking also works in Chrome and Firefox, but serving
it over HTTP is the safer path.

---

## How the block simulator works

Each block commits to the string `index|data|nonce|prevHash`, hashed with SHA-256. The page
shows that exact input string under every block, so you can see what changed.

1. `prevHash` of block 1 is 64 zeros (a genesis placeholder); every other block takes the hash
   of the block above it. The prev-hash field is read-only for that reason — it is derived, not
   typed.
2. **Mining** increments the nonce until the resulting hash starts with the required number of
   leading zeros (2 by default, selectable up to 4). There is no shortcut — it is brute force.
   Each block reports how many attempts it took and the rough hash rate.
3. A block is **valid** only while its hash still meets that prefix.
4. Editing any block's data re-hashes that block, which changes the `prevHash` of the next
   block, which changes its hash, and so on down the chain. One edit invalidates everything
   after it, and the banner at the top names the first broken block.

Each extra required zero multiplies the expected number of attempts by 16, which is why
difficulty 4 takes noticeably longer than difficulty 2.

---

## Live prices — API notes

Primary request (one call covers everything, including sparklines):

```
https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,arbitrum,solana&sparkline=true&price_change_percentage=24h
```

If that call fails, the page automatically falls back to the simpler endpoint suggested in the
assignment brief, and shows prices without sparklines:

```
https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin&vs_currencies=usd&include_24hr_change=true
```

Adding a coin goes through `/search?query=` and takes the top match. No API key is needed. The
free tier is rate-limited, so manual refresh is throttled to once every ten seconds, auto-refresh
is capped at one call a minute, polling pauses while the tab is hidden, and a clear message is
shown if CoinGecko returns 429.

Your tracked coins, chosen currency and auto-refresh preference are stored in `localStorage` —
in your browser only, never sent anywhere.

---

## Accessibility and responsiveness

- Skip-to-content link on every page, and a visible focus ring throughout.
- The nav collapses to a labelled menu button under 680px; with JavaScript disabled the links
  stay visible rather than becoming unreachable.
- Scroll-reveal animations, the hero animation and the price-flash effect all respect
  `prefers-reduced-motion`.
- Live regions announce price updates and the chain verdict to screen readers.
- Layouts are grid-based and collapse to a single column on phones; the recap table scrolls
  horizontally inside its own container instead of forcing the page to.

---

## Known issues and what I'd improve

- **CoinGecko rate limits.** Rapid refreshing or reloading several times in a minute can trigger
  a 429. The page reports this rather than failing silently, but a small cache or a proxy with a
  demo API key would fix it properly.
- **Difficulty 4 blocks the main thread in bursts.** Mining yields to the browser every 500
  attempts to stay responsive; a Web Worker would keep it perfectly smooth.
- **Mined blocks don't persist.** Coin preferences survive a reload but the chain resets, which
  is deliberate for a teaching page — still, saving it would be a short addition.
- **Fallback hash is not cryptographic.** If `crypto.subtle` is unavailable on the origin, the
  simulator uses a deterministic FNV-1a-based hash so the cascade demo still works. The toolbar
  states which engine is active.
- **Only three currencies.** USD, INR and EUR are wired up; CoinGecko supports many more via the
  same `vs_currency` parameter.
- **Next step:** replace the simulated chain with real reads from an Arbitrum Sepolia RPC, so
  Page 4 shows actual block hashes alongside the simulated ones.

---

## Author

**Tanmay** — Arbitrum Builder Pods, batch tanhaker
GitHub: https://github.com/tanhaker
