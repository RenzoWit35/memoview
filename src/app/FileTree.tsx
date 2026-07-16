import type { TFile } from '@ipc/index';
import { useState } from 'react';
import { vaultRename } from '../ipc/invoke';
import { ROOT_FOLDER, useFolderAccent } from '../state/folders';
import { useWorkspace } from '../state/workspaceStore';
import { useContextMenu } from './ContextMenu';
import { useToast } from './Toast';

function countNotes(file: TFile): number {
  if (!file.isDir) return file.name.endsWith('.md') ? 1 : 0;
  return (file.children ?? []).reduce((sum, c) => sum + countNotes(c), 0);
}

function NoteRow({ file, depth, accent }: { file: TFile; depth: number; accent: string }) {
  const openFile = useWorkspace((s) => s.openFile);
  const refreshTree = useWorkspace((s) => s.refreshTree);
  const searchQuery = useWorkspace((s) => s.searchQuery);
  const activePath = useWorkspace(
    (s) => s.openTabs.find((t) => t.id === s.activeTabId)?.path ?? null,
  );
  const ctx = useContextMenu();
  const toast = useToast();

  const title = file.name.replace(/\.md$/, '');
  const query = searchQuery.trim().toLowerCase();
  const matches = !query || title.toLowerCase().includes(query);
  const isActive = activePath === file.path;

  const handleContextMenu: React.MouseEventHandler = (e) => {
    e.preventDefault();
    ctx.open(e.clientX, e.clientY, [
      {
        label: 'Rename…',
        onClick: () => {
          const next = window.prompt('Rename note', title);
          if (!next || next.trim() === '' || next === title) return;
          const cleaned = next.endsWith('.md') ? next : `${next}.md`;
          const sep = file.path.includes('\\') ? '\\' : '/';
          const parent = file.path.slice(0, file.path.lastIndexOf(sep));
          const dest = `${parent}${sep}${cleaned}`;
          void (async () => {
            try {
              const report = await vaultRename(file.path, dest);
              toast.show(
                report.filesRewritten > 0
                  ? `Renamed; updated ${report.occurrences} link${report.occurrences === 1 ? '' : 's'} in ${report.filesRewritten} file${report.filesRewritten === 1 ? '' : 's'}.`
                  : 'Renamed.',
              );
              await refreshTree();
            } catch (err) {
              toast.show(`Rename failed: ${String(err)}`);
            }
          })();
        },
      },
    ]);
  };

  return (
    <button
      type="button"
      className={`tree-note ${isActive ? 'tree-note--active' : ''}`}
      style={{ paddingLeft: `${34 + Math.max(depth - 1, 0) * 16}px`, opacity: matches ? 1 : 0.35 }}
      onClick={() => openFile(file.path, file.name)}
      onContextMenu={handleContextMenu}
    >
      <span className="tree-note__dot" style={{ background: accent }} />
      <span className="tree-note__title">{title}</span>
    </button>
  );
}

interface FolderNodeProps {
  file: TFile;
  depth: number;
  /** Top-level folder this subtree belongs to; drives accent + graph filter. */
  topFolder: string;
}

function FolderNode({ file, depth, topFolder }: FolderNodeProps) {
  const [expanded, setExpanded] = useState(depth < 1);
  const folderFilter = useWorkspace((s) => s.folderFilter);
  const toggleFolderFilter = useWorkspace((s) => s.toggleFolderFilter);

  const accent = useFolderAccent()(topFolder);
  const isTopLevel = depth === 0;
  const isFiltered = isTopLevel && folderFilter === topFolder;
  const count = countNotes(file);

  const onRowClick = () => {
    // Top-level folders drive the graph's folder filter (per the design);
    // deeper folders just expand/collapse.
    if (isTopLevel) {
      toggleFolderFilter(topFolder);
      if (!expanded) setExpanded(true);
    } else {
      setExpanded((v) => !v);
    }
  };

  return (
    <div className="tree-folder">
      <div
        className={`tree-folder__row ${isFiltered ? 'tree-folder__row--filtered' : ''}`}
        style={{ paddingLeft: `${10 + depth * 16}px` }}
      >
        <button
          type="button"
          className="tree-folder__main"
          onClick={onRowClick}
          title={isTopLevel ? 'Click to focus this folder in the graph' : undefined}
        >
          <span className="msi" style={{ color: accent }}>
            folder
          </span>
          <span className="tree-folder__name">{file.name}</span>
          <span className="tree-folder__count">{count}</span>
        </button>
        <button
          type="button"
          className={`msi tree-folder__chev ${expanded ? '' : 'tree-folder__chev--collapsed'}`}
          aria-label={expanded ? `Collapse ${file.name}` : `Expand ${file.name}`}
          onClick={() => setExpanded((v) => !v)}
        >
          expand_more
        </button>
      </div>
      {expanded
        ? (file.children ?? []).map((child) =>
            child.isDir ? (
              <FolderNode key={child.path} file={child} depth={depth + 1} topFolder={topFolder} />
            ) : (
              <NoteRow key={child.path} file={child} depth={depth + 1} accent={accent} />
            ),
          )
        : null}
    </div>
  );
}

export function FileTree() {
  const tree = useWorkspace((s) => s.tree);
  const rootAccent = useFolderAccent()(ROOT_FOLDER);
  if (tree.length === 0) {
    return <div className="file-tree file-tree--empty">Empty vault.</div>;
  }

  const dirs = tree.filter((f) => f.isDir);
  const rootFiles = tree.filter((f) => !f.isDir);

  return (
    <nav className="file-tree" aria-label="Vault file tree">
      {dirs.map((f) => (
        <FolderNode key={f.path} file={f} depth={0} topFolder={f.name} />
      ))}
      {rootFiles.length > 0 ? (
        <div className="tree-folder">
          {rootFiles.map((f) => (
            <NoteRow key={f.path} file={f} depth={1} accent={rootAccent} />
          ))}
        </div>
      ) : null}
    </nav>
  );
}
