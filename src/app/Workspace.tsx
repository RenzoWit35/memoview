import { Suspense, lazy, useEffect, useState } from 'react';
import { EditorPane } from '../editor/EditorPane';
import { useWorkspace } from '../state/workspaceStore';
import { BacklinksPane } from './BacklinksPane';
import { FileTree } from './FileTree';

const GraphView = lazy(() => import('./GraphView'));

export function Workspace() {
  const { openTabs, activeTabId, setActive, closeTab, vaultRoot } = useWorkspace();
  const activeTab = openTabs.find((t) => t.id === activeTabId) ?? null;
  const [graphOpen, setGraphOpen] = useState(false);

  // Cmd/Ctrl-G toggles the 3D graph view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        setGraphOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="workspace">
      <aside className="workspace__sidebar">
        <header className="workspace__sidebar-header" title={vaultRoot ?? ''}>
          <span className="workspace__vault-name">
            {vaultRoot ? vaultRoot.split(/[\\/]/).pop() : 'No vault'}
          </span>
          <button
            type="button"
            className="workspace__icon-btn"
            title="Open graph view (⌘G)"
            aria-label="Open graph view"
            onClick={() => setGraphOpen(true)}
          >
            ⌾
          </button>
        </header>
        <FileTree />
      </aside>
      <main className="workspace__main">
        <div className="tab-strip" role="tablist">
          {openTabs.map((t) => (
            <span key={t.id} className={`tab ${t.id === activeTabId ? 'tab--active' : ''}`}>
              <button
                type="button"
                role="tab"
                aria-selected={t.id === activeTabId}
                className="tab__label"
                onClick={() => setActive(t.id)}
              >
                {t.name.replace(/\.md$/, '')}
              </button>
              <button
                type="button"
                className="tab__close"
                aria-label={`Close ${t.name}`}
                onClick={() => closeTab(t.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="workspace__content">
          {activeTab ? (
            <EditorPane key={activeTab.id} tab={activeTab} />
          ) : (
            <div className="empty-state">Select a note from the sidebar.</div>
          )}
        </div>
      </main>
      <BacklinksPane />

      {graphOpen ? (
        <Suspense fallback={<div className="graph-view graph-view--loading">Loading graph…</div>}>
          <GraphView onClose={() => setGraphOpen(false)} />
        </Suspense>
      ) : null}
    </div>
  );
}
