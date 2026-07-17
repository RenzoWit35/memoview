import { EditorView } from '@codemirror/view';

export const memoviewTheme = EditorView.theme(
  {
    '&': {
      color: 'var(--c-on-surface-var)',
      backgroundColor: 'transparent',
      fontSize: '16px',
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-sans)',
      lineHeight: '1.7',
    },
    '.cm-content': {
      caretColor: 'var(--c-primary)',
      padding: '0 0 8px',
    },
    '.cm-line': {
      padding: '0',
    },
    '.cm-cursor': {
      borderLeftColor: 'var(--c-primary)',
    },
    '&.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(255, 152, 56, 0.22)',
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'var(--c-on-surface-faint)',
      border: 'none',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255, 255, 255, 0.03)',
    },
  },
  { dark: true },
);
