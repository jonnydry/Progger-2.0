'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { APPEARANCE_CHANGE_EVENT } from '@/lib/theme';

// Keep the fade inside the decorative layer. Browser view-transition snapshots
// otherwise cover the live navigation even when pointer events are disabled.
export function PondScene() {
  const element = useRef<HTMLDivElement>(null);
  const serial = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [previous, setPrevious] = useState<{
    id: number;
    style: CSSProperties;
  } | null>(null);

  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const clear = () => {
      clearTimeout(timer.current);
      setPrevious(null);
    };
    const capture = () => {
      clearTimeout(timer.current);
      if (motion.matches || !element.current) {
        setPrevious(null);
        return;
      }
      const artwork = getComputedStyle(element.current);
      const id = ++serial.current;
      setPrevious({
        id,
        style: {
          backgroundImage: artwork.backgroundImage,
          backgroundSize: artwork.backgroundSize,
          backgroundPosition: artwork.backgroundPosition,
          backgroundRepeat: artwork.backgroundRepeat,
        },
      });
      // Animation events can be suppressed when a tab is hidden or styles
      // change. Never leave an old illustration covering the new scene.
      timer.current = setTimeout(() => {
        setPrevious((value) => (value?.id === id ? null : value));
      }, 500);
    };
    const motionChanged = () => {
      if (motion.matches) clear();
    };
    window.addEventListener(APPEARANCE_CHANGE_EVENT, capture);
    motion.addEventListener('change', motionChanged);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener(APPEARANCE_CHANGE_EVENT, capture);
      motion.removeEventListener('change', motionChanged);
    };
  }, []);

  return (
    <div className="pond-scene" aria-hidden="true" ref={element}>
      {previous && (
        <div
          key={previous.id}
          className="pond-scene-previous"
          style={previous.style}
          onAnimationEnd={(event) => {
            if (
              event.target !== event.currentTarget ||
              serial.current !== previous.id
            )
              return;
            clearTimeout(timer.current);
            setPrevious(null);
          }}
        />
      )}
    </div>
  );
}
