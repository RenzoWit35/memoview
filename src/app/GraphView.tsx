import type { NoteId } from '@ipc/index';
import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { vaultRead } from '../ipc/invoke';
import { clamp, folderOf, hexToRgba, lighten, rand01, useFolderAccent } from '../state/folders';
import { useGraph } from '../state/graphStore';
import { useWorkspace } from '../state/workspaceStore';

export type GraphLayout = 'orbit' | 'depth';

interface GraphViewSettings {
  layout: GraphLayout;
  physicsOn: boolean;
  /** Bumped by the top-bar reset button; re-seeds node positions. */
  resetNonce: number;
  setLayout(layout: GraphLayout): void;
  togglePhysics(): void;
  resetSim(): void;
}

/** Graph settings live in a store so the top bar can drive the canvas. */
export const useGraphView = create<GraphViewSettings>((set) => ({
  layout: 'orbit',
  physicsOn: true,
  resetNonce: 0,
  setLayout(layout) {
    set((s) => ({ layout, resetNonce: s.resetNonce + 1 }));
  },
  togglePhysics() {
    set((s) => ({ physicsOn: !s.physicsOn }));
  },
  resetSim() {
    set((s) => ({ resetNonce: s.resetNonce + 1 }));
  },
}));

interface GraphItem {
  id: NoteId;
  title: string;
  path: string;
  name: string;
  folder: string;
  accent: string;
  linkCount: number;
  ring: number;
  ringIndex: number;
  ringCount: number;
}

interface SimNode {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
}

const RING_RADIUS = [14, 30, 44];

const FORCE_PARAMS: Record<
  GraphLayout,
  {
    centerPull: number;
    repulsion: number;
    tether: number;
    idealLength: number;
    damping: number;
  }
> = {
  orbit: { centerPull: 0.00055, repulsion: 85, tether: 0.009, idealLength: 16, damping: 0.945 },
  depth: { centerPull: 0.00028, repulsion: 70, tether: 0.005, idealLength: 26, damping: 0.955 },
};

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.2;

function baseLayout(item: GraphItem, mode: GraphLayout): SimNode {
  const seed = item.path;
  if (mode === 'orbit') {
    const angle =
      (item.ringIndex / Math.max(item.ringCount, 1)) * Math.PI * 2 + rand01(`${seed}a`) * 0.6;
    const r = (RING_RADIUS[item.ring] ?? 44) + (rand01(`${seed}r`) - 0.5) * 6;
    const x = 50 + Math.cos(angle) * r;
    const y = 50 + Math.sin(angle) * r * 0.82;
    const z = 1 - item.ring * 0.28 + rand01(`${seed}z`) * 0.12;
    return { x: clamp(x, 6, 94), y: clamp(y, 8, 92), z: clamp(z, 0.35, 1), vx: 0, vy: 0 };
  }
  return {
    x: 10 + rand01(`${seed}dx`) * 80,
    y: 10 + rand01(`${seed}dy`) * 80,
    z: 0.28 + rand01(`${seed}dz`) * 0.72,
    vx: 0,
    vy: 0,
  };
}

