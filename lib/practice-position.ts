import type { Pattern } from './music.ts';

/** Keep the guitarist near the same low-E starting fret when changing a scale. */
export function nearestPatternIndex(
  patterns: Pattern[],
  start: number,
): number {
  if (!patterns.length) return 0;
  return patterns.reduce(
    (best, pattern, index) =>
      Math.abs(pattern.start - start) < Math.abs(patterns[best].start - start)
        ? index
        : best,
    0,
  );
}
