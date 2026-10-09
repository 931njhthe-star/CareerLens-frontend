import {
  drawFixedAnchorFrame,
  loadStudyArtwork,
  studyRingOpacity,
  studyRotation,
} from './fixed-anchor-study.js';

export const ANALYSIS_ENTRY_MS = 460;

const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const smooth = (value) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};
const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);

/** One viewport coordinate system for every workflow page and the modal's top layer. */
export function liveMotionViewport(width, height) {
  const w = Math.max(1, finite(width, 1200));
  const h = Math.max(1, finite(height, 800));
  const scale = Math.max(0.1, Math.min(0.9, (w - 32) / 1200, (h - 120) / 620));
  const centerX = w / 2;
  const centerY = Math.min(h * 0.48, Math.max(w <= 1000 ? 288 : 270, Math.min(330, h * 0.3)));
  return {
    left: 0,
    top: 0,
    width: w,
    height: h,
    scale,
    centerX,
    centerY,
    radius: 60 * scale,
    offsetX: centerX - 600 * scale,
    offsetY: centerY - 245 * scale,
    stageBottom: centerY + 196 * scale + 32,
  };
}

/** Keep the captured pupil fixed even when opening the modal removes a scrollbar. */
export function liveAnalysisViewport(width, height, snapshot) {
  const current = liveMotionViewport(width, height);
  const captured = snapshot?.frame;
  if (
    !captured ||
    snapshot.viewportWidth !== width ||
    snapshot.viewportHeight !== height ||
    !['centerX', 'centerY', 'radius', 'scale', 'offsetX', 'offsetY', 'stageBottom'].every((key) =>
      Number.isFinite(captured[key]),
    ) ||
    captured.scale <= 0 ||
    captured.radius <= 0
  ) {
    return current;
  }
  return { ...current, ...captured, width, height };
}

/** First clear the page behind the ring, then accelerate and draw the eye. */
export function liveEyeChoreography(
  elapsed,
  {
    initialTime = 10.4,
    initialRotation = studyRotation(10.4),
    active = true,
    readyAt = 4000,
    reduced = false,
  } = {},
) {
  const initial = clamp(initialTime, 0, 10.4);
  const gatherMs = initial < 9.5 ? Math.min(900, (10.4 - initial) * 170) : 0;
  const entryMs = reduced ? 0 : Math.max(ANALYSIS_ENTRY_MS, gatherMs);
  const time = Math.max(0, active ? elapsed : readyAt);
  const entering = time < entryMs;
  const gathering = time < gatherMs;
  const sceneTime =
    reduced || !active
      ? 18
      : entering
        ? gathering
          ? initial + (10.4 - initial) * smooth(time / gatherMs)
          : 10.4
        : 12 + 6 * clamp((time - entryMs) / (4000 - entryMs));
  const rotation =
    initialRotation +
    (reduced
      ? 0
      : Math.min(time, entryMs) * 0.00062 +
        studyRotation(12 + Math.max(0, time - entryMs) / 1000) -
        studyRotation(12));
  return {
    entering,
    sceneTime,
    rotation,
    reflection: active ? (entering ? studyRingOpacity(sceneTime) : 1) : 0,
  };
}

/** Illustrative progress never reaches 100 until the final request has succeeded. */
export class LiveAnalysisClock {
  constructor() {
    this.completedAt = null;
    this.readyAt = null;
    this.from = 0;
  }
  progress(elapsed) {
    const time = Math.max(0, elapsed);
    if (this.completedAt !== null) {
      return (
        this.from +
        (1 - this.from) * smooth((time - this.completedAt) / (this.readyAt - this.completedAt))
      );
    }
    return time < 4000
      ? 0.92 * Math.pow(time / 4000, 0.85)
      : Math.min(0.99, 0.92 + 0.07 * (1 - Math.exp(-(time - 4000) / 6500)));
  }
  complete(elapsed) {
    if (this.completedAt !== null) return;
    this.from = this.progress(elapsed);
    this.completedAt = Math.max(0, elapsed);
    this.readyAt = Math.max(4000, this.completedAt + 400);
  }
  frame(elapsed) {
    const done = this.readyAt !== null && elapsed >= this.readyAt;
    const amount = this.progress(elapsed);
    return {
      percent: done ? 100 : Math.min(99, Math.floor(amount * 100)),
      active: !done,
      sceneTime: 12 + Math.min(6, Math.max(0, elapsed) * 0.0015),
      amount,
    };
  }
}

