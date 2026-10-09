import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { EYE_DRAW_DELAY_MS, EYE_DRAW_MS, EYE_YAW_MS, pupilMotionFrame } from '../../src/features/analysis/pupil-motion.js';
import {
  LiveAnalysisClock,
  liveMotionViewport,
} from '../../src/features/analysis/live-eye-motion.js';

test('historical journey previews retain their independent viewport geometry', () => {
  for (const [w, h] of [
    [1440, 1000],
    [390, 844],
    [320, 568],
    [844, 390],
  ]) {
    const a = liveMotionViewport(w, h),
      b = liveMotionViewport(w, h);
    assert.deepEqual(a, b);
    assert.equal(a.centerX, a.offsetX + 600 * a.scale);
    assert.equal(a.centerY, a.offsetY + 245 * a.scale);
    assert.equal(a.radius, 60 * a.scale);
    assert.ok(a.centerX - a.radius > 0 && a.centerX + a.radius < w);
    assert.ok(a.centerY - a.radius > 0 && a.centerY + a.radius < h);
  }
});

test('a pending server response never completes even after a long wait', () => {
  const clock = new LiveAnalysisClock();
  let previous = 0;
  for (const time of [0, 100, 900, 1500, 3999, 4000, 10000, 60000, 600000]) {
    const f = clock.frame(time);
    assert.ok(f.percent >= previous && f.percent < 100);
    assert.equal(f.active, true);
    previous = f.percent;
  }
  assert.equal(clock.frame(4000).sceneTime, 18);
});

test('fast success keeps the four-second minimum and slow success adds only a short finish', () => {
  for (const completion of [0, 100, 900, 3900, 4000, 12000]) {
    const clock = new LiveAnalysisClock();
    const before = clock.progress(completion);
    clock.complete(completion);
    assert.equal(clock.progress(completion), before);
    assert.equal(clock.readyAt, Math.max(4000, completion + 400));
    assert.ok(clock.frame(clock.readyAt - 1).percent < 100);
    assert.equal(clock.frame(clock.readyAt).percent, 100);
    assert.equal(clock.frame(clock.readyAt).active, false);
    const ready = clock.readyAt;
    clock.complete(completion + 1000);
    assert.equal(clock.readyAt, ready);
  }
});

