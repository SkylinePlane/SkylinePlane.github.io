/* --------------------------------------------------------------------------
   Rub to Reveal — heart-shaped eraser over a stack of pictures.

   How it works: two canvases sit on top of each other. The bottom one holds
   the next picture in the series, the top one holds the current picture.
   Scrubbing punches heart-shaped holes in the top canvas with a
   `destination-out` composite, so the picture underneath shows through.
   Once enough has been rubbed away the rest dissolves, the two canvases
   shuffle along by one, and the whole thing starts again.

   Nothing to edit here — the knobs all live in config.js.
   -------------------------------------------------------------------------- */

(function () {
  'use strict';

  var DEFAULTS = {
    title: 'Rub to Reveal',
    subtitle: '',
    hint: 'Click and drag across the image.',
    images: [],
    aspectRatio: '4 / 3',
    brushSize: 120,
    revealThreshold: 0.55,
    loop: true,
    softEdge: true
  };

  var CFG = {};
  var user = window.SITE_CONFIG || {};
  for (var k in DEFAULTS) { CFG[k] = (k in user) ? user[k] : DEFAULTS[k]; }

  var REVEAL_MS = 700;          // length of the dissolve
  var GRID = 44;                // coverage grid, GRID x GRID cells
  var MAX_STROKES = 24000;      // safety net on the replay buffer

  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- Elements ---------------------------------------------------------- */

  var stage      = document.getElementById('stage');
  var belowCv    = document.getElementById('below');
  var topCv      = document.getElementById('scratch');
  var follower   = document.getElementById('cursor');
  var sparkles   = document.getElementById('sparkles');
  var stageMsg   = document.getElementById('stage-message');
  var progressEl = document.getElementById('progress');
  var fillEl     = document.getElementById('progress-fill');
  var captionEl  = document.getElementById('caption');
  var counterEl  = document.getElementById('counter');
  var revealBtn  = document.getElementById('reveal-btn');
  var restartBtn = document.getElementById('restart-btn');
  var hintEl     = document.getElementById('hint');
  var liveEl     = document.getElementById('live');

  var belowCtx = belowCv.getContext('2d');
  var topCtx   = topCv.getContext('2d');

  /* ---- State ------------------------------------------------------------- */

  var pics = [];            // { img, caption }
  var index = 0;            // which picture is on top
  var W = 0, H = 0, dpr = 1;
  var brush = CFG.brushSize;
  var sprite = null;        // pre-rendered heart, stamped for each erase
  var strokes = [];         // normalised stamps, replayed after a resize
  var grid = null;
  var covered = 0;
  var drawing = false;
  var lastX = 0, lastY = 0;
  var sinceStamp = 0;       // travel since the last stamp, in CSS pixels
  var revealing = false;
  var finished = false;
  var pointerId = null;

  /* ---- Small helpers ----------------------------------------------------- */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function parseAspect(value) {
    if (typeof value === 'number' && isFinite(value) && value > 0) return value;
    var parts = String(value).split('/');
    var w = parseFloat(parts[0]);
    var h = parts.length > 1 ? parseFloat(parts[1]) : 1;
    if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return 4 / 3;
    return w / h;
  }

  function loadImage(entry) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.decoding = 'async';
      img.onload = function () { resolve({ img: img, caption: entry.caption || '' }); };
      img.onerror = function () {
        console.warn('Could not load image: ' + entry.src);
        resolve(null);
      };
      img.src = entry.src;
    });
  }

  function say(text) { if (liveEl) liveEl.textContent = text; }

  /* ---- Heart geometry ---------------------------------------------------- */

  // A heart centred on the origin, `size` wide and `size` tall.
  function heartPath(ctx, size) {
    var w = size, h = size;
    var y = -h / 2;
    var top = h * 0.3;

    ctx.beginPath();
    ctx.moveTo(0, y + top);
    ctx.bezierCurveTo(0, y, -w / 2, y, -w / 2, y + top);
    ctx.bezierCurveTo(-w / 2, y + (h + top) / 2, 0, y + (h + top) / 2, 0, y + h);
    ctx.bezierCurveTo(0, y + (h + top) / 2, w / 2, y + (h + top) / 2, w / 2, y + top);
    ctx.bezierCurveTo(w / 2, y, 0, y, 0, y + top);
    ctx.closePath();
  }

  // Rendering the heart once and stamping the result keeps scrubbing cheap,
  // and lets us feather the edge without paying for a blur on every stamp.
  function buildSprite(size) {
    var pad = Math.ceil(size * 0.15);
    var box = Math.ceil(size + pad * 2);
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(box * dpr));
    cv.height = cv.width;

    var c = cv.getContext('2d');
    c.scale(cv.width / box, cv.width / box);
    c.translate(box / 2, box / 2);
    if (CFG.softEdge) {
      var blur = Math.max(1, size * 0.018);
      try { c.filter = 'blur(' + blur.toFixed(2) + 'px)'; } catch (e) { /* older browser */ }
    }
    c.fillStyle = '#fff';
    heartPath(c, size);
    c.fill();

    return { canvas: cv, box: box };
  }

  /* ---- Coverage tracking -------------------------------------------------
     Rather than reading pixels back (slow, and blocked outright when the page
     is opened straight off disk), we keep a coarse grid and tick off the cells
     the brush has passed over. */

  function resetGrid() {
    grid = new Uint8Array(GRID * GRID);
    covered = 0;
    updateProgress();
  }

  function markGrid(x, y, size) {
    if (!W || !H) return;
    var cw = W / GRID, ch = H / GRID;
    var r = size * 0.40;
    var i0 = clamp(Math.floor((x - r) / cw), 0, GRID - 1);
    var i1 = clamp(Math.floor((x + r) / cw), 0, GRID - 1);
    var j0 = clamp(Math.floor((y - r) / ch), 0, GRID - 1);
    var j1 = clamp(Math.floor((y + r) / ch), 0, GRID - 1);
    var rr = r * r;

    for (var j = j0; j <= j1; j++) {
      for (var i = i0; i <= i1; i++) {
        var idx = j * GRID + i;
        if (grid[idx]) continue;
        var dx = (i + 0.5) * cw - x;
        var dy = (j + 0.5) * ch - y;
        if (dx * dx + dy * dy <= rr) { grid[idx] = 1; covered++; }
      }
    }
  }

  function progress() { return covered / (GRID * GRID); }

  function updateProgress() {
    var pct = Math.round(clamp(progress() / CFG.revealThreshold, 0, 1) * 100);
    fillEl.style.width = pct + '%';
    progressEl.setAttribute('aria-valuenow', String(pct));
  }

  /* ---- Painting ---------------------------------------------------------- */

  function drawCover(ctx, img, w, h) {
    ctx.clearRect(0, 0, w, h);
    var iw = img.naturalWidth || img.width;
    var ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;

    var scale = Math.max(w / iw, h / ih);
    var dw = iw * scale, dh = ih * scale;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  function picAt(offset) {
    if (!pics.length) return null;
    var i = index + offset;
    if (i >= pics.length) {
      if (!CFG.loop) return null;
      i = i % pics.length;
    }
    return pics[i];
  }

  function paintTop() {
    var p = picAt(0);
    if (p) drawCover(topCtx, p.img, W, H);
  }

  function paintBelow() {
    var p = picAt(1);
    if (p) drawCover(belowCtx, p.img, W, H);
    else belowCtx.clearRect(0, 0, W, H);
  }

  function stamp(x, y, size, angle) {
    if (!sprite) return;
    topCtx.save();
    topCtx.globalCompositeOperation = 'destination-out';
    topCtx.translate(x, y);
    if (angle) topCtx.rotate(angle);
    topCtx.drawImage(sprite.canvas, -sprite.box / 2, -sprite.box / 2,
                     sprite.box, sprite.box);
    topCtx.restore();
  }

  function replayStrokes() {
    for (var i = 0; i < strokes.length; i++) {
      var s = strokes[i];
      stamp(s.x * W, s.y * H, s.s * W, s.a);
    }
  }

  /* ---- Layout ------------------------------------------------------------ */

  function sizeCanvas(cv, ctx) {
    cv.width = Math.max(1, Math.round(W * dpr));
    cv.height = Math.max(1, Math.round(H * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function layout() {
    var rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    W = rect.width;
    H = rect.height;
    dpr = clamp(window.devicePixelRatio || 1, 1, 3);

    brush = Math.round(clamp(W * 0.14, 44, CFG.brushSize));
    document.documentElement.style.setProperty('--brush', brush + 'px');
    sprite = buildSprite(brush);

    sizeCanvas(belowCv, belowCtx);
    sizeCanvas(topCv, topCtx);

    paintBelow();
    paintTop();
    replayStrokes();
  }

  /* ---- Scrubbing --------------------------------------------------------- */

  function localPoint(ev) {
    var rect = stage.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  function canScrub() {
    return !revealing && !finished && pics.length > 1;
  }

  function rubTo(x, y) {
    // A little rotation on each stamp keeps the trail from looking extruded.
    var jitter = (Math.random() - 0.5) * 0.55;
    stamp(x, y, brush, jitter);
    markGrid(x, y, brush);
    if (strokes.length < MAX_STROKES) {
      strokes.push({ x: x / W, y: y / H, s: brush / W, a: jitter });
    }
  }

  // Stamps are laid down every `step` pixels of travel, measured across
  // events rather than within one — otherwise a slow drag fires a stamp per
  // event and the trail turns back into a smear.
  function rubLine(x0, y0, x1, y1) {
    var dx = x1 - x0, dy = y1 - y0;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (!dist) return;

    // Far enough apart that each heart still reads, close enough that they
    // overlap into one continuous cut.
    var step = Math.max(4, brush * 0.4);
    var at = step - sinceStamp;

    while (at <= dist) {
      var t = at / dist;
      rubTo(x0 + dx * t, y0 + dy * t);
      at += step;
    }
    sinceStamp = dist - (at - step);
  }

  function onPointerDown(ev) {
    moveFollower(ev);
    if (!canScrub()) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;

    drawing = true;
    pointerId = ev.pointerId;
    follower.classList.add('pressing');
    try { stage.setPointerCapture(ev.pointerId); } catch (e) { /* not fatal */ }

    var p = localPoint(ev);
    lastX = p.x; lastY = p.y;
    sinceStamp = 0;
    rubTo(p.x, p.y);
    updateProgress();
    checkThreshold();
    ev.preventDefault();
  }

  function onPointerMove(ev) {
    moveFollower(ev);
    if (!drawing || ev.pointerId !== pointerId || !canScrub()) return;

    // Coalesced events keep fast flicks from leaving gaps in the trail.
    var events = (typeof ev.getCoalescedEvents === 'function')
      ? ev.getCoalescedEvents() : [ev];
    if (!events.length) events = [ev];

    for (var i = 0; i < events.length; i++) {
      var p = localPoint(events[i]);
      rubLine(lastX, lastY, p.x, p.y);
      lastX = p.x; lastY = p.y;
    }

    updateProgress();
    checkThreshold();
    ev.preventDefault();
  }

  function endStroke(ev) {
    if (ev && pointerId !== null && ev.pointerId !== pointerId) return;
    drawing = false;
    pointerId = null;
    follower.classList.remove('pressing');
  }

  function checkThreshold() {
    if (progress() >= CFG.revealThreshold) reveal();
  }

  /* ---- The follower heart ------------------------------------------------ */

  function moveFollower(ev) {
    if (ev.pointerType === 'touch') stage.classList.remove('no-follower');
    follower.style.transform =
      'translate3d(' + (ev.clientX - brush / 2) + 'px,' +
                       (ev.clientY - brush / 2) + 'px, 0)';
    follower.classList.add('visible');
  }

  function hideFollower() {
    follower.classList.remove('visible', 'pressing');
  }

  /* ---- Revealing --------------------------------------------------------- */

  function reveal() {
    if (revealing || finished || pics.length < 2) return;
    revealing = true;
    drawing = false;
    follower.classList.remove('pressing');
    revealBtn.disabled = true;
    fillEl.style.width = '100%';
    progressEl.setAttribute('aria-valuenow', '100');

    stage.classList.add('revealing');
    popHearts();
    window.setTimeout(advance, reduceMotion ? 30 : REVEAL_MS);
  }

  // Shuffle everything along by one without a flicker: the top canvas is
  // invisible right now, so we repaint it with the picture the viewer is
  // already looking at, snap it back to full opacity (identical pixels, so
  // nothing appears to change), and only then load the following picture
  // underneath — hidden behind the now-opaque top layer.
  function advance() {
    var last = (index + 1 >= pics.length);

    if (last && !CFG.loop) {
      index = pics.length - 1;
      finishSeries();
      return;
    }

    index = (index + 1) % pics.length;

    paintTop();                          // step 1: same pixels, hidden layer
    stage.classList.add('instant');
    stage.classList.remove('revealing'); // step 2: snap back to opaque
    // Force the browser to apply both together before we touch the layer below.
    void stage.offsetWidth;
    paintBelow();                        // step 3: queue up the next picture

    strokes = [];
    resetGrid();
    revealing = false;
    revealBtn.disabled = false;
    updateMeta();

    requestAnimationFrame(function () {
      requestAnimationFrame(function () { stage.classList.remove('instant'); });
    });
  }

  function finishSeries() {
    finished = true;
    revealing = false;
    stage.classList.add('instant');
    stage.classList.remove('revealing');
    paintTop();
    paintBelow();
    strokes = [];
    resetGrid();
    void stage.offsetWidth;
    stage.classList.remove('instant');

    revealBtn.disabled = true;
    stageMsg.textContent = 'That’s the last one.';
    stageMsg.hidden = false;
    updateMeta();
    say('End of the series.');
  }

  function popHearts() {
    if (reduceMotion) return;
    var svg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l' +
      '-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 ' +
      '4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 ' +
      '6.86-8.55 11.54L12 21.35z"/></svg>';

    for (var i = 0; i < 9; i++) {
      var el = document.createElement('span');
      el.className = 'spark';
      el.innerHTML = svg;
      el.style.left = (8 + Math.random() * 84) + '%';
      el.style.width = el.style.height = (14 + Math.random() * 20) + 'px';
      el.style.animationDelay = (Math.random() * 0.35) + 's';
      el.style.setProperty('--spin', ((Math.random() - 0.5) * 90) + 'deg');
      sparkles.appendChild(el);
      (function (node) {
        window.setTimeout(function () { node.remove(); }, 2200);
      })(el);
    }
  }

  function restart() {
    index = 0;
    finished = false;
    revealing = false;
    strokes = [];
    stage.classList.add('instant');
    stage.classList.remove('revealing');
    paintTop();
    paintBelow();
    void stage.offsetWidth;
    stage.classList.remove('instant');
    stageMsg.hidden = true;
    revealBtn.disabled = pics.length < 2;
    resetGrid();
    updateMeta();
    say('Back to the beginning.');
  }

  function updateMeta() {
    var p = pics[index];
    captionEl.textContent = p ? p.caption : '';
    counterEl.textContent = (index + 1) + ' / ' + pics.length;
    say((p && p.caption ? p.caption + '. ' : '') +
        'Picture ' + (index + 1) + ' of ' + pics.length + '.');
  }

  /* ---- Wiring ------------------------------------------------------------ */

  function bind() {
    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerenter', moveFollower);
    stage.addEventListener('pointerleave', function (ev) {
      hideFollower();
      endStroke(ev);
    });
    window.addEventListener('pointerup', endStroke);
    window.addEventListener('pointercancel', function (ev) {
      hideFollower();
      endStroke(ev);
    });

    // Keyboard route through the series, for anyone not using a pointer.
    stage.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
        ev.preventDefault();
        reveal();
      }
    });

    revealBtn.addEventListener('click', reveal);
    restartBtn.addEventListener('click', restart);

    var resizeTimer;
    window.addEventListener('resize', function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(layout, 150);
    });

    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () {
        var rect = stage.getBoundingClientRect();
        if (Math.abs(rect.width - W) > 0.5 || Math.abs(rect.height - H) > 0.5) layout();
      });
      ro.observe(stage);
    }
  }

  function fatal(message) {
    stageMsg.textContent = message;
    stageMsg.hidden = false;
    revealBtn.disabled = true;
    restartBtn.disabled = true;
    counterEl.textContent = '';
    say(message);
  }

  function init() {
    document.title = CFG.title;
    document.getElementById('site-title').textContent = CFG.title;

    var sub = document.getElementById('site-subtitle');
    sub.textContent = CFG.subtitle || '';
    sub.hidden = !CFG.subtitle;

    hintEl.textContent = CFG.hint || '';

    document.documentElement.style.setProperty('--ar', String(parseAspect(CFG.aspectRatio)));
    document.documentElement.style.setProperty('--brush', CFG.brushSize + 'px');

    // A device with no hover has no cursor to replace.
    if (window.matchMedia && window.matchMedia('(hover: none)').matches) {
      stage.classList.add('no-follower');
    }

    if (!CFG.images || !CFG.images.length) {
      fatal('No pictures listed yet — add some to config.js.');
      return;
    }

    resetGrid();

    Promise.all(CFG.images.map(loadImage)).then(function (loaded) {
      pics = loaded.filter(Boolean);

      if (!pics.length) {
        fatal('None of the pictures could be loaded. Check the paths in config.js.');
        return;
      }

      layout();
      updateMeta();
      bind();

      if (pics.length < 2) {
        revealBtn.disabled = true;
        stageMsg.textContent = 'Add a second picture to config.js and this one ' +
                               'will rub away to reveal it.';
        stageMsg.hidden = false;
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
