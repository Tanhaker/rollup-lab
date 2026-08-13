/* ============================================================================
   wallet.js — MetaMask connection over raw EIP-1193.

   No ethers.js, no web3.js, no wagmi. A browser wallet injects an object at
   `window.ethereum` that exposes exactly one method that matters:

       await window.ethereum.request({ method, params })

   Every wallet interaction on this site is that one call with a different
   method name. Written by hand so the mechanics are visible rather than
   hidden behind a library:

       eth_requestAccounts        prompt the user to connect
       eth_accounts               read already-authorised accounts, no prompt
       eth_chainId                which network the wallet is pointed at
       eth_getBalance             the account's balance, in wei, as hex
       wallet_switchEthereumChain ask the wallet to change network
       wallet_addEthereumChain    add the network first if it isn't known

   The Concepts page explains that a private key signs and a public key
   verifies. This is that idea made concrete: the site never sees the private
   key, never asks for it, and cannot. It receives an address the wallet chose
   to reveal, and nothing else.
   ============================================================================ */

(function () {
  'use strict';

  const chip = document.getElementById('walletChip');
  if (!chip) return;

  const panel = document.getElementById('walletPanel');
  const TARGET = (window.RollupChain && window.RollupChain.NETWORKS.arbSepolia) || {
    name: 'Arbitrum Sepolia',
    chainId: 421614,
    chainIdHex: '0x66eee',
    rpc: ['https://sepolia-rollup.arbitrum.io/rpc'],
    explorer: 'https://sepolia.arbiscan.io',
    currency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 }
  };

  const provider = window.ethereum || null;

  let account = null;
  let chainIdHex = null;
  let balanceWei = 0n;
  let panelOpen = false;

  /* ------------------------------------------------------------- helpers */

  // Formatting comes from core.js (unit tested); this file is pure I/O.
  const shortAddress = window.RollupCore.shortAddress;

  function onTargetChain() {
    return chainIdHex && chainIdHex.toLowerCase() === TARGET.chainIdHex.toLowerCase();
  }

  function formatEth(wei) {
    return window.RollupCore.formatUnits(wei, 18, 5);
  }

  // Wallets reject with 4001 when the user clicks "cancel". That is a normal
  // outcome, not an error worth shouting about.
  function isUserRejection(err) {
    return err && (err.code === 4001 || /user rejected|denied/i.test(err.message || ''));
  }

  /* ------------------------------------------------------------ rendering */

  function renderChip() {
    chip.classList.remove('is-connected', 'is-wrong-net');

    if (!provider) {
      chip.innerHTML = 'Install MetaMask';
      chip.setAttribute('title', 'No injected wallet found in this browser');
      return;
    }
    if (!account) {
      chip.innerHTML = 'Connect wallet';
      chip.setAttribute('title', 'Connect a browser wallet — read only, no transaction is ever requested');
      return;
    }
    if (!onTargetChain()) {
      chip.classList.add('is-wrong-net');
      chip.innerHTML = '<span class="wallet-chip__avatar"></span> Switch to ' + TARGET.name;
      chip.setAttribute('title', 'Connected, but pointed at another network');
      return;
    }

    chip.classList.add('is-connected');
    chip.innerHTML = '<span class="wallet-chip__avatar"></span> ' + shortAddress(account);
    chip.setAttribute('title', account);
  }

  function renderPanel() {
    if (!panel) return;

    if (!account) {
      panel.hidden = true;
      panelOpen = false;
      return;
    }

    const netLabel = onTargetChain()
      ? TARGET.name
      : 'Chain ' + (chainIdHex ? parseInt(chainIdHex, 16) : '?') + ' (not ' + TARGET.name + ')';

    panel.innerHTML =
      '<div class="wpanel__row"><span>Address</span>' +
        '<a href="' + TARGET.explorer + '/address/' + account + '" target="_blank" rel="noopener">' +
          shortAddress(account) + ' ↗</a></div>' +
      '<div class="wpanel__row"><span>Network</span><b' +
        (onTargetChain() ? '' : ' class="is-warn"') + '>' + netLabel + '</b></div>' +
      '<div class="wpanel__row"><span>Balance</span><b>' + formatEth(balanceWei) + ' ' +
        TARGET.currency.symbol + '</b></div>' +
      '<div class="wpanel__actions">' +
        (onTargetChain()
          ? ''
          : '<button type="button" class="btn btn--sm" data-wallet-switch>Switch network</button>') +
        '<button type="button" class="ghost-link" data-wallet-disconnect>DISCONNECT</button>' +
      '</div>' +
      '<p class="wpanel__note">Read-only. This site never requests a signature or a transaction. ' +
      'Disconnecting here forgets the address locally; revoke the site in MetaMask to remove it fully.</p>';

    panel.hidden = !panelOpen;
  }

  function render() {
    renderChip();
    renderPanel();
  }

  /* -------------------------------------------------------- chain reads */

  async function refreshBalance() {
    if (!account) { balanceWei = 0n; return; }
    try {
      const hex = await provider.request({
        method: 'eth_getBalance',
        params: [account, 'latest']
      });
      balanceWei = BigInt(hex);
    } catch (err) {
      balanceWei = 0n;
    }
  }

  async function refreshChain() {
    try {
      chainIdHex = await provider.request({ method: 'eth_chainId' });
    } catch (err) {
      chainIdHex = null;
    }
  }

  /* ----------------------------------------------------------- actions */

  async function connect() {
    if (!provider) {
      window.open('https://metamask.io/download/', '_blank', 'noopener');
      return;
    }
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      account = accounts && accounts.length ? accounts[0] : null;
      await refreshChain();
      await refreshBalance();
      panelOpen = true;
      render();

      // Connected but on the wrong network — offer the switch straight away
      // rather than making the user find it.
      if (account && !onTargetChain()) switchNetwork();
    } catch (err) {
      if (!isUserRejection(err)) console.warn('[wallet] connect failed:', err.message);
      render();
    }
  }

  async function switchNetwork() {
    if (!provider) return;
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: TARGET.chainIdHex }]
      });
    } catch (err) {
      // 4902 = the wallet has never heard of this chain, so add it first.
      if (err && (err.code === 4902 || err.code === -32603)) {
        try {
          await provider.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: TARGET.chainIdHex,
              chainName: TARGET.name,
              nativeCurrency: TARGET.currency,
              rpcUrls: TARGET.rpc,
              blockExplorerUrls: [TARGET.explorer]
            }]
          });
        } catch (addErr) {
          if (!isUserRejection(addErr)) console.warn('[wallet] add chain failed:', addErr.message);
        }
      } else if (!isUserRejection(err)) {
        console.warn('[wallet] switch failed:', err.message);
      }
    }
    await refreshChain();
    await refreshBalance();
    render();
  }

  // A dapp cannot force a wallet to forget it; this clears local state only,
  // and the panel says so rather than pretending otherwise.
  function disconnect() {
    account = null;
    balanceWei = 0n;
    panelOpen = false;
    render();
  }

  /* ------------------------------------------------------------- events */

  chip.addEventListener('click', function () {
    if (!provider || !account) { connect(); return; }
    if (!onTargetChain()) { switchNetwork(); return; }
    panelOpen = !panelOpen;
    renderPanel();
  });

  if (panel) {
    panel.addEventListener('click', function (e) {
      if (e.target.closest('[data-wallet-switch]')) switchNetwork();
      if (e.target.closest('[data-wallet-disconnect]')) disconnect();
    });
  }

  document.addEventListener('click', function (e) {
    if (!panelOpen) return;
    if (e.target.closest('#walletPanel') || e.target.closest('#walletChip')) return;
    panelOpen = false;
    renderPanel();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panelOpen) { panelOpen = false; renderPanel(); }
  });

  if (provider && provider.on) {
    // The user switched accounts in MetaMask, or locked the wallet entirely.
    provider.on('accountsChanged', async function (accounts) {
      account = accounts && accounts.length ? accounts[0] : null;
      await refreshBalance();
      render();
    });

    // The user changed network in MetaMask. Balance is per-chain, so re-read it.
    provider.on('chainChanged', async function (id) {
      chainIdHex = id;
      await refreshBalance();
      render();
    });
  }

  /* ---------------------------------------------------------------- boot */

  // eth_accounts (unlike eth_requestAccounts) never prompts. It only returns an
  // address if this site was already authorised, so a returning visitor sees
  // their wallet reconnect silently and a new one is left alone.
  (async function init() {
    render();
    if (!provider) return;
    try {
      const accounts = await provider.request({ method: 'eth_accounts' });
      if (accounts && accounts.length) {
        account = accounts[0];
        await refreshChain();
        await refreshBalance();
        render();
      }
    } catch (err) {
      /* nothing authorised yet — the chip stays in its "Connect" state */
    }
  })();
})();