function motionFixture({ reduced = false } = {}) {
  let now = 0;
  let nextId = 1;
  const frames = [];
  const progress = [];
  const raf = new Map();
  const timers = new Map();
  const node = (tagName) => ({
    tagName,
    clientWidth: 320,
    dataset: {},
    style: { setProperty(name, value) { this[name] = value; } },
    children: [],
    attributes: {},
    append(...children) {
      this.children.push(...children);
      for (const child of children) child.parentNode = this;
    },
    replaceChildren(...children) {
      for (const child of this.children) child.parentNode = null;
      this.children = [];
      this.append(...children);
    },
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name]; },
    remove() {
      if (this.parentNode) {
        this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
        this.parentNode = null;
      }
    },
    getContext: () => ({ setTransform() {} }),
  });
  const events = () => {
    const listeners = new Map();
    return {
      listeners,
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: (name) => listeners.delete(name),
      dispatch: (name) => listeners.get(name)?.(),
    };
  };
  const preference = { ...events(), matches: reduced };
  const document = {
    ...events(),
    hidden: false,
    createElement: node,
  };
  const window = { ...events(), matchMedia: () => preference, devicePixelRatio: 1 };
  const context = vm.createContext({
    document,
    window,
    performance: { now: () => now },
    pupilMotionFrame,
    drawPupilFrame: (_context, _size, frame) => frames.push(frame),
    requestAnimationFrame: (callback) => {
      const id = nextId++;
      raf.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => raf.delete(id),
    setTimeout: (callback, delay) => {
      const id = nextId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  const source = readFileSync(
    new URL('../../src/features/analysis/live-eye-motion.js', import.meta.url),
    'utf8',
  )
    .replace(/^import[^\n]+\n/, '')
    .replaceAll('export ', '');
  vm.runInContext(source, context);
  const host = node('div');
  const eye = context.mountLiveAnalysisEye(host, { onProgress: (percent) => progress.push(percent) });
  return { eye, host, raf, timers, frames, progress, document, window, preference, setNow: (value) => (now = value) };
}

test('hidden tabs stop drawing and resume pupil rotation and eye yaw without jumping', () => {
  const fixture = motionFixture();
  const visibleAt = EYE_DRAW_DELAY_MS + EYE_DRAW_MS + EYE_YAW_MS / 2;
  fixture.setNow(visibleAt);
  fixture.window.dispatch('resize');
  const wordmark = fixture.eye.element.children.find((node) => node.className === 'live-analysis-wordmark');
  assert.equal(wordmark.style.visibility, 'visible');
  const transform = wordmark.style.transform;
  const rotation = fixture.frames.at(-1).rotation;
  const eyeYaw = fixture.frames.at(-1).eyeYaw;
  fixture.document.hidden = true;
  fixture.document.dispatch('visibilitychange');
  assert.equal(fixture.raf.size, 0);
  const count = fixture.frames.length;
  fixture.setNow(visibleAt + 4000);
  fixture.window.dispatch('resize');
  assert.equal(fixture.frames.length, count);
  assert.equal(wordmark.style.transform, transform);
  fixture.document.hidden = false;
  fixture.document.dispatch('visibilitychange');
  assert.equal(fixture.frames.at(-1).rotation, rotation);
  assert.equal(fixture.frames.at(-1).eyeYaw, eyeYaw);
  assert.equal(wordmark.style.transform, transform);
  assert.equal(wordmark.style.visibility, 'visible');
  assert.equal(fixture.raf.size, 1);
  fixture.eye.dispose();
  assert.equal(fixture.raf.size, 0);
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.document.listeners.size, 0);
  assert.equal(fixture.window.listeners.size, 0);
  assert.equal(fixture.preference.listeners.size, 0);
  assert.equal(fixture.host.children.length, 0, 'disposing removes both decorative faces');
});

test('the wordmark alternates with the eye while loading progress remains separate and monotonic', () => {
  const fixture = motionFixture();
  const element = fixture.eye.element;
  const wordmark = element.children.find((node) => node.className === 'live-analysis-wordmark');
  assert.ok(wordmark);
  assert.equal(wordmark.innerHTML.replace(/<[^>]+>/g, ''), 'Career Lens');
  assert.equal(wordmark.getAttribute('aria-hidden'), 'true');
  assert.equal(fixture.eye.scene.getAttribute('aria-hidden'), 'true');
  const started = EYE_DRAW_DELAY_MS + EYE_DRAW_MS;
  for (const degrees of [0, 45, 89, 91, 180, 269, 271, 360, 540]) {
    fixture.setNow(started + (degrees / 360) * EYE_YAW_MS);
    fixture.window.dispatch('resize');
    const frame = fixture.frames.at(-1);
    const isLogo = frame.face === 'logo';
    assert.equal(element.dataset.face, frame.face);
    assert.equal(wordmark.style.visibility, isLogo ? 'visible' : 'hidden');
    const yaw = Number(wordmark.style.transform.match(/rotateY\(([^)]+)rad\)/)?.[1]);
    assert.ok(Number.isFinite(yaw));
    assert.ok(Math.abs(yaw - frame.logoYaw) < 1e-10);
    if (isLogo) assert.ok(Math.cos(yaw) > 0, 'the visible wordmark is never mirrored');
    assert.ok(Number(wordmark.style.opacity) >= 0 && Number(wordmark.style.opacity) <= 1);
    assert.equal(element.style.transform, undefined, 'the outer loading container is not rotated');
    assert.equal(element.dataset.loading, 'true');
    assert.equal(Number(element.dataset.percent), fixture.progress.at(-1));
  }
  assert.ok(fixture.progress.every((percent, index) =>
    percent < 100 && (index === 0 || percent >= fixture.progress[index - 1])));
  fixture.eye.dispose();
  assert.equal(fixture.host.children.length, 0);
});

test('reduced motion uses timed progress updates instead of an animation-frame loop', async () => {
  const fixture = motionFixture({ reduced: true });
  assert.equal(fixture.raf.size, 0);
  assert.equal(fixture.timers.size, 1);
  assert.equal([...fixture.timers.values()][0].delay, 250);
  assert.equal(fixture.frames.at(-1).rotation, 0);
  assert.equal(fixture.frames.at(-1).eyeYaw, 0);
  assert.equal(fixture.frames.at(-1).face, 'eye');
  assert.equal(fixture.eye.element.children.find((node) => node.className === 'live-analysis-wordmark').style.visibility, 'hidden');
  fixture.eye.dispose();
  assert.equal(fixture.timers.size, 0);
  await fixture.eye.whenSettled();
});

test('enabling reduced motion on the logo face restores a static eye and cleans up its timer', () => {
  const fixture = motionFixture();
  fixture.setNow(EYE_DRAW_DELAY_MS + EYE_DRAW_MS + EYE_YAW_MS / 2);
  fixture.window.dispatch('resize');
  const wordmark = fixture.eye.element.children.find((node) => node.className === 'live-analysis-wordmark');
  assert.equal(wordmark.style.visibility, 'visible');
  fixture.preference.matches = true;
  fixture.preference.dispatch('change');
  assert.equal(fixture.frames.at(-1).face, 'eye');
  assert.equal(fixture.frames.at(-1).eyeYaw, 0);
  assert.equal(wordmark.style.visibility, 'hidden');
  assert.equal(fixture.raf.size, 0);
  assert.equal(fixture.timers.size, 1);
  assert.ok(fixture.progress.at(-1) < 100);
  fixture.eye.dispose();
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.host.children.length, 0);
});

test('completion on the logo face reaches 100 and stops work before both faces are disposed', async () => {
  const fixture = motionFixture();
  const completedAt = EYE_DRAW_DELAY_MS + EYE_DRAW_MS + EYE_YAW_MS / 2;
  fixture.setNow(completedAt);
  fixture.window.dispatch('resize');
  assert.equal(fixture.eye.element.dataset.face, 'logo');
  fixture.eye.complete();
  fixture.setNow(completedAt + 440);
  for (const [id, timer] of [...fixture.timers]) {
    fixture.timers.delete(id);
    timer.callback();
  }
  await fixture.eye.whenSettled();
  assert.equal(fixture.progress.at(-1), 100);
  assert.equal(fixture.eye.element.dataset.loading, 'false');
  assert.equal(fixture.raf.size, 0);
  fixture.eye.dispose();
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.host.children.length, 0);
});
