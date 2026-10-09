export type MatchLead = 'shared' | 'color' | 'local';

/**
 * A collection that contains every chord tone leads. When none does, a colour
 * suggestion leads instead of the empty-state card.
 */
export function matchLead(sharedCount: number, colorCount: number): MatchLead {
  if (sharedCount > 0) return 'shared';
  if (colorCount > 0) return 'color';
  return 'local';
}
