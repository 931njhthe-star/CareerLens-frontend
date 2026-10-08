export type Point3 = [number, number, number];

/** A regular tetrahedron centred at its centroid; each vertex is one 100-point axis. */
export const PYRAMID_VERTICES: readonly Point3[] = [
  [0, 1.28, 0],
  [0, -1.28 / 3, 1.28 * Math.sqrt(8 / 9)],
  [-1.28 * Math.sqrt(2 / 3), -1.28 / 3, -1.28 * Math.sqrt(2 / 9)],
  [1.28 * Math.sqrt(2 / 3), -1.28 / 3, -1.28 * Math.sqrt(2 / 9)],
];

export const PYRAMID_FACES = [0, 2, 1, 0, 3, 2, 0, 1, 3, 1, 2, 3] as const;
export const PYRAMID_EDGES = [0, 1, 0, 2, 0, 3, 1, 2, 2, 3, 3, 1] as const;

export function pyramidPoints(scores: readonly number[]): Point3[] {
  return PYRAMID_VERTICES.map((vertex, index) => {
    const score = scores[index];
    const fraction = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) / 100 : 0;
    return vertex.map((value) => value * fraction) as Point3;
  });
}

/** Quintic easing starts and ends with zero velocity and acceleration. */
export function pyramidEase(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function interpolateScores(
  from: readonly number[],
  to: readonly number[],
  progress: number,
): number[] {
  const mix = pyramidEase(progress);
  return from.map((value, index) => value + (to[index] - value) * mix);
}
