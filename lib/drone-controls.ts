export const DRONE_TAP_TARGET_PX = 44;
export const DRONE_ICON_PX = 18;
export const DRONE_POPOVER_MARGIN_PX = 8;

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

function clampOrigin(
  origin: { x: number; y: number },
  popover: { width: number; height: number },
  viewport: { width: number; height: number },
  margin: number,
): { x: number; y: number } {
  const maxX = Math.max(margin, viewport.width - popover.width - margin);
  const maxY = Math.max(margin, viewport.height - popover.height - margin);
  return {
    x: Math.min(Math.max(margin, origin.x), maxX),
    y: Math.min(Math.max(margin, origin.y), maxY),
  };
}

// Prefer below the trigger, right-aligned. Flip above when that box would cover the neck.
export function volumePopoverOrigin(input: {
  trigger: DroneBox;
  popover: { width: number; height: number };
  viewport: { width: number; height: number };
  neck: DroneBox | null;
  margin?: number;
}): { x: number; y: number } | null {
  const margin = input.margin ?? DRONE_POPOVER_MARGIN_PX;
  const alignRight =
    input.trigger.x + input.trigger.width - input.popover.width;
  const candidates = [
    {
      x: alignRight,
      y: input.trigger.y + input.trigger.height + margin,
    },
    { x: alignRight, y: input.trigger.y - input.popover.height - margin },
  ];
  const placed = candidates.map((origin) =>
    clampOrigin(origin, input.popover, input.viewport, margin),
  );
  const missesNeck = (origin: { x: number; y: number }) => {
    if (!input.neck) return true;
    return !boxesOverlap(
      {
        ...origin,
        width: input.popover.width,
        height: input.popover.height,
      },
      input.neck,
    );
  };
  const inside = (origin: { x: number; y: number }) =>
    origin.y + input.popover.height <= input.viewport.height - margin + 0.01 &&
    origin.x + input.popover.width <= input.viewport.width - margin + 0.01;
  return (
    placed.find((origin) => missesNeck(origin) && inside(origin)) ??
    placed.find((origin) => missesNeck(origin)) ??
    null
  );
}
