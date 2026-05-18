import type { BacklinkRef, GraphSnapshot, ReadResult, TFile, WriteResult } from '@ipc/index';
import { invoke } from '@tauri-apps/api/core';

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
export const lastVault = () => invoke<string | null>('last_vault');

export const graphSnapshot = () => invoke<GraphSnapshot>('graph_snapshot');
export const graphBacklinks = (path: string) => invoke<BacklinkRef[]>('graph_backlinks', { path });
export const graphResolveWikilink = (source: string | null, target: string) =>
  invoke<string | null>('graph_resolve_wikilink', { source, target });

export const search = (query: string, limit?: number) =>
  invoke<SearchHit[]>('search', { query, limit: limit ?? null });
