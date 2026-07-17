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

export type LinkKind = 'wikilink' | 'mdlink';

interface LivePreviewOptions {
  /** Called when the user clicks a link widget that targets a vault note. */
  onOpenLink?: (target: string, kind: LinkKind) => void;
}

type OpenLink = ((target: string, kind: LinkKind) => void) | undefined;

class WikilinkWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly display: string,
    readonly onOpenLink: OpenLink,
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
      this.onOpenLink?.(this.target, 'wikilink');
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

/**
 * Standard `[text](url)` markdown link. External URLs open in the system
 * browser; vault-relative paths resolve through the graph like wikilinks.
 */
class MdLinkWidget extends WidgetType {
  constructor(
    readonly display: string,
    readonly href: string,
    readonly external: boolean,
    readonly onOpenLink: OpenLink,
  ) {
    super();
  }
  override toDOM(): HTMLElement {
    const a = document.createElement('a');
    a.className = 'cm-wikilink cm-mdlink';
    a.textContent = this.display;
    a.title = this.href;
    a.onmousedown = (e) => {
      e.preventDefault();
      if (this.href.startsWith('#')) return; // same-page anchor: nothing to open
      if (this.external) {
        window.open(this.href, '_blank', 'noopener');
      } else {
        this.onOpenLink?.(this.href, 'mdlink');
      }
    };
    return a;
  }
  override eq(other: MdLinkWidget): boolean {
    return other.display === this.display && other.href === this.href;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

class EmbedWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly icon: string,
  ) {
    super();
  }
  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-embed';
    span.textContent = `${this.icon} ${this.target}`;
    return span;
  }
  override eq(other: EmbedWidget): boolean {
    return other.target === this.target && other.icon === this.icon;
  }
}

class HrWidget extends WidgetType {
  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-hr';
    return span;
  }
  override eq(): boolean {
    return true;
  }
}

class BulletWidget extends WidgetType {
  override toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-bullet';
    span.textContent = '•';
    return span;
  }
  override eq(): boolean {
    return true;
  }
}

