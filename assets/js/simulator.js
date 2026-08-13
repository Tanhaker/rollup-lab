/* ============================================================
   simulator.js — a proof-of-work chain running in the browser.

   Model:  block = { index, data, nonce, prevHash, hash }
   Hash:   SHA-256 via the Web Crypto API. If crypto.subtle is unavailable
           (some browsers block it on file:// pages), we fall back to a
           deterministic non-cryptographic hash so the page still demonstrates
           the same behaviour — clearly labelled in the toolbar.
   Rule:   a block is valid when its hash starts with N leading zeros.
   Chain:  block[i].prevHash = block[i-1].hash, so editing an early block
           changes its hash, which changes the next block's input, and so on.

   The chain starts at three blocks and can grow to six, because the cascade
   is more convincing the further it has to travel.
   ============================================================ */

(function () {
  const GENESIS_PREV = window.RollupCore.GENESIS_PREV;
  const MIN_BLOCKS = 2;
  const MAX_BLOCKS = 6;

  const chainEl = document.getElementById('chain');
  const mineAllBtn = document.getElementById('mineAllBtn');
  const tamperBtn = document.getElementById('tamperBtn');
  const addBlockBtn = document.getElementById('addBlockBtn');
  const removeBlockBtn = document.getElementById('removeBlockBtn');
  const resetBtn = document.getElementById('resetBtn');
  const difficultyEl = document.getElementById('difficulty');
  const engineNote = document.getElementById('engineNote');
  const verdictEl = document.getElementById('verdict');
  const verdictText = document.getElementById('verdictText');

  const useWebCrypto = !!(window.crypto && window.crypto.subtle);
  engineNote.textContent = useWebCrypto
    ? 'ENGINE: WEB CRYPTO SHA-256'
    : 'ENGINE: FALLBACK HASH (SHA-256 UNAVAILABLE ON THIS ORIGIN)';

  let difficulty = parseInt(difficultyEl.value, 10);
  let blocks = [];
  let views = [];   // DOM references per block, so typing never loses focus
  let busy = false;

  /* ---------- hashing ---------- */

  // Pure helpers come from core.js so they can be unit tested
  // (see tests/core.test.js). This file keeps the DOM and the mining loop.
  const C = window.RollupCore;
  const serialize = C.serializeBlock;
  const fallbackHex = C.fallbackHex;

  function isValid(block) {
    return C.meetsDifficulty(block.hash, difficulty);
  }

  async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function hashText(text) {
    return useWebCrypto ? sha256Hex(text) : Promise.resolve(fallbackHex(text));
  }

  /* ---------- chain state ---------- */

  const SEED_DATA = [
    'Alice pays Bob 5 ETH',
    'Bob pays Carol 2 ETH',
    'Carol pays Dev 1 ETH',
    'Dev pays Erin 0.5 ETH',
    'Erin pays Frank 0.25 ETH',
    'Frank pays Alice 0.1 ETH'
  ];

  function makeBlock(index) {
    return {
      index: index,
      data: SEED_DATA[index - 1] || 'Block ' + index + ' payload',
      nonce: 0,
      prevHash: index === 1 ? GENESIS_PREV : '',
      hash: ''
    };
  }

  function createChain() {
    return [makeBlock(1), makeBlock(2), makeBlock(3)];
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
        '<div class="f f--wide">' +
          '<label for="prev-' + block.index + '">Previous hash (auto-filled)</label>' +
          '<input class="field" id="prev-' + block.index + '" type="text" data-role="prev" readonly ' +
                 'aria-describedby="prevhint-' + block.index + '" />' +
        '</div>' +
      '</div>' +

      '<p class="preimage" id="prevhint-' + block.index + '">' +
        '<b>SHA-256 INPUT</b> <span data-role="pre"></span>' +
      '</p>' +

      '<p class="hashline" data-role="hashline" style="margin-top:12px;">HASH &nbsp;<span data-role="hash"></span></p>' +

      '<div class="block__actions">' +
        '<button class="btn btn--sm" type="button" data-role="mine">Mine block ' + block.index + '</button>' +
        '<button class="ghost-link" type="button" data-role="copy">COPY HASH</button>' +
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
        pre: el.querySelector('[data-role="pre"]'),
        hash: el.querySelector('[data-role="hash"]'),
        hashline: el.querySelector('[data-role="hashline"]'),
        mineBtn: el.querySelector('[data-role="mine"]'),
        copyBtn: el.querySelector('[data-role="copy"]'),
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

      // On blur, normalise whatever was left in the box back to the real value
      // (an empty field or "abc" both mean nonce 0).
      view.nonceInput.addEventListener('blur', () => {
        view.nonceInput.value = block.nonce;
      });

      view.mineBtn.addEventListener('click', () => mineBlock(i));

      view.copyBtn.addEventListener('click', () => copyHash(view, block));
    });

    updateChainButtons();
  }

  function paintBlock(i, firstBroken) {
    const block = blocks[i];
    const view = views[i];
    const valid = isValid(block);
    const lead = difficulty;

    view.el.classList.toggle('is-valid', valid);
    view.el.classList.toggle('is-invalid', !valid);
    view.el.classList.toggle('is-culprit', firstBroken === i);

    view.badge.textContent = valid ? 'Block valid' : 'Block invalid';
    view.badge.className = 'badge ' + (valid ? 'badge--valid' : 'badge--invalid');

    view.prev.value = block.prevHash;

    // textContent, not innerHTML — block data is free-form user input.
    view.pre.textContent = serialize(block);

    // Highlight the leading characters — that prefix is the whole proof of work.
    view.hash.innerHTML =
      '<span class="lead">' + block.hash.slice(0, lead) + '</span>' + block.hash.slice(lead);
    view.hashline.classList.toggle('is-invalid', !valid);

    // Never write back into a field the user is currently typing in. Doing so
    // fights the caret: "007" collapses to "7", and clearing the box snaps it
    // straight back to 0. Mining updates the nonce while the field is blurred,
    // which is the only time this write actually needs to happen.
    if (document.activeElement !== view.nonceInput) {
      view.nonceInput.value = block.nonce;
    }
  }

  function paintAll() {
    // The first invalid block is where tampering (or unfinished mining) starts.
    let firstBroken = -1;
    for (let i = 0; i < blocks.length; i++) {
      if (!isValid(blocks[i])) { firstBroken = i; break; }
    }

    blocks.forEach((_, i) => paintBlock(i, firstBroken));
    paintVerdict(firstBroken);
  }

  function paintVerdict(firstBroken) {
    const total = blocks.length;
    const invalid = blocks.filter(b => !isValid(b)).length;

    verdictEl.classList.toggle('is-ok', firstBroken === -1);
    verdictEl.classList.toggle('is-broken', firstBroken !== -1);

    if (firstBroken === -1) {
      verdictText.textContent =
        'All ' + total + ' blocks valid at difficulty ' + difficulty +
        '. Every hash meets the target and each block carries the hash of the one above it.';
    } else {
      verdictText.textContent =
        'Broken from block #' + blocks[firstBroken].index + ' onward — ' + invalid + ' of ' + total +
        ' blocks no longer meet the target. Re-mining block #' + blocks[firstBroken].index +
        ' would change its hash again, so every block after it has to be re-mined too.';
    }
  }

  async function copyHash(view, block) {
    const original = view.copyBtn.textContent;
    try {
      await navigator.clipboard.writeText(block.hash);
      view.copyBtn.textContent = 'COPIED';
    } catch (err) {
      // Clipboard access needs a secure context; say so rather than failing silently.
      view.copyBtn.textContent = 'COPY BLOCKED';
    }
    setTimeout(() => { view.copyBtn.textContent = original; }, 1400);
  }

  /* ---------- mining ---------- */

  function updateChainButtons() {
    addBlockBtn.disabled = busy || blocks.length >= MAX_BLOCKS;
    removeBlockBtn.disabled = busy || blocks.length <= MIN_BLOCKS;
  }

  function setBusy(state) {
    busy = state;
    mineAllBtn.disabled = state;
    tamperBtn.disabled = state;
    resetBtn.disabled = state;
    difficultyEl.disabled = state;
    views.forEach(v => { v.mineBtn.disabled = state; });
    updateChainButtons();
  }

  async function mineBlock(i) {
    if (busy) return;
    setBusy(true);
    await mineBlockInner(i);
    await recomputeChain();
    setBusy(false);
  }

  // The actual loop, split out so mineAll can drive it without toggling
  // the busy flag once per block.
  async function mineBlockInner(i) {
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

    // Brute force, but batched. Awaiting crypto.subtle once per nonce means one
    // microtask round-trip per attempt, which at difficulty 4 (~65k expected
    // attempts) is agonising. Hashing BATCH candidates concurrently and then
    // scanning the results in order is 10-30x faster and still deterministic:
    // we always take the lowest nonce that satisfies the target, exactly as a
    // sequential search would.
    const BATCH = 1024;
    let found = -1;

    while (found === -1) {
      const candidates = [];
      for (let n = nonce; n < nonce + BATCH; n++) {
        candidates.push(hashText(serialize({
          index: block.index,
          data: block.data,
          nonce: n,
          prevHash: block.prevHash
        })));
      }

      const hashes = await Promise.all(candidates);

      for (let k = 0; k < hashes.length; k++) {
        if (hashes[k].startsWith(target)) {
          found = nonce + k;
          hash = hashes[k];
          break;
        }
      }

      if (found === -1) {
        nonce += BATCH;
        // Repaint the counter every few batches rather than every batch — the
        // text update forces layout, and at difficulty 4 that adds up.
        if ((nonce / BATCH) % 4 === 0) {
          view.attempts.textContent = nonce.toLocaleString() + ' attempts';
        }
        // Hand the frame back so the page stays alive and interruptible.
        await new Promise(r => setTimeout(r, 0));
      }
    }

    nonce = found;
    block.nonce = nonce;
    block.hash = hash;

    const seconds = (performance.now() - started) / 1000;
    const rate = seconds > 0 ? Math.round(nonce / seconds) : 0;
    view.attempts.textContent =
      'Found after ' + nonce.toLocaleString() + ' attempts in ' + seconds.toFixed(2) + 's' +
      (rate ? ' · ~' + rate.toLocaleString() + ' h/s' : '');
    view.el.classList.remove('is-mining');
  }

  async function mineAll() {
    if (busy) return;
    setBusy(true);
    // Front to back: each block needs the finished hash of the one before it.
    for (let i = 0; i < blocks.length; i++) {
      await mineBlockInner(i);
      await recomputeChain();
    }
    setBusy(false);
  }

  /* ---------- controls ---------- */

  mineAllBtn.addEventListener('click', mineAll);

  // One-click demonstration of the whole point of the page.
  tamperBtn.addEventListener('click', async () => {
    if (busy) return;
    const first = blocks[0];
    first.data = 'Alice pays Bob 500 ETH';   // the classic silent edit
    views[0].dataInput.value = first.data;
    views.forEach(v => { v.attempts.textContent = ''; });
    await recomputeChain();
    views[0].dataInput.focus();
  });

  addBlockBtn.addEventListener('click', async () => {
    if (busy || blocks.length >= MAX_BLOCKS) return;
    blocks.push(makeBlock(blocks.length + 1));
    buildDom();
    await recomputeChain();
  });

  removeBlockBtn.addEventListener('click', async () => {
    if (busy || blocks.length <= MIN_BLOCKS) return;
    blocks.pop();
    buildDom();
    await recomputeChain();
  });

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
