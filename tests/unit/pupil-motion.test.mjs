import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EYE_DRAW_DELAY_MS,
  EYE_DRAW_MS,
  EYE_YAW_MS,
  PUPIL_ENTRY_MS,
  PUPIL_ROTATION_MS,
  drawPupilFrame,
  eyeContourPoint,
  projectEyePoint,
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

test('the eye finishes its outline before beginning a slower, continuous rightward Y-axis turn', () => {
  const completedAt = EYE_DRAW_DELAY_MS + EYE_DRAW_MS;
  assert.equal(pupilMotionFrame(0).outline, 0);
  assert.equal(pupilMotionFrame(EYE_DRAW_DELAY_MS).outline, 0);
  const midway = pupilMotionFrame(EYE_DRAW_DELAY_MS + EYE_DRAW_MS / 2);
  assert.ok(midway.outline > 0 && midway.outline < 1);
  assert.equal(midway.eyeYaw, 0);
  const completed = pupilMotionFrame(completedAt);
  assert.equal(completed.outline, 1);
  assert.equal(completed.eyeYaw, 0);
  assert.ok(completed.rotation > 0);
  assert.equal(pupilMotionFrame(completedAt + EYE_YAW_MS).eyeYaw, 2 * Math.PI);
  assert.equal(pupilMotionFrame(completedAt + EYE_YAW_MS * 2).eyeYaw, 4 * Math.PI);
  for (const elapsed of [completedAt, 10000, 90000, 600000]) {
    const frame = pupilMotionFrame(elapsed);
    const next = pupilMotionFrame(elapsed + 100);
    const eyeDelta = next.eyeYaw - frame.eyeYaw;
    const pupilDelta = next.rotation - frame.rotation;
    assert.ok(eyeDelta > 0 && pupilDelta > eyeDelta);
    assert.equal(next.outline, 1);
  }
});

test('Y-axis projection faces forward at zero and foreshortens at a quarter turn', () => {
  const point = { x: 0.35, y: -0.18 };
  assert.deepEqual(projectEyePoint(point, 0), { ...point, z: 0, scale: 1 });
  const side = projectEyePoint(point, Math.PI / 2);
  assert.ok(Math.abs(side.x) < 1e-12);
  assert.ok(side.y < 0, 'the upper edge stays above the horizontal axis');
  assert.ok(Math.abs(side.y) < Math.abs(point.y), 'the far side is smaller in perspective');
  const core = projectEyePoint({ x: 0, y: 0, z: 0.075 }, Math.PI / 2);
  assert.ok(core.x > 0, 'the raised core turns toward the right');
  assert.equal(core.y, 0);
});

