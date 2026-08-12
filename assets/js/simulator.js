/* ============================================================
   simulator.js — a three-block proof-of-work chain in the browser.

   Model:  block = { index, data, nonce, prevHash, hash }
   Hash:   SHA-256 via the Web Crypto API. If crypto.subtle is unavailable
           (some browsers block it on file:// pages), we fall back to a
           deterministic non-cryptographic hash so the page still demonstrates
           the same behaviour — clearly labelled in the toolbar.
   Rule:   a block is valid when its hash starts with N leading zeros.
   Chain:  block[i].prevHash = block[i-1].hash, so editing an early block
           changes its hash, which changes the next block's input, and so on.
   ============================================================ */

(function () {
  const GENESIS_PREV = '0'.repeat(64);

  const chainEl = document.getElementById('chain');
  const mineAllBtn = document.getElementById('mineAllBtn');
  const resetBtn = document.getElementById('resetBtn');
  const difficultyEl = document.getElementById('difficulty');
  const engineNote = document.getElementById('engineNote');

  const useWebCrypto = !!(window.crypto && window.crypto.subtle);
  engineNote.textContent = useWebCrypto
    ? 'ENGINE: WEB CRYPTO SHA-256'
    : 'ENGINE: FALLBACK HASH (SHA-256 UNAVAILABLE ON THIS ORIGIN)';

  let difficulty = parseInt(difficultyEl.value, 10);
  let blocks = [];
  let views = [];   // DOM references per block, so typing never loses focus
  let busy = false;

  /* ---------- hashing ---------- */

  async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // Deterministic fallback: four FNV-1a passes with different seeds, concatenated
  // to 64 hex characters. Not cryptographic — only used when SHA-256 is blocked.
  function fallbackHex(text) {
    const seeds = [0x811c9dc5, 0x1000193, 0xdeadbeef, 0xcafebabe];
    return seeds.map(seed => {
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
    }).join('').slice(0, 64);
  }

  function hashText(text) {
    return useWebCrypto ? sha256Hex(text) : Promise.resolve(fallbackHex(text));
  }

  // The exact string a block commits to. Change any part and the hash changes.
  function serialize(block) {
    return block.index + '|' + block.data + '|' + block.nonce + '|' + block.prevHash;
  }

  function isValid(block) {
    return !!block.hash && block.hash.startsWith('0'.repeat(difficulty));
  }

  /* ---------- chain state ---------- */

  function createChain() {
    return [
      { index: 1, data: 'Alice pays Bob 5 ETH', nonce: 0, prevHash: GENESIS_PREV, hash: '' },
      { index: 2, data: 'Bob pays Carol 2 ETH', nonce: 0, prevHash: '', hash: '' },
      { index: 3, data: 'Carol pays Dev 1 ETH', nonce: 0, prevHash: '', hash: '' }
    ];
  }

  // Recompute every hash from the first block down. This is what makes edits cascade.
  async function recomputeChain() {
    for (let i = 0; i < blocks.length; i++) {
      blocks[i].prevHash = i === 0 ? GENESIS_PREV : blocks[i - 1].hash;
      blocks[i].hash = await hashText(serialize(blocks[i]));
    }
    paintAll();
  }

  /* ---------- rendering ---------- */

  function blockMarkup(block) {
    return (
      '<div class="block__head">' +
        '<span class="block__id">BLOCK <b>#' + block.index + '</b></span>' +
        '<span class="badge badge--invalid" data-role="badge">Invalid</span>' +
      '</div>' +

      '<div class="block__fields">' +
        '<div class="f">' +
          '<label for="data-' + block.index + '">Block data</label>' +
          '<input class="field" id="data-' + block.index + '" type="text" data-role="data" value="" />' +
        '</div>' +
        '<div class="f">' +
          '<label for="nonce-' + block.index + '">Nonce</label>' +
          '<input class="field" id="nonce-' + block.index + '" type="number" data-role="nonce" value="0" min="0" />' +
        '</div>' +
      '</div>' +

      '<p class="hashline">PREV &nbsp;<span data-role="prev"></span></p>' +
      '<p class="hashline" data-role="hashline">HASH &nbsp;<span data-role="hash"></span></p>' +

      '<div class="block__actions">' +
        '<button class="btn btn--sm" type="button" data-role="mine">Mine block ' + block.index + '</button>' +
        '<span class="toolbar__status" data-role="attempts"></span>' +
      '</div>'
    );
  }

  function buildDom() {
    chainEl.innerHTML = '';
    views = [];

    blocks.forEach((block, i) => {
      const el = document.createElement('article');
      el.className = 'block';
      el.innerHTML = blockMarkup(block);
      chainEl.appendChild(el);

      // Visual hint that block i+1 consumes block i's hash
      if (i < blocks.length - 1) {
        const hint = document.createElement('p');
        hint.className = 'link-hint';
        hint.textContent = '↓ HASH OF BLOCK #' + block.index + ' BECOMES PREV OF BLOCK #' + (block.index + 1);
        chainEl.appendChild(hint);
      }

      const view = {
        el: el,
        badge: el.querySelector('[data-role="badge"]'),
        dataInput: el.querySelector('[data-role="data"]'),
        nonceInput: el.querySelector('[data-role="nonce"]'),
        prev: el.querySelector('[data-role="prev"]'),
        hash: el.querySelector('[data-role="hash"]'),
        hashline: el.querySelector('[data-role="hashline"]'),
        mineBtn: el.querySelector('[data-role="mine"]'),
        attempts: el.querySelector('[data-role="attempts"]')
      };
      views.push(view);

      view.dataInput.value = block.data;
      view.nonceInput.value = block.nonce;

      // Editing either field re-hashes this block and everything downstream.
      view.dataInput.addEventListener('input', () => {
        block.data = view.dataInput.value;
        view.attempts.textContent = '';
        recomputeChain();
      });

      view.nonceInput.addEventListener('input', () => {
        block.nonce = parseInt(view.nonceInput.value, 10) || 0;
        view.attempts.textContent = '';
        recomputeChain();
      });

      view.mineBtn.addEventListener('click', () => mineBlock(i));
    });
  }

  function paintBlock(i) {
    const block = blocks[i];
    const view = views[i];
    const valid = isValid(block);
    const lead = difficulty;

    view.el.classList.toggle('is-valid', valid);
    view.el.classList.toggle('is-invalid', !valid);

    view.badge.textContent = valid ? 'Block valid' : 'Block invalid';
    view.badge.className = 'badge ' + (valid ? 'badge--valid' : 'badge--invalid');

    view.prev.textContent = block.prevHash;

    // Highlight the leading characters — that prefix is the whole proof of work.
    view.hash.innerHTML =
      '<span class="lead">' + block.hash.slice(0, lead) + '</span>' + block.hash.slice(lead);
    view.hashline.classList.toggle('is-invalid', !valid);

    view.nonceInput.value = block.nonce;
  }

  function paintAll() {
    blocks.forEach((_, i) => paintBlock(i));
  }

  /* ---------- mining ---------- */

  function setBusy(state) {
    busy = state;
    mineAllBtn.disabled = state;
    resetBtn.disabled = state;
    difficultyEl.disabled = state;
    views.forEach(v => { v.mineBtn.disabled = state; });
  }

  async function mineBlock(i) {
    if (busy) return;
    setBusy(true);

    const block = blocks[i];
    const view = views[i];
    const target = '0'.repeat(difficulty);

    view.el.classList.remove('is-valid', 'is-invalid');
    view.el.classList.add('is-mining');
    view.badge.textContent = 'Mining…';
    view.badge.className = 'badge badge--mining';

    block.prevHash = i === 0 ? GENESIS_PREV : blocks[i - 1].hash;

    let nonce = 0;
    let hash = '';
    const started = performance.now();

    // Brute force. Yield to the browser periodically so the UI stays responsive.
    while (true) {
      block.nonce = nonce;
      hash = await hashText(serialize(block));
      if (hash.startsWith(target)) break;
      nonce++;

      if (nonce % 500 === 0) {
        view.attempts.textContent = nonce.toLocaleString() + ' attempts';
        await new Promise(r => setTimeout(r, 0));
      }
    }

    block.nonce = nonce;
    block.hash = hash;

    const elapsed = ((performance.now() - started) / 1000).toFixed(2);
    view.attempts.textContent = 'Found after ' + nonce.toLocaleString() + ' attempts in ' + elapsed + 's';
    view.el.classList.remove('is-mining');

    // Downstream blocks now consume a different prev hash, so they break here.
    await recomputeChain();
    setBusy(false);
  }

  async function mineAll() {
    for (let i = 0; i < blocks.length; i++) {
      await mineBlock(i);
    }
  }

  /* ---------- controls ---------- */

  mineAllBtn.addEventListener('click', () => { if (!busy) mineAll(); });

  resetBtn.addEventListener('click', async () => {
    if (busy) return;
    blocks = createChain();
    buildDom();
    await recomputeChain();
  });

  difficultyEl.addEventListener('change', async () => {
    difficulty = parseInt(difficultyEl.value, 10);
    views.forEach(v => { v.attempts.textContent = ''; });
    await recomputeChain();
  });

  /* ---------- boot ---------- */

  blocks = createChain();
  buildDom();
  recomputeChain();
})();
