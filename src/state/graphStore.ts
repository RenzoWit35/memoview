import type { GraphDelta, GraphSnapshot, NoteId, NoteView } from '@ipc/index';
import { create } from 'zustand';
import { graphDeltaBus, graphSnapshotBus } from '../ipc/events';
import { graphSnapshot as fetchSnapshot } from '../ipc/invoke';

export interface ClientEdge {
  from: NoteId;
  to: NoteId;
  kind: string;
}

interface GraphState {
  notes: Map<NoteId, NoteView>;
  /** Keyed by `${from}|${to}|${kind}` so a topology delta can target it. */
  edges: Map<string, ClientEdge>;
  loaded: boolean;
  hydrate(): Promise<void>;
}

const edgeKey = (e: { from: NoteId; to: NoteId; kind: string }) => `${e.from}|${e.to}|${e.kind}`;

export const useGraph = create<GraphState>((set) => ({
  notes: new Map(),
  edges: new Map(),
  loaded: false,
  async hydrate() {
    try {
      const snap = await fetchSnapshot();
      applySnapshot(snap, set);
    } catch (err) {
      console.error('graph hydrate failed', err);
    }
  },
}));

function applySnapshot(
  s: GraphSnapshot,
  set: (fn: (state: GraphState) => Partial<GraphState>) => void,
) {
  set(() => {
    const notes = new Map<NoteId, NoteView>(s.notes.map((n) => [n.id, n]));
    const edges = new Map<string, ClientEdge>(s.edges.map((e) => [edgeKey(e), e]));
    return { notes, edges, loaded: true };
  });
}

function applyDelta(d: GraphDelta, set: (fn: (state: GraphState) => Partial<GraphState>) => void) {
  set((state) => {
    const notes = new Map(state.notes);
    const edges = new Map(state.edges);
    for (const id of d.notesRemoved) notes.delete(id);
    for (const n of d.notesAdded) notes.set(n.id, n);
    for (const n of d.notesUpdated) notes.set(n.id, n);
    for (const e of d.edgesRemoved) edges.delete(edgeKey(e));
    for (const e of d.edgesAdded) edges.set(edgeKey(e), e);
    return { notes, edges, loaded: true };
  });
}

// Module-level subscriptions so the store reflects backend state regardless of
// whether any component has imported it yet.
graphSnapshotBus.on((s) => applySnapshot(s, useGraph.setState));
graphDeltaBus.on((d) => applyDelta(d, useGraph.setState));

/** Notes the given note links to (deduped, in edge order). */
export function outgoingNotes(
  notes: Map<NoteId, NoteView>,
  edges: Map<string, ClientEdge>,
  path: string,
): NoteView[] {
  let fromId: NoteId | null = null;
  for (const n of notes.values()) {
    if (n.path === path) {
      fromId = n.id;
      break;
    }
  }
  if (fromId === null) return [];
  const seen = new Set<NoteId>();
  const out: NoteView[] = [];
  for (const e of edges.values()) {
    if (e.from !== fromId || seen.has(e.to) || e.to === fromId) continue;
    const target = notes.get(e.to);
    if (!target) continue;
    seen.add(e.to);
    out.push(target);
  }
  return out;
}

/** Unique-neighbor count (in + out) per note — the graph's "total links". */
export function neighborCounts(
  notes: Map<NoteId, NoteView>,
  edges: Map<string, ClientEdge>,
): Map<NoteId, Set<NoteId>> {
  const neighbors = new Map<NoteId, Set<NoteId>>();
  for (const id of notes.keys()) neighbors.set(id, new Set());
  for (const e of edges.values()) {
    if (e.from === e.to) continue;
    neighbors.get(e.from)?.add(e.to);
    neighbors.get(e.to)?.add(e.from);
  }
  return neighbors;
}
