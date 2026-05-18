import { useEffect, useRef, useState } from 'react';
import { type SearchHit, search } from '../ipc/invoke';
import { useWorkspace } from '../state/workspaceStore';

const DEBOUNCE_MS = 120;

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const openFile = useWorkspace((s) => s.openFile);

  // Global hotkey: Cmd/Ctrl + K toggles.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setHits([]);
      setActiveIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    if (!query.trim()) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const next = await search(query, 50);
        setHits(next);
        setActiveIdx(0);
      } catch {
        setHits([]);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, open]);

  if (!open) return null;

  const choose = (h: SearchHit) => {
    const name = h.path.split(/[\\/]/).pop() ?? h.title;
    void openFile(h.path, name);
    setOpen(false);
  };

  const onKey: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const h = hits[activeIdx];
      if (h) choose(h);
    }
  };

  return (
    <div className="palette" aria-label="Quick search">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: dismissal shield; Escape handler is global */}
      <div className="palette__shield" onClick={() => setOpen(false)} role="presentation" />
      <div className="palette__card">
        <input
          ref={inputRef}
          className="palette__input"
          type="text"
          placeholder="Search notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="palette__results">
          {hits.length === 0 && query.trim() ? (
            <div className="palette__empty">No matches.</div>
          ) : (
            hits.map((h, i) => (
              <button
                type="button"
                key={h.path}
                className={`palette__row ${i === activeIdx ? 'palette__row--active' : ''}`}
                onClick={() => choose(h)}
                onMouseEnter={() => setActiveIdx(i)}
              >
                <span className="palette__title">{h.title}</span>
                <span className="palette__snippet">{h.snippet}</span>
              </button>
            ))
          )}
        </div>
        <div className="palette__hint">
          ⌘K to toggle · ↑↓ to navigate · ↵ to open · Esc to close
        </div>
      </div>
    </div>
  );
}
