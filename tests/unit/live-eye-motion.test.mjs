import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LiveAnalysisClock,
  ANALYSIS_ENTRY_MS,
  liveAnalysisViewport,
  liveEyeChoreography,
  liveMotionViewport,
} from '../../src/features/analysis/live-eye-motion.js';

test('workflow and modal use one viewport geometry independent of document scroll or content', () => {
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

test('the analysis modal preserves a captured pupil and recomputes it only after a viewport resize', () => {
  const frame = {
    ...liveMotionViewport(1440, 1000),
    centerX: 681,
    offsetX: 141,
  };
  const snapshot = { frame, viewportWidth: 1440, viewportHeight: 1000 };
  assert.deepEqual(liveAnalysisViewport(1440, 1000, snapshot), frame);
  assert.deepEqual(liveAnalysisViewport(390, 844, snapshot), liveMotionViewport(390, 844));
  assert.deepEqual(
    liveAnalysisViewport(1440, 1000, { ...snapshot, frame: { ...frame, scale: NaN } }),
    liveMotionViewport(1440, 1000),
  );
});

test('page clearing keeps the same rotating ring before acceleration and eye drawing begin', () => {
  const options = { initialTime: 10.4, initialRotation: 7.125 };
  const initial = liveEyeChoreography(0, options);
  assert.equal(initial.rotation, options.initialRotation);
  for (const time of [0, 100, ANALYSIS_ENTRY_MS - 1]) {
    const frame = liveEyeChoreography(time, options);
    assert.equal(frame.entering, true);
    assert.equal(frame.sceneTime, 10.4);
    assert.equal(frame.reflection, 1);
    assert.ok(Math.abs(frame.rotation - options.initialRotation - time * 0.00062) < 1e-12);
  }
  const edge = liveEyeChoreography(ANALYSIS_ENTRY_MS, options);
  assert.equal(edge.entering, false);
  assert.equal(edge.sceneTime, 12);
  const later = liveEyeChoreography(ANALYSIS_ENTRY_MS + 850, options);
  assert.ok(later.sceneTime > 12);
  assert.ok(later.rotation - edge.rotation > 2 * Math.PI);
  assert.equal(liveEyeChoreography(4000, options).sceneTime, 18);
  assert.equal(liveEyeChoreography(60000, options).reflection, 1);
});

test('an early analysis click finishes the captured formation continuously without showing the eye early', () => {
  const options = { initialTime: 7.1, initialRotation: 3 };
  assert.equal(liveEyeChoreography(0, options).sceneTime, options.initialTime);
  const frame = liveEyeChoreography(ANALYSIS_ENTRY_MS, options);
  assert.equal(frame.entering, true);
  assert.ok(frame.sceneTime < 12 && frame.sceneTime > options.initialTime);
  assert.equal(liveEyeChoreography(1000, options).entering, false);
  const reduced = liveEyeChoreography(0, { ...options, reduced: true });
  assert.equal(reduced.rotation, options.initialRotation);
  assert.equal(reduced.sceneTime, 18);
  assert.equal(reduced.entering, false);
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
