import { useEffect } from 'react';
import { CommandPalette } from './app/CommandPalette';
import { ContextMenuProvider } from './app/ContextMenu';
import { ToastProvider } from './app/Toast';
import { UpdateChecker } from './app/UpdateChecker';
import { VaultPicker } from './app/VaultPicker';
import { Workspace } from './app/Workspace';
import { subscribeBackend, vaultEventBus } from './ipc/events';
import { useGraph } from './state/graphStore';
import { useWorkspace } from './state/workspaceStore';

const TREE_REFRESH_DEBOUNCE_MS = 200;

export function App() {
  const { vaultRoot, hydrate } = useWorkspace();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (vaultRoot) void useGraph.getState().hydrate();
  }, [vaultRoot]);

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

  return (
    <ToastProvider>
      <UpdateChecker />
      <ContextMenuProvider>
        {vaultRoot ? <Workspace /> : <VaultPicker />}
        <CommandPalette />
      </ContextMenuProvider>
    </ToastProvider>
  );
}
