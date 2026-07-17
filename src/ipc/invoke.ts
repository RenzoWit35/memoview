import type { BacklinkRef, GraphSnapshot, ReadResult, TFile, WriteResult } from '@ipc/index';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

export const hasTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Route IPC through Tauri when running inside the shell; in a plain-browser
 * dev session fall back to the in-memory mock backend (dev builds only —
 * the DEV guard lets production bundles drop mock.ts entirely).
 */
const invoke = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  if (!hasTauri && import.meta.env.DEV) {
    const { mockInvoke } = await import('./mock');
    return mockInvoke<T>(cmd, args);
  }
  return tauriInvoke<T>(cmd, args);
};

export interface PickResult {
  root: string;
  tree: TFile[];
}

export interface SearchHit {
  path: string;
  title: string;
  snippet: string;
  score: number;
}

export interface RenameReport {
  filesRewritten: number;
  occurrences: number;
}

export const vaultPick = () => invoke<PickResult | null>('vault_pick');
export const vaultList = (path: string) => invoke<TFile[]>('vault_list', { path });
export const vaultOpen = (path: string) => invoke<TFile[]>('vault_open', { path });
export const vaultRead = (path: string) => invoke<ReadResult>('vault_read', { path });
export const vaultWrite = (path: string, content: string, precondition: string | null) =>
  invoke<WriteResult>('vault_write', { path, content, precondition });
export const vaultRename = (from: string, to: string) =>
  invoke<RenameReport>('vault_rename', { from, to });
export const vaultCreateNote = (parent: string, name: string) =>
  invoke<TFile>('vault_create_note', { parent, name });
export const vaultCreateFolder = (parent: string, name: string) =>
  invoke<TFile>('vault_create_folder', { parent, name });
export const lastVault = () => invoke<string | null>('last_vault');

export const graphSnapshot = () => invoke<GraphSnapshot>('graph_snapshot');
export const graphBacklinks = (path: string) => invoke<BacklinkRef[]>('graph_backlinks', { path });
export const graphResolveWikilink = (source: string | null, target: string) =>
  invoke<string | null>('graph_resolve_wikilink', { source, target });

export const search = (query: string, limit?: number) =>
  invoke<SearchHit[]>('search', { query, limit: limit ?? null });
