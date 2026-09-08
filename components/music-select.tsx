'use client';

import type { CSSProperties } from 'react';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Choice = { value: string; label: string; group?: string };

/** A shared, keyboard-accessible menu for musical choices. Values keep their engine spelling. */
export function MusicSelect({
  value,
  onValueChange,
  options,
  label,
  id,
  style,
  placeholder = 'Choose',
  className = '',
}: {
  value: string | null;
  onValueChange: (value: string) => void;
  options: Choice[];
  label: string;
  id?: string;
  style?: CSSProperties;
  placeholder?: string;
  className?: string;
}) {
  const groups = [...new Set(options.map((option) => option.group ?? ''))];
  return (
    <div className={`music-select ${className}`}>
      <Select
        value={value}
        items={options}
        modal={false}
        onValueChange={(next) => {
          if (next !== null) onValueChange(next);
        }}
      >
        <SelectTrigger
          id={id}
          aria-label={label}
          className="music-select-trigger"
          style={style}
        >
          <SelectValue>
            {options.find((option) => option.value === value)?.label ??
              placeholder}
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          className="music-select-popup"
          align="start"
          alignItemWithTrigger={false}
          sideOffset={8}
        >
          {groups.map((group) => (
            <SelectGroup key={group}>
              {group && <SelectLabel>{group}</SelectLabel>}
              {options
                .filter((option) => (option.group ?? '') === group)
                .map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
