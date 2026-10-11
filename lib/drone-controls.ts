export const DRONE_TAP_TARGET_PX = 44;
export const DRONE_ICON_PX = 18;
export const DRONE_POPOVER_MARGIN_PX = 8;

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

export type DroneBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function droneControlName(enabled: boolean): string {
  return enabled ? 'Drone, on' : 'Drone, off';
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
  focus: 'toggle' | 'slider' | 'outside';
}): { open: boolean; focus: 'toggle' | 'slider' | 'outside' } {
  if (!input.open) {
    if (input.focus === 'toggle' && droneVolumeKeyOpens(input.key)) {
      return { open: true, focus: 'slider' };
    }
    return { open: false, focus: input.focus };
  }
  if (input.key === 'Escape') return { open: false, focus: 'toggle' };
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

// Sit against the volume button. Prefer the side that misses every obstacle.
// A clear cell further up the page is not a place to open.
export function volumePopoverOrigin(input: {
  trigger: DroneBox;
  popover: { width: number; height: number };
  viewport: { width: number; height: number };
  obstacles?: readonly DroneBox[];
  neck?: DroneBox | null;
  margin?: number;
}): { x: number; y: number } | null {
  const margin = input.margin ?? DRONE_POPOVER_MARGIN_PX;
  const obstacles = input.obstacles ?? [];
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
  const clear = (y: number) =>
    onScreen(y) && !hits(y, obstacles) && !(neck && hits(y, [neck]));

  if (clear(aboveY)) return { x, y: aboveY };
  if (clear(belowY)) return { x, y: belowY };
  if (onScreen(aboveY) && !(neck && hits(aboveY, [neck])))
    return { x, y: aboveY };
  if (onScreen(belowY) && !(neck && hits(belowY, [neck])))
    return { x, y: belowY };
  return null;
}
