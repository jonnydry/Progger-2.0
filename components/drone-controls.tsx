'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { AudioLines, ChevronDown, Footprints } from 'lucide-react';
import {
  DRONE_SOUNDS,
  reedRequestForScale,
  type DroneSoundId,
} from '@/lib/drone';
import { pageAudio } from '@/lib/audio-output';
import { ReedDrone, clampDroneVolume } from '@/lib/drone-audio';
import {
  DRONE_ICON_PX,
  DRONE_POPOVER_MARGIN_PX,
  VOLUME_POPOVER_GUARD_SELECTORS,
  type AnchoredPopoverSide,
  type DroneBox,
  anchoredVolumePopover,
  droneControlName,
  droneVolumeFocusOut,
  droneVolumeOpens,
  popoverFixedPoint,
  volumePopoverKey,
} from '@/lib/drone-controls';
import { ExploreDrone } from '@/lib/drone-session';

export function useReedDrone(input: {
  active: boolean;
  root: string;
  scaleId: string;
}) {
  const [controller] = useState(
    () =>
      new ExploreDrone(
        (onStatus, onWalk, onHeld, onCelloUnavailable) =>
          new ReedDrone(onStatus, {
            onWalk,
            onHeld,
            onCelloUnavailable,
            createContext: () => pageAudio().context,
            output: () => pageAudio().chain,
          }),
        reedRequestForScale(input.root, input.scaleId),
      ),
  );
  const [snapshot, setSnapshot] = useState(() => controller.snapshot());

  useEffect(
    () => controller.subscribe(() => setSnapshot(controller.snapshot())),
    [controller],
  );

  useEffect(() => {
    const request = reedRequestForScale(input.root, input.scaleId);
    if (!input.active) {
      controller.setActive(false);
      controller.setRequest(request);
      return;
    }
    controller.setRequest(request);
    controller.setActive(true);
  }, [controller, input.active, input.root, input.scaleId]);

  useEffect(() => {
    const onVisibility = () => {
      controller.setHidden(document.visibilityState === 'hidden');
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) controller.restoreFromCache();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      controller.dispose();
    };
  }, [controller]);

  return {
    enabled: snapshot.pressed,
    volume: snapshot.volume,
    message: snapshot.message,
    toggle() {
      controller.toggle();
    },
    setVolume(next: number) {
      controller.setVolume(next);
    },
    sound: snapshot.sound,
    celloAvailable: snapshot.celloAvailable,
    walking: snapshot.walking,
    walkPc: snapshot.walkPc,
    setSound(next: DroneSoundId) {
      controller.setSound(next);
    },
    walk() {
      controller.walk();
    },
  };
}

function toBox(rect: Pick<DOMRect, 'x' | 'y' | 'width' | 'height'>): DroneBox {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function boxesFor(selectors: readonly string[]): DroneBox[] {
  const boxes: DroneBox[] = [];
  for (const selector of selectors) {
    for (const node of document.querySelectorAll(selector)) {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) boxes.push(toBox(rect));
    }
  }
  return boxes;
}

function guardBoxes(): DroneBox[] {
  return boxesFor(VOLUME_POPOVER_GUARD_SELECTORS);
}

function soundLabel(id: DroneSoundId): string {
  return DRONE_SOUNDS.find((choice) => choice.id === id)?.label ?? id;
}

/**
 * Fixed elements stay on the viewport unless an ancestor paints or
 * transforms. Inline-size containment does not do that, so the shell's
 * container query must not be treated as the frame: subtracting it pins
 * the menu while the button scrolls away.
 */
