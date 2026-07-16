// Folder metadata helpers shared by the sidebar, editor header, backlinks
// pane and graph view. A note's "folder" is the top-level directory it lives
// in, relative to the vault root; notes at the root belong to "Vault".

import { useMemo } from 'react';
import { useWorkspace } from './workspaceStore';

export const ROOT_FOLDER = 'Vault';

/** Accent hexes from the design: primary blue, secondary violet, tertiary teal. */
const ACCENT_HEXES = ['#3bbffa', '#8a95ff', '#48e5d0'];
const ACCENT_FALLBACK = '#3bbffa';

export function relPath(path: string, root: string | null): string {
  if (!root) return path;
  const normPath = path.replace(/\\/g, '/');
  const normRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  return normPath.startsWith(`${normRoot}/`) ? normPath.slice(normRoot.length + 1) : normPath;
}

export function folderOf(path: string, root: string | null): string {
  const rel = relPath(path, root);
  const slash = rel.indexOf('/');
  return slash === -1 ? ROOT_FOLDER : rel.slice(0, slash);
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}

/** Deterministic accent per folder name; the root bucket is always primary. */
export function folderAccent(folder: string): string {
  if (folder === ROOT_FOLDER) return ACCENT_FALLBACK;
  const idx = ((hashStr(folder) % ACCENT_HEXES.length) + ACCENT_HEXES.length) % ACCENT_HEXES.length;
  return ACCENT_HEXES[idx] ?? ACCENT_FALLBACK;
}

/**
 * Accent lookup keyed on the sidebar's top-level folder order, cycling
 * blue → violet → teal like the design; folders not in the current tree
 * fall back to the name hash.
 */
export function useFolderAccent(): (folder: string) => string {
  const tree = useWorkspace((s) => s.tree);
  return useMemo(() => {
    const byOrder = new Map<string, string>();
    let i = 0;
    for (const f of tree) {
      if (!f.isDir) continue;
      byOrder.set(f.name, ACCENT_HEXES[i % ACCENT_HEXES.length] ?? ACCENT_FALLBACK);
      i++;
    }
    byOrder.set(ROOT_FOLDER, ACCENT_FALLBACK);
    return (folder: string) => byOrder.get(folder) ?? folderAccent(folder);
  }, [tree]);
}

/** Deterministic 0..1 from a string; used to seed stable graph layouts. */
export function rand01(seed: string): number {
  const h = hashStr(seed);
  return (((h % 10000) + 10000) % 10000) / 10000;
}

export function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}

export function hexToRgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = Number.parseInt(h.substring(0, 2), 16);
  const g = Number.parseInt(h.substring(2, 4), 16);
  const b = Number.parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export function lighten(hex: string, amt: number): string {
  const h = hex.replace('#', '');
  const r = Number.parseInt(h.substring(0, 2), 16);
  const g = Number.parseInt(h.substring(2, 4), 16);
  const b = Number.parseInt(h.substring(4, 6), 16);
  const nr = Math.min(255, Math.round(r + (255 - r) * amt));
  const ng = Math.min(255, Math.round(g + (255 - g) * amt));
  const nb = Math.min(255, Math.round(b + (255 - b) * amt));
  return `rgb(${nr},${ng},${nb})`;
}
