import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PUPIL_ENTRY_MS,
  PUPIL_ROTATION_MS,
  pupilMotionFrame,
} from '../../src/features/analysis/pupil-motion.js';

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

test('each dashed ring visibly reverses even after adding the global clockwise rotation', () => {
  const velocity = (time, key) => {
    const before = pupilMotionFrame(time - 1);
    const after = pupilMotionFrame(time + 1);
    return (after.rotation + after[key] - before.rotation - before[key]) / 2;
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
  for (const elapsed of [1000, 4000, 20000, 600000]) {
    assert.deepEqual(pupilMotionFrame(elapsed, { reduced: true }), staticFrame);
  }
});
