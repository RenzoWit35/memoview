import { useEffect, useMemo, useRef } from 'react';
import ForceGraph3D, { type ForceGraphMethods } from 'react-force-graph-3d';
import { useGraph } from '../state/graphStore';
import { useWorkspace } from '../state/workspaceStore';

interface GraphViewProps {
  onClose(): void;
}

interface Node {
  id: number;
  title: string;
  path: string;
  open: boolean;
}

interface Link {
  source: number;
  target: number;
  kind: string;
  active: boolean;
}

export default function GraphView({ onClose }: GraphViewProps) {
  const notes = useGraph((s) => s.notes);
  const edges = useGraph((s) => s.edges);
  const openTabs = useWorkspace((s) => s.openTabs);
  const openFile = useWorkspace((s) => s.openFile);
  const fgRef = useRef<ForceGraphMethods<Node, Link> | undefined>(undefined);

  const openPaths = useMemo(() => new Set(openTabs.map((t) => t.path)), [openTabs]);

  const data = useMemo(() => {
    const nodes: Node[] = Array.from(notes.values()).map((n) => ({
      id: n.id,
      title: n.title,
      path: n.path,
      open: openPaths.has(n.path),
    }));
    const idToOpen = new Map(nodes.map((n) => [n.id, n.open] as const));
    const links: Link[] = Array.from(edges.values()).map((e) => ({
      source: e.from,
      target: e.to,
      kind: e.kind,
      active: !!idToOpen.get(e.from) || !!idToOpen.get(e.to),
    }));
    return { nodes, links };
  }, [notes, edges, openPaths]);

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="graph-view">
      <header className="graph-view__header">
        <span className="graph-view__title">Graph</span>
        <span className="graph-view__count">
          {data.nodes.length} notes · {data.links.length} links
        </span>
        <button
          type="button"
          className="graph-view__close"
          onClick={onClose}
          aria-label="Close graph"
        >
          ×
        </button>
      </header>
      <div className="graph-view__canvas">
        <ForceGraph3D<Node, Link>
          ref={fgRef}
          graphData={data}
          backgroundColor="#14171c"
          nodeId="id"
          nodeLabel={(n) => n.title}
          nodeRelSize={5}
          nodeColor={(n) => (n.open ? '#7dd3fc' : 'rgba(138, 147, 163, 0.55)')}
          linkColor={(l) => (l.active ? '#7dd3fc' : 'rgba(61, 68, 82, 0.35)')}
          linkWidth={(l) => (l.active ? 2 : 0.4)}
          linkDirectionalParticles={(l) => (l.active ? 2 : 0)}
          linkDirectionalParticleSpeed={0.006}
          enableNodeDrag={false}
          onNodeClick={(n) => {
            const name = n.path.split(/[\\/]/).pop() ?? n.title;
            void openFile(n.path, name);
            onClose();
          }}
        />
      </div>
      <footer className="graph-view__hint">click a node to open · esc to close</footer>
    </div>
  );
}
