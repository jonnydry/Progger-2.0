import type { ReedRequest } from './drone-audio.ts';
import type { DroneStatus } from './drone-audio.ts';

export type DronePhase = 'unstarted' | DroneStatus;

export type DroneCommand =
  | { type: 'silent' }
  | { type: 'stop' }
  | { type: 'hold' }
  | { type: 'play'; request: ReedRequest }
  | { type: 'retune'; request: ReedRequest };

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
