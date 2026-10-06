/**
 * `@dsh-skin/harness-skin` — host half.
 *
 * Contributes the skin's global stylesheet, the one-time shell transition
 * layer's markup, and its inline state machine to every index render through
 * the webserver's structured injection table. Nothing here touches the model
 * surface, and the plugin degrades to a no-op when the composition has no
 * webserver (the `ctx.inject` guard).
 *
 * Layout owned by this package (keep it flat — the client half resolves its
 * bundle through `dsh.client` and this host half through the profile patch):
 *
 *   lib/index.js     this module
 *   lib/theme.css    token palette + shell-placeholder handshake
 *   lib/boot.css     transition layer styles and keyframes
 *   lib/client.js    browser half: activation handshake, HMR-clean styles
 *
 * @module @dsh-skin/harness-skin
 */

import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Stable plugin name, used in log messages. */
const NAME = '@dsh-skin/harness-skin'

/** Absolute directory holding this module's assets. */
const LIB_DIR = new URL('./', import.meta.url)

/** Asset cache: file name -> { mtimeMs, size, text }. */
const assets = new Map()

/** Defaults for every config field; a partial config is merged over these. */
const DEFAULTS = {
  enabled: true,
  overlay: true,
  theme: true,
  minVisibleMs: 2200,
  readyTimeoutMs: 12000,
  playOncePerSession: true,
}

/**
 * Read a sibling asset, re-reading only when it changed on disk so a live
 * patch/reload cycle serves edited CSS without a process restart.
 *
 * @param {string} name - file name inside this package's `lib/` directory.
 * @returns {string} the file's UTF-8 text.
 */
function readAsset(name) {
  const path = fileURLToPath(new URL(name, LIB_DIR))
  const stat = statSync(path)
  const cached = assets.get(name)
  if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.text
  }
  const text = readFileSync(path, 'utf8')
  assets.set(name, { mtimeMs: stat.mtimeMs, size: stat.size, text })
  return text
}

/**
 * Merge the live config over the defaults, ignoring malformed fields.
 *
 * @param {unknown} raw - the loader-provided plugin config.
 * @returns {typeof DEFAULTS} a complete config.
 */
function resolveConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const config = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS)) {
    const value = source[key]
    if (value === undefined) continue
    if (typeof value === typeof DEFAULTS[key]) config[key] = value
    else console.warn(`${NAME}: ignoring config.${key}: expected ${typeof DEFAULTS[key]}`)
  }
  return config
}

/**
 * The wordmark copy, and the single-stroke skeleton used to write it.
 *
 * A system font cannot be "written": a glyph is a set of closed *outlines*, so
 * stroking them with a dash offset draws a hollow letter with gaps. Instead the
 * wordmark is drawn as real strokes — a small monoline skeleton, one path per
 * pen stroke, which the state machine reveals with `stroke-dashoffset`.
 *
 * Coordinates are on a 100-unit em: baseline 82, cap height 60. Only the glyphs
 * this title needs are defined; anything else falls back to a plain dot so the
 * renderer never produces a broken word.
 */
const WORDMARK = 'DEEPSEEK HARNESS'

/** One record per character: how many pen strokes, and their paths. */
const STROKE_GLYPHS = {
  D: ['M22,18 L22,78', 'M22,18 L46,18 C64,18 74,30 74,48 C74,66 64,78 46,78 L22,78'],
  E: ['M66,18 L26,18 L26,78 L66,78', 'M26,48 L58,48'],
  P: ['M24,78 L24,18 L52,18 C70,18 70,48 52,48 L24,48'],
  S: ['M70,28 C70,18 58,16 48,16 C34,16 28,22 28,32 C28,42 40,46 50,49 C62,52 72,56 72,66 C72,76 60,82 46,82 C34,82 26,78 24,68'],
  K: ['M26,18 L26,80', 'M68,18 L26,50', 'M42,42 L70,80'],
  H: ['M26,18 L26,80', 'M70,18 L70,80', 'M26,48 L70,48'],
  A: ['M22,80 L48,18 L74,80', 'M32,56 L64,56'],
  R: ['M26,78 L26,18 L54,18 C72,18 72,46 54,46 L26,46', 'M50,46 L72,78'],
  N: ['M26,80 L26,18 L70,80 L70,18'],
}