/** First meaningful line of a note body, markdown noise stripped. */
function extractSnippet(content: string): string {
  let body = content;
  const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(body);
  if (fm) body = body.slice(fm[0].length);
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine
      .replace(/^#{1,6}\s+/, '')
      .replace(/!?\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`>]/g, '')
      .trim();
    if (line) return line.length > 140 ? `${line.slice(0, 139)}…` : line;
  }
  return '';
}

export function GraphView() {
  const notes = useGraph((s) => s.notes);
  const edges = useGraph((s) => s.edges);
  const vaultRoot = useWorkspace((s) => s.vaultRoot);
  const openFile = useWorkspace((s) => s.openFile);
  const searchQuery = useWorkspace((s) => s.searchQuery);
  const folderFilter = useWorkspace((s) => s.folderFilter);
  const clearFolderFilter = useWorkspace((s) => s.clearFolderFilter);
  const layout = useGraphView((s) => s.layout);
  const resetNonce = useGraphView((s) => s.resetNonce);
  const accentOf = useFolderAccent();

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const simRef = useRef<Map<NoteId, SimNode>>(new Map());
  const draggingRef = useRef<NoteId | null>(null);
  const panStateRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const snippetsRef = useRef<Map<string, string>>(new Map());

  const [, setFrame] = useState(0);
  const [hoveredId, setHoveredId] = useState<NoteId | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // ---- data prep -----------------------------------------------------------

  const { items, edgeList, maxLinks } = useMemo(() => {
    const neighbors = new Map<NoteId, Set<NoteId>>();
    for (const id of notes.keys()) neighbors.set(id, new Set());
    for (const e of edges.values()) {
      if (e.from === e.to) continue;
      neighbors.get(e.from)?.add(e.to);
      neighbors.get(e.to)?.add(e.from);
    }

    const base = Array.from(notes.values()).map((n) => {
      const folder = folderOf(n.path, vaultRoot);
      return {
        id: n.id,
        title: n.title,
        path: n.path,
        name: n.path.split(/[\\/]/).pop() ?? n.title,
        folder,
        accent: accentOf(folder),
        linkCount: neighbors.get(n.id)?.size ?? 0,
      };
    });

    const ranked = base.slice().sort((a, b) => b.linkCount - a.linkCount);
    const ringOf = new Map<NoteId, number>();
    ranked.forEach((n, i) => {
      const frac = i / Math.max(ranked.length - 1, 1);
      ringOf.set(n.id, frac < 0.2 ? 0 : frac < 0.55 ? 1 : 2);
    });
    const ringCounts = new Map<number, number>();
    const ringIndexOf = new Map<NoteId, number>();
    for (const n of ranked) {
      const ring = ringOf.get(n.id) ?? 2;
      ringIndexOf.set(n.id, ringCounts.get(ring) ?? 0);
      ringCounts.set(ring, (ringCounts.get(ring) ?? 0) + 1);
    }

    const items: GraphItem[] = base.map((n) => {
      const ring = ringOf.get(n.id) ?? 2;
      return {
        ...n,
        ring,
        ringIndex: ringIndexOf.get(n.id) ?? 0,
        ringCount: Math.max(ringCounts.get(ring) ?? 0, 1),
      };
    });

    const dedup = new Set<string>();
    const edgeList: Array<{ from: NoteId; to: NoteId; accent: string }> = [];
    const accentById = new Map(items.map((n) => [n.id, n.accent] as const));
    for (const e of edges.values()) {
      if (e.from === e.to) continue;
      const key = `${e.from}|${e.to}`;
      if (dedup.has(key) || !accentById.has(e.from) || !accentById.has(e.to)) continue;
      dedup.add(key);
      edgeList.push({ from: e.from, to: e.to, accent: accentById.get(e.from) ?? '#3bbffa' });
    }

    const maxLinks = Math.max(1, ...items.map((n) => n.linkCount));
    return { items, edgeList, maxLinks };
  }, [notes, edges, vaultRoot, accentOf]);

  const itemById = useMemo(() => new Map(items.map((n) => [n.id, n] as const)), [items]);

  // ---- simulation ----------------------------------------------------------

  // Full re-seed on layout switch or explicit reset.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetNonce intentionally forces a re-seed
  useEffect(() => {
    const sim = new Map<NoteId, SimNode>();
    for (const item of items) sim.set(item.id, baseLayout(item, layout));
    simRef.current = sim;
    setFrame((f) => f + 1);
  }, [layout, resetNonce]);

  // Incremental sync when the note set changes (vault edits while open).
  useEffect(() => {
    const sim = simRef.current;
    const alive = new Set(items.map((n) => n.id));
    for (const id of Array.from(sim.keys())) {
      if (!alive.has(id)) sim.delete(id);
    }
    for (const item of items) {
      if (!sim.has(item.id)) sim.set(item.id, baseLayout(item, useGraphView.getState().layout));
    }
    setFrame((f) => f + 1);
  }, [items]);

  // Physics loop.
  useEffect(() => {
    let rafId: number;
    const step = () => {
      rafId = requestAnimationFrame(step);
      const { physicsOn, layout: mode } = useGraphView.getState();
      const dragging = draggingRef.current;
      if (!physicsOn && dragging === null) return;

      const params = FORCE_PARAMS[mode];
      const sim = simRef.current;
      const entries = Array.from(sim.entries());
      const n = entries.length;
      const fx: number[] = new Array(n).fill(0);
      const fy: number[] = new Array(n).fill(0);
      const addForce = (i: number, dx: number, dy: number) => {
        fx[i] = (fx[i] ?? 0) + dx;
        fy[i] = (fy[i] ?? 0) + dy;
      };
      const indexOf = new Map<NoteId, number>();
      entries.forEach(([id], i) => indexOf.set(id, i));

      // center pull
      entries.forEach(([, p], i) => {
        addForce(i, (50 - p.x) * params.centerPull * 10, (50 - p.y) * params.centerPull * 10);
      });

      // pairwise repulsion
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = (entries[i] as [NoteId, SimNode])[1];
          const b = (entries[j] as [NoteId, SimNode])[1];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          let dist2 = dx * dx + dy * dy;
          if (dist2 < 0.5) dist2 = 0.5;
          const dist = Math.sqrt(dist2);
          const force = params.repulsion / dist2;
          const ux = dx / dist;
          const uy = dy / dist;
          addForce(i, ux * force, uy * force);
          addForce(j, -ux * force, -uy * force);
        }
      }

      // edge tether (spring toward ideal length)
      for (const e of edgeList) {
        const ai = indexOf.get(e.from);
        const bi = indexOf.get(e.to);
        if (ai === undefined || bi === undefined) continue;
        const a = (entries[ai] as [NoteId, SimNode])[1];
        const b = (entries[bi] as [NoteId, SimNode])[1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.01) dist = 0.01;
        const diff = dist - params.idealLength;
        const ux = dx / dist;
        const uy = dy / dist;
        const f = diff * params.tether;
        addForce(ai, ux * f, uy * f);
        addForce(bi, -ux * f, -uy * f);
      }

      entries.forEach(([id, p], i) => {
        if (id === dragging) {
          p.vx = 0;
          p.vy = 0;
          return;
        }
        if (!physicsOn) return;
        p.vx = (p.vx + (fx[i] ?? 0)) * params.damping;
        p.vy = (p.vy + (fy[i] ?? 0)) * params.damping;
        p.x = clamp(p.x + p.vx, 4, 96);
        p.y = clamp(p.y + p.vy, 4, 96);
      });

      setFrame((f) => f + 1);
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [edgeList]);

  // ---- pointer interactions ------------------------------------------------

  const canvasRect = () =>
    canvasRef.current?.getBoundingClientRect() ??
    ({ left: 0, top: 0, width: 1000, height: 700 } as DOMRect);

  /** Screen point -> scene percentage, inverting the pan/zoom transform. */
  const clientToScenePct = (clientX: number, clientY: number) => {
    const rect = canvasRect();
    const xPct = 50 + ((clientX - rect.left - rect.width / 2 - pan.x) / zoom / rect.width) * 100;
    const yPct = 50 + ((clientY - rect.top - rect.height / 2 - pan.y) / zoom / rect.height) * 100;
    return { xPct, yPct };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const dragging = draggingRef.current;
      if (dragging !== null) {
        const { xPct, yPct } = clientToScenePct(e.clientX, e.clientY);
        const node = simRef.current.get(dragging);
        if (node) {
          node.x = clamp(xPct, 2, 98);
          node.y = clamp(yPct, 2, 98);
          node.vx = 0;
          node.vy = 0;
        }
        setFrame((f) => f + 1);
      } else if (panStateRef.current) {
        const st = panStateRef.current;
        setPan({ x: st.panX + (e.clientX - st.x), y: st.panY + (e.clientY - st.y) });
      }
    };
    const onUp = () => {
      if (draggingRef.current !== null || panStateRef.current) {
        draggingRef.current = null;
        panStateRef.current = null;
        setIsPanning(false);
        setFrame((f) => f + 1);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  });

  // Wheel zoom needs a non-passive native listener to preventDefault.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => clamp(z + (e.deltaY < 0 ? 0.08 : -0.08), ZOOM_MIN, ZOOM_MAX));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onCanvasMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target === canvasRef.current || target.tagName === 'svg' || target.tagName === 'SVG') {
      panStateRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      setIsPanning(true);
    }
  };

  // ---- hover snippet -------------------------------------------------------

  useEffect(() => {
    if (hoveredId === null) return;
    const item = itemById.get(hoveredId);
    if (!item || snippetsRef.current.has(item.path)) return;
    let cancelled = false;
    void vaultRead(item.path)
      .then(({ content }) => {
        if (cancelled) return;
        snippetsRef.current.set(item.path, extractSnippet(content));
        setFrame((f) => f + 1);
      })
      .catch(() => {
        snippetsRef.current.set(item.path, '');
      });
    return () => {
      cancelled = true;
    };
  }, [hoveredId, itemById]);

  // ---- render --------------------------------------------------------------

  if (items.length === 0) {
    return <div className="empty-state">Vault has no linked notes yet.</div>;
  }

  const query = searchQuery.trim().toLowerCase();
  const rect = canvasRect();

  const visuals = items.map((item) => {
    const sim = simRef.current.get(item.id) ?? baseLayout(item, layout);
    const matchesSearch = !query || item.title.toLowerCase().includes(query);
    const matchesFolder = !folderFilter || item.folder === folderFilter;
    const dimmed = !matchesSearch || !matchesFolder;
    const isHover = hoveredId === item.id;
    const size =
      (28 + (item.linkCount / maxLinks) * 62) * (layout === 'depth' ? 0.6 + sim.z * 0.7 : 1);
    return {
      item,
      x: sim.x,
      y: sim.y,
      size: Math.round(size),
      scale: isHover ? 1.12 : 1,
      opacity: dimmed ? 0.16 : 0.72 + sim.z * 0.28,
      blur: layout === 'depth' ? clamp((1 - sim.z) * 2.2, 0, 2.2) : 0,
      zIndex: Math.round(sim.z * 100) + (isHover ? 999 : 0),
      colorLight: lighten(item.accent, 0.35),
      colorDeep: hexToRgba(item.accent, 0.85),
      ringColor: hexToRgba(item.accent, isHover ? 0.9 : 0.4),
      glow: isHover ? 26 : 10 + item.linkCount * 3,
      glowColor: hexToRgba(item.accent, isHover ? 0.55 : 0.28),
      fontSize: Math.max(11, Math.min(20, size * 0.32)),
      labelOpacity: dimmed ? 0.25 : 0.9,
      dimmed,
    };
  });
  const visualById = new Map(visuals.map((v) => [v.item.id, v] as const));

  const hovered = hoveredId !== null ? visualById.get(hoveredId) : undefined;
  let tooltip: {
    title: string;
    folder: string;
    accent: string;
    linkCount: number;
    snippet: string;
    left: number;
    top: number;
  } | null = null;
  if (hovered) {
    // Forward transform: scene pct -> screen px inside the canvas.
    const nodeLeft = rect.width / 2 + ((hovered.x - 50) / 100) * rect.width * zoom + pan.x;
    const nodeTop = rect.height / 2 + ((hovered.y - 50) / 100) * rect.height * zoom + pan.y;
    tooltip = {
      title: hovered.item.title,
      folder: hovered.item.folder,
      accent: hovered.item.accent,
      linkCount: hovered.item.linkCount,
      snippet: snippetsRef.current.get(hovered.item.path) ?? '',
      left: clamp(nodeLeft + 26, 8, Math.max(rect.width - 250, 8)),
      top: clamp(nodeTop - 10, 8, Math.max(rect.height - 90, 8)),
    };
  }

  const dragging = draggingRef.current !== null;

  return (
    <div
      ref={canvasRef}
      className="graph-canvas"
      style={{ cursor: isPanning ? 'grabbing' : 'default' }}
      onMouseDown={onCanvasMouseDown}
    >
      <div
        className="graph-scene"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transition: dragging || isPanning ? 'none' : 'transform 200ms var(--ease-out)',
        }}
      >
        <svg
          className="graph-edges"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {edgeList.map((e) => {
            const a = visualById.get(e.from);
            const b = visualById.get(e.to);
            if (!a || !b) return null;
            const dim = a.dimmed || b.dimmed;
            return (
              <line
                key={`${e.from}|${e.to}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={e.accent}
                strokeWidth={0.35}
                opacity={dim ? 0.05 : 0.28}
              />
            );
          })}
        </svg>
        {visuals.map((v) => (
          <div
            key={v.item.id}
            className="graph-node"
            style={{
              left: `${v.x}%`,
              top: `${v.y}%`,
              width: `${v.size}px`,
              height: `${v.size}px`,
              transform: `translate(-50%,-50%) scale(${v.scale})`,
              opacity: v.opacity,
              filter: v.blur > 0 ? `blur(${v.blur}px)` : undefined,
              zIndex: v.zIndex,
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              draggingRef.current = v.item.id;
              setFrame((f) => f + 1);
            }}
            onMouseEnter={() => setHoveredId(v.item.id)}
            onMouseLeave={() => setHoveredId(null)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              void openFile(v.item.path, v.item.name);
            }}
          >
            <div
              className="graph-node__bubble"
              style={{
                background: `radial-gradient(circle at 32% 28%, ${v.colorLight}, ${v.colorDeep})`,
                boxShadow: `0 0 ${v.glow}px ${v.glowColor}, 0 8px 24px rgba(0,0,0,.35)`,
                border: `1.5px solid ${v.ringColor}`,
              }}
            >
              <span
                className="graph-node__count"
                style={{ fontSize: `${v.fontSize}px`, color: 'rgba(6,14,32,0.75)' }}
              >
                {v.item.linkCount}
              </span>
            </div>
            <div className="graph-node__label" style={{ opacity: v.labelOpacity }}>
              {v.item.title.length > 16 ? `${v.item.title.slice(0, 15)}…` : v.item.title}
            </div>
          </div>
        ))}
      </div>

      {tooltip ? (
        <div className="graph-tooltip" style={{ left: tooltip.left, top: tooltip.top }}>
          <div className="graph-tooltip__title">{tooltip.title}</div>
          <div className="graph-tooltip__meta" style={{ color: tooltip.accent }}>
            {tooltip.folder} · {tooltip.linkCount} links
          </div>
          {tooltip.snippet ? <div className="graph-tooltip__snippet">{tooltip.snippet}</div> : null}
        </div>
      ) : null}

      <div className="graph-zoombar">
        <button
          type="button"
          className="graph-zoombar__btn msi"
          aria-label="Zoom out"
          onClick={() => setZoom((z) => clamp(z - 0.15, ZOOM_MIN, ZOOM_MAX))}
        >
          remove
        </button>
        <span className="graph-zoombar__level">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className="graph-zoombar__btn msi"
          aria-label="Zoom in"
          onClick={() => setZoom((z) => clamp(z + 0.15, ZOOM_MIN, ZOOM_MAX))}
        >
          add
        </button>
        <div className="graph-zoombar__divider" />
        <button
          type="button"
          className="graph-zoombar__btn graph-zoombar__btn--small msi"
          aria-label="Reset view"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          center_focus_weak
        </button>
      </div>

      {folderFilter ? (
        <div className="graph-filter-chip">
          <span className="graph-filter-chip__label">Filtered:</span>
          <span className="graph-filter-chip__value">{folderFilter}</span>
          <button
            type="button"
            className="graph-filter-chip__close msi"
            aria-label="Clear folder filter"
            onClick={clearFolderFilter}
          >
            close
          </button>
        </div>
      ) : null}
    </div>
  );
}
