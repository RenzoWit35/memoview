import { useEffect } from 'react';
import { ToastProvider } from './app/Toast';
import { VaultPicker } from './app/VaultPicker';
import { Workspace } from './app/Workspace';
import { subscribeBackend, vaultEventBus } from './ipc/events';
import { useWorkspace } from './state/workspaceStore';

const TREE_REFRESH_DEBOUNCE_MS = 200;

export function App() {
  const { vaultRoot, hydrate } = useWorkspace();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Subscribe ONCE to upstream Tauri streams; the local buses fan out to per-
  // component listeners (EditorPane, BacklinksPane).
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

    void subscribeBackend().then((stop) => {
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
