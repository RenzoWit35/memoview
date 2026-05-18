import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, drawSelection, keymap } from '@codemirror/view';

import { memoviewTheme } from './theme';

export interface CreateEditorOptions {
  parent: HTMLElement;
  initialDoc: string;
  onChange: (doc: string) => void;
  onSaveShortcut: () => void;
}

export function createEditor(opts: CreateEditorOptions): EditorView {
  const updateListener = EditorView.updateListener.of((u) => {
    if (u.docChanged) opts.onChange(u.state.doc.toString());
  });

  // Cmd/Ctrl+S — force-flush a pending save. We bind it to a dummy command that
  // the React wrapper has already wired to `onSaveShortcut` via this callback.
  const saveKey = keymap.of([
    {
      key: 'Mod-s',
      preventDefault: true,
      run: () => {
        opts.onSaveShortcut();
        return true;
      },
    },
  ]);

  return new EditorView({
    parent: opts.parent,
    state: EditorState.create({
      doc: opts.initialDoc,
      extensions: [
        history(),
        drawSelection(),
        saveKey,
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        memoviewTheme,
        updateListener,
        EditorView.lineWrapping,
      ],
    }),
  });
}
