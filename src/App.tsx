import { useEffect } from 'react';
import { ToastProvider } from './app/Toast';
import { VaultPicker } from './app/VaultPicker';
import { Workspace } from './app/Workspace';
import { useWorkspace } from './state/workspaceStore';

export function App() {
  const { vaultRoot, hydrate } = useWorkspace();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return <ToastProvider>{vaultRoot ? <Workspace /> : <VaultPicker />}</ToastProvider>;
}
