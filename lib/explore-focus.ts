/** Where keyboard focus should return after a chord preview. */
export type ScaleReturnPoint = {
  id: string;
  scroll: number;
};

/**
 * A chord preview restores the control that opened it. The Back control is
 * removed with the chord reference, so without a stored point it lands on the
 * Scales tab. The Scales tab itself stays mounted and keeps focus.
 */
export function scaleReturnFocusId(
  point: ScaleReturnPoint | null,
  sourceId?: string,
): string | null {
  if (point?.id) return point.id;
  if (sourceId === 'return-to-scale') return 'scales-reference-tab';
  return null;
}