/** Same v8 painter, with real request completion replacing the preview's fixed timer. */
export function mountLiveAnalysisEye(host, { snapshot, onProgress } = {}) {
  const element = document.createElement('div');
  element.className = 'live-analysis-motion';
  element.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1;';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none;';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '이력서와 채용공고를 분석하고 있습니다.');
  element.append(canvas);
  // A separate measured eye rectangle gives the existing report transition its real source.
  const scene = document.createElement('div');
  scene.className = 'live-analysis-scene';
  scene.style.cssText = 'position:fixed;pointer-events:none;';
  scene.setAttribute('aria-hidden', 'true');
  element.append(scene);
  host.replaceChildren(element);
  const context = canvas.getContext('2d');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const started = performance.now();
  const clock = new LiveAnalysisClock();
  const seed = finite(snapshot?.seed, 7);
  const initialRotation = finite(snapshot?.rotation, studyRotation(10.4));
  const initialTime = clamp(finite(snapshot?.time, 10.4), 0, 10.4);
  let viewport;
  let disposed = false;
  let raf = 0;
  let finishTimer;
  let lastPercent = -1;
  let resolveSettled;
  const settled = new Promise((resolve) => {
    resolveSettled = resolve;
  });

  function render(now = performance.now()) {
    if (disposed) return;
    const elapsed = Math.max(0, now - started);
    const loading = clock.frame(elapsed);
    const choreography = liveEyeChoreography(elapsed, {
      initialTime,
      initialRotation,
      active: loading.active,
      readyAt: clock.readyAt,
      reduced: reduced.matches,
    });
    const { entering, rotation, sceneTime, reflection } = choreography;
    if (context) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawFixedAnchorFrame(context, viewport.width, viewport.height, {
        time: sceneTime,
        seed,
        layout: viewport,
        rotation,
        origin: snapshot?.origin,
        journeyGeometry: snapshot?.journeyGeometry,
        loading: {
          ...loading,
          percent: entering ? null : loading.percent,
          rotation,
          reflection,
        },
      });
    }
    element.dataset.percent = String(loading.percent);
    element.dataset.loading = String(loading.active);
    element.dataset.centerX = String(viewport.centerX);
    element.dataset.centerY = String(viewport.centerY);
    element.dataset.radius = String(viewport.radius);
    element.dataset.rotation = String(rotation);
    element.dataset.stage = entering ? 'entry' : 'analysis';
    element.dataset.sceneTime = String(sceneTime);
    if (lastPercent !== loading.percent) {
      lastPercent = loading.percent;
      canvas.setAttribute(
        'aria-label',
        `분석 진행 ${loading.percent}%. 중간 진행률은 시각적 안내입니다.`,
      );
      onProgress?.(loading.percent);
    }
  }
  function resize() {
    viewport = liveAnalysisViewport(window.innerWidth, window.innerHeight, snapshot);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(viewport.width * dpr);
    canvas.height = Math.round(viewport.height * dpr);
    const content = host.closest('.report-loading-content') || host;
    content.style.setProperty('--live-eye-stage-bottom', `${viewport.stageBottom}px`);
    const s = viewport.scale;
    Object.assign(scene.style, {
      left: `${viewport.centerX - 478 * s}px`,
      top: `${viewport.centerY - 183 * s}px`,
      width: `${981 * s}px`,
      height: `${379 * s}px`,
    });
    render();
  }
  function tick() {
    raf = 0;
    if (disposed || document.hidden) return;
    render();
    if (clock.frame(performance.now() - started).active) raf = requestAnimationFrame(tick);
  }
  function refresh() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (disposed) return;
    render();
    if (!document.hidden) raf = requestAnimationFrame(tick);
  }
  function complete() {
    if (disposed || clock.completedAt !== null) return;
    const elapsed = performance.now() - started;
    clock.complete(elapsed);
    finishTimer = setTimeout(
      () => {
        if (disposed) return;
        render(started + clock.readyAt);
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        resolveSettled();
      },
      Math.max(0, clock.readyAt - elapsed) + 120,
    );
    refresh();
  }
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', refresh);
  reduced.addEventListener('change', refresh);
  resize();
  loadStudyArtwork().then(refresh, () => {
    element.dataset.artworkError = 'true';
    refresh();
  });
  refresh();
  return {
    element,
    scene,
    complete,
    update(value) {
      if (value?.complete) complete();
    },
    whenSettled() {
      return settled;
    },
    finish() {
      complete();
      return settled;
    },
    capture() {
      return { ...viewport, seed, ...clock.frame(performance.now() - started) };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(finishTimer);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', refresh);
      reduced.removeEventListener('change', refresh);
      element.remove();
      resolveSettled();
    },
  };
}
