import type { TFile } from '@ipc/index';
import { useState } from 'react';
import { useWorkspace } from '../state/workspaceStore';

interface NodeProps {
  file: TFile;
  depth: number;
}

function Node({ file, depth }: NodeProps) {
  const [expanded, setExpanded] = useState(depth < 1);
  const openFile = useWorkspace((s) => s.openFile);
  const activePath = useWorkspace(
    (s) => s.openTabs.find((t) => t.id === s.activeTabId)?.path ?? null,
  );

  const indent = { paddingLeft: `${depth * 12 + 8}px` };

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
