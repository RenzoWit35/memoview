import type { EditorView } from '@codemirror/view';
import { useEffect, useRef, useState } from 'react';
import { useToast } from '../app/Toast';
import { vaultRead, vaultWrite } from '../ipc/invoke';
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
    });
    viewRef.current = view;

    return () => {
      // best-effort flush on unmount
      void flush();
      view.destroy();
      viewRef.current = null;
    };
  }, [tab.id]);

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
