import type { EditorView } from '@codemirror/view';
import { useEffect, useRef, useState } from 'react';
import { useToast } from '../app/Toast';
import { vaultEventBus } from '../ipc/events';
import { graphResolveWikilink, vaultRead, vaultWrite } from '../ipc/invoke';
import type { Tab } from '../state/workspaceStore';
import { useWorkspace } from '../state/workspaceStore';
import { createEditor } from './createEditor';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface Pending {
  doc: string;
  timer: ReturnType<typeof setTimeout> | null;
}

const SAVE_DEBOUNCE_MS = 250;

export function EditorPane({ tab }: { tab: Tab }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const hashRef = useRef<string>(tab.hash);
  const pendingRef = useRef<Pending>({ doc: tab.content, timer: null });
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const markSaved = useWorkspace((s) => s.markSaved);
  const toast = useToast();

  // Flush the pending edit immediately.
  const flush = async () => {
    const pending = pendingRef.current;
    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }
    const doc = pending.doc;
    if (doc === tab.content && hashRef.current === tab.hash) return;
    try {
      setSaveState('saving');
      const { hash } = await vaultWrite(tab.path, doc, hashRef.current);
      hashRef.current = hash;
      markSaved(tab.id, doc, hash);
      setSaveState('saved');
    } catch (e) {
      const payload = e as { kind?: string; message?: string } | string;
      const kind = typeof payload === 'object' ? payload?.kind : undefined;
      if (kind === 'Conflict') {
        setSaveState('error');
        toast.show('File changed on disk.', [
          {
            label: 'Reload',
            onClick: async () => {
              const fresh = await vaultRead(tab.path);
              hashRef.current = fresh.hash;
              const view = viewRef.current;
              if (view) {
                view.dispatch({
                  changes: { from: 0, to: view.state.doc.length, insert: fresh.content },
                });
              }
              markSaved(tab.id, fresh.content, fresh.hash);
              setSaveState('saved');
            },
          },
          {
            label: 'Overwrite',
            onClick: async () => {
              try {
                const { hash } = await vaultWrite(tab.path, doc, null);
                hashRef.current = hash;
                markSaved(tab.id, doc, hash);
                setSaveState('saved');
              } catch (err) {
                toast.show(`Save failed: ${String(err)}`);
                setSaveState('error');
              }
            },
          },
        ]);
      } else {
        const msg = typeof payload === 'string' ? payload : (payload?.message ?? String(e));
        toast.show(`Save failed: ${msg}`);
        setSaveState('error');
      }
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: editor mounts once per tab; doc and flush are captured intentionally to avoid re-mounting on every keystroke
  useEffect(() => {
    if (!hostRef.current) return;

    const view = createEditor({
      parent: hostRef.current,
      initialDoc: tab.content,
      onChange: (doc) => {
        const pending = pendingRef.current;
        pending.doc = doc;
        if (pending.timer) clearTimeout(pending.timer);
        pending.timer = setTimeout(() => {
          pending.timer = null;
          void flush();
        }, SAVE_DEBOUNCE_MS);
      },
      onSaveShortcut: () => {
        void flush();
      },
      onOpenLink: (target) => {
        void (async () => {
          const resolved = await graphResolveWikilink(tab.path, target);
          if (resolved) {
            const name = resolved.split(/[\\/]/).pop() ?? target;
            await useWorkspace.getState().openFile(resolved, name);
          } else {
            toast.show(`No note named "${target}".`);
          }
        })();
      },
    });
    viewRef.current = view;

    return () => {
      // best-effort flush on unmount
      void flush();
      view.destroy();
      viewRef.current = null;
    };
  }, [tab.id]);

  // React to external on-disk changes for this tab's file. Clean tabs reload
  // silently; dirty tabs surface a toast.
  useEffect(() => {
    const off = vaultEventBus.on((e) => {
      if (e.kind !== 'modified' || e.path !== tab.path) return;
      if (e.hash === hashRef.current) return; // already in sync

      const view = viewRef.current;
      if (!view) return;

      const currentDoc = view.state.doc.toString();
      const savedDoc = useWorkspace.getState().openTabs.find((t) => t.id === tab.id)?.content;
      const isDirty = currentDoc !== savedDoc;

      const replaceWithDisk = async () => {
        const fresh = await vaultRead(tab.path);
        hashRef.current = fresh.hash;
        const v = viewRef.current;
        if (v) {
          v.dispatch({
            changes: { from: 0, to: v.state.doc.length, insert: fresh.content },
          });
        }
        useWorkspace.getState().applyExternalChange(tab.path, fresh.content, fresh.hash);
      };

      if (!isDirty) {
        void replaceWithDisk();
      } else {
        toast.show('File changed on disk while you were editing.', [
          {
            label: 'Keep my changes',
            onClick: () => {
              // Next save will see a stale hashRef and the existing Conflict
              // toast (Reload / Overwrite) will let the user resolve.
            },
          },
          { label: 'Use disk version', onClick: () => void replaceWithDisk() },
        ]);
      }
    });
    return off;
  }, [tab.id, tab.path, toast]);

  return (
    <div className="editor-pane">
      <div ref={hostRef} className="editor-pane__host" />
      <div className={`editor-pane__status editor-pane__status--${saveState}`}>
        {saveState === 'saving' ? 'Saving…' : null}
        {saveState === 'saved' ? 'Saved' : null}
        {saveState === 'error' ? 'Save failed' : null}
      </div>
    </div>
  );
}
