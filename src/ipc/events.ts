import type { GraphDelta, GraphSnapshot, VaultEvent } from '@ipc/index';
import { listen } from '@tauri-apps/api/event';

export type Unsubscribe = () => void;

type VaultHandler = (e: VaultEvent) => void;
type GraphDeltaHandler = (e: GraphDelta) => void;
type GraphSnapshotHandler = (e: GraphSnapshot) => void;

class Bus<T> {
  private handlers = new Set<(e: T) => void>();
  on(fn: (e: T) => void): Unsubscribe {
    this.handlers.add(fn);
    return () => {
      this.handlers.delete(fn);
    };
  }
  emit(e: T): void {
    for (const h of [...this.handlers]) {
      try {
        h(e);
      } catch (err) {
        console.error('[bus] handler error:', err);
      }
    }
  }
}

export const vaultEventBus = new Bus<VaultEvent>();
export const graphDeltaBus = new Bus<GraphDelta>();
export const graphSnapshotBus = new Bus<GraphSnapshot>();

// Type re-exports for convenience.
export type { VaultHandler, GraphDeltaHandler, GraphSnapshotHandler };

/**
 * Subscribe to the upstream Tauri streams and forward events into the local
 * buses. Call once at app startup; returns a disposer.
 */
export async function subscribeBackend(): Promise<Unsubscribe> {
  if (typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window)) {
    // Plain-browser dev session (mock backend): no upstream event streams.
    return () => {};
  }
  const unsubVault = await listen<VaultEvent>('vault:event', (msg) =>
    vaultEventBus.emit(msg.payload),
  );
  const unsubDelta = await listen<GraphDelta>('graph:delta', (msg) =>
    graphDeltaBus.emit(msg.payload),
  );
  const unsubSnap = await listen<GraphSnapshot>('graph:snapshot', (msg) =>
    graphSnapshotBus.emit(msg.payload),
  );
  return () => {
    unsubVault();
    unsubDelta();
    unsubSnap();
  };
}
