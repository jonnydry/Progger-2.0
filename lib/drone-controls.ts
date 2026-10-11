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

function uniqueXs(values: number[]): number[] {
  const seen = new Set<string>();
  const result: number[] = [];
  for (const value of values) {
    const key = value.toFixed(3);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

// Open above the trigger when that box is clear. Otherwise walk away until the
// popover misses every obstacle. Never slide a candidate onto an obstacle.
export function volumePopoverOrigin(input: {
  trigger: DroneBox;
  popover: { width: number; height: number };
  viewport: { width: number; height: number };
  obstacles?: readonly DroneBox[];
  neck?: DroneBox | null;
  margin?: number;
}): { x: number; y: number } | null {
  const margin = input.margin ?? DRONE_POPOVER_MARGIN_PX;
  const obstacles = [
    ...(input.obstacles ?? []),
    ...(input.neck ? [input.neck] : []),
  ];
  const { width, height } = input.popover;
  const preferredX = input.trigger.x + input.trigger.width - width;
  const xs = uniqueXs([
    preferredX,
    input.trigger.x,
    input.trigger.x + (input.trigger.width - width) / 2,
    input.viewport.width - width - margin,
    margin,
  ]).sort((a, b) => Math.abs(a - preferredX) - Math.abs(b - preferredX));

  const clear = (x: number, y: number) => {
    if (x < margin - 0.01 || y < margin - 0.01) return false;
    if (x + width > input.viewport.width - margin + 0.01) return false;
    if (y + height > input.viewport.height - margin + 0.01) return false;
    const padded: DroneBox = {
      x: x - margin,
      y: y - margin,
      width: width + margin * 2,
      height: height + margin * 2,
    };
    return obstacles.every((obstacle) => !boxesOverlap(padded, obstacle));
  };

  const aligned = (x: number) =>
    x < input.trigger.x + input.trigger.width && x + width > input.trigger.x;
  const groups = [xs.filter(aligned), xs.filter((x) => !aligned(x))];
  const aboveY = input.trigger.y - height - margin;
  const belowY = input.trigger.y + input.trigger.height + margin;
  const limit = Math.ceil(
    Math.max(input.viewport.width, input.viewport.height),
  );
  for (const group of groups) {
    for (const x of group) {
      if (clear(x, aboveY)) return { x, y: aboveY };
    }
    for (const x of group) {
      if (clear(x, belowY)) return { x, y: belowY };
    }
    for (let step = margin + 1; step <= limit; step += 1) {
      const yAbove = input.trigger.y - height - step;
      const yBelow = input.trigger.y + input.trigger.height + step;
      for (const x of group) {
        if (clear(x, yAbove)) return { x, y: yAbove };
      }
      for (const x of group) {
        if (clear(x, yBelow)) return { x, y: yBelow };
      }
    }
  }
  return null;
}
