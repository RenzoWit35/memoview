import { EditorPane } from '../editor/EditorPane';
import { vaultCreateFolder, vaultCreateNote } from '../ipc/invoke';
import { folderOf, useFolderAccent } from '../state/folders';
import { outgoingNotes, useGraph } from '../state/graphStore';
import { type Tab, useWorkspace } from '../state/workspaceStore';
import { BacklinksPane } from './BacklinksPane';
import { FileTree } from './FileTree';
import { GraphView, useGraphView } from './GraphView';
import { useToast } from './Toast';

function Sidebar() {
  const vaultRoot = useWorkspace((s) => s.vaultRoot);
  const searchQuery = useWorkspace((s) => s.searchQuery);
  const setSearchQuery = useWorkspace((s) => s.setSearchQuery);
  const refreshTree = useWorkspace((s) => s.refreshTree);
  const openFile = useWorkspace((s) => s.openFile);
  const toast = useToast();
  const vaultName = vaultRoot ? (vaultRoot.split(/[\\/]/).pop() ?? vaultRoot) : 'No vault';

  const createNote = () => {
    if (!vaultRoot) return;
    const name = window.prompt('New note name', 'Untitled');
    if (!name || name.trim() === '') return;
    void (async () => {
      try {
        const file = await vaultCreateNote(vaultRoot, name.trim());
        await refreshTree();
        await openFile(file.path, file.name);
      } catch (err) {
        toast.show(`Create note failed: ${String(err)}`);
      }
    })();
  };

  const createFolder = () => {
    if (!vaultRoot) return;
    const name = window.prompt('New folder name', 'New folder');
    if (!name || name.trim() === '') return;
    void (async () => {
      try {
        await vaultCreateFolder(vaultRoot, name.trim());
        await refreshTree();
      } catch (err) {
        toast.show(`Create folder failed: ${String(err)}`);
      }
    })();
  };

  return (
    <aside className="sidebar">
      <div className="sidebar__header" title={vaultRoot ?? ''}>
        <div className="logo-orb">
          <span className="msi">deployed_code</span>
        </div>
        <div>
          <div className="sidebar__app-name">memoview</div>
          <div className="sidebar__vault-name">{vaultName}</div>
        </div>
      </div>
      <div className="sidebar__search">
        <div className="sidebar__search-box">
          <span className="msi">search</span>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search notes…"
            aria-label="Search notes"
          />
        </div>
      </div>
      <div className="sidebar__actions">
        <button
          type="button"
          className="sidebar__action-btn"
          onClick={createNote}
          title="Create a new note in the vault root"
        >
          <span className="msi">note_add</span>
          New note
        </button>
        <button
          type="button"
          className="sidebar__action-btn"
          onClick={createFolder}
          title="Create a new folder in the vault root"
        >
          <span className="msi">create_new_folder</span>
          New folder
        </button>
      </div>
      <FileTree />
    </aside>
  );
}

function TabStrip() {
  const openTabs = useWorkspace((s) => s.openTabs);
  const activeTabId = useWorkspace((s) => s.activeTabId);
  const setActive = useWorkspace((s) => s.setActive);
  const closeTab = useWorkspace((s) => s.closeTab);

  return (
    <div className="tab-strip" role="tablist">
      {openTabs.map((t) => (
        <div key={t.id} className={`tab ${t.id === activeTabId ? 'tab--active' : ''}`}>
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
            className="tab__close msi"
            aria-label={`Close ${t.name}`}
            onClick={() => closeTab(t.id)}
          >
            close
          </button>
        </div>
      ))}
    </div>
  );
}

