import { REED_TIMING, type DroneStatus, type ReedRequest } from './drone-audio.ts';

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
    current.octave === request.octave
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
