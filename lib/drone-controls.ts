export const DRONE_TAP_TARGET_PX = 44;
export const DRONE_ICON_PX = 18;
export const DRONE_POPOVER_MARGIN_PX = 8;
/** The scales tab and the two pickers stay this far from the popover. */
export const DRONE_POPOVER_GUARD_PX = 8;

/** Regions the volume popover must miss. Caption and degree letters are required. */
export const VOLUME_POPOVER_OBSTACLE_SELECTORS = [
  '.brand',
  '.site-header nav',
  '.workspace-tools',
  '.reference-tabs',
  '.root-select',
  '.scale-select',
  '.scale-caption',
  '.palette-note > span',
  '.palette-note small',
  '.neck-meta',
  '.fret-grid',
] as const;

/** The tab and the pickers. A 4–8px graze still counts as a hit. */
export const VOLUME_POPOVER_GUARD_SELECTORS = [
  '#scales-reference-tab',
  '.root-select',
  '.scale-select',
] as const;

export type DroneBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function droneControlName(enabled: boolean, sound?: string): string {
  const state = enabled ? 'Drone, on' : 'Drone, off';
  return sound ? `${state}, ${sound}` : state;
}

export function droneVolumeKeyOpens(key: string): boolean {
  return key === 'ArrowDown' || key === 'ArrowUp';
}

// A click or an arrow key opens the volume. A long-press is not required.
export function droneVolumeOpens(input: {
  kind: 'click' | 'keydown' | 'longpress';
  key?: string;
}): boolean {
  if (input.kind === 'click') return true;
  if (input.kind === 'keydown') return droneVolumeKeyOpens(input.key ?? '');
  return false;
}

/**
 * Close when focus moves outside the popover.
 * A press on the volume button toggles instead. The pointer flag has to
 * still be set after pointerup, because a touch moves focus after pointerup
 * and before click.
 */
export function droneVolumeFocusOut(input: {
  relatedInside: boolean;
  relatedTrigger: boolean;
  pointerOnTrigger: boolean;
}): { open: boolean } {
  if (input.relatedInside) return { open: true };
  if (input.relatedTrigger && input.pointerOnTrigger) return { open: true };
  return { open: false };
}

export function volumePopoverKey(input: {
  open: boolean;
  key: string;
  focus: 'toggle' | 'slider' | 'outside' | 'volume';
}): { open: boolean; focus: 'toggle' | 'slider' | 'outside' | 'volume' } {
  if (!input.open) {
    if (input.focus === 'toggle' && droneVolumeKeyOpens(input.key)) {
      return { open: true, focus: 'slider' };
    }
    return { open: false, focus: input.focus };
  }
  if (input.key === 'Escape') return { open: false, focus: 'volume' };
  // Tab is not trapped. focusout closes once focus has actually left.
  if (input.key === 'Tab') return { open: true, focus: 'outside' };
  return { open: true, focus: input.focus };
}

export function boxesOverlap(a: DroneBox, b: DroneBox): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Positive when the boxes are apart, negative by the smaller overlap
 * when they cross. A 4px graze is −4, not a miss.
 */
export function boxGap(a: DroneBox, b: DroneBox): number {
  const overlapX =
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const overlapY =
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (overlapX > 0 && overlapY > 0) return -Math.min(overlapX, overlapY);
  const gapX =
    overlapX > 0
      ? 0
      : Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
  const gapY =
    overlapY > 0
      ? 0
      : Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height));
  if (overlapX > 0) return gapY;
  if (overlapY > 0) return gapX;
  return Math.hypot(gapX, gapY);
}

/**
 * `position: fixed` inside a container query is positioned against that
 * container, not the viewport. Subtract the container's viewport origin
 * so a scroll or a shell offset cannot slide the popover onto the tab.
 */
export function popoverFixedPoint(
  origin: { x: number; y: number },
  container: { x: number; y: number } | null,
): { x: number; y: number } {
  const frame = container ?? { x: 0, y: 0 };
  return { x: origin.x - frame.x, y: origin.y - frame.y };
}

// Sit against the volume button. Prefer the side that misses every obstacle.
// A clear cell further up the page is not a place to open.
export function volumePopoverOrigin(input: {
  trigger: DroneBox;
  popover: { width: number; height: number };
  viewport: { width: number; height: number };
  obstacles?: readonly DroneBox[];
  guards?: readonly DroneBox[];
  guard?: number;
  neck?: DroneBox | null;
  margin?: number;
}): { x: number; y: number } | null {
  const margin = input.margin ?? DRONE_POPOVER_MARGIN_PX;
  const guard = input.guard ?? DRONE_POPOVER_GUARD_PX;
  const obstacles = input.obstacles ?? [];
  const guards = input.guards ?? [];
  const neck = input.neck ?? null;
  const { width, height } = input.popover;
  const minX = margin;
  const maxX = input.viewport.width - width - margin;
  const minY = margin;
  const maxY = input.viewport.height - height - margin;
  if (maxX < minX - 0.01 || maxY < minY - 0.01) return null;

  let x = input.trigger.x + input.trigger.width - width;
  if (x < minX) x = minX;
  if (x > maxX) x = maxX;

  const aboveY = input.trigger.y - height - margin;
  const belowY = input.trigger.y + input.trigger.height + margin;
  const boxAt = (y: number): DroneBox => ({ x, y, width, height });
  const onScreen = (y: number) => y >= minY - 0.01 && y <= maxY + 0.01;
  const hits = (y: number, regions: readonly DroneBox[]) =>
    regions.some((region) => boxesOverlap(boxAt(y), region));
  const hitsGuard = (y: number) =>
    guards.some((region) => boxGap(boxAt(y), region) < guard - 0.01);
  const clear = (y: number) =>
    onScreen(y) &&
    !hits(y, obstacles) &&
    !hitsGuard(y) &&
    !(neck && hits(y, [neck]));

  if (clear(aboveY)) return { x, y: aboveY };
  if (clear(belowY)) return { x, y: belowY };

  let best: { x: number; y: number; distance: number } | null = null;
  const steps = Math.ceil(maxY - minY);
  for (let step = 0; step <= steps; step += 1) {
    const y = minY + step;
    if (!clear(y)) continue;
    const distance = Math.min(
      Math.abs(y - aboveY),
      Math.abs(y - belowY),
    );
    if (!best || distance < best.distance) best = { x, y, distance };
  }
  return best ? { x: best.x, y: best.y } : null;
}
