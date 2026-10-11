'use client';

import { useEffect, useRef, useState } from 'react';
import { reedRequestForScale } from '@/lib/drone';
import {
  ReedDrone,
  clampDroneVolume,
  type DroneStatus,
} from '@/lib/drone-audio';
import { droneCommand, type DronePhase } from '@/lib/drone-session';

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
        engineRef.current?.stop();
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
  return (
    <div className="drone-controls">
      <button
        type="button"
        id="drone-toggle"
        className="drone-toggle"
        aria-pressed={enabled}
        onClick={onToggle}
      >
        Drone {enabled ? 'on' : 'off'}
      </button>
      <label className="drone-volume">
        <span>Volume</span>
        <input
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
      {message ? <output className="drone-status">{message}</output> : null}
    </div>
  );
}