function GraphTopBar() {
  const layout = useGraphView((s) => s.layout);
  const setLayout = useGraphView((s) => s.setLayout);
  const physicsOn = useGraphView((s) => s.physicsOn);
  const togglePhysics = useGraphView((s) => s.togglePhysics);
  const resetSim = useGraphView((s) => s.resetSim);

  return (
    <>
      <div className="graph-header">
        <span className="msi">hub</span>
        <div className="graph-header__title">Graph view</div>
        <div className="graph-header__hint">
          Bubble size = total links · double-click to open · drag to nudge · scroll to zoom
        </div>
      </div>
      <div className="segmented">
        <button
          type="button"
          className={`segmented__option ${layout === 'orbit' ? 'segmented__option--active' : ''}`}
          onClick={() => setLayout('orbit')}
        >
          Orbit
        </button>
        <button
          type="button"
          className={`segmented__option ${layout === 'depth' ? 'segmented__option--active' : ''}`}
          onClick={() => setLayout('depth')}
        >
          Depth field
        </button>
      </div>
      <div className="segmented">
        <button
          type="button"
          title="Play/pause physics"
          className="segmented__icon-btn msi"
          onClick={togglePhysics}
        >
          {physicsOn ? 'pause' : 'play_arrow'}
        </button>
        <button
          type="button"
          title="Reset positions"
          className="segmented__icon-btn msi"
          onClick={resetSim}
        >
          restart_alt
        </button>
      </div>
    </>
  );
}

function TopBar() {
  const view = useWorkspace((s) => s.view);
  const toggleView = useWorkspace((s) => s.toggleView);
  const isEditor = view === 'editor';

  return (
    <div className="topbar">
      {isEditor ? <TabStrip /> : <GraphTopBar />}
      <button
        type="button"
        className={`view-toggle ${isEditor ? '' : 'view-toggle--primary'}`}
        onClick={toggleView}
      >
        <span className="msi">{isEditor ? 'hub' : 'edit_note'}</span>
        {isEditor ? 'Graph view' : 'Editor'}
      </button>
    </div>
  );
}

function LinksOut({ path }: { path: string }) {
  const notes = useGraph((s) => s.notes);
  const edges = useGraph((s) => s.edges);
  const vaultRoot = useWorkspace((s) => s.vaultRoot);
  const openFile = useWorkspace((s) => s.openFile);
  const accentOf = useFolderAccent();

  const targets = outgoingNotes(notes, edges, path);
  if (targets.length === 0) return null;

  return (
    <div className="links-out">
      <div className="links-out__label">Links out</div>
      <div className="links-out__chips">
        {targets.map((n) => (
          <button
            type="button"
            key={n.id}
            className="link-chip"
            onClick={() => openFile(n.path, n.path.split(/[\\/]/).pop() ?? n.title)}
          >
            <span
              className="link-chip__dot"
              style={{ background: accentOf(folderOf(n.path, vaultRoot)) }}
            />
            {n.title}
          </button>
        ))}
      </div>
    </div>
  );
}

function NoteSheet({ tab }: { tab: Tab }) {
  const vaultRoot = useWorkspace((s) => s.vaultRoot);
  const accentOf = useFolderAccent();
  const folder = folderOf(tab.path, vaultRoot);

  return (
    <div className="note-sheet">
      <div className="note-eyebrow" style={{ color: accentOf(folder) }}>
        {folder}
      </div>
      <h1 className="note-title">{tab.name.replace(/\.md$/, '')}</h1>
      <EditorPane key={tab.id} tab={tab} />
      <LinksOut path={tab.path} />
    </div>
  );
}

export function Workspace() {
  const view = useWorkspace((s) => s.view);
  const openTabs = useWorkspace((s) => s.openTabs);
  const activeTabId = useWorkspace((s) => s.activeTabId);
  const activeTab = openTabs.find((t) => t.id === activeTabId) ?? null;

  return (
    <div className="shell">
      <Sidebar />
      <div className="main">
        <TopBar />
        <div className="main__content">
          {view === 'editor' ? (
            <div className="editor-layout">
              <div className="note-scroll">
                {activeTab ? (
                  <NoteSheet tab={activeTab} />
                ) : (
                  <div className="empty-state">Select a note from the sidebar.</div>
                )}
              </div>
              <BacklinksPane />
            </div>
          ) : (
            <GraphView />
          )}
        </div>
      </div>
    </div>
  );
}