function fixedFrame(node: HTMLElement): { x: number; y: number } | null {
  let current: HTMLElement | null = node.parentElement;
  while (current && current !== document.documentElement) {
    const style = getComputedStyle(current);
    const backdrop =
      style.backdropFilter ||
      style.getPropertyValue('-webkit-backdrop-filter') ||
      'none';
    const containsFixed =
      style.transform !== 'none' ||
      style.filter !== 'none' ||
      backdrop !== 'none' ||
      style.perspective !== 'none' ||
      style.contain === 'paint' ||
      style.contain.split(' ').includes('paint') ||
      style.willChange.split(',').some((part) => {
        const value = part.trim();
        return value === 'transform' || value === 'paint';
      });
    if (containsFixed) {
      const rect = current.getBoundingClientRect();
      return { x: rect.left, y: rect.top };
    }
    current = current.parentElement;
  }
  return null;
}

function DroneVolumePopover({
  volume,
  sound,
  celloAvailable,
  onVolume,
  onSound,
  onFocusLeave,
  pointerOnTrigger,
  anchorRef,
  initialFocus,
}: {
  volume: number;
  sound: DroneSoundId;
  celloAvailable: boolean;
  onVolume: (volume: number) => void;
  onSound: (sound: DroneSoundId) => void;
  onFocusLeave: () => void;
  pointerOnTrigger: RefObject<boolean>;
  anchorRef: RefObject<HTMLButtonElement | null>;
  initialFocus: 'trigger' | 'slider';
}) {
  const panelRef = useRef<HTMLDialogElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const didFocus = useRef(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const [side, setSide] = useState<AnchoredPopoverSide>('below');

  // The menu stays visibility: hidden until it has a position, and a hidden
  // slider cannot take focus. Wait for the first placement.
  useLayoutEffect(() => {
    if (didFocus.current || !origin) return;
    didFocus.current = true;
    if (initialFocus === 'slider') {
      sliderRef.current?.focus({ preventScroll: true });
      return;
    }
    anchorRef.current?.focus({ preventScroll: true });
  }, [anchorRef, initialFocus, origin]);

  useLayoutEffect(() => {
    const place = () => {
      const trigger = anchorRef.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!trigger || !panel || panel.offsetWidth < 1) return;
      const next = anchoredVolumePopover({
        trigger: toBox(trigger),
        popover: { width: panel.offsetWidth, height: panel.offsetHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        guards: guardBoxes(),
      });
      const point = popoverFixedPoint(next, fixedFrame(panel));
      const rounded = {
        x: Math.round(point.x),
        y:
          next.side === 'above'
            ? Math.floor(point.y)
            : next.side === 'below'
              ? Math.ceil(point.y)
              : Math.round(point.y),
      };
      setSide(next.side);
      setOrigin((current) =>
        current && current.x === rounded.x && current.y === rounded.y
          ? current
          : rounded,
      );
    };
    const panel = panelRef.current;
    const onCancel = (event: Event) => {
      event.preventDefault();
    };
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      const relatedInside = next instanceof Node && !!panel?.contains(next);
      const relatedTrigger =
        next instanceof Element && next.id === 'drone-volume-trigger';
      if (
        droneVolumeFocusOut({
          relatedInside,
          relatedTrigger,
          pointerOnTrigger: pointerOnTrigger.current,
        }).open
      )
        return;
      // The outside click focuses its target in this same turn. Close on the
      // next tick so that click can record the toggle return first.
      if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
      leaveTimer.current = setTimeout(() => {
        leaveTimer.current = null;
        onFocusLeave();
      }, 0);
    };
    // Open under the button. When the viewport ends too close below it,
    // scroll just enough for the menu, but never tuck the button under
    // the pinned bar. A viewport too short for that keeps its scroll and
    // the menu falls back to above or a sheet.
    const makeRoom = () => {
      const trigger = anchorRef.current?.getBoundingClientRect();
      if (!trigger || !panel || panel.offsetHeight < 1) return;
      const needed =
        trigger.bottom +
        DRONE_POPOVER_MARGIN_PX * 2 +
        panel.offsetHeight -
        window.innerHeight;
      if (needed <= 0) return;
      const bar = document.querySelector('.site-header');
      const barBottom = bar
        ? Math.max(0, bar.getBoundingClientRect().bottom)
        : 0;
      const room = trigger.top - barBottom - DRONE_POPOVER_MARGIN_PX;
      if (needed > room) return;
      window.scrollBy({ top: Math.ceil(needed), behavior: 'instant' });
    };
    panel?.addEventListener('cancel', onCancel);
    panel?.addEventListener('focusout', onFocusOut);
    makeRoom();
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
      panel?.removeEventListener('cancel', onCancel);
      panel?.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchorRef, onFocusLeave, pointerOnTrigger]);

  return (
    <dialog
      id="drone-volume-popover"
      aria-label="Drone volume"
      className="drone-volume-popover"
      data-side={side}
      open
      ref={panelRef}
      style={
        origin
          ? {
              left: `${Math.round(origin.x)}px`,
              top: `${Math.round(origin.y)}px`,
            }
          : { visibility: 'hidden' }
      }
    >
      <label className="drone-volume-field" htmlFor="drone-volume">
        <span>Volume</span>
        <input
          ref={sliderRef}
          id="drone-volume"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          aria-label="Sound menu volume"
          onChange={(event) =>
            onVolume(clampDroneVolume(event.target.valueAsNumber))
          }
        />
      </label>
      <fieldset className="drone-sound-field">
        <legend>Sound</legend>
        <div className="drone-sound-options">
          {DRONE_SOUNDS.map((choice) => {
            const unavailable = choice.id === 'cello' && !celloAvailable;
            return (
              <button
                key={choice.id}
                type="button"
                data-sound={choice.id}
                aria-pressed={sound === choice.id}
                disabled={unavailable}
                onClick={() => onSound(choice.id)}
              >
                {choice.label}
                {unavailable ? (
                  <span className="sr-only">, unavailable</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </fieldset>
    </dialog>
  );
}

export function DroneControls({
  enabled,
  volume,
  sound,
  celloAvailable,
  walking,
  message,
  rootName,
  onToggle,
  onVolume,
  onSound,
  onWalk,
}: {
  enabled: boolean;
  volume: number;
  sound: DroneSoundId;
  celloAvailable: boolean;
  walking: boolean;
  message?: string;
  rootName?: string;
  onToggle: () => void;
  onVolume: (volume: number) => void;
  onSound: (sound: DroneSoundId) => void;
  onWalk: () => void;
}) {
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [volumeFocus, setVolumeFocus] = useState<'trigger' | 'slider'>(
    'trigger',
  );
  const activeSound = soundLabel(sound);
  const droneHint = rootName
    ? `Sustained ${rootName} under your playing`
    : 'Sustained root note under your playing';
  const toggleRef = useRef<HTMLButtonElement>(null);
  const volumeRef = useRef<HTMLButtonElement>(null);
  const restoreToggleFocus = useRef(false);
  const dismissing = useRef(false);
  const pointerOnTrigger = useRef(false);
  const returnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveVolume = useCallback(() => {
    if (dismissing.current || restoreToggleFocus.current) return;
    setVolumeOpen(false);
  }, []);

  useLayoutEffect(() => {
    if (volumeOpen || !restoreToggleFocus.current) return;
    restoreToggleFocus.current = false;
    volumeRef.current?.focus({ preventScroll: true });
  }, [volumeOpen]);

  useEffect(() => {
    if (!volumeOpen) {
      dismissing.current = false;
      return;
    }
    dismissing.current = false;
    const onKeyDown = (event: KeyboardEvent) => {
      const next = volumePopoverKey({
        open: true,
        key: event.key,
        focus: 'slider',
      });
      if (next.open) return;
      if (next.focus === 'volume') {
        event.preventDefault();
        setVolumeOpen(false);
        volumeRef.current?.focus({ preventScroll: true });
        return;
      }
      if (next.focus !== 'toggle') return;
      event.preventDefault();
      restoreToggleFocus.current = true;
      setVolumeOpen(false);
    };
    const outside = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      return !target.closest('#drone-volume-popover, #drone-volume-trigger');
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!outside(event.target)) return;
      event.preventDefault();
      dismissing.current = true;
      const clickedToggle =
        event.target instanceof Element &&
        !!event.target.closest('#drone-toggle');
      restoreToggleFocus.current = !clickedToggle;
      if (returnTimer.current !== null) clearTimeout(returnTimer.current);
      returnTimer.current = setTimeout(() => {
        returnTimer.current = null;
        setVolumeOpen(false);
        if (clickedToggle) toggleRef.current?.focus({ preventScroll: true });
        else volumeRef.current?.focus({ preventScroll: true });
      }, 0);
    };
    const onPointerUp = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('#drone-volume-trigger'))
        return;
      pointerOnTrigger.current = false;
    };
    const onMouseDown = (event: MouseEvent) => {
      if (!outside(event.target)) return;
      event.preventDefault();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!dismissing.current) return;
      const target = event.target;
      if (
        target instanceof Element &&
        (target.id === 'drone-toggle' || target.id === 'drone-volume-trigger')
      )
        return;
      volumeRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    return () => {
      if (returnTimer.current !== null) clearTimeout(returnTimer.current);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
    };
  }, [volumeOpen]);

  return (
    <div className="drone-controls">
      <p className="drone-legend" title={`Drone. ${droneHint}`}>
        <AudioLines size={DRONE_ICON_PX} aria-hidden="true" />
        <span>
          <span className="drone-legend-title">Drone</span>
          <span id="drone-legend-hint" className="drone-legend-hint">
            {droneHint}
          </span>
        </span>
      </p>
      <button
        type="button"
        id="drone-volume-trigger"
        className="drone-volume-trigger"
        ref={volumeRef}
        data-sound={sound}
        data-playing={enabled ? 'true' : 'false'}
        aria-label={`Drone sound, ${activeSound}`}
        aria-haspopup="dialog"
        aria-expanded={volumeOpen}
        aria-controls="drone-volume-popover"
        onPointerDown={() => {
          pointerOnTrigger.current = true;
        }}
        onPointerCancel={() => {
          pointerOnTrigger.current = false;
        }}
        onClick={() => {
          pointerOnTrigger.current = false;
          if (!droneVolumeOpens({ kind: 'click' })) return;
          setVolumeFocus('trigger');
          setVolumeOpen((open) => !open);
        }}
      >
        <span className="drone-sound-name">{activeSound}</span>
        <ChevronDown size={DRONE_ICON_PX} aria-hidden="true" />
      </button>
      {volumeOpen ? (
        <DroneVolumePopover
          volume={volume}
          onVolume={onVolume}
          sound={sound}
          celloAvailable={celloAvailable}
          onSound={onSound}
          onFocusLeave={leaveVolume}
          pointerOnTrigger={pointerOnTrigger}
          anchorRef={volumeRef}
          initialFocus={volumeFocus}
        />
      ) : null}
      <button
        type="button"
        id="drone-walk"
        className="drone-walk"
        aria-pressed={walking}
        aria-label={
          walking ? 'Stop the scale walk' : 'Walk the scale up and down'
        }
        onClick={onWalk}
      >
        <Footprints size={DRONE_ICON_PX} aria-hidden="true" />
      </button>
      <button
        type="button"
        id="drone-toggle"
        className="drone-toggle"
        ref={toggleRef}
        aria-pressed={enabled}
        aria-label={droneControlName(enabled, activeSound)}
        aria-describedby="drone-legend-hint"
        aria-keyshortcuts="ArrowDown ArrowUp"
        onClick={onToggle}
        onKeyDown={(event) => {
          const next = volumePopoverKey({
            open: volumeOpen,
            key: event.key,
            focus: 'toggle',
          });
          if (!droneVolumeOpens({ kind: 'keydown', key: event.key })) return;
          if (!next.open || next.focus !== 'slider') return;
          event.preventDefault();
          setVolumeFocus('slider');
          setVolumeOpen(true);
        }}
      >
        <AudioLines size={DRONE_ICON_PX} aria-hidden="true" />
      </button>
      {message ? (
        <output className="drone-status sr-only">{message}</output>
      ) : null}
    </div>
  );
}
