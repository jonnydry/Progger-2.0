'use client';

import { SlidersHorizontal } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';

export function NeckDisplay({
  left,
  onLeftChange,
}: {
  left: boolean;
  onLeftChange: (left: boolean) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        className="neck-display-trigger"
        aria-label="Display"
        title="Neck display"
      >
        <SlidersHorizontal size={17} aria-hidden="true" />
        <span>Display</span>
      </PopoverTrigger>
      <PopoverContent
        className="neck-display-panel"
        side="top"
        align="end"
        sideOffset={12}
      >
        <PopoverTitle>Neck display</PopoverTitle>
        <PopoverDescription>
          Set the neck to match your guitar.
        </PopoverDescription>
        <label className="neck-handedness">
          <span>
            Left-handed<small>Mirror the fretboard direction</small>
          </span>
          <input
            type="checkbox"
            checked={left}
            onChange={(event) => onLeftChange(event.target.checked)}
          />
        </label>
        <p className="neck-tuning">
          Standard tuning <span>E A D G B E</span>
        </p>
      </PopoverContent>
    </Popover>
  );
}
