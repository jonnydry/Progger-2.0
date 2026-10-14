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
const VOLUME_KEY = 'progger.drone-volume';

export function volumeFromStorage(value: string | null): number {
  if (value === null) return 1;
  const trimmed = value.trim();
  if (trimmed === '') return 1;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return 1;
  return clampDroneVolume(parsed);
}

function storedVolume(): number {
  try {
    if (typeof localStorage === 'undefined') return 1;
    return volumeFromStorage(localStorage.getItem(VOLUME_KEY));
  } catch {
    return 1;
  }
}

function storeVolume(volume: number): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(volume));
  } catch {
    // Private mode can refuse storage. The level still applies for this visit.
  }
}

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
  celloAvailable: boolean;
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
  private volume = storedVolume();
  private sound: DroneSoundId = storedSound();
  private walking = false;
  private walkPc: number | null = null;
  private status: DroneStatus = 'idle';
  private message: string | undefined;
  private celloAvailable = true;
  private engine: ReedDrone | null = null;
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  private readonly onCelloUnavailable = (mode: 'hold' | 'fallback') => {
    this.celloAvailable = false;
    this.message = 'Cello is unavailable.';
    if (mode === 'hold') return;
    this.sound = 'reed';
    this.request = { ...this.request, sound: 'reed' };
    try {
      localStorage.setItem(SOUND_KEY, 'reed');
    } catch {
      // The heard sound still applies for this visit.
    }
    this.phase = 'idle';
    this.current = null;
    if (this.enabled) {
      this.reconcile();
      return;
    }
    this.emit();
  };
  private readonly createEngine: (
    onStatus: (status: DroneStatus, message?: string) => void,
    onWalk: (index: number | null) => void,
    onHeld: (heard: ReedRequest, attempted: ReedRequest) => void,
    onCelloUnavailable: (mode: 'hold' | 'fallback') => void,
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
    this.message = this.celloAvailable ? detail : 'Cello is unavailable.';
    // An interruption or a failed start is not a tap. The toggle goes off,
    // and a later scale change must not start the sound.
    if (status === 'idle' || status === 'error') this.enabled = false;
    this.emit();
  };
  private readonly onHeld = (heard: ReedRequest, attempted: ReedRequest) => {
    const sound = requestSound(heard);
    this.sound = sound;
    this.current = { ...heard, sound };
    this.request = { ...this.request, sound };
    try {
      localStorage.setItem(SOUND_KEY, sound);
    } catch {
      // The heard sound still applies for this visit.
    }
    this.phase = 'playing';
    this.status = 'playing';
    this.message = this.celloAvailable ? undefined : 'Cello is unavailable.';
    const keyMoved =
      heard.root !== this.request.root ||
      heard.modeId !== this.request.modeId ||
      heard.octave !== this.request.octave;
    // The voice that stayed plays the key now on screen.
    // The sound that failed stays unloaded.
    if (keyMoved && requestSound(attempted) !== sound) {
      this.reconcile();
      return;
    }
    this.emit();
  };

  private readonly onStorage = (event: StorageEvent) => {
    if (event.storageArea && event.storageArea !== localStorage) return;
    if (event.key !== null && event.key !== VOLUME_KEY) return;
    const next =
      event.key === VOLUME_KEY
        ? volumeFromStorage(event.newValue)
        : storedVolume();
    if (next === this.volume) return;
    this.volume = next;
    this.engine?.setVolume(next);
    this.emit();
  };

  constructor(
    createEngine: (
      onStatus: (status: DroneStatus, message?: string) => void,
      onWalk: (index: number | null) => void,
      onHeld: (heard: ReedRequest, attempted: ReedRequest) => void,
      onCelloUnavailable: (mode: 'hold' | 'fallback') => void,
    ) => ReedDrone,
    request: ReedRequest,
  ) {
    this.createEngine = createEngine;
    this.request = { ...request, sound: this.sound };
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', this.onStorage);
    }
  }

  snapshot(): DroneSnapshot {
    return {
      pressed: this.enabled && this.status !== 'error',
      volume: this.volume,
      sound: this.sound,
      walking: this.walking,
      walkPc: this.walkPc,
      celloAvailable: this.celloAvailable,
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
    if (sound === 'cello' && !this.celloAvailable) return;
    this.sound = sound;
    this.request = { ...this.request, sound };
    try {
      localStorage.setItem(SOUND_KEY, sound);
    } catch {
      // The choice still applies for this visit.
    }
    if (sound === 'cello') void this.engineOrCreate().preloadCello();
    this.reconcile();
    // A silent pick still has to publish the choice. Reconcile only emits
    // when it starts, retunes, or stops, so an off drone would keep the
    // previous name until the next tap.
    this.emit();
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
    storeVolume(this.volume);
    this.engine?.setVolume(this.volume);
    this.emit();
  }

  dispose(): void {
    this.disposed = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', this.onStorage);
    }
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
    const engine = this.createEngine(
      this.onStatus,
      this.onWalkIndex,
      this.onHeld,
      this.onCelloUnavailable,
    );
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
    const engine =
      this.engine ??
      this.createEngine(
        this.onStatus,
        this.onWalkIndex,
        this.onHeld,
        this.onCelloUnavailable,
      );
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
