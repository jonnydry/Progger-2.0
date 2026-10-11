import {
  REED_TIMING,
  ReedDrone,
  clampDroneVolume,
  requestSound,
  type DroneStatus,
  type ReedRequest,
} from './drone-audio.ts';
import { scaleWalk, type DroneSoundId } from './drone.ts';

const SOUND_KEY = 'progger.drone-sound';

function storedSound(): DroneSoundId {
  try {
    if (typeof localStorage === 'undefined') return 'reed';
    const value = localStorage.getItem(SOUND_KEY);
    if (value === 'reed' || value === 'bow' || value === 'cello') return value;
  } catch {
    // Private mode can refuse storage. The choice stays for this visit.
  }
  return 'reed';
}

export type DronePhase = 'unstarted' | DroneStatus;

export type DroneCommand =
  | { type: 'silent' }
  | { type: 'stop' }
  | { type: 'hold' }
  | { type: 'play'; request: ReedRequest }
  | { type: 'retune'; request: ReedRequest };

// A view change cuts the tail. Toggle-off keeps the longer fade on the scale page.
export function droneStopFade(place: 'scales' | 'away'): number {
  return place === 'away' ? REED_TIMING.hideFade : REED_TIMING.stopFade;
}

function sameRequest(current: ReedRequest, request: ReedRequest): boolean {
  return (
    current.root === request.root &&
    current.modeId === request.modeId &&
    current.octave === request.octave &&
    requestSound(current) === requestSound(request)
  );
}

export function droneCommand(input: {
  enabled: boolean;
  place: 'scales' | 'away';
  phase: DronePhase;
  current: ReedRequest | null;
  request: ReedRequest;
}): DroneCommand {
  const heard = input.enabled && input.place === 'scales';
  if (!heard) {
    if (input.phase === 'playing' || input.phase === 'starting')
      return { type: 'stop' };
    return { type: 'silent' };
  }
  if (
    (input.phase === 'playing' || input.phase === 'starting') &&
    input.current &&
    sameRequest(input.current, input.request)
  ) {
    return { type: 'hold' };
  }
  if (input.phase === 'playing' || input.phase === 'starting') {
    return { type: 'retune', request: input.request };
  }
  return { type: 'play', request: input.request };
}

export type DroneSnapshot = {
  pressed: boolean;
  volume: number;
  sound: DroneSoundId;
  walking: boolean;
  walkPc: number | null;
  message?: string;
};

/**
 * The drone stays off after any stop the user did not choose.
 * A tap is the only way back to sound. Becoming visible, returning to
 * Explore, or a bfcache restore does not call play or resume.
 */
export class ExploreDrone {
  private enabled = false;
  private active = false;
  private hidden = false;
  private phase: DronePhase = 'unstarted';
  private current: ReedRequest | null = null;
  private request: ReedRequest;
  private volume = 1;
  private sound: DroneSoundId = storedSound();
  private walking = false;
  private walkPc: number | null = null;
  private status: DroneStatus = 'idle';
  private message: string | undefined;
  private engine: ReedDrone | null = null;
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  private readonly createEngine: (
    onStatus: (status: DroneStatus, message?: string) => void,
    onWalk: (index: number | null) => void,
  ) => ReedDrone;
  private readonly onWalkIndex = (index: number | null) => {
    if (index === null) {
      this.walking = false;
      this.walkPc = null;
    } else {
      const notes = scaleWalk(
        this.request.root,
        this.request.scaleId ?? this.request.modeId,
      );
      this.walking = true;
      this.walkPc = notes[index]?.note.pc ?? null;
    }
    this.emit();
  };
  private readonly onStatus = (status: DroneStatus, detail?: string) => {
    this.phase = status;
    this.status = status;
    this.message = detail;
    // An interruption or a failed start is not a tap. The toggle goes off,
    // and a later scale change must not start the sound.
    if (status === 'idle' || status === 'error') this.enabled = false;
    this.emit();
  };

