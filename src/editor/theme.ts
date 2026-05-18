import { EditorView } from '@codemirror/view';

export const memoviewTheme = EditorView.theme(
  {
    '&': {
      color: 'var(--fg)',
      backgroundColor: 'transparent',
      height: '100%',
      fontSize: '15px',
    },
    '.cm-scroller': {
      fontFamily: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace',
      lineHeight: '1.6',
      padding: '16px 24px',
    },
    '.cm-content': {
      caretColor: 'var(--accent)',
    },
    '.cm-cursor': {
      borderLeftColor: 'var(--accent)',
    },
    '&.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(125, 211, 252, 0.25)',
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'var(--fg-muted)',
      border: 'none',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255, 255, 255, 0.03)',
    },
  },
  { dark: true },
);
