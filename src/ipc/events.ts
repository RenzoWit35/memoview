import type { VaultEvent } from '@ipc/index';
import { listen } from '@tauri-apps/api/event';

export type Unsubscribe = () => void;

type Handler = (e: VaultEvent) => void;

/**
 * Process-local pub/sub for vault events. The app subscribes ONCE to Tauri's
 * underlying `vault:event` channel and re-broadcasts to every component
 * listener registered here. Avoids registering N Tauri listeners.
 *
 * Note: this is intentionally separate from the plugin EventBus that arrives
 * in M9 — that one lives in @memoview/plugin-sdk with permission scoping.
 */
class VaultEventBus {
  private handlers = new Set<Handler>();

  on(fn: Handler): Unsubscribe {
    this.handlers.add(fn);
    return () => {
      this.handlers.delete(fn);
    };
  }

  emit(e: VaultEvent): void {
    // Snapshot in case a handler unsubscribes during dispatch.
    for (const h of [...this.handlers]) {
      try {
        h(e);
      } catch (err) {
        console.error('[vault-bus] handler error:', err);
      }
    }
  }
}

export const vaultEventBus = new VaultEventBus();

/**
 * Subscribe to the upstream Tauri stream and forward each event into the
 * local bus. Call once at app startup.
 */
export async function subscribeVaultEvents(): Promise<Unsubscribe> {
  return await listen<VaultEvent>('vault:event', (msg) => {
    vaultEventBus.emit(msg.payload);
  });
}
