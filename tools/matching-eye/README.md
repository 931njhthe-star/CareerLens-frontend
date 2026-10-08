# CareerLens eye graphics

## Current final-report loading eye

The active flow mounts `mountAnalysisEye(host, snapshot, { surface: 'overlay', purpose: 'report' })`
when **모의지원 결과 확인** is selected on a posting. There is no supplemental-answer
page. The posting dims first; the outer eye and
pupil outlines draw together. Fine sapphire needles grow from the open pupil edge
outward at independent deterministic speeds. There is no angular sweep or filled
colour sector. The 12 subcriteria are randomly assigned to individual needles once
per analysis run. Each rotating callout gauge follows its assigned needle, and
the assignment remains stable through API updates, resizing and SVG fallback.
The gauges show visual growth, not per-criterion server progress or scores.

- `src/analysis-criteria.ts`: the 12 subcriteria and per-run needle assignments.
- `src/analysis-fibres.ts`: editable needle count, onset, growth and taper.
- `src/analysis-renderer.ts`: GPU geometry/material, palette-driven light and a transparent pupil.
- `src/analysis-component.ts`: accessible status, SVG fallback, callouts and cleanup.
- `src/analysis-timing.ts`: 4-second minimum, error pause, smooth completion and fold.
- `src/analysis-styles.ts`: responsive callout appearance and spacing.

The eye waits for both a four-second minimum and an actual successful analysis
response. Members then see the report; guests reach the locked result gate until
authentication and claim succeed. A slower request never starts another four-second
wait. The fallback uses the same needle descriptors and growth law. The standalone
bundle still needs no Node runtime when Flask serves the app.

## Current four-axis report demonstration

The report mounts a tetrahedral score graphic through
`src/features/analysis/status-radar.js` (paths in this section are repository-relative).
Its four axes are 이력서 완성도, 직무 적합도, 지원 자격 충족도 and 실무 경쟁력.
`src/features/analysis/demo-score-data.js` supplies random demonstration values,
labelled **시연용 점수 · 실제 평가와 무관**, which remain stable for the same report
object. The blue-to-sky-blue score change is also a demonstration. These values are
unrelated to the résumé, the legacy server scores or actual improvement predictions.

The renderer and geometry sources are `tools/matching-eye/src/score-pyramid.ts`
and `tools/matching-eye/src/pyramid-geometry.ts`. Reference weights and pending
backend scoring policy are documented in `docs/product/score-pyramid.md`.
Reports are hidden by print CSS and have no print/PDF download control.

## Retained legacy job-matching component

The inactive legacy export uses the same Three.js line drawing and bloom approach as the Oculus
motion study. The only white point batch contains the report's job posting IDs.
Decorative iris strokes are separate from matching rays. Every eligible ray is
white and begins at the same 1.05-second timestamp; only the résumé center is gold.

### Legacy integration example

This retained export is not mounted by the current report flow.

```js
import { mountMatchingEye } from './matching-eye.js';

const host = document.querySelector('[data-matching-eye]');
const dispose = mountMatchingEye(host, report.job_matches);

// Before leaving the report route:
dispose();
```

The host can be a plain `<div data-matching-eye></div>`. The component owns its
scoped styles, compact 200-pixel scene, selection description, and collapsed accessible
job list. Mounting again on the same host automatically disposes the old scene.
It never fetches data. The `matching-eye:select` event exposes only job ID, score,
and matched state for an optional parent integration.

## Build and test

For rebuilding, use Node.js 20.19+ within 20.x, or 22.12+ as required by the locked build tools.
From this directory:

```sh
npm ci
npm run build
npm test
```

The build writes the readable, self-contained local ES module to
`../../src/features/analysis/matching-eye.js`. Commit this bundle with source changes.
It bundles Three.js and its postprocess
passes. Flask serves it locally with no CDN or Node requirement at runtime.
No changes to unrelated frontend folders or files are needed for rebuilding.

## Legacy matching component data and lifecycle

- `src/data.ts` normalizes only valid supplied job IDs and computes stable positions.
- Coordinate-bearing jobs use a fixed Korea-centered schematic projection.
  Missing coordinates use ID-based iris positions; no geographical coordinates
  are invented. These positions never depend on the selected résumé's score.
- Connection eligibility requires a finite score of at least 60 and no explicit
  backend exclusion. A missing score stays unavailable.
- All rendering is a function of one elapsed scene clock. It stops after 2.25s,
  pauses offscreen/in a hidden tab, and settles immediately for reduced motion.
- Resizing redraws the settled scene. Disposing removes observers, event handlers,
  animation callbacks, GPU geometry/materials/render targets, and context.
- A static SVG and the same accessible job list remain available without WebGL.
- The host exposes actual job IDs, connected IDs, counts, threshold, status and
  animation state as `data-*` attributes for integration verification.
- With hundreds of jobs, the initial scene still renders all supplied points in
  one GPU batch. The collapsed list creates no posting buttons until opened,
  then shows searchable pages of 40 rows inside a bounded scroll area.
- White rays use normal alpha blending so coincident connections do not add into
  an excessively bright central bloom. The gold résumé light is a separate pass.
- Call the returned disposer on component replacement or route navigation.

Three.js is MIT licensed; its included license notice is retained in the bundle.
