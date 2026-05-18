// Placeholder for the public plugin API. The full surface (App, VaultAPI, WorkspaceAPI,
// MetadataAPI, EventBus) is specified in ARCHITECTURE.md §7 and implemented in M9.
// Exporting a few stable type stubs now so first-party code can import from @sdk without
// triggering a later move.

export interface Disposable {
  dispose(): void;
}

export interface Plugin {
  onload(app: App): void | Promise<void>;
  onunload(): void | Promise<void>;
}

export interface App {
  // Filled in during M9.
  readonly version: string;
}
