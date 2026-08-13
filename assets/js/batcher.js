/* ============================================================================
   batcher.js — hero animation on the home page.

   Shows the core rollup loop: many L2 transactions stream into the sequencer,
   get compressed into one batch, and settle on the L1 rail above. Pure canvas,
   no dependencies.

   Two things it does that a decorative animation wouldn't:
     · colours follow the site's semantic system, read live from the CSS custom
       properties, so L1 is always amber and L2 always blue — and so the whole
       animation re-themes itself when the light/dark toggle flips.
     · it renders at devicePixelRatio, so the hairlines stay crisp on retina
       screens instead of going soft.

   Honours prefers-reduced-motion by drawing a single readable frame.
   ============================================================================ */

(function () {
  'use strict';

  const canvas = document.getElementById('batcher');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  // Logical drawing size. The backing store is scaled up by DPR below, so all
  // the geometry below can stay in these comfortable coordinates.
  const W = 520;
  const H = 320;

  const L1_Y = 54;          // the Ethereum rail across the top
  const L2_Y = 226;         // the Arbitrum lane across the bottom
  const GATE_X = W - 150;   // the sequencer / batcher
  const BATCH_SIZE = 12;    // txs per batch — the compression ratio, visibly

  let COLORS = {};

  // Pull the palette out of CSS rather than hardcoding it, so the canvas and
  // the rest of the page can never drift apart.
  function readPalette() {
    const css = getComputedStyle(document.documentElement);
    const get = function (name, fallback) {
      return (css.getPropertyValue(name) || '').trim() || fallback;
    };
    COLORS = {
      l1:    get('--l1', '#f2a54c'),
      l2:    get('--l2', '#2ba6ff'),
      line:  get('--line-strong', 'rgba(255,255,255,0.14)'),
      muted: get('--faint', '#545c6b'),
      text:  get('--ink', '#f4f6fa')
    };
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.aspectRatio = W + ' / ' + H;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const txs = [];        // in-flight L2 transactions
  const batches = [];    // batches climbing to L1
  const settled = [];    // batches parked on the L1 rail

  let txCount = 0;
  let batchCount = 0;
  let pending = 0;
  let frame = 0;

  const readoutTx = document.getElementById('txCount');
  const readoutBatch = document.getElementById('batchCount');

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------ drawing */

  function spawnTx() {
    txs.push({
      x: -14,
      y: L2_Y + (Math.random() * 34 - 17),
      speed: 1.5 + Math.random() * 1.1,
      size: 6 + Math.random() * 4
    });
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Draw a translucent version of a token colour without needing a second var.
  function alpha(color, a) {
    // Works for hex tokens; anything else falls back to the colour as-is.
    if (color.charAt(0) !== '#' || color.length < 7) return color;
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  function drawRails() {
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 1;

    // L1 rail — amber
    ctx.strokeStyle = alpha(COLORS.l1, 0.45);
    ctx.beginPath();
    ctx.moveTo(0, L1_Y + 22); ctx.lineTo(W, L1_Y + 22); ctx.stroke();

    // L2 lane — blue
    ctx.strokeStyle = alpha(COLORS.l2, 0.35);
    ctx.beginPath();
    ctx.moveTo(0, L2_Y); ctx.lineTo(GATE_X, L2_Y); ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = '500 10px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = alpha(COLORS.l1, 0.9);
    ctx.fillText('LAYER 1  ·  ETHEREUM  ·  SETTLEMENT', 8, L1_Y + 12);
    ctx.fillStyle = alpha(COLORS.l2, 0.9);
    ctx.fillText('LAYER 2  ·  ARBITRUM  ·  EXECUTION', 8, L2_Y + 46);
  }

  function drawGate() {
    ctx.strokeStyle = COLORS.l2;
    ctx.lineWidth = 1.2;
    roundRect(GATE_X, L2_Y - 34, 74, 68, 4);
    ctx.stroke();
    ctx.fillStyle = alpha(COLORS.l2, 0.08);
    ctx.fill();

    ctx.font = '500 9px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = COLORS.l2;
    ctx.fillText('BATCHER', GATE_X + 11, L2_Y - 44);

    // A fill meter so you can see the batch actually filling up.
    const ratio = pending / BATCH_SIZE;
    ctx.fillStyle = alpha(COLORS.l2, 0.22);
    ctx.fillRect(GATE_X + 1, L2_Y + 33 - 66 * ratio, 72, 66 * ratio);

    ctx.font = '600 15px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillStyle = COLORS.text;
    ctx.fillText(String(pending).padStart(2, '0'), GATE_X + 27, L2_Y + 6);
  }

  function drawTxs() {
    ctx.fillStyle = alpha(COLORS.l2, 0.8);
    txs.forEach(function (t) {
      roundRect(t.x, t.y - t.size / 2, t.size, t.size, 1.5);
      ctx.fill();
    });
  }

  // A batch in transit is leaving L2 for L1, so it fades blue → amber.
  function drawBatches() {
    batches.forEach(function (b) {
      const progress = Math.min(1, Math.max(0, (L2_Y - b.y) / (L2_Y - L1_Y)));
      ctx.strokeStyle = progress > 0.5 ? COLORS.l1 : COLORS.l2;
      ctx.lineWidth = 1.2;
      roundRect(b.x, b.y - 11, 30, 22, 3);
      ctx.stroke();
      ctx.fillStyle = alpha(progress > 0.5 ? COLORS.l1 : COLORS.l2, 0.14);
      ctx.fill();
    });
  }

  function drawSettled() {
    settled.forEach(function (s, i) {
      const x = 12 + i * 38;
      if (x > W - 40) return;

      ctx.strokeStyle = COLORS.l1;
      ctx.lineWidth = 1;
      roundRect(x, L1_Y + 12, 30, 22, 3);
      ctx.stroke();
      ctx.fillStyle = alpha(COLORS.l1, 0.12);
      ctx.fill();

      // the chain link between settled batches
      if (i > 0) {
        ctx.strokeStyle = alpha(COLORS.l1, 0.4);
        ctx.beginPath();
        ctx.moveTo(x - 8, L1_Y + 23);
        ctx.lineTo(x, L1_Y + 23);
        ctx.stroke();
      }
    });
  }

  /* ---------------------------------------------------------------- loop */

  function step() {
    ctx.clearRect(0, 0, W, H);
    drawRails();

    if (frame % 9 === 0) spawnTx();

    for (let i = txs.length - 1; i >= 0; i--) {
      const t = txs[i];
      t.x += t.speed;
      t.y += (L2_Y - t.y) * 0.02;          // drift toward the batcher inlet

      if (t.x >= GATE_X) {
        txs.splice(i, 1);
        pending++;
        txCount++;
        if (readoutTx) readoutTx.textContent = txCount.toLocaleString();

        if (pending >= BATCH_SIZE) {
          pending = 0;
          batches.push({ x: GATE_X + 22, y: L2_Y - 40 });
        }
      }
    }

    for (let i = batches.length - 1; i >= 0; i--) {
      const b = batches[i];
      b.y -= 2.6;
      b.x -= 1.4;
      if (b.y <= L1_Y + 30) {
        batches.splice(i, 1);
        batchCount++;
        settled.push({});
        if (settled.length > 12) settled.shift();
        if (readoutBatch) readoutBatch.textContent = batchCount.toLocaleString();
      }
    }

    drawSettled();
    drawBatches();
    drawTxs();
    drawGate();

    frame++;
    requestAnimationFrame(step);
  }

  function drawStaticFrame() {
    ctx.clearRect(0, 0, W, H);
    drawRails();
    txs.length = 0;
    for (let i = 0; i < 14; i++) {
      txs.push({ x: 20 + i * 24, y: L2_Y + (i % 3 - 1) * 10, size: 8 });
    }
    settled.length = 0;
    settled.push({}, {}, {}, {});
    pending = 8;
    drawSettled();
    drawTxs();
    drawGate();
    if (readoutTx) readoutTx.textContent = '168';
    if (readoutBatch) readoutBatch.textContent = '14';
  }

  /* ---------------------------------------------------------------- boot */

  readPalette();
  resize();

  if (reducedMotion) drawStaticFrame();
  else step();

  // Re-read the palette when the theme flips, and redraw immediately if the
  // animation loop isn't running to do it for us.
  window.addEventListener('themechange', function () {
    readPalette();
    if (reducedMotion) drawStaticFrame();
  });

  window.addEventListener('resize', function () {
    resize();
    if (reducedMotion) drawStaticFrame();
  });
})();
