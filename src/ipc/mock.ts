// Dev-only in-browser backend so `pnpm vite:dev` renders the full UI without
// the Tauri shell (plain `vite build` bundles exclude this via the
// import.meta.env.DEV guard in invoke.ts). The sample vault mirrors the demo
// content from the Claude Design export (Memoview.dc.html).

import type { BacklinkRef, GraphSnapshot, ReadResult, TFile, WriteResult } from '@ipc/index';

const ROOT = '/demo-vault';

interface MockNote {
  id: number;
  title: string;
  folder: string | null;
  out: string[];
  para: string[];
}

const NOTES: MockNote[] = [
  {
    id: 1,
    title: 'Product Roadmap Q3',
    folder: 'Projects',
    out: ['Design System Migration', 'API Rate Limiting'],
    para: [
      'Three workstreams this quarter: faster sync, a real graph view, and plugin sandboxing.',
      '[[Design System Migration]] unblocks the graph work — visuals need to land first.',
      'Backpressure planning lives in [[API Rate Limiting]].',
    ],
  },
  {
    id: 2,
    title: 'Design System Migration',
    folder: 'Projects',
    out: ['Product Roadmap Q3'],
    para: [
      'Moving every screen onto the new token set. Cards, chips and inputs are done; graph view is next.',
      'Tracked on [[Product Roadmap Q3]].',
    ],
  },
  {
    id: 3,
    title: 'API Rate Limiting',
    folder: 'Projects',
    out: [],
    para: [
      'Sync API needs backpressure before we ship offline queueing. Draft proposal attached below.',
    ],
  },
  {
    id: 4,
    title: 'Team Rituals',
    folder: 'Areas',
    out: ['2026-07-06'],
    para: ['Weekly demo on Thursdays. Retro notes live in Daily Notes → [[2026-07-06]].'],
  },
  {
    id: 5,
    title: 'Personal Finance',
    folder: 'Areas',
    out: [],
    para: ['Isolated note — nothing links here yet. Good example of an orphan in the graph.'],
  },
  {
    id: 6,
    title: 'Graph Databases',
    folder: 'Research',
    out: ['Local-first Sync'],
    para: [
      'Reading up on adjacency-list vs edge-table storage for the local link index. See [[Local-first Sync]].',
    ],
  },
  {
    id: 7,
    title: 'Local-first Sync',
    folder: 'Research',
    out: ['CRDT Notes', 'Graph Databases'],
    para: [
      'CRDTs give us conflict-free merges without a server round trip.',
      '[[Graph Databases]] has the storage angle; [[CRDT Notes]] covers merge semantics.',
    ],
  },
  {
    id: 8,
    title: 'CRDT Notes',
    folder: 'Research',
    out: ['Local-first Sync'],
    para: [
      'LWW-element-set is enough for our note metadata; content body needs an RGA. Context: [[Local-first Sync]].',
    ],
  },
  {
    id: 9,
    title: '2026-07-08',
    folder: 'Daily Notes',
    out: ['Product Roadmap Q3', 'Team Rituals'],
    para: [
      'Reviewed [[Product Roadmap Q3]] with the team. [[Team Rituals]] needs an update after retro.',
    ],
  },
  {
    id: 10,
    title: '2026-07-07',
    folder: 'Daily Notes',
    out: ['2026-07-08'],
    para: ['Short day — mostly triage. Carried two items into [[2026-07-08]].'],
  },
  {
    id: 11,
    title: '2026-07-06',
    folder: 'Daily Notes',
    out: [],
    para: ['Retro: shipped the CRDT prototype. Team wants a graph view next.'],
  },
  {
    id: 12,
    title: 'Quick capture',
    folder: 'Inbox',
    out: ['API Rate Limiting'],
    para: [
      'Idea: rate limit responses should carry a Retry-After header, tie into [[API Rate Limiting]].',
    ],
  },
];

const FOLDER_ORDER = ['Projects', 'Areas', 'Research', 'Daily Notes', 'Inbox'];

const pathOf = (n: MockNote) =>
  n.folder ? `${ROOT}/${n.folder}/${n.title}.md` : `${ROOT}/${n.title}.md`;
const byTitle = new Map(NOTES.map((n) => [n.title, n] as const));
const byPath = new Map(NOTES.map((n) => [pathOf(n), n] as const));

const contents = new Map<string, string>(
  NOTES.map((n) => [pathOf(n), `${n.para.join('\n\n')}\n`] as const),
);
let hashCounter = 0;
const hashes = new Map<string, string>(NOTES.map((n) => [pathOf(n), `mock-${hashCounter++}`]));

let nextId = Math.max(...NOTES.map((n) => n.id)) + 1;

