import { useEffect } from 'react';
import { ToastProvider } from './app/Toast';
import { VaultPicker } from './app/VaultPicker';
import { Workspace } from './app/Workspace';
import { subscribeVaultEvents, vaultEventBus } from './ipc/events';
import { useWorkspace } from './state/workspaceStore';

const TREE_REFRESH_DEBOUNCE_MS = 200;

export function App() {
  const { vaultRoot, hydrate } = useWorkspace();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Subscribe ONCE to the upstream Tauri vault:event channel; the local bus
  // fans out to per-tab listeners (EditorPane).
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let treeTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const scheduleTreeRefresh = () => {
      if (treeTimer) clearTimeout(treeTimer);
      treeTimer = setTimeout(() => {
        void useWorkspace.getState().refreshTree();
      }, TREE_REFRESH_DEBOUNCE_MS);
    };

    const offBus = vaultEventBus.on((e) => {
      if (e.kind === 'created' || e.kind === 'deleted' || e.kind === 'renamed') {
        scheduleTreeRefresh();
      }
    });

    void subscribeVaultEvents().then((stop) => {
      if (cancelled) {
        stop();
        return;
      }
      unsub = stop;
    });

    return () => {
      cancelled = true;
      if (treeTimer) clearTimeout(treeTimer);
      offBus();
      if (unsub) unsub();
    };
  }, []);

  return <ToastProvider>{vaultRoot ? <Workspace /> : <VaultPicker />}</ToastProvider>;
}
