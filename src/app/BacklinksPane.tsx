import type { BacklinkRef } from '@ipc/index';
import { useEffect, useState } from 'react';
import { graphDeltaBus, graphSnapshotBus } from '../ipc/events';
import { graphBacklinks } from '../ipc/invoke';
import { useWorkspace } from '../state/workspaceStore';

export function BacklinksPane() {
  const activePath = useWorkspace((s) => {
    const t = s.openTabs.find((x) => x.id === s.activeTabId);
    return t?.path ?? null;
  });
  const [items, setItems] = useState<BacklinkRef[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activePath) {
      setItems([]);
      return;
    }
    let cancelled = false;

    const refresh = async () => {
      setLoading(true);
      try {
        const next = await graphBacklinks(activePath);
        if (!cancelled) setItems(next);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void refresh();

    const offDelta = graphDeltaBus.on(() => {
      void refresh();
    });
    const offSnap = graphSnapshotBus.on(() => {
      void refresh();
    });

    return () => {
      cancelled = true;
      offDelta();
      offSnap();
    };
  }, [activePath]);

  if (!activePath) {
    return (
      <aside className="backlinks">
        <header className="backlinks__header">Backlinks</header>
        <div className="backlinks__empty">No file selected.</div>
      </aside>
    );
  }

  const openFile = useWorkspace((s) => s.openFile);

  return (
    <aside className="backlinks">
      <header className="backlinks__header">
        Backlinks
        <span className="backlinks__count">{items.length}</span>
      </header>
      <div className="backlinks__list">
        {loading && items.length === 0 ? (
          <div className="backlinks__empty">Loading…</div>
        ) : items.length === 0 ? (
          <div className="backlinks__empty">No notes link here.</div>
        ) : (
          items.map((b) => {
            const name = basename(b.fromPath);
            return (
              <button
                type="button"
                key={`${b.from}-${b.byteStart}`}
                className="backlinks__row"
                title={b.fromPath}
                onClick={() => openFile(b.fromPath, name)}
              >
                <span className="backlinks__title">{b.fromTitle}</span>
                <span className={`backlinks__kind backlinks__kind--${b.kind}`}>{b.kind}</span>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}
