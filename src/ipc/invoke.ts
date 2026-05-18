import type { ReadResult, TFile, WriteResult } from '@ipc/index';
import { invoke } from '@tauri-apps/api/core';

export interface PickResult {
  root: string;
  tree: TFile[];
}

export const vaultPick = () => invoke<PickResult | null>('vault_pick');
export const vaultList = (path: string) => invoke<TFile[]>('vault_list', { path });
export const vaultOpen = (path: string) => invoke<TFile[]>('vault_open', { path });
export const vaultRead = (path: string) => invoke<ReadResult>('vault_read', { path });
export const vaultWrite = (path: string, content: string, precondition: string | null) =>
  invoke<WriteResult>('vault_write', { path, content, precondition });
export const lastVault = () => invoke<string | null>('last_vault');