/** Em box and layout constants for the skeleton (glyph units, 100-unit em). */
const GLYPH_EM = { height: 110, advance: 100, glyphWidth: 100, spaceRatio: 0.5, stroke: 4, pad: 4 }

/**
 * Render the wordmark: one cell per letter, holding a static stroke SVG plus an HTML
 * block that wipes across it. Laid out by the flexbox in `boot.css`.
 *
 * The blocks are HTML elements rather than SVG children because a transform animation on
 * an HTML element is composited — it keeps running while the app's boot blocks the main
 * thread (measured: ~170ms), which an SVG-child transform does not do.
 *
 * @returns {string} the wordmark markup (a row of per-letter cells).
 */
function wordmarkSvg() {
  const { height, glyphWidth, spaceRatio, stroke, pad } = GLYPH_EM
  const cells = []
  let index = 0
  for (const character of WORDMARK) {
    if (character === ' ') {
      cells.push(`<span class="hsx-boot__gap" aria-hidden="true" style="flex-basis:calc(var(--hsx-cell) * ${spaceRatio})"></span>`)
      continue
    }
    const glyph = STROKE_GLYPHS[character] ?? [`M30,${height - 32} L70,${height - 32}`]
    const paths = glyph.map((data) => `<path d="${data}"></path>`).join('')
    // One HTML cover per LETTER, not one SVG rect per stroke. Two reasons, both measured:
    //   * the stagger is per glyph anyway (a letter is meant to arrive in one motion);
    //   * a transform animation on an HTML element is handed to the compositor, while a
    //     transform on an SVG child is not. Only this version keeps moving while the app's
    //     own boot blocks the main thread for ~170ms — and that block is the hitch the
    //     user still feels, since the animation is otherwise at the native frame rate.
    // The cover shrinks with `scaleX(1 -> 0)` from its right edge, so it always stays
    // inside its own cell: no clip paths are needed, and it can never cover a neighbour.
    cells.push(`<span class="hsx-boot__cell" data-hsx-char="${index}">`
      + `<svg class="hsx-boot__glyph" viewBox="${-pad} ${-pad} ${glyphWidth + pad * 2} ${height + pad * 2}" `
      + `aria-hidden="true" style="--hsx-stroke:${stroke}">${paths}</svg>`
      + `<span class="hsx-boot__cover" aria-hidden="true" data-hsx-stroke="${index}" `
      + `style="--hsx-i:${index}"></span>`
      + `</span>`)
    index += 1
  }
  return `<div class="hsx-boot__word" role="img" aria-label="${WORDMARK}" `
    + `data-hsx-glyphs="${index}">${cells.join('')}</div>`
}

/**
 * The transition layer's DOM. Kept as one literal so the preview page, the
 * script's query selectors and the stylesheet stay on one contract.
 *
 * The layout is deliberately bare: the wordmark centred, one status line, and
 * the sliver/block elements the exit drives.
 *
 * @returns {string} the markup fragment injected right after `<body>`.
 */
function bootMarkup() {
  return `<div class="hsx-boot" id="hsx-boot" data-hsx-root role="progressbar" aria-label="正在载入工作台" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">`
    + '<div class="hsx-boot__inner">'
    + '<div class="hsx-boot__index">00 / 00</div>'
    + `<div class="hsx-boot__title" data-hsx-wordmark="${WORDMARK}">${wordmarkSvg()}</div>`
    + '<div class="hsx-boot__rule" aria-hidden="true"></div>'
    + '</div>'
    + '<div class="hsx-boot__status"><span class="hsx-boot__pulse" aria-hidden="true"></span><span class="hsx-boot__hint">正在载入工作台</span></div>'
    + '<div class="hsx-boot__bar" aria-hidden="true"><i data-hsx-bar></i></div>'
    + '<div class="hsx-boot__sweep" aria-hidden="true"></div>'
    + '</div>'
}

