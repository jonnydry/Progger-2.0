'use client';

import { useEffect, useRef, useState } from 'react';
import { Play, Square } from 'lucide-react';
import { pageAudio } from '@/lib/audio-output';
import { VoicingPlayer, type AuditionState } from '@/lib/voicing-audio';

export function VoicingAudition({
  frets,
  active,
}: {
  frets: readonly (number | null)[];
  active: boolean;
}) {
  const player = useRef<VoicingPlayer | null>(null);
  const [state, setState] = useState<AuditionState>('idle');
  useEffect(() => {
    const current = new VoicingPlayer(setState, () => pageAudio().voicing);
    player.current = current;
    const hide = () => {
      if (document.hidden) current.stop();
    };
    const leave = () => current.stop();
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', leave);
    return () => {
      current.dispose();
      player.current = null;
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', leave);
    };
  }, []);
  useEffect(() => {
    if (!active) player.current?.stop();
  }, [active]);
  const busy = state === 'starting' || state === 'playing';
  return (
    <div className="voicing-audition">
      <button
        type="button"
        className="voicing-listen"
        disabled={!active}
        aria-label={busy ? 'Stop voicing' : 'Hear voicing'}
        onClick={() => {
          if (busy) player.current?.stop();
          else if (active) void player.current?.play(frets);
        }}
      >
        {busy ? (
          <Square size={14} aria-hidden="true" />
        ) : (
          <Play size={14} aria-hidden="true" />
        )}
        {busy ? 'Stop' : 'Hear voicing'}
      </button>
      <output className="voicing-audio-status">
        {state === 'error'
          ? 'Audio couldn’t start. Tap to try again.'
          : state === 'starting'
            ? 'Starting…'
            : state === 'playing'
              ? 'Playing this shape'
              : ''}
      </output>
    </div>
  );
}
