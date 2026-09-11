'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Combobox } from '@base-ui/react/combobox';
import { Check, ChevronDown, Search } from 'lucide-react';
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
  matchesMusicChoice,
  musicChoiceDescription,
  type MusicChoice,
  type MusicSearchKind,
} from '@/lib/music-search';
import './music-select-search.css';

type MusicSelectProps = {
  value: string | null;
  onValueChange: (value: string) => void;
  options: MusicChoice[];
  label: string;
  id?: string;
  style?: CSSProperties;
  placeholder?: string;
  className?: string;
  searchable?: boolean;
  searchKind?: MusicSearchKind;
};

/** Values keep their engine spelling; a new option domain gets a fresh registry. */
export function MusicSelect(props: MusicSelectProps) {
  const domain = `${props.searchKind ?? ''}:${!!props.searchable}:${props.options.map((item) => item.value).join('|')}`;
  const previousDomain = useRef(domain);
  const restoreAfterSelection = useRef(false);
  const wrapper = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Selecting an unusual enharmonic root can remove its temporary menu item.
    // Restore the replacement trigger after that domain change, without moving
    // focus when an unrelated page action switches Scales / Chords.
    if (domain !== previousDomain.current && restoreAfterSelection.current) {
      wrapper.current?.querySelector<HTMLButtonElement>('button')?.focus();
    }
    previousDomain.current = domain;
    restoreAfterSelection.current = false;
  });
  return (
    <div ref={wrapper} className={`music-select ${props.className ?? ''}`}>
      <MusicMenu
        key={domain}
        {...props}
        onValueChange={(next) => {
          restoreAfterSelection.current = next !== props.value;
          props.onValueChange(next);
        }}
      />
    </div>
  );
}

function MusicMenu({
  value,
  onValueChange,
  options,
  label,
  id,
  style,
  placeholder = 'Choose',
  searchable = false,
  searchKind,
}: MusicSelectProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    // Workspace views remain mounted. Portals close when a route hides them.
    const close = () => setOpen(false);
    const observer = new ResizeObserver(() => {
      if (!trigger.current?.getClientRects().length) close();
    });
    if (trigger.current) observer.observe(trigger.current);
    window.addEventListener('hashchange', close);
    return () => {
      observer.disconnect();
      window.removeEventListener('hashchange', close);
    };
  }, [open]);
  const groups = [...new Set(options.map((option) => option.group ?? ''))];
  const finalFocus = () => {
    // A replaced option domain has a new trigger. The old popup's focus manager
    // runs its return-focus cleanup in a microtask; it must not redirect focus
    // into main after the wrapper has already focused that replacement.
    if (!trigger.current?.isConnected) return false;
    return trigger.current.getClientRects().length
      ? true
      : (document.getElementById('main-content') ?? false);
  };
  const selected = options.find((option) => option.value === value);

  if (searchable) {
    const groupedOptions = groups.map((group) => ({
      label: group,
      items: options.filter((option) => (option.group ?? '') === group),
    }));
    return (
      <Combobox.Root<MusicChoice>
        open={open}
        onOpenChange={setOpen}
        value={selected ?? null}
        items={groupedOptions}
        defaultInputValue=""
        autoHighlight
        modal={false}
        filter={(choice, query) =>
          matchesMusicChoice(choice, query, searchKind)
        }
        isItemEqualToValue={(item, current) => item.value === current.value}
        onValueChange={(next) => {
          if (next !== null) onValueChange(next.value);
        }}
      >
        <Combobox.Trigger
          ref={trigger}
          id={id}
          aria-label={label}
          className="music-select-trigger music-search-trigger"
          style={style}
        >
          <span>{selected?.label ?? placeholder}</span>
          <ChevronDown aria-hidden="true" />
        </Combobox.Trigger>
        <Combobox.Portal>
          <Combobox.Positioner
            sideOffset={8}
            align="start"
            className="music-search-positioner"
          >
            <Combobox.Popup
              className="music-search-popup"
              finalFocus={finalFocus}
            >
              <div className="music-search-field">
                <Search aria-hidden="true" size={16} />
                <Combobox.Input
                  aria-label={`Search ${label.toLowerCase()}`}
                  placeholder={
                    searchKind === 'quality'
                      ? 'Name or symbol, e.g. m7♭5'
                      : 'Name or alias, e.g. Aeolian'
                  }
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
              <Combobox.Empty className="music-search-empty">
                No matching {searchKind === 'quality' ? 'chords' : 'scales'}.
                Try another name or clear the search.
              </Combobox.Empty>
              <Combobox.List className="music-search-list">
                {(group: { label: string; items: MusicChoice[] }) => (
                  <Combobox.Group key={group.label} items={group.items}>
                    {group.label && (
                      <Combobox.GroupLabel className="music-search-group-label">
                        {group.label}
                      </Combobox.GroupLabel>
                    )}
                    <Combobox.Collection>
                      {(choice: MusicChoice) => (
                        <Combobox.Item
                          key={choice.value}
                          value={choice}
                          className="music-search-item"
                        >
                          <span>{choice.label}</span>
                          {musicChoiceDescription(choice, searchKind) && (
                            <small>
                              {musicChoiceDescription(choice, searchKind)}
                            </small>
                          )}
                          <Combobox.ItemIndicator className="music-search-check">
                            <Check aria-hidden="true" size={15} />
                          </Combobox.ItemIndicator>
                        </Combobox.Item>
                      )}
                    </Combobox.Collection>
                  </Combobox.Group>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    );
  }
  return (
    <Select
      open={open}
      onOpenChange={setOpen}
      value={value}
      items={options}
      modal={false}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
    >
      <SelectTrigger
        ref={trigger}
        id={id}
        aria-label={label}
        className="music-select-trigger"
        style={style}
      >
        <SelectValue>{selected?.label ?? placeholder}</SelectValue>
      </SelectTrigger>
      <SelectContent
        className="music-select-popup"
        align="start"
        alignItemWithTrigger={false}
        sideOffset={8}
        finalFocus={finalFocus}
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
  );
}
