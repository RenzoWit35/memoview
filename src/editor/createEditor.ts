import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, drawSelection, keymap } from '@codemirror/view';

import { livePreview } from './livePreview';
import { memoviewTheme } from './theme';
import { wikilinkParser } from './wikilink';

export interface CreateEditorOptions {
  parent: HTMLElement;
  initialDoc: string;
  onChange: (doc: string) => void;
  onSaveShortcut: () => void;
  onOpenLink?: (target: string) => void;
}

export function createEditor(opts: CreateEditorOptions): EditorView {
  const updateListener = EditorView.updateListener.of((u) => {
    if (u.docChanged) opts.onChange(u.state.doc.toString());
  });

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
        markdown({ base: markdownLanguage, extensions: [wikilinkParser] }),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        memoviewTheme,
        livePreview({ onOpenLink: opts.onOpenLink }),
        updateListener,
        EditorView.lineWrapping,
      ],
    }),
  });
}
