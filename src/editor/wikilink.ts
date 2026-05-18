import type { MarkdownConfig } from '@lezer/markdown';

/**
 * Lezer-markdown extension that parses `[[Target]]`, `[[Target|Display]]`,
 * `[[Target#anchor]]` and `![[Target]]` into a Wikilink (or WikilinkEmbed)
 * AST node. Used by the Live Preview ViewPlugin to attach widgets.
 */
export const wikilinkParser: MarkdownConfig = {
  defineNodes: ['Wikilink', 'WikilinkEmbed', 'WikilinkMark', 'WikilinkTarget'],
  parseInline: [
    {
      name: 'WikilinkEmbed',
      parse(cx, next, pos) {
        if (next !== 33 /* ! */) return -1;
        const offset = pos - cx.offset;
        const src = cx.text;
        if (src.charCodeAt(offset + 1) !== 91 || src.charCodeAt(offset + 2) !== 91) {
          return -1;
        }
        const closeRel = src.indexOf(']]', offset + 3);
        if (closeRel < 0) return -1;
        if (src.lastIndexOf('\n', closeRel) > offset) return -1;
        const innerStart = pos + 3;
        const innerEnd = cx.offset + closeRel;
        const close = innerEnd + 2;
        return cx.addElement(
          cx.elt('WikilinkEmbed', pos, close, [
            cx.elt('WikilinkMark', pos, pos + 3),
            cx.elt('WikilinkTarget', innerStart, innerEnd),
            cx.elt('WikilinkMark', innerEnd, close),
          ]),
        );
      },
      before: 'Image',
    },
    {
      name: 'Wikilink',
      parse(cx, next, pos) {
        if (next !== 91 /* [ */) return -1;
        const offset = pos - cx.offset;
        const src = cx.text;
        if (src.charCodeAt(offset + 1) !== 91) return -1;
        const closeRel = src.indexOf(']]', offset + 2);
        if (closeRel < 0) return -1;
        if (src.lastIndexOf('\n', closeRel) > offset) return -1;
        const innerStart = pos + 2;
        const innerEnd = cx.offset + closeRel;
        const close = innerEnd + 2;
        return cx.addElement(
          cx.elt('Wikilink', pos, close, [
            cx.elt('WikilinkMark', pos, pos + 2),
            cx.elt('WikilinkTarget', innerStart, innerEnd),
            cx.elt('WikilinkMark', innerEnd, close),
          ]),
        );
      },
      before: 'Link',
    },
  ],
};
