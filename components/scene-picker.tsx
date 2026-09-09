'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  chooseScene,
  currentScene,
  SCENES,
  subscribeScene,
  warmScene,
  type Scene,
} from '@/lib/theme';

export function ScenePicker() {
  const scene = useSyncExternalStore<Scene>(
    subscribeScene,
    currentScene,
    () => 'pond',
  );
  const [pending, setPending] = useState<Scene | null>(null);
  const request = useRef(0);
  const selected = SCENES.find((item) => item.id === scene) ?? SCENES[0];

  return (
    <Select
      value={scene}
      items={SCENES.map((item) => ({ value: item.id, label: item.label }))}
      modal={false}
      onValueChange={async (value) => {
        const choice = SCENES.find((item) => item.id === value);
        if (!choice) return;
        const id = ++request.current;
        setPending(choice.id);
        try {
          await chooseScene(choice.id);
        } finally {
          if (id === request.current) setPending(null);
        }
      }}
    >
      <SelectTrigger
        className="scene-trigger"
        aria-label={`Scene: ${selected.label}`}
        aria-busy={pending !== null}
        title={`Choose a scene · ${selected.label}`}
      >
        <span className="scene-trigger-mobile" aria-hidden="true">
          Scene
        </span>
        <SelectValue className="scene-trigger-name">
          {selected.label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        className="scene-popup"
        align="end"
        alignItemWithTrigger={false}
        sideOffset={10}
        aria-label="Choose a scene"
      >
        <SelectGroup>
          <SelectLabel>Set the scene</SelectLabel>
          {SCENES.map((item) => (
            <SelectItem
              key={item.id}
              value={item.id}
              className="scene-option"
              onPointerEnter={() => void warmScene(item.id)}
              onFocus={() => void warmScene(item.id)}
            >
              <span className="scene-option-copy">
                <span className="scene-option-name">{item.label}</span>
                <span className="scene-option-description">
                  {item.description}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