function tree(): TFile[] {
  const dirs: TFile[] = FOLDER_ORDER.map((folder) => ({
    path: `${ROOT}/${folder}`,
    name: folder,
    isDir: true,
    children: NOTES.filter((n) => n.folder === folder).map((n) => ({
      path: pathOf(n),
      name: `${n.title}.md`,
      isDir: false,
      children: null,
    })),
  }));
  const rootFiles: TFile[] = NOTES.filter((n) => n.folder === null).map((n) => ({
    path: pathOf(n),
    name: `${n.title}.md`,
    isDir: false,
    children: null,
  }));
  return [...dirs, ...rootFiles];
}

function snapshot(): GraphSnapshot {
  return {
    notes: NOTES.map((n) => ({ id: n.id, path: pathOf(n), title: n.title, aliases: [], tags: [] })),
    edges: NOTES.flatMap((n) =>
      n.out
        .map((t) => byTitle.get(t))
        .filter((t): t is MockNote => !!t)
        .map((t) => ({ from: n.id, to: t.id, kind: 'wiki-link' as const })),
    ),
  };
}

function backlinks(path: string): BacklinkRef[] {
  const target = byPath.get(path);
  if (!target) return [];
  return NOTES.filter((n) => n.out.includes(target.title)).map((n) => ({
    from: n.id,
    fromPath: pathOf(n),
    fromTitle: n.title,
    kind: 'wiki-link' as const,
    byteStart: 0,
    byteEnd: 0,
  }));
}

export async function mockInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  switch (cmd) {
    case 'last_vault':
      return ROOT as T;
    case 'vault_pick':
      return { root: ROOT, tree: tree() } as T;
    case 'vault_open':
    case 'vault_list':
      return tree() as T;
    case 'vault_read': {
      const path = String(args?.path ?? '');
      const content = contents.get(path);
      if (content === undefined) throw { kind: 'NotFound', message: `no such file: ${path}` };
      return { content, hash: hashes.get(path) ?? 'mock' } satisfies ReadResult as T;
    }
    case 'vault_write': {
      const path = String(args?.path ?? '');
      contents.set(path, String(args?.content ?? ''));
      const hash = `mock-${hashCounter++}`;
      hashes.set(path, hash);
      return { hash } satisfies WriteResult as T;
    }
    case 'vault_rename':
      return { filesRewritten: 0, occurrences: 0 } as T;
    case 'vault_create_note': {
      const parent = String(args?.parent ?? ROOT);
      const base = String(args?.name ?? 'Untitled')
        .replace(/\.md$/, '')
        .trim();
      const folder = parent === ROOT ? null : (parent.split('/').pop() ?? null);
      let title = base;
      for (let i = 1; byTitle.has(title); i++) title = `${base} ${i}`;
      const note: MockNote = { id: nextId++, title, folder, out: [], para: [] };
      NOTES.push(note);
      byTitle.set(title, note);
      byPath.set(pathOf(note), note);
      contents.set(pathOf(note), '');
      hashes.set(pathOf(note), `mock-${hashCounter++}`);
      return { path: pathOf(note), name: `${title}.md`, isDir: false, children: null } as T;
    }
    case 'vault_create_folder': {
      // The mock vault is single-level: new folders always land at the root.
      const base = String(args?.name ?? 'New folder').trim();
      let name = base;
      for (let i = 1; FOLDER_ORDER.includes(name); i++) name = `${base} ${i}`;
      FOLDER_ORDER.push(name);
      return { path: `${ROOT}/${name}`, name, isDir: true, children: [] } as T;
    }
    case 'graph_snapshot':
      return snapshot() as T;
    case 'graph_backlinks':
      return backlinks(String(args?.path ?? '')) as T;
    case 'graph_resolve_wikilink': {
      const target = byTitle.get(String(args?.target ?? ''));
      return (target ? pathOf(target) : null) as T;
    }
    case 'graph_resolve_md_link': {
      // Vault-relative path → note. The mock resolves by basename since the
      // sample vault is flat inside each folder.
      const raw = decodeURIComponent(String(args?.target ?? ''));
      const base = raw.split('#')[0]?.split('/').pop()?.replace(/\.md$/, '') ?? '';
      const target = byTitle.get(base);
      return (target ? pathOf(target) : null) as T;
    }
    case 'search': {
      const q = String(args?.query ?? '').toLowerCase();
      return NOTES.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          (contents.get(pathOf(n)) ?? '').toLowerCase().includes(q),
      ).map((n, i) => ({
        path: pathOf(n),
        title: n.title,
        snippet: n.para[0] ?? '',
        score: 100 - i,
      })) as T;
    }
    default:
      throw new Error(`mock backend: unhandled command "${cmd}"`);
  }
}
