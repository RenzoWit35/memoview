// Shared TypeScript types matching the Rust IPC payloads in src-tauri/src/vault and ipc.
// In M9 we will switch to ts-rs-generated bindings; for now these are hand-mirrored.

export interface TFile {
  path: string;
  name: string;
  isDir: boolean;
  children: TFile[] | null;
}

export interface ReadResult {
  content: string;
  /** blake3 hash of the on-disk bytes at read time, hex-encoded (64 chars). */
  hash: string;
}

export interface WriteResult {
  /** blake3 hash of the bytes just written, hex-encoded. */
  hash: string;
}

export type AppErrorKind = 'Io' | 'NotFound' | 'Conflict' | 'InvalidPath' | 'Cancelled' | 'Other';

export interface AppErrorPayload {
  kind: AppErrorKind;
  message: string;
}
