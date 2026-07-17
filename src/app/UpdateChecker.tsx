import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';
import { useEffect, useRef } from 'react';
import { hasTauri } from '../ipc/invoke';
import { useToast } from './Toast';

/**
 * Checks GitHub Releases once on startup and offers to install a newer
 * version. Renders nothing; talks to the user through the toast stack.
 */
export function UpdateChecker() {
  const toast = useToast();
  const startedRef = useRef(false);

  useEffect(() => {
    // The updater only exists inside the Tauri shell, not in browser dev.
    if (!hasTauri || startedRef.current) return;
    startedRef.current = true;

    const install = async (update: Awaited<ReturnType<typeof check>>) => {
      if (!update) return;
      const progressId = toast.show(`Downloading memoview ${update.version}…`, [
        { label: 'Hide', onClick: () => {} },
      ]);
      try {
        await update.downloadAndInstall();
        toast.dismiss(progressId);
        toast.show('Update installed', [{ label: 'Restart now', onClick: () => void relaunch() }]);
      } catch (err) {
        toast.dismiss(progressId);
        toast.show(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    void (async () => {
      try {
        const update = await check();
        if (!update) return;
        toast.show(`memoview ${update.version} is available`, [
          { label: 'Update', onClick: () => void install(update) },
          { label: 'Later', onClick: () => {} },
        ]);
      } catch {
        // Offline, or the latest release predates updater manifests — ignore.
      }
    })();
  }, [toast]);

  return null;
}
