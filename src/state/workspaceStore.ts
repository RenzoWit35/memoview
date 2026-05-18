import type { TFile } from '@ipc/index';
import { create } from 'zustand';
import { lastVault, vaultList, vaultPick, vaultRead } from '../ipc/invoke';

export interface Tab {
  id: string;
  path: string;
  name: string;
  content: string;
  hash: string;
  dirty: boolean;
}

interface WorkspaceState {
  vaultRoot: string | null;
  tree: TFile[];
  loading: boolean;
  error: string | null;

  openTabs: Tab[];
  activeTabId: string | null;

  hydrate(): Promise<void>;
  pickVault(): Promise<void>;
  openFile(path: string, name: string): Promise<void>;
  closeTab(id: string): void;
  setActive(id: string): void;
  /** Called by the editor after a successful save to update the cached hash. */
  markSaved(id: string, content: string, hash: string): void;
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  vaultRoot: null,
  tree: [],
  loading: false,
  error: null,
  openTabs: [],
  activeTabId: null,

  async hydrate() {
    set({ loading: true, error: null });
    try {
      const root = await lastVault();
      if (root) {
        const tree = await vaultList(root);
        set({ vaultRoot: root, tree, loading: false });
      } else {
        set({ loading: false });
      }
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  async pickVault() {
    set({ loading: true, error: null });
    try {
      const result = await vaultPick();
      if (result) {
        set({ vaultRoot: result.root, tree: result.tree, loading: false });
      } else {
        set({ loading: false });
      }
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  async openFile(path, name) {
    // already open?
    const existing = get().openTabs.find((t) => t.path === path);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    try {
      const { content, hash } = await vaultRead(path);
      const id = `${path}#${Date.now()}`;
      const tab: Tab = { id, path, name, content, hash, dirty: false };
      set((s) => ({ openTabs: [...s.openTabs, tab], activeTabId: id }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  closeTab(id) {
    set((s) => {
      const openTabs = s.openTabs.filter((t) => t.id !== id);
      const activeTabId =
        s.activeTabId === id ? (openTabs[openTabs.length - 1]?.id ?? null) : s.activeTabId;
      return { openTabs, activeTabId };
    });
  },

  setActive(id) {
    set({ activeTabId: id });
  },

  markSaved(id, content, hash) {
    set((s) => ({
      openTabs: s.openTabs.map((t) => (t.id === id ? { ...t, content, hash, dirty: false } : t)),
    }));
  },
}));
