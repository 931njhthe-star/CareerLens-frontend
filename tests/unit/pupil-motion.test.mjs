import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EYE_DRAW_DELAY_MS,
  EYE_DRAW_MS,
  EYE_ROTATION_MS,
  PUPIL_ENTRY_MS,
  PUPIL_ROTATION_MS,
  drawPupilFrame,
  eyeContourPoint,
  pupilMotionFrame,
} from '../../src/features/analysis/pupil-motion.js';

test('the upper outline draws left to right and the lower outline draws right to left', () => {
  const upperStart = eyeContourPoint(0);
  const upperEnd = eyeContourPoint(1);
  const lowerStart = eyeContourPoint(0, false);
  const lowerEnd = eyeContourPoint(1, false);
  assert.deepEqual(upperStart, lowerEnd);
  assert.deepEqual(upperEnd, lowerStart);
  assert.ok(upperStart.x < 0 && upperEnd.x > 0);
  assert.equal(upperStart.y, 0);
  assert.equal(upperEnd.y, 0);
  for (const upper of [true, false]) {
    assert.deepEqual(eyeContourPoint(-1, upper), eyeContourPoint(0, upper));
    assert.deepEqual(eyeContourPoint(2, upper), eyeContourPoint(1, upper));
    let previousX = eyeContourPoint(0, upper).x;
    for (let i = 1; i < 100; i++) {
      const point = eyeContourPoint(i / 100, upper);
      assert.ok(upper ? point.x > previousX : point.x < previousX);
      assert.ok(upper ? point.y < 0 : point.y > 0);
      previousX = point.x;
    }
  }
});

test('the eye finishes its outline before beginning a slower, independent clockwise turn', () => {
  const completedAt = EYE_DRAW_DELAY_MS + EYE_DRAW_MS;
  assert.equal(pupilMotionFrame(0).outline, 0);
  assert.equal(pupilMotionFrame(EYE_DRAW_DELAY_MS).outline, 0);
  const midway = pupilMotionFrame(EYE_DRAW_DELAY_MS + EYE_DRAW_MS / 2);
  assert.ok(midway.outline > 0 && midway.outline < 1);
  assert.equal(midway.eyeRotation, 0);
  const completed = pupilMotionFrame(completedAt);
  assert.equal(completed.outline, 1);
  assert.equal(completed.eyeRotation, 0);
  assert.ok(completed.rotation > 0);
  assert.equal(pupilMotionFrame(completedAt + EYE_ROTATION_MS).eyeRotation, 2 * Math.PI);
  for (const elapsed of [completedAt, 10000, 90000, 600000]) {
    const frame = pupilMotionFrame(elapsed);
    const next = pupilMotionFrame(elapsed + 100);
    const eyeDelta = next.eyeRotation - frame.eyeRotation;
    const pupilDelta = next.rotation - frame.rotation;
    assert.ok(eyeDelta > 0 && pupilDelta > eyeDelta);
    assert.equal(next.outline, 1);
  }
});

test('the complete eye stays inside its canvas through every rotation', () => {
  for (const upper of [true, false]) {
    for (let i = 0; i <= 1000; i++) {
      const point = eyeContourPoint(i / 1000, upper);
      // A circular safe area keeps all angles clear of the square canvas edges.
      assert.ok(Math.hypot(point.x, point.y) < 0.45);
    }
  }
});

test('the pupil grows from nothing, reaches full size, then turns clockwise without wrapping', () => {
  const start = pupilMotionFrame(0);
  assert.equal(start.scale, 0);
  assert.equal(start.opacity, 0);
  assert.ok(pupilMotionFrame(500).scale > 0 && pupilMotionFrame(500).scale < 1);
  assert.equal(pupilMotionFrame(PUPIL_ENTRY_MS).scale, 1);
  assert.equal(pupilMotionFrame(PUPIL_ENTRY_MS).rotation, 0);
  for (const elapsed of [1200, 4000, 12000, 60000, 600000]) {
    assert.ok(pupilMotionFrame(elapsed + 10).rotation > pupilMotionFrame(elapsed).rotation);
    assert.equal(pupilMotionFrame(elapsed).scale, 1);
  }
  assert.equal(pupilMotionFrame(PUPIL_ENTRY_MS + PUPIL_ROTATION_MS).rotation, 2 * Math.PI);
});

test('each dashed ring reverses after adding both the pupil and whole-eye clockwise turns', () => {
  const velocity = (time, key) => {
    const before = pupilMotionFrame(time - 1);
    const after = pupilMotionFrame(time + 1);
    return (
      (after.eyeRotation +
        after.rotation +
        after[key] -
        before.eyeRotation -
        before.rotation -
        before[key]) /
      2
    );
  };
  const signs = { dashes: new Set(), innerDashes: new Set() };
  let independent = false;
  for (let elapsed = PUPIL_ENTRY_MS + 2; elapsed < 40000; elapsed += 40) {
    const outer = velocity(elapsed, 'dashes');
    const inner = velocity(elapsed, 'innerDashes');
    signs.dashes.add(Math.sign(outer));
    signs.innerDashes.add(Math.sign(inner));
    if (outer * inner < 0) independent = true;
    for (const key of ['dashes', 'innerDashes']) {
      assert.ok(Math.abs(velocity(elapsed + 1, key) - velocity(elapsed, key)) < 0.00001);
    }
  }
  assert.ok(signs.dashes.has(-1) && signs.dashes.has(1));
  assert.ok(signs.innerDashes.has(-1) && signs.innerDashes.has(1));
  assert.equal(independent, true);
});

test('outer and reactor rings advance in one direction with a slower reactor and bounded light', () => {
  for (let elapsed = PUPIL_ENTRY_MS; elapsed <= 30000; elapsed += 250) {
    const frame = pupilMotionFrame(elapsed);
    const next = pupilMotionFrame(elapsed + 250);
    assert.ok(next.outer > frame.outer);
    assert.ok(next.reactor > frame.reactor);
    assert.ok(next.reactor - frame.reactor < next.outer - frame.outer);
    assert.ok(frame.pulse >= 0 && frame.pulse <= 1);
    assert.ok(next.lights > frame.lights);
  }
});

test('reduced motion renders a complete static pupil for any duration', () => {
  const staticFrame = pupilMotionFrame(0, { reduced: true });
  assert.equal(staticFrame.scale, 1);
  assert.equal(staticFrame.opacity, 1);
  assert.equal(staticFrame.outline, 1);
  assert.equal(staticFrame.eyeRotation, 0);
  for (const elapsed of [1000, 4000, 20000, 600000]) {
    assert.deepEqual(pupilMotionFrame(elapsed, { reduced: true }), staticFrame);
  }
});

test('the glowing center is filled softly without a stroked circular border', () => {
  let path = [];
  const strokes = [];
  const fills = [];
  const gradient = { addColorStop() {} };
  const context = new Proxy(
    {
      beginPath() {
        path = [];
      },
      arc(x, y, radius) {
        path.push({ x, y, radius });
      },
      stroke() {
        strokes.push(...path);
      },
      fill() {
        fills.push(...path);
      },
      createRadialGradient() {
        return gradient;
      },
      createLinearGradient() {
        return gradient;
      },
    },
    { get: (target, name) => target[name] ?? (() => {}) },
  );
  const size = 360;
  drawPupilFrame(context, size, pupilMotionFrame(12000));
  const inCore = ({ x, y, radius }) => x === 0 && y === 0 && radius < size * 0.06;
  assert.ok(fills.some(inCore), 'the luminous center remains visible');
  assert.equal(strokes.some(inCore), false, 'the luminous center has no hard circular edge');
});