test('Y-axis rotation preserves the eye corners on the horizon and exposes near/far perspective', () => {
  for (let step = 0; step <= 96; step++) {
    const yaw = (step / 96) * Math.PI * 2;
    for (const progress of [0, 1]) {
      assert.equal(projectEyePoint(eyeContourPoint(progress), yaw).y, 0);
    }
  }
  const near = projectEyePoint({ x: -0.3, y: 0.1 }, Math.PI / 3);
  const far = projectEyePoint({ x: 0.3, y: 0.1 }, Math.PI / 3);
  assert.ok(near.z > far.z);
  assert.ok(near.scale > 1 && far.scale < 1);
  assert.ok(Math.abs(near.x) > Math.abs(far.x));
  assert.ok(near.y > far.y);
  const raised = projectEyePoint({ x: 0.1, y: 0.1, z: 0.075 }, 0);
  assert.ok(raised.scale > 1 && raised.x > 0.1 && raised.y > 0.1);
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

test('each dashed ring reverses independently within the turning eye', () => {
  const velocity = (time, key) => {
    const before = pupilMotionFrame(time - 1);
    const after = pupilMotionFrame(time + 1);
    return (
      (after.rotation +
        after[key] -
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
  assert.equal(staticFrame.eyeYaw, 0);
  for (const elapsed of [1000, 4000, 20000, 600000]) {
    assert.deepEqual(pupilMotionFrame(elapsed, { reduced: true }), staticFrame);
  }
});

function recordingContext() {
  let matrix = [1, 0, 0, 1, 0, 0];
  let path = [];
  const stack = [];
  const strokes = [];
  const fills = [];
  const point = (x, y) => ({
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  });
  const transform = (a, b, c, d, e, f) => {
    const [ma, mb, mc, md, me, mf] = matrix;
    matrix = [
      ma * a + mc * b,
      mb * a + md * b,
      ma * c + mc * d,
      mb * c + md * d,
      ma * e + mc * f + me,
      mb * e + md * f + mf,
    ];
  };
  const gradient = () => ({
    stops: [],
    addColorStop(offset, color) {
      this.stops.push({ offset, color });
    },
  });
  const context = new Proxy(
    {
      save() {
        stack.push({
          matrix: [...matrix],
          fillStyle: this.fillStyle,
          strokeStyle: this.strokeStyle,
        });
      },
      restore() {
        const state = stack.pop();
        matrix = state.matrix;
        this.fillStyle = state.fillStyle;
        this.strokeStyle = state.strokeStyle;
      },
      transform,
      translate(x, y) {
        transform(1, 0, 0, 1, x, y);
      },
      scale(x, y) {
        transform(x, 0, 0, y, 0, 0);
      },
      rotate(angle) {
        transform(
          Math.cos(angle),
          Math.sin(angle),
          -Math.sin(angle),
          Math.cos(angle),
          0,
          0,
        );
      },
      beginPath() {
        path = [];
      },
      moveTo(x, y) {
        path.push(point(x, y));
      },
      lineTo(x, y) {
        path.push(point(x, y));
      },
      arc(x, y, radius, start, end) {
        const steps = Math.max(1, Math.ceil(Math.abs(end - start) * 16));
        for (let step = 0; step <= steps; step++) {
          const angle = start + (step / steps) * (end - start);
          path.push(point(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius));
        }
      },
      stroke() {
        strokes.push({ points: [...path], style: this.strokeStyle });
      },
      fill() {
        fills.push({ points: [...path], style: this.fillStyle });
      },
      createRadialGradient: gradient,
      createLinearGradient: gradient,
    },
    { get: (target, name) => target[name] ?? (() => {}) },
  );
  return { context, strokes, fills };
}

test('the painter projects the lids around the vertical axis without banking their corners', () => {
  const { context, strokes } = recordingContext();
  const size = 360;
  const yaw = Math.PI / 3;
  drawPupilFrame(context, size, { ...pupilMotionFrame(12000), eyeYaw: yaw });
  const corners = strokes.flatMap(({ points }) => [points[0], points.at(-1)]);
  for (const progress of [0, 1]) {
    const expected = projectEyePoint(eyeContourPoint(progress), yaw);
    assert.ok(
      corners.some(
        (point) =>
          Math.abs(point.x - (0.5 + expected.x) * size) < 1e-8 &&
          Math.abs(point.y - size / 2) < 1e-8,
      ),
      'each projected lid corner remains on the horizontal centerline',
    );
  }
});

test('all painted contours, rings and glow stay within the canvas over a full yaw revolution', () => {
  const size = 360;
  for (let step = 0; step <= 48; step++) {
    const { context, strokes, fills } = recordingContext();
    const frame = pupilMotionFrame(EYE_DRAW_DELAY_MS + EYE_DRAW_MS + (step / 48) * EYE_YAW_MS);
    drawPupilFrame(context, size, frame);
    const points = [...strokes, ...fills].flatMap((path) => path.points);
    assert.ok(points.length > 0);
    for (const { x, y } of points) {
      assert.ok(Number.isFinite(x) && Number.isFinite(y));
      assert.ok(
        x > 5 && x < size - 5 && y > 5 && y < size - 5,
        `yaw ${frame.eyeYaw}: ${x}, ${y}`,
      );
    }
  }
});

test('the glowing center is filled softly without a stroked circular border', () => {
  const { context, strokes, fills } = recordingContext();
  const size = 360;
  drawPupilFrame(context, size, { ...pupilMotionFrame(12000), eyeYaw: 0 });
  const inCore = ({ points }) =>
    points.length > 0 &&
    points.every(({ x, y }) => Math.hypot(x - size / 2, y - size / 2) < size * 0.064);
  const core = fills.find(inCore);
  assert.ok(core, 'the luminous center remains visible');
  assert.ok(
    core.style.stops.some(({ offset, color }) => offset === 1 && color.endsWith(',0)')),
    'the light field fades to transparent',
  );
  assert.equal(strokes.some(inCore), false, 'the luminous center has no hard circular edge');
});
