'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUpRight,
  Bookmark,
  Download,
  FileText,
  Pencil,
  Play,
  Square,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { QUALITIES } from '@/lib/harmony';
import { SCALES, pretty } from '@/lib/music';
import { encodePhraseMidi } from '@/lib/tray-midi';
import { phraseTabText } from '@/lib/tray-tab';
import {
  PHRASE_STOP_EVENT,
  emptyTray,
  getTray,
  insertTrayItem,
  removeTrayItem,
  renameTrayItem,
  saveView,
  subscribeTray,
  trayFilename,
  traySoundingTempo,
  type TrayChordBookmark,
  type TrayItem,
  type TrayLiveView,
  type TrayPhrase,
  type TrayScaleBookmark,
} from '@/lib/tray';

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

type Player = {
  start(input: {
    notes: TrayPhrase['notes'];
    bars: 2 | 4;
    tempo: number;
    swing: number;
    loop: boolean;
  }): Promise<void>;
  stop(): void;
  dispose(): void;
};

function scaleMeta(item: TrayScaleBookmark): string {
  const scale = SCALES.find((entry) => entry.id === item.scaleId);
  const where =
    item.view === 'pattern' ? `form ${item.position + 1}` : 'full neck';
  const chord = item.chord ? ` · ${pretty(item.chord.symbol)}` : '';
  return `${pretty(item.scaleRoot)} ${scale?.name ?? 'scale'} · ${where}${chord}`;
}

function chordMeta(item: TrayChordBookmark): string {
  const quality = QUALITIES.find((entry) => entry.id === item.qualityId);
  const symbol = pretty(`${item.chordRoot}${quality?.symbol ?? ''}`);
  const where =
    item.chordView === 'shape' ? `shape ${item.voicingIndex + 1}` : 'all tones';
  return `${symbol} · ${quality?.name ?? 'chord'} · ${where}`;
}

