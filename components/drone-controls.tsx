'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { AudioLines, ChevronDown } from 'lucide-react';
import { reedRequestForScale } from '@/lib/drone';
import { ReedDrone, clampDroneVolume } from '@/lib/drone-audio';
import {
  DRONE_ICON_PX,
  VOLUME_POPOVER_OBSTACLE_SELECTORS,
  type DroneBox,
  droneControlName,
  droneVolumeFocusOut,
  droneVolumeOpens,
  volumePopoverKey,
  volumePopoverOrigin,
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
        (onStatus) => new ReedDrone(onStatus),
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
  };
}

function toBox(rect: Pick<DOMRect, 'x' | 'y' | 'width' | 'height'>): DroneBox {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function obstacleBoxes(): DroneBox[] {
  const boxes: DroneBox[] = [];
  for (const selector of VOLUME_POPOVER_OBSTACLE_SELECTORS) {
    for (const node of document.querySelectorAll(selector)) {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) boxes.push(toBox(rect));
    }
  }
  return boxes;
}

function DroneVolumePopover({
  volume,
  onVolume,
  onDismiss,
  onFocusLeave,
  pointerOnTrigger,
  anchorRef,
}: {
  volume: number;
  onVolume: (volume: number) => void;
  onDismiss: () => void;
  onFocusLeave: () => void;
  pointerOnTrigger: RefObject<boolean>;
  anchorRef: RefObject<HTMLButtonElement | null>;
}) {
  const panelRef = useRef<HTMLDialogElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const didFocus = useRef(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    if (!origin || didFocus.current) return;
    didFocus.current = true;
    sliderRef.current?.focus({ preventScroll: true });
  }, [origin]);

  useLayoutEffect(() => {
    const place = () => {
      const trigger = anchorRef.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!trigger || !panel || panel.offsetWidth < 1) return;
      const next = volumePopoverOrigin({
        trigger: toBox(trigger),
        popover: { width: panel.offsetWidth, height: panel.offsetHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        obstacles: obstacleBoxes(),
      });
      if (!next) {
        onDismiss();
        return;
      }
      setOrigin((current) =>
        current && current.x === next.x && current.y === next.y
          ? current
          : next,
      );
    };
    const panel = panelRef.current;
    const onCancel = (event: Event) => {
      event.preventDefault();
    };
    const onScroll = () => onDismiss();
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
    panel?.addEventListener('cancel', onCancel);
    panel?.addEventListener('focusout', onFocusOut);
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
      panel?.removeEventListener('cancel', onCancel);
      panel?.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [anchorRef, onDismiss, onFocusLeave, pointerOnTrigger]);

  return (
    <dialog
      id="drone-volume-popover"
      aria-label="Drone volume"
      className="drone-volume-popover"
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
          aria-label="Drone volume"
          onChange={(event) =>
            onVolume(clampDroneVolume(event.target.valueAsNumber))
          }
        />
      </label>
    </dialog>
  );
}

export function DroneControls({
  enabled,
  volume,
  message,
  onToggle,
  onVolume,
}: {
  enabled: boolean;
  volume: number;
  message?: string;
  onToggle: () => void;
  onVolume: (volume: number) => void;
}) {
  const [volumeOpen, setVolumeOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const volumeRef = useRef<HTMLButtonElement>(null);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const restoreToggleFocus = useRef(false);
  const dismissing = useRef(false);
  const pointerOnTrigger = useRef(false);
  const returnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissVolume = useCallback(() => {
    restoreToggleFocus.current = true;
    dismissing.current = true;
    setVolumeOpen(false);
  }, []);
  const leaveVolume = useCallback(() => {
    if (dismissing.current || restoreToggleFocus.current) return;
    setVolumeOpen(false);
  }, []);

  useLayoutEffect(() => {
    if (volumeOpen || !restoreToggleFocus.current) return;
    restoreToggleFocus.current = false;
    toggleRef.current?.focus({ preventScroll: true });
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
      if (next.open || next.focus !== 'toggle') return;
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
      restoreToggleFocus.current = true;
      if (returnTimer.current !== null) clearTimeout(returnTimer.current);
      returnTimer.current = setTimeout(() => {
        returnTimer.current = null;
        setVolumeOpen(false);
        toggleRef.current?.focus({ preventScroll: true });
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
      if (target instanceof Element && target.id === 'drone-toggle') return;
      toggleRef.current?.focus({ preventScroll: true });
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
      <button
        type="button"
        id="drone-volume-trigger"
        className="drone-volume-trigger"
        ref={volumeRef}
        aria-label="Drone volume"
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
          anchorRef.current = volumeRef.current;
          setVolumeOpen((open) => !open);
        }}
      >
        <ChevronDown size={DRONE_ICON_PX} aria-hidden="true" />
      </button>
      {volumeOpen ? (
        <DroneVolumePopover
          volume={volume}
          onVolume={onVolume}
          onDismiss={dismissVolume}
          onFocusLeave={leaveVolume}
          pointerOnTrigger={pointerOnTrigger}
          anchorRef={anchorRef}
        />
      ) : null}
      <button
        type="button"
        id="drone-toggle"
        className="drone-toggle"
        ref={toggleRef}
        aria-pressed={enabled}
        aria-label={droneControlName(enabled)}
        aria-keyshortcuts="ArrowDown ArrowUp"
        aria-haspopup="dialog"
        aria-expanded={volumeOpen}
        aria-controls="drone-volume-popover"
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
          anchorRef.current = toggleRef.current;
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
