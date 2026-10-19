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
  bindPhraseStop,
  dispatchPhraseStop,
  emptyTray,
  focusTrayTab,
  getTray,
  insertTrayItem,
  removeTrayItem,
  renameTrayItem,
  saveView,
  settleTrayPlay,
  subscribeTray,
  TRAY_UNREADABLE_NOTE,
  trayFilename,
  trayReadable,
  trayRenameCommand,
  trayRenameStart,
  traySaveMessage,
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
  const readable = useSyncExternalStore(
    subscribeTray,
    trayReadable,
    () => true,
  );
  const [entered, setEntered] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [undo, setUndo] = useState<{
    item: TrayItem;
    index: number;
    raw: unknown;
  } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const panelRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const playerRef = useRef<Player | null>(null);
  const playToken = useRef(0);
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
      const index = items.findIndex((node) => node === active);
      if (focusTrayTab(items, index, event.shiftKey)) event.preventDefault();
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
    const unbind = bindPhraseStop(window, 'tray', () => {
      playToken.current += 1;
      playerRef.current?.stop();
      setPlayingId(null);
    });
    return () => {
      playToken.current += 1;
      unbind();
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
      playToken.current += 1;
      playerRef.current?.stop();
      setPlayingId(null);
      return;
    }
    const mine = (playToken.current += 1);
    dispatchPhraseStop(window, 'tray');
    setPlayingId(item.id);
    try {
      const started = await settleTrayPlay({
        mine,
        current: () => playToken.current,
        load: () => import('@/lib/phrase-audio'),
        begin: ({ PhrasePlayer }) => {
          playerRef.current ??= new PhrasePlayer((state) => {
            if (state === 'idle' || state === 'error') setPlayingId(null);
          });
        },
        start: () => {
          const player = playerRef.current;
          if (!player) return Promise.resolve();
          return player.start({
            notes: item.notes,
            bars: item.bars,
            tempo: traySoundingTempo(item.tempo, item.slow),
            swing: item.swing,
            loop: false,
          });
        },
        stop: () => playerRef.current?.stop(),
      });
      if (!started && playToken.current === mine) setPlayingId(null);
    } catch {
      if (playToken.current === mine) setPlayingId(null);
    }
  }

  function focusRename(id: string) {
    requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLButtonElement>(
          `[data-tray-rename="${CSS.escape(id)}"]`,
        )
        ?.focus();
    });
  }

  function focusAfterDelete(nextId: string | null) {
    requestAnimationFrame(() => {
      const root = panelRef.current;
      if (!root) return;
      if (!nextId) {
        root.querySelector<HTMLElement>('#practice-tray-empty')?.focus();
        return;
      }
      root
        .querySelector<HTMLElement>(
          `[data-tray-item="${CSS.escape(nextId)}"] button`,
        )
        ?.focus();
    });
  }

  function beginRename(item: TrayItem) {
    renameCancelled.current = trayRenameStart().cancelled;
    setEditing(item.id);
    setDraft(item.name);
  }

  function commitRename() {
    const next = trayRenameCommand(
      renameCancelled.current,
      'blur',
      Boolean(editing),
    );
    renameCancelled.current = next.cancelled;
    if (!next.commit || !editing) return;
    renameTrayItem(editing, draft);
    setEditing(null);
  }

  function remove(item: TrayItem) {
    const visible = tray.items;
    const index = visible.findIndex((entry) => entry.id === item.id);
    const neighbor = visible[index + 1] ?? visible[index - 1] ?? null;
    if (playingId === item.id) {
      playToken.current += 1;
      playerRef.current?.stop();
      setPlayingId(null);
    }
    const removed = removeTrayItem(item.id);
    if (removed) setUndo(removed);
    if (editing === item.id) setEditing(null);
    if (removed) focusAfterDelete(neighbor?.id ?? null);
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
        aria-label="Close stash"
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
            <h2 id="practice-tray-title">Stash</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="practice-tray-close"
            aria-label="Close stash"
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
              if (!view) return;
              const saved = saveView(view);
              setBanner(traySaveMessage(saved.status, 'view', saved.removed));
            }}
          >
            <Bookmark size={16} aria-hidden="true" /> {bookmarkLabel}
          </button>
          {!view && (
            <p className="practice-tray-intro">
              Open Explore to bookmark a scale or chord.
            </p>
          )}
          {banner && (
            <p className="practice-tray-intro" aria-live="polite">
              {banner}
            </p>
          )}
          {tray.items.length === 0 &&
            (readable ? (
              <>
                <h3
                  id="practice-tray-empty"
                  className="practice-tray-empty"
                  tabIndex={-1}
                >
                  Nothing saved yet
                </h3>
                <p className="practice-tray-intro">
                  Save a phrase from the phrase panel, or bookmark the view you
                  are practicing.
                </p>
              </>
            ) : (
              <p
                id="practice-tray-empty"
                className="practice-tray-intro"
                tabIndex={-1}
              >
                {TRAY_UNREADABLE_NOTE}
              </p>
            ))}
          {groups.map((group) =>
            group.items.length ? (
              <section
                className="practice-tray-group"
                key={group.label}
                aria-label={group.label}
              >
                <h3>{group.label}</h3>
                {group.label === 'Phrases' && (
                  <p className="practice-tray-export-note">
                    Exports ignore swing and half speed.
                  </p>
                )}
                <ul>
                  {group.items.map((item) => (
                    <li
                      className="practice-tray-item"
                      key={item.id}
                      data-tray-item={item.id}
                    >
                      {editing === item.id ? (
                        <input
                          className="practice-tray-rename"
                          value={draft}
                          aria-label={`Rename ${item.name}`}
                          autoFocus
                          maxLength={80}
                          onChange={(event) => setDraft(event.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter' && event.key !== 'Escape')
                              return;
                            const next = trayRenameCommand(
                              renameCancelled.current,
                              event.key,
                              true,
                            );
                            renameCancelled.current = next.cancelled;
                            if (event.key === 'Enter') {
                              event.currentTarget.blur();
                              return;
                            }
                            event.stopPropagation();
                            event.preventDefault();
                            const id = editing;
                            setEditing(null);
                            if (id) focusRename(id);
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
                        <button
                          type="button"
                          data-tray-rename={item.id}
                          onClick={() => beginRename(item)}
                        >
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
                insertTrayItem(undo.item, undo.index, undo.raw);
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
