'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { ScenePicker } from '@/components/scene-picker';
import {
  chooseTheme,
  currentTheme,
  subscribeTheme,
  warmTheme,
} from '@/lib/theme';

export function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeTheme,
    currentTheme,
    () => 'night',
  );
  const [pending, setPending] = useState(false);
  const changing = useRef(false);
  const next = theme === 'day' ? 'night' : 'day';
  return (
    <fieldset className="appearance-controls" aria-label="Appearance">
      <ScenePicker />
      <button
        type="button"
        className="theme-toggle"
        role="switch"
        aria-label="Day theme"
        aria-checked={theme === 'day'}
        aria-busy={pending}
        aria-disabled={pending}
        title={`Switch to ${next} theme`}
        onPointerEnter={() => {
          void warmTheme(next);
        }}
        onFocus={() => {
          void warmTheme(next);
        }}
        onClick={async () => {
          if (changing.current) return;
          changing.current = true;
          setPending(true);
          try {
            await chooseTheme(next);
          } finally {
            changing.current = false;
            setPending(false);
          }
        }}
      >
        <Sun className="theme-icon-sun" size={20} aria-hidden="true" />
        <span className="theme-switch-track" aria-hidden="true">
          <span className="theme-switch-thumb" />
        </span>
        <Moon className="theme-icon-moon" size={20} aria-hidden="true" />
      </button>
    </fieldset>
  );
}
