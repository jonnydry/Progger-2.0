import { patterns, spell, type Pattern } from './music.ts';

/** Follow the musical center of the view without flickering at form boundaries. */
export function formAtFret(
  forms: Pattern[],
  fret: number,
  current: number,
  hysteresis = 0.35,
): number {
  if (!forms.length) return -1;
  const distance = (index: number) =>
    Math.abs((forms[index].min + forms[index].max) / 2 - fret);
  const validCurrent = current >= 0 && current < forms.length;
  let best = validCurrent ? current : 0;
  for (let index = 0; index < forms.length; index++) {
    if (distance(index) < distance(best)) best = index;
  }
  return validCurrent && distance(current) - distance(best) <= hysteresis
    ? current
    : best;
}

/** Map musical neck progress onto complete-form centers. 0 is the nut, 1 is fret 24. */
export function formAtProgress(
  forms: Pattern[],
  progress: number,
  current: number,
): number {
  if (!forms.length) return -1;
  const clamped = Math.max(0, Math.min(1, progress));
  const first = (forms[0].min + forms[0].max) / 2;
  const last = (forms.at(-1)!.min + forms.at(-1)!.max) / 2;
  return formAtFret(forms, first + clamped * (last - first), current);
}

/** The form already in view when the neck stays put. Boundary hysteresis does not apply. */
export function nearestConnectedForm(
  forms: Pattern[],
  progress: number,
): number {
  const index = formAtProgress(forms, progress, -1);
  return index < 0 ? 0 : index;
}

export function connectedFormForScale(
  root: string,
  formula: readonly string[],
  neckProgress: number,
): number {
  return nearestConnectedForm(
    patterns(spell(root, [...formula])),
    neckProgress,
  );
}

/** Spread the form centers over the available travel, including both end forms.
 * A wide viewport cannot physically center an open or fret-24 form. */
export function formAtViewport(
  forms: Pattern[],
  scroll: number,
  width: number,
  cell: number,
  left: boolean,
  current: number,
) {
  if (!forms.length) return -1;
  const travel = Math.max(0, 25 * cell - width);
  if (!travel) return current >= 0 && current < forms.length ? current : 0;
  const physical = Math.max(0, Math.min(1, scroll / travel));
  const progress = left ? 1 - physical : physical;
  return formAtProgress(forms, progress, current);
}

/** The inverse of form following, so selecting a form remains stable on a drag. */
export function scrollToForm(
  forms: Pattern[],
  index: number,
  width: number,
  cell: number,
  left: boolean,
) {
  const form = forms[index];
  if (!form) return 0;
  const first = (forms[0].min + forms[0].max) / 2;
  const last = (forms.at(-1)!.min + forms.at(-1)!.max) / 2;
  const progress =
    last === first ? 0.5 : ((form.min + form.max) / 2 - first) / (last - first);
  return (left ? 1 - progress : progress) * Math.max(0, 25 * cell - width);
}

/** Shared notes mean the same string AND fret, not merely the same pitch. */
export function formLayers(active?: Pattern, neighbor?: Pattern) {
  const positions = (form?: Pattern) =>
    new Set(form?.positions.map(({ string, fret }) => `${string}:${fret}`));
  const activePositions = positions(active);
  const neighborPositions = positions(neighbor);
  return {
    active: activePositions,
    neighbor: neighborPositions,
    shared: new Set(
      [...activePositions].filter((key) => neighborPositions.has(key)),
    ),
  };
}

export function viewportCenter(
  scroll: number,
  width: number,
  cell: number,
  left: boolean,
) {
  const physical = (scroll + width / 2) / cell - 0.5;
  return Math.max(0, Math.min(24, left ? 24 - physical : physical));
}

export function scrollToCenter(
  fret: number,
  width: number,
  cell: number,
  left: boolean,
) {
  const physical = left ? 24 - fret : fret;
  return Math.max(
    0,
    Math.min(25 * cell - width, (physical + 0.5) * cell - width / 2),
  );
}
