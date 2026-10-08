import assert from 'node:assert/strict';
import test from 'node:test';
import {
  pyramidAxes,
  pyramidPreview,
  pyramidTransition,
} from '../../src/features/analysis/status-radar-data.js';
import {
  pyramidPoints,
  PYRAMID_VERTICES,
  PYRAMID_EDGES,
} from '../../tools/matching-eye/src/pyramid-geometry.ts';
import { analysisReport } from '../../src/features/analysis/report.js';

const criteria = [
  { label: '희망 직무 경험 연결', score: 35, max_score: 70 },
  { label: '수행 맥락', score: 10, max_score: 20 },
  { label: '수치로 표현한 결과·규모', score: 2, max_score: 10 },
];
const report = {
  score: 47,
  criteria,
  matches: [{ status: 'missing', requirement: '화면과 사용자 경험을 설계한 경험' }],
  improvement_preview: {
    basis: 'conditional_rules',
    score: 94,
    criteria: criteria.map((item, i) => ({ ...item, score: [70, 20, 4][i] })),
    assumptions: [
      { requirement: '실제 설계 경험', detail: '본인의 역할과 사용한 방법이 확인된다는 가정' },
    ],
    notice: '실제 수정 후 다시 분석합니다.',
  },
};

test('four demonstration axes stay independent of original scores and stable on rerender', () => {
  const before = structuredClone(report);
  const axes = pyramidAxes(report);
  assert.deepEqual(
    axes.map((axis) => axis.label),
    ['이력서 완성도', '직무 적합도', '지원 자격 충족도', '실무 경쟁력'],
  );
  assert.ok(axes.every((axis) => axis.normalized >= 35 && axis.normalized <= 90));
  assert.equal(pyramidAxes(report), axes);
  assert.equal(pyramidPreview(report).basis, 'presentation_demo');
  assert.ok(pyramidPreview(report).axes.every((axis, index) => axis.score > axes[index].score));
  assert.deepEqual(report, before);
});

test('server preview values do not influence the presentation demonstration', () => {
  const copy = structuredClone(report);
  const axes = pyramidAxes(copy);
  const preview = pyramidPreview(copy);
  copy.score = 100;
  copy.criteria = [];
  copy.improvement_preview = { basis: 'gpt', score: 0, criteria: [] };
  assert.equal(pyramidAxes(copy), axes);
  assert.equal(pyramidPreview(copy), preview);
});

test('100-point vertices form a regular centred tetrahedron and fractions stay inside it', () => {
  assert.deepEqual(pyramidPoints([100, 100, 100, 100]), PYRAMID_VERTICES);
  for (let axis = 0; axis < 3; axis++)
    assert.ok(Math.abs(PYRAMID_VERTICES.reduce((sum, p) => sum + p[axis], 0)) < 1e-12);
  const lengths = [];
  for (let i = 0; i < PYRAMID_EDGES.length; i += 2) {
    const a = PYRAMID_VERTICES[PYRAMID_EDGES[i]],
      b = PYRAMID_VERTICES[PYRAMID_EDGES[i + 1]];
    lengths.push(Math.hypot(...a.map((value, axis) => value - b[axis])));
  }
  assert.ok(Math.max(...lengths) - Math.min(...lengths) < 1e-12);
  const scores = [0, 25, 50, 75];
  pyramidPoints(scores).forEach((point, i) =>
    point.forEach((value, axis) =>
      assert.ok(Math.abs(value - (PYRAMID_VERTICES[i][axis] * scores[i]) / 100) < 1e-12),
    ),
  );
  assert.ok(pyramidPoints([NaN, -10, 500, Infinity]).flat().every(Number.isFinite));
});

test('morph is continuous, has eased endpoints and can reverse from an intermediate shape', () => {
  const a = [47, 50, 50, 20],
    b = [94, 100, 100, 40];
  assert.deepEqual(pyramidTransition(a, b, 0), a);
  assert.deepEqual(pyramidTransition(a, b, 1), b);
  const midway = pyramidTransition(a, b, 0.5);
  assert.deepEqual(midway, [70.5, 75, 75, 30]);
  assert.deepEqual(pyramidTransition(midway, a, 0), midway);
  assert.deepEqual(pyramidTransition(midway, a, 1), a);
  assert.ok(pyramidTransition(a, b, 0.001)[0] - a[0] < 0.000001);
});

test('report marks demo values clearly, preserves missing badges and omits legacy score claims', () => {
  const copy = structuredClone(report);
  copy.improvement_preview.assumptions[0].detail = '<img src=x onerror=alert(1)>';
  const markup = analysisReport({ analysis_mode: 'desired_role', role: '디자이너', report: copy });
  assert.ok(!markup.includes('준비도 47점'));
  assert.ok(markup.includes('badge missing'));
  assert.ok(markup.includes('근거 부족'));
  assert.ok(markup.includes('시연용 점수 · 실제 평가와 무관'));
  assert.ok(!markup.includes('배점과 평가 근거'));
  assert.ok(!markup.includes('<img src=x'));
  assert.ok(!markup.includes('onerror'));
});
