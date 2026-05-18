import { EditorPane } from '../editor/EditorPane';
import { useWorkspace } from '../state/workspaceStore';
import { BacklinksPane } from './BacklinksPane';
import { FileTree } from './FileTree';

export function Workspace() {
  const { openTabs, activeTabId, setActive, closeTab, vaultRoot } = useWorkspace();
  const activeTab = openTabs.find((t) => t.id === activeTabId) ?? null;

  return (
    <div className="workspace">
      <aside className="workspace__sidebar">
        <header className="workspace__sidebar-header" title={vaultRoot ?? ''}>
          {vaultRoot ? vaultRoot.split(/[\\/]/).pop() : 'No vault'}
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
    </div>
  );
}
