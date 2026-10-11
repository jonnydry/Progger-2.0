'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { AudioLines, ChevronDown } from 'lucide-react';
import { reedRequestForScale } from '@/lib/drone';
import {
  ReedDrone,
  clampDroneVolume,
  type DroneStatus,
} from '@/lib/drone-audio';
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
import {
  droneCommand,
  droneStopFade,
  type DronePhase,
} from '@/lib/drone-session';

export function useReedDrone(input: {
  active: boolean;
  root: string;
  scaleId: string;
}) {
  const [enabled, setEnabled] = useState(false);
  const [volume, setVolumeState] = useState(1);
  const [status, setStatus] = useState<DroneStatus>('idle');
  const [message, setMessage] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  const engineRef = useRef<ReedDrone | null>(null);
  const phaseRef = useRef<DronePhase>('unstarted');
  const currentRef = useRef<ReturnType<typeof reedRequestForScale> | null>(
    null,
  );

  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
      phaseRef.current = 'unstarted';
    };
  }, []);

  useEffect(() => {
    const sync = () => {
      const request = reedRequestForScale(input.root, input.scaleId);
      const hidden = document.visibilityState === 'hidden';
      const place = input.active && !hidden ? 'scales' : 'away';
      const command = droneCommand({
        enabled,
        place,
        phase: phaseRef.current,
        current: currentRef.current,
        request,
      });
      if (command.type === 'silent') return;
      if (command.type === 'hold') {
        engineRef.current?.setVolume(volume);
        return;
      }
      if (command.type === 'stop') {
        engineRef.current?.stop(droneStopFade(place));
        phaseRef.current = 'idle';
        currentRef.current = null;
        return;
      }
      const engine =
        engineRef.current ??
        new ReedDrone((next, detail) => {
          phaseRef.current = next;
          setStatus(next);
          setMessage(detail);
        });
      engineRef.current = engine;
      engine.setVolume(volume);
      phaseRef.current = 'starting';
      currentRef.current = command.request;
      if (command.type === 'play') engine.play(command.request);
      else engine.retune(command.request);
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, [input.active, input.root, input.scaleId, enabled, volume, attempt]);

  const live = enabled && status !== 'error';

  return {
    enabled: live,
    volume,
    message,
    toggle() {
      if (enabled && status === 'error') {
        phaseRef.current = 'idle';
        setAttempt((value) => value + 1);
        return;
      }
      setEnabled((value) => !value);
    },
    setVolume(next: number) {
      setVolumeState(clampDroneVolume(next));
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
      onFocusLeave();
    };
    panel?.addEventListener('cancel', onCancel);
    panel?.addEventListener('focusout', onFocusOut);
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
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
      setVolumeOpen(false);
      toggleRef.current?.focus({ preventScroll: true });
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
      {message ? (
        <output className="drone-status sr-only">{message}</output>
      ) : null}
      {volumeOpen
        ? createPortal(
            <DroneVolumePopover
              volume={volume}
              onVolume={onVolume}
              onDismiss={dismissVolume}
              onFocusLeave={leaveVolume}
              pointerOnTrigger={pointerOnTrigger}
              anchorRef={anchorRef}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