  constructor(
    createEngine: (
      onStatus: (status: DroneStatus, message?: string) => void,
      onWalk?: (index: number | null) => void,
    ) => ReedDrone,
    request: ReedRequest,
  ) {
    this.createEngine = createEngine;
    this.request = { ...request, sound: this.sound };
  }

  snapshot(): DroneSnapshot {
    return {
      pressed: this.enabled && this.status !== 'error',
      volume: this.volume,
      sound: this.sound,
      walking: this.walking,
      walkPc: this.walkPc,
      message: this.message,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) this.disarm();
    else this.reconcile();
  }

  setRequest(request: ReedRequest): void {
    this.stopWalking();
    this.request = { ...request, sound: this.sound };
    this.reconcile();
  }

  setSound(sound: DroneSoundId): void {
    this.sound = sound;
    this.request = { ...this.request, sound };
    try {
      localStorage.setItem(SOUND_KEY, sound);
    } catch {
      // The choice still applies for this visit.
    }
    if (sound === 'cello') void this.engineOrCreate().preloadCello();
    this.reconcile();
  }

  walk(): void {
    if (this.walking) {
      this.stopWalking();
      this.emit();
      return;
    }
    this.walking = true;
    this.emit();
    this.engineOrCreate().walk({ ...this.request, sound: this.sound });
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden) this.disarm();
    else this.reconcile();
  }

  restoreFromCache(): void {
    this.disarm();
  }

  toggle(): void {
    if (this.enabled && this.status === 'error') {
      this.phase = 'idle';
      this.reconcile();
      return;
    }
    this.enabled = !this.enabled;
    this.reconcile();
  }

  setVolume(volume: number): void {
    this.volume = clampDroneVolume(volume);
    this.engine?.setVolume(this.volume);
    this.emit();
  }

  dispose(): void {
    this.disposed = true;
    this.enabled = false;
    if (this.phase === 'playing' || this.phase === 'starting') {
      this.engine?.stop(droneStopFade('away'));
      this.phase = 'idle';
      this.current = null;
    }
    this.engine?.dispose();
    this.engine = null;
    this.phase = 'unstarted';
  }

  private disarm(): void {
    this.enabled = false;
    this.stopWalking();
    if (this.phase === 'playing' || this.phase === 'starting') {
      this.engine?.stop(droneStopFade('away'));
      this.phase = 'idle';
      this.current = null;
    }
    this.emit();
  }

  private stopWalking(): void {
    if (!this.walking && this.walkPc === null) return;
    this.walking = false;
    this.walkPc = null;
    this.engine?.stopWalk();
  }

  private engineOrCreate(): ReedDrone {
    if (this.engine) return this.engine;
    const engine = this.createEngine(this.onStatus, this.onWalkIndex);
    this.engine = engine;
    return engine;
  }

  private reconcile(): void {
    if (this.disposed) return;
    const place = this.active && !this.hidden ? 'scales' : 'away';
    const command = droneCommand({
      enabled: this.enabled,
      place,
      phase: this.phase,
      current: this.current,
      request: this.request,
    });
    if (command.type === 'silent') return;
    if (command.type === 'hold') {
      this.engine?.setVolume(this.volume);
      return;
    }
    if (command.type === 'stop') {
      this.engine?.stop(droneStopFade(place));
      this.phase = 'idle';
      this.current = null;
      if (place === 'away') this.enabled = false;
      this.emit();
      return;
    }
    const engine = this.engine ?? this.createEngine(this.onStatus, this.onWalkIndex);
    this.engine = engine;
    engine.setVolume(this.volume);
    this.phase = 'starting';
    this.current = command.request;
    if (command.type === 'play') engine.play(command.request);
    else engine.retune(command.request);
    this.emit();
  }

  private emit(): void {
    if (this.disposed) return;
    for (const listener of this.listeners) listener();
  }
}