function phraseMeta(item: TrayPhrase): string {
  const tempo = Math.round(traySoundingTempo(item.tempo, item.slow));
  const chord = item.chord
    ? pretty(item.chord.symbol)
    : `${pretty(item.key)} tonic`;
  const speed = item.slow ? ' · half speed' : '';
  return `${pretty(item.key)} ${item.scaleName} · ${chord} · ${item.bars} bars · ${tempo} BPM${speed}`;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function PracticeTray({
  view,
  onRestore,
  onClose,
}: {
  view: TrayLiveView | null;
  onRestore: (item: TrayItem) => void;
  onClose: () => void;
}) {
  const tray = useSyncExternalStore(subscribeTray, getTray, emptyTray);
  const [entered, setEntered] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [undo, setUndo] = useState<{ item: TrayItem; index: number } | null>(
    null,
  );
  const panelRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const playerRef = useRef<Player | null>(null);
  const closeAction = useRef(onClose);
  const renameCancelled = useRef(false);

  useEffect(() => {
    closeAction.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const panel = panelRef.current;
    const opener = document.activeElement;
    const root = panel?.closest('.practice-tray-root');
    const covered: HTMLElement[] = [];
    for (const child of document.body.children) {
      if (!(child instanceof HTMLElement) || child === root) continue;
      if (child.hasAttribute('inert')) continue;
      child.setAttribute('inert', '');
      covered.push(child);
    }
    closeRef.current?.focus();
    const frame = requestAnimationFrame(() => setEntered(true));
    function focusable(): HTMLElement[] {
      if (!panel) return [];
      return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (node) => !node.hasAttribute('disabled'),
      );
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        const target = event.target;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement
        )
          return;
        event.preventDefault();
        closeAction.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      const inside = active instanceof Node && !!panel?.contains(active);
      if (!inside) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
      for (const child of covered) child.removeAttribute('inert');
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    const onStop = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === 'tray') return;
      playerRef.current?.stop();
      setPlayingId(null);
    };
    window.addEventListener(PHRASE_STOP_EVENT, onStop);
    return () => {
      window.removeEventListener(PHRASE_STOP_EVENT, onStop);
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), 5000);
    return () => window.clearTimeout(timer);
  }, [undo]);

  async function togglePlay(item: TrayPhrase) {
    if (playingId === item.id) {
      playerRef.current?.stop();
      setPlayingId(null);
      return;
    }
    window.dispatchEvent(
      new CustomEvent(PHRASE_STOP_EVENT, { detail: 'tray' }),
    );
    setPlayingId(item.id);
    try {
      const { PhrasePlayer } = await import('@/lib/phrase-audio');
      playerRef.current ??= new PhrasePlayer((state) => {
        if (state === 'idle' || state === 'error') setPlayingId(null);
      });
      await playerRef.current.start({
        notes: item.notes,
        bars: item.bars,
        tempo: traySoundingTempo(item.tempo, item.slow),
        swing: item.swing,
        loop: false,
      });
    } catch {
      setPlayingId(null);
    }
  }

  function beginRename(item: TrayItem) {
    setEditing(item.id);
    setDraft(item.name);
  }

  function commitRename() {
    if (renameCancelled.current) {
      renameCancelled.current = false;
      return;
    }
    if (!editing) return;
    renameTrayItem(editing, draft);
    setEditing(null);
  }

  function remove(item: TrayItem) {
    if (playingId === item.id) {
      playerRef.current?.stop();
      setPlayingId(null);
    }
    const removed = removeTrayItem(item.id);
    if (removed) setUndo(removed);
    if (editing === item.id) setEditing(null);
  }

  const groups: { label: string; items: TrayItem[] }[] = [
    {
      label: 'Phrases',
      items: tray.items.filter((item) => item.type === 'phrase'),
    },
    {
      label: 'Scales',
      items: tray.items.filter((item) => item.type === 'scale'),
    },
    {
      label: 'Chords',
      items: tray.items.filter((item) => item.type === 'chord'),
    },
  ];
  const bookmarkLabel =
    view?.kind === 'chord'
      ? 'Bookmark this chord'
      : view?.kind === 'scale'
        ? 'Bookmark this scale'
        : 'Bookmark this view';

  const panel = (
    <div className={`practice-tray-root${entered ? ' is-in' : ''}`}>
      <button
        type="button"
        className="practice-tray-backdrop"
        aria-label="Close practice tray"
        tabIndex={-1}
        onClick={() => closeAction.current()}
      />
      <dialog
        id="practice-tray"
        ref={panelRef}
        className="practice-tray-panel"
        open
        aria-modal="true"
        aria-labelledby="practice-tray-title"
      >
        <div className="practice-tray-head">
          <div>
            <p className="practice-tray-kicker">Practice</p>
            <h2 id="practice-tray-title">Tray</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="practice-tray-close"
            aria-label="Close practice tray"
            onClick={() => closeAction.current()}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="practice-tray-body">
          <p className="practice-tray-intro">
            Saved on this device. Phrases keep their notes, so opening one does
            not generate a new line.
          </p>
          <button
            type="button"
            className="practice-tray-bookmark"
            disabled={!view}
            onClick={() => {
              if (view) saveView(view);
            }}
          >
            <Bookmark size={16} aria-hidden="true" /> {bookmarkLabel}
          </button>
          {!view && (
            <p className="practice-tray-intro">
              Open Explore to bookmark a scale or chord.
            </p>
          )}
          {tray.items.length === 0 && (
            <p className="practice-tray-intro">
              Nothing saved yet. Save a phrase from the phrase panel, or
              bookmark the view you are practicing.
            </p>
          )}
          {groups.map((group) =>
            group.items.length ? (
              <section
                className="practice-tray-group"
                key={group.label}
                aria-label={group.label}
              >
                <h3>{group.label}</h3>
                <ul>
                  {group.items.map((item) => (
                    <li className="practice-tray-item" key={item.id}>
                      {editing === item.id ? (
                        <input
                          className="practice-tray-rename"
                          value={draft}
                          aria-label={`Rename ${item.name}`}
                          autoFocus
                          onChange={(event) => setDraft(event.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.currentTarget.blur();
                            }
                            if (event.key === 'Escape') {
                              event.stopPropagation();
                              event.preventDefault();
                              renameCancelled.current = true;
                              setEditing(null);
                            }
                          }}
                        />
                      ) : (
                        <p className="practice-tray-name">{item.name}</p>
                      )}
                      <p className="practice-tray-meta">
                        {item.type === 'phrase'
                          ? phraseMeta(item)
                          : item.type === 'scale'
                            ? scaleMeta(item)
                            : chordMeta(item)}
                      </p>
                      <div className="practice-tray-actions">
                        {item.type === 'phrase' && (
                          <button
                            type="button"
                            aria-pressed={playingId === item.id}
                            onClick={() => void togglePlay(item)}
                          >
                            {playingId === item.id ? (
                              <Square size={14} aria-hidden="true" />
                            ) : (
                              <Play size={14} aria-hidden="true" />
                            )}
                            {playingId === item.id ? 'Stop' : 'Play'}
                          </button>
                        )}
                        <button type="button" onClick={() => onRestore(item)}>
                          <ArrowUpRight size={14} aria-hidden="true" /> Open
                        </button>
                        {item.type === 'phrase' && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                const tempo = traySoundingTempo(
                                  item.tempo,
                                  false,
                                );
                                const text = phraseTabText({
                                  title: `${item.name} · seed ${item.seed}`,
                                  tempo,
                                  notes: item.notes,
                                });
                                downloadBlob(
                                  trayFilename(item.name, 'txt'),
                                  new Blob([text], {
                                    type: 'text/plain;charset=utf-8',
                                  }),
                                );
                              }}
                            >
                              <FileText size={14} aria-hidden="true" /> Tab
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const bytes = encodePhraseMidi({
                                  tempo: traySoundingTempo(item.tempo, false),
                                  notes: item.notes,
                                });
                                const copy = Uint8Array.from(bytes);
                                downloadBlob(
                                  trayFilename(item.name, 'mid'),
                                  new Blob([copy], { type: 'audio/midi' }),
                                );
                              }}
                            >
                              <Download size={14} aria-hidden="true" /> MIDI
                            </button>
                          </>
                        )}
                        <button type="button" onClick={() => beginRename(item)}>
                          <Pencil size={14} aria-hidden="true" /> Rename
                        </button>
                        <button type="button" onClick={() => remove(item)}>
                          <Trash2 size={14} aria-hidden="true" /> Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null,
          )}
        </div>
        {undo && (
          <div className="practice-tray-toast" aria-live="polite">
            <p>Removed {undo.item.name}.</p>
            <button
              type="button"
              onClick={() => {
                insertTrayItem(undo.item, undo.index);
                setUndo(null);
              }}
            >
              <Undo2 size={14} aria-hidden="true" /> Undo
            </button>
          </div>
        )}
      </dialog>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(panel, document.body);
}
