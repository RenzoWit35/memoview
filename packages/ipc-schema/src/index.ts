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

/**
 * Events emitted by the Rust watcher when files in the active vault change.
 * Serialized with `#[serde(tag = "kind", rename_all = "kebab-case")]`.
 */
export type VaultEvent =
  | { kind: 'created'; path: string }
  | { kind: 'modified'; path: string; hash: string }
  | { kind: 'deleted'; path: string }
  | { kind: 'renamed'; from: string; to: string };

export type NoteId = number;

export type EdgeKind = 'wiki-link' | 'embed' | 'md-link';

export interface NoteView {
  id: NoteId;
  path: string;
  title: string;
  aliases: string[];
  tags: string[];
}

export interface EdgeView {
  from: NoteId;
  to: NoteId;
  kind: EdgeKind;
}

export interface GraphSnapshot {
  notes: NoteView[];
  edges: EdgeView[];
}

export interface GraphDelta {
  notesAdded: NoteView[];
  notesRemoved: NoteId[];
  notesUpdated: NoteView[];
  edgesAdded: EdgeView[];
  edgesRemoved: EdgeView[];
}

export interface BacklinkRef {
  from: NoteId;
  fromPath: string;
  fromTitle: string;
  kind: EdgeKind;
  byteStart: number;
  byteEnd: number;
}
