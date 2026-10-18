'use client';

import { useState, useSyncExternalStore, type ComponentType } from 'react';
import { Library } from 'lucide-react';
import {
  emptyTray,
  getTray,
  subscribeTray,
  type TrayItem,
  type TrayLiveView,
} from '@/lib/tray';
import '@/app/practice-tray.css';

type PanelProps = {
  view: TrayLiveView | null;
  onRestore: (item: TrayItem) => void;
  onClose: () => void;
};

export function PracticeTrayHost({
  view,
  onRestore,
}: {
  view: TrayLiveView | null;
  onRestore: (item: TrayItem) => void;
}) {
  const tray = useSyncExternalStore(subscribeTray, getTray, emptyTray);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [Panel, setPanel] = useState<ComponentType<PanelProps> | null>(null);
  const count = tray.items.length;

  function openTray() {
    setOpen(true);
    setFailed(false);
    if (Panel) return;
    void import('@/components/practice-tray')
      .then((module) => {
        setPanel(() => module.PracticeTray);
      })
      .catch(() => {
        setFailed(true);
      });
  }

  return (
    <>
      <button
        type="button"
        className="tray-open"
        aria-expanded={open}
        aria-controls={open ? 'practice-tray' : undefined}
        aria-label={count ? `Stash, ${count} saved` : 'Stash'}
        onClick={() => (open ? setOpen(false) : openTray())}
      >
        <Library size={18} aria-hidden="true" />
        <span className="tray-open-label">Stash</span>
      </button>
      {open && failed && (
        <p className="sr-only" role="alert">
          The stash did not load. Try again.
        </p>
      )}
      {open && Panel && (
        <Panel
          view={view}
          onRestore={(item) => {
            onRestore(item);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
