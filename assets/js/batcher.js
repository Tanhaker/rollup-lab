/* ============================================================
   batcher.js — hero animation on the home page.
   Shows the core rollup loop: many L2 transactions stream into a
   sequencer, get compressed into one batch, and settle on the L1 rail.
   Pure canvas, no dependencies. Honours prefers-reduced-motion.
   ============================================================ */

(function () {
  const canvas = document.getElementById('batcher');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  const COLORS = {
    line:  '#22374f',
    muted: '#7e96b0',
    blue:  '#2fb2ff',
    green: '#42d392',
    text:  '#dce8f5'
  };

  const L1_Y = 54;       // the Ethereum rail across the top
  const L2_Y = 226;      // the Arbitrum lane across the bottom
  const GATE_X = W - 150; // the sequencer / batcher

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

  function drawRails() {
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(0, L1_Y + 22); ctx.lineTo(W, L1_Y + 22); ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, L2_Y); ctx.lineTo(GATE_X, L2_Y); ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = '600 10px "IBM Plex Mono", monospace';
    ctx.fillStyle = COLORS.muted;
    ctx.fillText('LAYER 1  ·  ETHEREUM  ·  SETTLEMENT', 8, L1_Y + 12);
    ctx.fillText('LAYER 2  ·  ARBITRUM  ·  EXECUTION', 8, L2_Y + 46);
  }

  function drawGate() {
    // The sequencer/batcher box
    ctx.strokeStyle = COLORS.blue;
    ctx.lineWidth = 1.2;
    roundRect(GATE_X, L2_Y - 34, 74, 68, 3);
    ctx.stroke();

    ctx.fillStyle = 'rgba(47,178,255,0.07)';
    ctx.fill();

    ctx.font = '600 9px "IBM Plex Mono", monospace';
    ctx.fillStyle = COLORS.blue;
    ctx.fillText('BATCHER', GATE_X + 11, L2_Y - 44);

    ctx.font = '600 15px "IBM Plex Mono", monospace';
    ctx.fillStyle = COLORS.text;
    const label = String(pending).padStart(2, '0');
    ctx.fillText(label, GATE_X + 27, L2_Y + 6);
  }

  function drawTxs() {
    txs.forEach(t => {
      ctx.fillStyle = 'rgba(47,178,255,0.75)';
      roundRect(t.x, t.y - t.size / 2, t.size, t.size, 1);
      ctx.fill();
    });
  }

  function drawBatches() {
    batches.forEach(b => {
      ctx.strokeStyle = COLORS.green;
      ctx.lineWidth = 1.2;
      roundRect(b.x, b.y - 11, 30, 22, 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(66,211,146,0.12)';
      ctx.fill();
    });
  }

  function drawSettled() {
    settled.forEach((s, i) => {
      const x = 12 + i * 38;
      if (x > W - 40) return;
      ctx.strokeStyle = COLORS.green;
      ctx.lineWidth = 1;
      roundRect(x, L1_Y + 12, 30, 22, 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(66,211,146,0.10)';
      ctx.fill();

      // chain link between settled batches
      if (i > 0) {
        ctx.strokeStyle = COLORS.line;
        ctx.beginPath();
        ctx.moveTo(x - 8, L1_Y + 23);
        ctx.lineTo(x, L1_Y + 23);
        ctx.stroke();
      }
    });
  }

  function step() {
    ctx.clearRect(0, 0, W, H);
    drawRails();

    // spawn L2 transactions steadily
    if (frame % 9 === 0) spawnTx();

    // move transactions into the batcher
    for (let i = txs.length - 1; i >= 0; i--) {
      const t = txs[i];
      t.x += t.speed;
      // drift toward the batcher inlet
      t.y += (L2_Y - t.y) * 0.02;
      if (t.x >= GATE_X) {
        txs.splice(i, 1);
        pending++;
        txCount++;
        if (readoutTx) readoutTx.textContent = txCount.toLocaleString();

        // once the batcher is full, emit one batch to L1
        if (pending >= 12) {
          pending = 0;
          batches.push({ x: GATE_X + 22, y: L2_Y - 40 });
        }
      }
    }

    // batches travel up to the L1 rail
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
    // Reduced-motion users get one readable frame instead of a loop.
    ctx.clearRect(0, 0, W, H);
    drawRails();
    for (let i = 0; i < 14; i++) {
      txs.push({ x: 20 + i * 24, y: L2_Y + (i % 3 - 1) * 10, size: 8 });
    }
    settled.push({}, {}, {}, {});
    pending = 12;
    drawSettled();
    drawTxs();
    drawGate();
    if (readoutTx) readoutTx.textContent = '168';
    if (readoutBatch) readoutBatch.textContent = '14';
  }

  if (reducedMotion) drawStaticFrame();
  else step();
})();
