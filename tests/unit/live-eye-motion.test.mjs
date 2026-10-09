import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { pupilMotionFrame } from '../../src/features/analysis/pupil-motion.js';
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
  const raf = new Map();
  const timers = new Map();
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
    createElement() {
      return {
        clientWidth: 320,
        dataset: {},
        append() {},
        setAttribute() {},
        remove() {},
        getContext: () => ({ setTransform() {} }),
      };
    },
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
  const eye = context.mountLiveAnalysisEye({ replaceChildren() {} });
  return { eye, raf, timers, frames, document, window, preference, setNow: (value) => (now = value) };
}

test('hidden tabs stop drawing and resume the pupil without jumping rotation', () => {
  const fixture = motionFixture();
  fixture.setNow(2500);
  fixture.window.dispatch('resize');
  const rotation = fixture.frames.at(-1).rotation;
  fixture.document.hidden = true;
  fixture.document.dispatch('visibilitychange');
  assert.equal(fixture.raf.size, 0);
  const count = fixture.frames.length;
  fixture.setNow(6500);
  fixture.window.dispatch('resize');
  assert.equal(fixture.frames.length, count);
  fixture.document.hidden = false;
  fixture.document.dispatch('visibilitychange');
  assert.equal(fixture.frames.at(-1).rotation, rotation);
  assert.equal(fixture.raf.size, 1);
  fixture.eye.dispose();
  assert.equal(fixture.raf.size, 0);
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.document.listeners.size, 0);
  assert.equal(fixture.window.listeners.size, 0);
  assert.equal(fixture.preference.listeners.size, 0);
});

test('reduced motion uses timed progress updates instead of an animation-frame loop', async () => {
  const fixture = motionFixture({ reduced: true });
  assert.equal(fixture.raf.size, 0);
  assert.equal(fixture.timers.size, 1);
  assert.equal([...fixture.timers.values()][0].delay, 250);
  assert.equal(fixture.frames.at(-1).rotation, 0);
  fixture.eye.dispose();
  assert.equal(fixture.timers.size, 0);
  await fixture.eye.whenSettled();
});