/** GFM task checkbox; clicking toggles the underlying `[ ]`/`[x]` text. */
class TaskWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
    readonly to: number,
  ) {
    super();
  }
  override toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-task';
    box.checked = this.checked;
    box.onmousedown = (e) => {
      e.preventDefault();
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: this.checked ? '[ ]' : '[x]' },
      });
    };
    return box;
  }
  override eq(other: TaskWidget): boolean {
    return other.checked === this.checked && other.from === this.from && other.to === this.to;
  }
  override ignoreEvent(): boolean {
    return false;
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

const EXTERNAL_URL = /^[a-z][a-z0-9+.-]*:/i;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function build(view: EditorView, opts: LivePreviewOptions): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const cursor = view.state.selection.main.head;
  const cursorLine = view.state.doc.lineAt(cursor).number;
  const doc = view.state.doc;

  // Full doc text, materialized lazily — only needed to resolve
  // reference-style links ([text][label] … [label]: url).
  let docText: string | null = null;
  const getDocText = () => {
    docText ??= doc.toString();
    return docText;
  };
  const resolveReference = (label: string): string | null => {
    const re = new RegExp(`^\\[${escapeRegex(label)}\\]:\\s*<?([^\\s>]+)>?`, 'im');
    return re.exec(getDocText())?.[1] ?? null;
  };

  type Span = { from: number; to: number; deco: Decoration };
  const spans: Span[] = [];
  const quoteLines = new Set<number>();

  const linkWidget = (display: string, href: string): Decoration => {
    const external = EXTERNAL_URL.test(href);
    return Decoration.replace({
      widget: new MdLinkWidget(display || href, href, external, opts.onOpenLink),
    });
  };

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
              deco: Decoration.replace({ widget: new EmbedWidget(target, '📎') }),
            });
            return false;
          }
          case 'Link': {
            if (cursorIsHere) return;
            const n = node.node;
            const marks = n.getChildren('LinkMark');
            const urlNode = n.getChild('URL');
            const display =
              marks.length >= 2 ? doc.sliceString(marks[0]?.to ?? 0, marks[1]?.from ?? 0) : '';
            let href = urlNode ? doc.sliceString(urlNode.from, urlNode.to) : null;
            if (!href) {
              // Reference-style: label is the second bracket pair, or the
              // display text itself for collapsed/shortcut references.
              const labelNode = n.getChild('LinkLabel');
              const label = labelNode
                ? doc.sliceString(labelNode.from + 1, labelNode.to - 1)
                : display;
              if (label.trim() !== '') href = resolveReference(label.trim());
            }
            if (!href) return; // unresolvable — leave the raw text visible
            spans.push({ from: node.from, to: node.to, deco: linkWidget(display, href) });
            return false;
          }
          case 'Image': {
            if (cursorIsHere) return;
            const n = node.node;
            const marks = n.getChildren('LinkMark');
            const urlNode = n.getChild('URL');
            const alt =
              marks.length >= 2 ? doc.sliceString(marks[0]?.to ?? 0, marks[1]?.from ?? 0) : '';
            const src = urlNode ? doc.sliceString(urlNode.from, urlNode.to) : '';
            spans.push({
              from: node.from,
              to: node.to,
              deco: Decoration.replace({ widget: new EmbedWidget(alt || src, '🖼') }),
            });
            return false;
          }
          case 'Autolink': {
            if (cursorIsHere) return;
            const url = doc.sliceString(node.from + 1, node.to - 1);
            spans.push({ from: node.from, to: node.to, deco: linkWidget(url, url) });
            return false;
          }
          case 'HeaderMark': {
            const ch = doc.sliceString(node.from, node.from + 1);
            if (ch === '=' || ch === '-') {
              // Setext underline: hide the mark characters (view plugins may
              // not replace the line break, so the line itself stays and reads
              // as the usual blank line under a heading). The cursor check
              // spans the whole heading so editing either line reveals the
              // raw markup.
              const parent = node.node.parent;
              const hFrom = doc.lineAt(parent?.from ?? node.from).number;
              const hTo = doc.lineAt(Math.min(parent?.to ?? node.to, doc.length)).number;
              if (cursorLine >= hFrom && cursorLine <= hTo) return;
              spans.push({ from: node.from, to: node.to, deco: Decoration.replace({}) });
            } else {
              if (cursorIsHere) return;
              // ATX `#` marks + the trailing space.
              const next = doc.sliceString(node.to, Math.min(node.to + 1, doc.length));
              const to = next === ' ' ? node.to + 1 : node.to;
              spans.push({ from: node.from, to, deco: Decoration.replace({}) });
            }
            return;
          }
          case 'EmphasisMark':
          case 'StrikethroughMark': {
            if (cursorIsHere) return;
            spans.push({ from: node.from, to: node.to, deco: Decoration.replace({}) });
            return;
          }
          case 'Escape': {
            if (cursorIsHere) return;
            // Hide the backslash, keep the escaped character.
            spans.push({
              from: node.from,
              to: node.from + 1,
              deco: Decoration.replace({}),
            });
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
          case 'Blockquote': {
            for (let l = startLine; l <= endLine; l++) {
              quoteLines.add(l);
            }
            return;
          }
          case 'QuoteMark': {
            if (cursorIsHere) return;
            const next = doc.sliceString(node.to, Math.min(node.to + 1, doc.length));
            const to = next === ' ' ? node.to + 1 : node.to;
            spans.push({ from: node.from, to, deco: Decoration.replace({}) });
            return;
          }
          case 'ListMark': {
            const ch = doc.sliceString(node.from, node.from + 1);
            if (ch === '-' || ch === '*' || ch === '+') {
              if (cursorIsHere) return;
              spans.push({
                from: node.from,
                to: node.to,
                deco: Decoration.replace({ widget: new BulletWidget() }),
              });
            } else {
              spans.push({
                from: node.from,
                to: node.to,
                deco: Decoration.mark({ class: 'cm-list-number' }),
              });
            }
            return;
          }
          case 'TaskMarker': {
            if (cursorIsHere) return;
            const raw = doc.sliceString(node.from, node.to).toLowerCase();
            spans.push({
              from: node.from,
              to: node.to,
              deco: Decoration.replace({
                widget: new TaskWidget(raw.includes('x'), node.from, node.to),
              }),
            });
            return;
          }
          case 'HorizontalRule': {
            if (cursorIsHere) return;
            spans.push({
              from: node.from,
              to: node.to,
              deco: Decoration.replace({ widget: new HrWidget() }),
            });
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
          case 'Strikethrough':
            spans.push({
              from: node.from,
              to: node.to,
              deco: Decoration.mark({ class: 'cm-strike' }),
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
          case 'SetextHeading1':
          case 'SetextHeading2': {
            const level = node.name === 'SetextHeading1' ? 1 : 2;
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

  for (const l of quoteLines) {
    const line = doc.line(l);
    spans.push({
      from: line.from,
      to: line.from,
      deco: Decoration.line({ class: 'cm-blockquote-line' }),
    });
  }

  spans.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const s of spans) {
    b.add(s.from, s.to, s.deco);
  }
  return b.finish();
}
