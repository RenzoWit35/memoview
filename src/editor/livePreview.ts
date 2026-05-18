import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';

interface LivePreviewOptions {
  /** Called when the user clicks a wikilink widget. */
  onOpenLink?: (target: string) => void;
}

class WikilinkWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly display: string,
    readonly onOpenLink: ((target: string) => void) | undefined,
  ) {
    super();
  }
  override toDOM(): HTMLElement {
    const a = document.createElement('a');
    a.className = 'cm-wikilink';
    a.dataset.target = this.target;
    a.textContent = this.display;
    a.onmousedown = (e) => {
      e.preventDefault();
      this.onOpenLink?.(this.target);
    };
    return a;
  }
  override eq(other: WikilinkWidget): boolean {
    return other.target === this.target && other.display === this.display;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

class EmbedWidget extends WidgetType {
  constructor(readonly target: string) {
    super();
  }
  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-embed';
    span.textContent = `📎 ${this.target}`;
    return span;
  }
  override eq(other: EmbedWidget): boolean {
    return other.target === this.target;
  }
}

export function livePreview(opts: LivePreviewOptions = {}) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view, opts);
      }
      update(u: ViewUpdate): void {
        if (u.docChanged || u.selectionSet || u.viewportChanged) {
          this.decorations = build(u.view, opts);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}

function build(view: EditorView, opts: LivePreviewOptions): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const cursor = view.state.selection.main.head;
  const cursorLine = view.state.doc.lineAt(cursor).number;
  const doc = view.state.doc;

  type Span = { from: number; to: number; deco: Decoration };
  const spans: Span[] = [];

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        const startLine = doc.lineAt(node.from).number;
        const endLine = doc.lineAt(Math.min(node.to, doc.length)).number;
        const cursorIsHere = cursorLine >= startLine && cursorLine <= endLine;

        switch (node.name) {
          case 'Wikilink': {
            if (cursorIsHere) return;
            const raw = doc.sliceString(node.from + 2, node.to - 2);
            const [target, display] = raw.includes('|')
              ? (raw.split('|', 2) as [string, string])
              : [raw, raw];
            spans.push({
              from: node.from,
              to: node.to,
              deco: Decoration.replace({
                widget: new WikilinkWidget(target.trim(), display.trim(), opts.onOpenLink),
              }),
            });
            return false;
          }
          case 'WikilinkEmbed': {
            if (cursorIsHere) return;
            const inner = doc.sliceString(node.from + 3, node.to - 2);
            const target = inner.split('|', 1)[0]?.trim() ?? inner;
            spans.push({
              from: node.from,
              to: node.to,
              deco: Decoration.replace({ widget: new EmbedWidget(target) }),
            });
            return false;
          }
          case 'HeaderMark': {
            if (cursorIsHere) return;
            // Hide the `#` markers + the trailing space.
            const next = doc.sliceString(node.to, Math.min(node.to + 1, doc.length));
            const to = next === ' ' ? node.to + 1 : node.to;
            spans.push({ from: node.from, to, deco: Decoration.replace({}) });
            return;
          }
          case 'EmphasisMark': {
            if (cursorIsHere) return;
            spans.push({ from: node.from, to: node.to, deco: Decoration.replace({}) });
            return;
          }
          case 'CodeMark': {
            if (cursorIsHere) return;
            // Only hide inline code marks (single/double backticks); preserve
            // fenced code-block fences for readability.
            const len = node.to - node.from;
            if (len <= 2) {
              spans.push({ from: node.from, to: node.to, deco: Decoration.replace({}) });
            }
            return;
          }
          case 'Emphasis':
            spans.push({
              from: node.from,
              to: node.to,
              deco: Decoration.mark({ class: 'cm-em' }),
            });
            return;
          case 'StrongEmphasis':
            spans.push({
              from: node.from,
              to: node.to,
              deco: Decoration.mark({ class: 'cm-strong' }),
            });
            return;
          case 'InlineCode':
            spans.push({
              from: node.from,
              to: node.to,
              deco: Decoration.mark({ class: 'cm-inline-code' }),
            });
            return;
          case 'ATXHeading1':
          case 'ATXHeading2':
          case 'ATXHeading3':
          case 'ATXHeading4':
          case 'ATXHeading5':
          case 'ATXHeading6': {
            const level = Number.parseInt(node.name.slice(-1), 10);
            spans.push({
              from: node.from,
              to: node.to,
              deco: Decoration.mark({ class: `cm-heading cm-heading-${level}` }),
            });
            return;
          }
        }
      },
    });
  }

  spans.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const s of spans) {
    b.add(s.from, s.to, s.deco);
  }
  return b.finish();
}
