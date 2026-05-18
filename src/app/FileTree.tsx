import type { TFile } from '@ipc/index';
import { useState } from 'react';
import { vaultRename } from '../ipc/invoke';
import { useWorkspace } from '../state/workspaceStore';
import { useContextMenu } from './ContextMenu';
import { useToast } from './Toast';

interface NodeProps {
  file: TFile;
  depth: number;
}

function Node({ file, depth }: NodeProps) {
  const [expanded, setExpanded] = useState(depth < 1);
  const openFile = useWorkspace((s) => s.openFile);
  const refreshTree = useWorkspace((s) => s.refreshTree);
  const activePath = useWorkspace(
    (s) => s.openTabs.find((t) => t.id === s.activeTabId)?.path ?? null,
  );
  const ctx = useContextMenu();
  const toast = useToast();

  const indent = { paddingLeft: `${depth * 12 + 8}px` };

  const handleContextMenu: React.MouseEventHandler = (e) => {
    if (file.isDir) return;
    e.preventDefault();
    ctx.open(e.clientX, e.clientY, [
      {
        label: 'Rename…',
        onClick: () => {
          const currentName = file.name.replace(/\.md$/, '');
          const next = window.prompt('Rename note', currentName);
          if (!next || next.trim() === '' || next === currentName) return;
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

  if (file.isDir) {
    return (
      <div>
        <button
          type="button"
          className="file-tree__row file-tree__row--dir"
          style={indent}
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="file-tree__chev">{expanded ? '▾' : '▸'}</span>
          <span className="file-tree__name">{file.name}</span>
        </button>
        {expanded && file.children
          ? file.children.map((child) => <Node key={child.path} file={child} depth={depth + 1} />)
          : null}
      </div>
    );
  }

  const isActive = activePath === file.path;
  return (
    <button
      type="button"
      className={`file-tree__row ${isActive ? 'file-tree__row--active' : ''}`}
      style={indent}
      onClick={() => openFile(file.path, file.name)}
      onContextMenu={handleContextMenu}
    >
      <span className="file-tree__name">{file.name.replace(/\.md$/, '')}</span>
    </button>
  );
}

export function FileTree() {
  const tree = useWorkspace((s) => s.tree);
  if (tree.length === 0) {
    return <div className="file-tree file-tree--empty">Empty vault.</div>;
  }
  return (
    <nav className="file-tree" aria-label="Vault file tree">
      {tree.map((f) => (
        <Node key={f.path} file={f} depth={0} />
      ))}
    </nav>
  );
}
