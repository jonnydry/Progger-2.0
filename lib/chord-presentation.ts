import type { Quality } from './harmony';

export function qualityGroup(quality: Quality): string {
  if (quality.formula.some((degree) => /^[b#]+(?:9|11|13)$/.test(degree)))
    return 'Altered tensions';
  if (quality.formula.some((degree) => /^(?:9|11|13)$/.test(degree)))
    return 'Extended chords';
  return 'Core chords';
}