/**
 * The transition layer's state machine, serialized into the document so it
 * runs before the shell can paint. Responsibilities: hold the layer while the
 * shell activates, drive the readout, play the exit, then hand ownership back
 * (remove the node and release the shell's boot placeholder).
 *
 * Debug switches: `?hsx=off` (skip), `?hsx=only` (hold until Escape),
 * `?hsx=slow` (3x), `?hsx=drawing` (freeze mid-stroke), `?hsx=write` (first half
 * of the name written), `?hsx=still` (name complete), `?hsx=sweep` (park the
 * sweep), `?hsx=flood` (park the full block).
 *
 * Readiness: the shell removes its boot placeholder in the same commit that
 * mounts the app. Because this layer is injected before any plugin runs, that
 * removal is a genuine handoff marker — but a plugin that fails to activate
 * leaves the placeholder (and its failure card) in place forever, so a stuck
 * detector releases the layer when the placeholder stops changing instead of
 * hiding the failure card behind it.
 *
 * @param {typeof DEFAULTS} config - resolved plugin config.
 * @returns {string} an inline classic script body.
 */
function bootScript(config) {
  const settings = {
    minVisibleMs: config.minVisibleMs,
    readyTimeoutMs: config.readyTimeoutMs,
    playOncePerSession: config.playOncePerSession,
  }
  const body = `(() => {
  const settings = ${JSON.stringify({ ...settings, wordmark: WORDMARK })};
  const root = document.documentElement;
  const existing = document.getElementById('hsx-boot');
  const params = new URLSearchParams(location.search);
  const mode = params.get('hsx') || 'auto';
  const multiplier = mode === 'slow' ? 3 : 1;
  let played = false;
  try { played = sessionStorage.getItem('hsx-boot-played') === '1' } catch {}

  if (mode === 'off' || (played && settings.playOncePerSession && mode !== 'only')) {
    try { sessionStorage.setItem('hsx-boot-played', '1') } catch {}
    if (existing) existing.remove();
    return;
  }
  if (!existing) return;

  root.dataset.hsxBoot = '';

  // --- theme: the field, the ink and the exiting block all follow the shell ---
  const dark = root.hasAttribute('data-ds-dark-theme') || document.body.hasAttribute('data-ds-dark-theme')
    || ((typeof matchMedia !== 'undefined') && matchMedia('(prefers-color-scheme: dark)').matches
        && !document.body.hasAttribute('data-ds-light-theme'));
  existing.setAttribute('data-hsx-mode', dark ? 'dark' : 'light');

  // Base durations, mirroring boot.css. The container's clock variable scales every
  // one of them, so the timers stay exact for slow mode and reduced motion without
  // parsing composed calc() expressions back out of the stylesheet. Computed BEFORE
  // the stroke measurement below, which needs these numbers to precompute the stagger.
  const timeline = (() => {
    const raw = getComputedStyle(existing).getPropertyValue('--hsx-k').trim();
    const parsed = parseFloat(raw);
    const k = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
    const write = 1100 * k;
    const hold = 1500 * k;
    const char = 340 * k;
    // Not used for the stagger any more (that is per glyph now, and lives in boot.css).
    // It is still needed to bound when the LAST STROKE lands: within a glyph the blocks
    // now move together, so the final one finishes inside char rather than after a
    // per-stroke gap, and keeping this margin only makes nameDrawnAt conservative.
    const partGap = 120 * k;
    const rail = 220 * k;
    const travel = 900 * k;
    const flood = 320 * k;
    const fade = 460 * k;
    return { k, write, hold, char, partGap, rail, travel, flood, fade, total: write + hold + rail + travel + flood + fade };
  })();

  // --- the stagger ----------------------------------------------------------
  //
  // One write, not 27. The per-glyph delay lives in boot.css as a calc() over --hsx-i
  // (which the markup carries per cover) and --hsx-cells (below). Doing it in CSS keeps
  // it scaled by the clock variable for free and removes a style write per cover at
  // startup; the alternative was 27 inline delays resolved before the first frame.
  existing.style.setProperty('--hsx-cells', String(Math.max(1, settings.wordmark.length)));

  if (mode === 'slow') existing.classList.add('hsx-boot--slow');
  if (mode === 'drawing') existing.classList.add('hsx-boot--drawing');
  if (mode === 'write') existing.classList.add('hsx-boot--write');
  if (mode === 'still') existing.classList.add('hsx-boot--still');
  if (mode === 'sweep') existing.classList.add('hsx-boot--sweep');
  if (mode === 'flood') existing.classList.add('hsx-boot--flood');
  if (mode === 'only') existing.removeAttribute('aria-hidden');
  // The clock starts when the PEN starts, not when the document loads. The shell
  // needs a second or two to mount the app, and running the writing animation
  // through that is what made the opening stutter: the two competed for the same
  // main thread. So the layer first shows a complete, still frame (the index line,
  // no wordmark) while the app boots silently, and the timeline begins from the
  // moment the shell reports ready.
  //
  // When the pen finishes the name (no hold), and when CSS lets the block start
  // (write + hold, i.e. --hsx-step). The block must not move before the name is done:
  // the final character starts one stagger before that boundary and still needs its
  // own stroke duration drawn. Computed in the browser, because the timeline is
  // scaled by the container's own --hsx-k.
  const cells = Math.max(1, settings.wordmark.length);
  const lastGlyph = Math.max(0, cells - 2);
  const lastStrokeStart = (timeline.write + timeline.char) * lastGlyph / cells;
  const lastStrokeEnd = lastStrokeStart + timeline.char + 1.13 * timeline.partGap;
  const nameDrawnAt = Math.max(timeline.write, lastStrokeEnd);
  const blockStartsAt = timeline.write + timeline.hold;
  if (blockStartsAt < nameDrawnAt - 1) {
    throw new Error('--hsx-hold is too short for the last stroke; see lib/boot.css')
  }
  const minVisible = Math.max(settings.minVisibleMs * timeline.k, blockStartsAt);
  let writingStartedAt = 0;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let writing = false;
  let ready = false;
  /** When the shell reported ready, so the pen's wait for quiet frames can be reported. */
  let firstReadyAt = 0;
  let unreadySeen = false;
  let dismissed = false;
  let observer;
  let poll;

  /** Release the writing phase; returns true when this call is what released it. */
  const startWriting = () => {
    if (writing || dismissed) return false;
    writing = true;
    writingStartedAt = now();
    existing.classList.add('hsx-boot--writing');
    startProbe();
    return true;
  };

  /**
   * Sample frame intervals for the duration of the writing phase, then stop.
   *
   * An earlier probe ran for the whole session and was removed for costing frames it
   * existed to measure. This one is bounded: it starts only when the pen is released,
   * takes one sample per frame for at most 3 seconds, and publishes the summary in
   * two places:
   *
   *   - localStorage, which lives with the app's own profile and therefore SURVIVES
   *     closing the app — the reliable channel;
   *   - a beacon to the local collector (harness/collect-frames.mjs), which is live
   *     only while that helper runs and is a silent no-op otherwise.
   *
   * Console and window.__HSX__.perf carry it too, for a session that is still open.
   *
   * @returns {void}
   */
  function startProbe() {
    const deltas = [];
    let previous = 0;
    const began = now();
    const step = (stamp) => {
      if (dismissed) { report(); return; }
      if (previous !== 0) deltas.push(stamp - previous);
      previous = stamp;
      if (now() - began < 3000 && deltas.length < 600) requestAnimationFrame(step);
      else report();
    };
    const report = () => {
      if (deltas.length === 0) return;
      const sorted = deltas.slice().sort((a, b) => a - b);
      const pct = (fraction) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0);
      const summary = {
        kind: 'hsx-writing-frames',
        k: timeline.k,
        mode,
        frames: deltas.length,
        median: pct(0.5),
        p95: pct(0.95),
        worst: Math.round(Math.max(...deltas)),
        over20: deltas.filter((value) => value > 20).length,
        over33: deltas.filter((value) => value > 33).length,
        // Null when the watchdog released the pen before any readiness signal.
        quietWaitMs: firstReadyAt > 0 ? Math.round(writingStartedAt - firstReadyAt) : null,
      };
      window.__HSX__.perf = summary;
      // Durable channel: the app's own storage, so the numbers outlive the window.
      // The last 10 reports are kept; each is one tiny JSON object.
      try {
        const kept = JSON.parse(localStorage.getItem('hsx-frames') || '[]');
        kept.push({ ...summary, at: Math.round(now()) });
        localStorage.setItem('hsx-frames', JSON.stringify(kept.slice(-10)));
      } catch (error) { /* storage unavailable: the beacon still has it */ }
      try { console.debug('harness-skin writing frames', summary) } catch (error) { /* ignore */ }
      try {
        navigator.sendBeacon('http://127.0.0.1:19477/hsx', JSON.stringify(summary));
      } catch (error) { /* collector not running: fine */ }
    };
    requestAnimationFrame(step);
  }
  let exitScheduled = false;
  /** The delay the exit last asked for, exposed for the diagnostic pages. */
  let lastExitWait = 0;

  /**
   * Wait until the main thread is actually free before starting the pen.
   *
   * Writing animates stroke-dashoffset, which cannot be composited: Chromium
   * re-rasterizes the vector paths on the main thread every frame. Meanwhile the
   * shell is still mounting the app on that same thread — and that contention, not
   * the animation's own cost, is what makes the writing stutter while the exit
   * (a composited translateX) glides. So the pen waits for a few quiet frames.
   *
   * @param {() => void} done - called once the thread looks idle, or on timeout.
   * @returns {void}
   */
  const whenQuiet = (done) => {
    const QUIET_FRAME_MS = 20;
    // SUSTAINED quiet, not a lucky patch. The shell reports ready when the app's mount
    // STARTS, and the post-mount work then arrives in bursts — measured on the real
    // machine as 219ms frames while the pen was writing. Six clean frames is only ~36ms
    // at 165Hz; a burst hides behind that trivially. The pen waits for this much
    // CONSECUTIVE clean time (any long frame resets it), capped so a shell that never
    // settles cannot hold the still frame hostage.
    const QUIET_MS = 700;
    const LIMIT_MS = 3000;
    // How long the browser may hold the final handover to find a moment of slack.
    const IDLE_TIMEOUT_MS = 400;
    let quietMs = 0;
    let previous = 0;
    let finished = false;
    const began = now();
    const finish = () => {
      if (finished || dismissed) return;
      finished = true;
      // Even after a clean stretch the next task can still be heavy, so hand the pen
      // over when the browser actually reports idle.
      if (typeof requestIdleCallback === 'function') requestIdleCallback(done, { timeout: IDLE_TIMEOUT_MS });
      else done();
    };
    // Timer-based backstop as well: requestAnimationFrame does not fire at all in
    // some environments (it fires exactly once under headless virtual time), and the
    // sequence must never stall waiting for frames that will not come.
    setTimeout(finish, LIMIT_MS + 60);
    const step = (stamp) => {
      if (finished || dismissed) return;
      if (previous !== 0) {
        const delta = stamp - previous;
        quietMs = delta <= QUIET_FRAME_MS ? quietMs + delta : 0;
      }
      previous = stamp;
      if (quietMs >= QUIET_MS || now() - began > LIMIT_MS) { finish(); return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  /**
   * Release the pen through the quiet gate, exactly once.
   *
   * Every release path except readiness goes through here. Measured on the real
   * machine: the fallback kick fired at 1200ms while the shell only reported ready at
   * ~2100ms, so the pen started mid-mount and walked straight into a 237ms frame —
   * the one hitch the user could actually feel (every other frame was native 6ms).
   * A release must never land in the middle of the shell's bursts.
   *
   * @param {string} reason - what triggered the release, for the console.
   * @returns {void}
   */
  let releasing = false;
  const releaseWhenIdle = (reason) => {
    if (writing || dismissed || releasing) return;
    releasing = true;
    whenQuiet(() => {
      releasing = false;
      if (writing || dismissed) return;
      try { console.debug('${NAME}: pen released after idle frames (' + reason + ')') } catch (error) { /* ignore */ }
      startWriting();
    });
  };

  /**
   * How long the name still needs before it is fully written, counted from the
   * moment the pen was released. The exit may never start before that, whatever
   * triggered it: the shell can report ready at any time, including immediately,
   * and starting the sweep then would cover the wordmark while the first strokes
   * are still being drawn.
   *
   * @returns {number} milliseconds to wait.
   */
  const nameRemaining = () => {
    if (!writing) return 0;
    // Wait for whichever is later: the name being fully drawn, or the block's
    // earliest allowed moment (which is also the minimum visible time).
    const doneAt = Math.max(minVisible, nameDrawnAt, blockStartsAt);
    return Math.max(0, writingStartedAt + doneAt - now());
  };

  // The progressbar's ARIA state is set at its two real transitions, not from a frame
  // loop. This used to run a requestAnimationFrame loop that wrote aria-valuenow on
  // EVERY frame — and because the pen is deliberately held until the shell is ready and
  // the main thread is quiet, that loop spun on an unchanging value for the whole
  // waiting period. An attribute write invalidates style (and can invalidate layout),
  // so it was pure per-frame cost competing with the very animation it was timing. The
  // bar's visual progress is a CSS animation and needs no help.
  existing.setAttribute('aria-valuenow', '0');

  const onReady = () => {
    // Handled ONCE. The placeholder observer keeps firing mark() for as long as the
    // app mutates the DOM, so without this guard every later mutation re-entered here:
    // it spawned ANOTHER quiet-wait and overwrote firstReadyAt with a later timestamp.
    // That is why the measured "pen minus readiness" came back negative even when the
    // pen really did wait — the timestamp it was compared against was being moved.
    if (ready || dismissed) return;
    ready = true;
    firstReadyAt = now();
    whenQuiet(() => {
      startWriting();
      const wait = nameRemaining();
      if (wait > 0) setTimeout(exit, wait);
      else exit();
    });
  };

  const cleanup = () => {
    if (observer) observer.disconnect();
    if (poll) clearInterval(poll);
    existing.remove();
    delete root.dataset.hsxBoot;
    try { sessionStorage.setItem('hsx-boot-played', '1') } catch {}
    window.dispatchEvent(new CustomEvent('hsx:done'));
  };

  function exit() {
    if (dismissed) return;
    // INVARIANT: the name is always written before the layer leaves. Every exit path
    // — the shell's ready signal, the stuck-shell watchdog, a manual dismiss — has to
    // release the pen AND wait out the name first. Without this the screen went from
    // the still frame straight to the sweep with no wordmark ever appearing, which is
    // exactly what the stuck-shell watchdog used to cause.
    const released = startWriting();
    const wait = released ? nameRemaining() : 0;
    if (wait > 0 && !exitScheduled) {
      exitScheduled = true;
      lastExitWait = Math.round(wait);
      setTimeout(() => { exitScheduled = false; exit(); }, wait);
      return;
    }
    dismissed = true;
    if (observer) observer.disconnect();
    if (poll) clearInterval(poll);
    existing.setAttribute('aria-valuenow', '100');
    if (mode === 'drawing') {
      // Freeze the blocks mid-wipe and hold the layer for review: the first letter is
      // half revealed, the rest are still fully covered.
      const frozen = [...existing.querySelectorAll('.hsx-boot__cover')];
      frozen.forEach((cover, index) => {
        cover.style.animation = 'none';
        cover.style.transform = index === 0 ? 'scaleX(0.52)' : 'scaleX(1)';
      });
      return;
    }
    if (mode === 'write' || mode === 'still' || mode === 'sweep' || mode === 'flood') {
      setTimeout(cleanup, 400);
      return;
    }
    existing.classList.add('hsx-boot--leaving');
    // Measured from this same moment, exactly as boot.css anchors its delays:
    // rail (after the step), travel, flood, then the fade. The timeline object
    // already carries whatever clock multiplier the mode applied.
    setTimeout(cleanup, timeline.total + 60);
  }

  const armObservation = () => {
    if (ready) return;
    /** When the placeholder's text last changed; 0 until the first reading. */
    let stableSince = 0;
    let lastMarkup = null;
    const mark = () => {
      const placeholder = document.querySelector('[data-dsh-boot]');
      if (placeholder === null) {
        if (unreadySeen || window.__DSH_BOOT__) onReady();
        return;
      }
      unreadySeen = true;
      // A placeholder that stops changing while still mounted is a stuck shell
      // (failed activation renders a failure card inside it). Release the layer so
      // the user can read it, rather than covering it forever.
      //
      // Measured in ELAPSED TIME, not in check counts: this runs from both the poll
      // below and the MutationObserver, and the transition layer's own state machine
      // mutates the DOM, so the observer fires far more often than the poll. A count
      // of checks is not a clock — that mistake made this watchdog fire at ~1.2s
      // instead of 2.4s and cut the writing phase short.
      const markup = placeholder.textContent || '';
      if (markup !== lastMarkup) {
        lastMarkup = markup;
        stableSince = markup.length > 0 ? now() : 0;
        return;
      }
      if (stableSince === 0 || now() - stableSince < 2400 * multiplier) return;
      // Only release once the name has been written. The exit path waits for it
      // anyway, but starting that count from here would leave the name only the
      // sliver of time between this watchdog and the write+hold deadline.
      // The release itself waits for idle frames: a shell whose placeholder froze may
      // still be churning on the main thread.
      if (!writing) {
        releaseWhenIdle('stuck-shell watchdog');
        return;
      }
      if (nameRemaining() > 0) return;
      console.warn('${NAME}: shell did not hand off (placeholder stuck); releasing the transition layer');
      exit();
    };
    observer = new MutationObserver(mark);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-dsh-boot'] });
    let polls = 0;
    poll = setInterval(() => {
      polls += 1;
      mark();
      if (ready) clearInterval(poll);
      else if (polls > 600 * multiplier) clearInterval(poll);
    }, 16);
  };

  window.addEventListener('dsh:ready', onReady, { once: true });
  window.__HSX__ = {
    dismiss: exit,
    markReady: onReady,
    get state() { return { ready, dismissed, mode } },
    // Exposed for the diagnostic pages: what the state machine actually computed.
    get timeline() { return { write: timeline.write, hold: timeline.hold, nameDrawnAt, blockStartsAt, minVisible }; },
    get exitWait() { return lastExitWait; },
  };
  if (mode === 'only') window.addEventListener('keydown', (event) => { if (event.key === 'Escape') exit() });

  // NOTE: frame sampling is BOUNDED (see startProbe above): it runs for the writing
  // phase only, one sample per frame for up to 3 seconds, and never for the whole
  // session. An always-on probe was removed earlier because it fired its own
  // requestAnimationFrame callback alongside the animation on a display whose frame
  // budget can be under 7ms — measuring the thing by making it slower. Static pages
  // are measured out of process (harness/measure-frames.mjs, harness/trace-layer.mjs);
  // this exists only because the real app's frames cannot be observed from outside.

  const postReady = () => armObservation();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', postReady, { once: true });
  else postReady();

  // The fallback: if readiness never arrives, do not hold the still frame forever.
  // Set LATER than the shell's normal ready signal — measured on the real machine the
  // shell reports ready at ~2.1s, and the old 1200ms kick preempted it, which is
  // exactly how the pen ended up drawing through a 237ms mount-time frame. The kick is
  // now only a "this shell looks dead" net, and even it waits for idle frames; the
  // stuck-shell watchdog (placeholder frozen) and readyTimeoutMs cover the rest.
  const kickAfterMs = 4000;
  setTimeout(() => {
    if (!writing && !dismissed && !ready) {
      console.debug('${NAME}: no readiness signal yet; queueing the writing phase');
      releaseWhenIdle('fallback kick');
    }
  }, kickAfterMs * multiplier);
  // A second, later net: if the shell still has not reported ready, do not hold a
  // finished name on screen forever. The stuck-shell detector keeps running too.
  setTimeout(() => {
    if (!ready && !dismissed) {
      console.warn('${NAME}: shell did not report readiness in time; releasing the transition layer');
      onReady();
    }
  }, settings.readyTimeoutMs * multiplier);

})();`
  // The body is a template literal, so a backtick anywhere inside it — even in a
  // comment — closes it early. That failure mode is nasty: the module still parses
  // in some shapes, and the error names an innocent identifier far from the cause.
  // It happened four times while this file was being written, so it is now checked
  // here and again in harness/check-markup.mjs.
  if (body.includes('`')) {
    throw new Error('bootScript: the generated script body must not contain a backtick')
  }
  return body
}

/**
 * Install the skin on a composed web profile.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 * @param {unknown} rawConfig - loader-provided config.
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  if (!config.enabled) return
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.on('webserver/index-inject', (table) => {
      if (config.theme) table.push({ kind: 'style', text: readAsset('theme.css') })
      if (config.overlay) {
        table.push({ kind: 'style', text: readAsset('boot.css') })
        table.push({ kind: 'html', placement: 'body', html: bootMarkup() })
        table.push({ kind: 'script', placement: 'body', text: bootScript(config) })
      }
    })
    webCtx.logger?.debug?.(`${NAME}: transition layer ${config.overlay ? 'on' : 'off'}, theme ${config.theme ? 'on' : 'off'}`)
  })
}

export const name = 'harness-skin'
export { DEFAULTS, bootMarkup, bootScript, readAsset, resolveConfig, wordmarkSvg }
