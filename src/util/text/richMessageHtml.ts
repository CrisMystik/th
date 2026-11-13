import type {
  ApiPageBlock,
  ApiPageCaption,
  ApiRichButton,
  ApiRichText,
} from '../../api/types';

import { escapeMessageAttribute as attr, escapeMessageHtml as escape, getHtmlDateFormat } from './messageHtml';

const INLINE_TAGS = {
  bold: 'b', italic: 'i', underline: 'u', strike: 's', fixed: 'code',
  subscript: 'sub', superscript: 'sup', marked: 'mark', spoiler: 'tg-spoiler',
} as const;

function wrap(tag: string, content: string, attributes = '') {
  return '<' + tag + attributes + '>' + content + '</' + tag + '>';
}

const INDENT_WIDTH = 2;

function indent(content: string, spaces: number) {
  return content ? ' '.repeat(spaces) + content : '';
}

function joinIndented(parts: string[], spaces: number) {
  return parts.filter(Boolean).map((part) => indent(part, spaces)).join('\n');
}

function wrapMultiline(tag: string, content: string, spaces: number, attributes = '') {
  return wrap(tag, '\n' + content + '\n' + ' '.repeat(spaces), attributes);
}

function attribute(name: string, value?: string | number) {
  return value === undefined ? '' : ' ' + name + '="' + attr(String(value)) + '"';
}

function flag(name: string, value?: boolean) {
  return value ? ' ' + name : '';
}

function serializeButton(button: ApiRichButton) {
  const { action, style } = button;
  let attributes = attribute('style', style?.type === 'destructive' ? 'danger' : style?.type);

  switch (action.type) {
    case 'url':
      attributes += attribute('type', 'url') + attribute('url', action.url);
      break;

    case 'webView':
      attributes += attribute('type', 'web_app') + attribute('url', action.url);
      break;

    case 'copy':
      attributes += attribute('type', 'copy_text') + attribute('text', action.copyText);
      break;

    case 'switchBotInline':
      attributes += attribute('type', action.isSamePeer ? 'switch_inline_query_current_chat' : 'switch_inline_query')
        + attribute('query', action.query);
      break;

    case 'userProfile':
      attributes += attribute('type', 'url') + attribute('url', 'tg://user?id=' + action.userId);
      break;

    case 'disabled':
      attributes += attribute('type', 'disabled');
      break;

    default:
      throw new Error('Unsupported rich button');
  }

  return wrap('tg-button', serializeText(button.text), attributes);
}

function serializeText(value: ApiRichText, isPre = false): string {
  switch (value.type) {
    case 'empty':
      return '';

    case 'plain':
      return isPre ? escape(value.text) : escape(value.text).replace(/\n/g, '<br>\n');

    case 'concat':
      return value.texts.map((item) => serializeText(item, isPre)).join('');

    case 'bold':
    case 'italic':
    case 'underline':
    case 'strike':
    case 'fixed':
    case 'subscript':
    case 'superscript':
    case 'marked':
    case 'spoiler':
      return wrap(INLINE_TAGS[value.type], serializeText(value.text, isPre));

    case 'url':
      return wrap('a', serializeText(value.text, isPre), attribute('href', value.url));

    case 'email':
      return wrap('a', serializeText(value.text, isPre), attribute('href', 'mailto:' + value.email));

    case 'phone':
      return wrap('a', serializeText(value.text, isPre), attribute('href', 'tel:' + value.phone));

    case 'mentionName':
      return wrap('a', serializeText(value.text, isPre), attribute('href', 'tg://user?id=' + value.userId));

    case 'anchor':
      return wrap('a', '', attribute('name', value.name)) + serializeText(value.text, isPre);

    case 'math':
      return wrap('tg-math', escape(value.source));

    case 'customEmoji':
      return wrap('tg-emoji', escape(value.alt), attribute('emoji-id', value.documentId));

    case 'date': {
      const attributes = attribute('unix', value.date) + attribute('format', getHtmlDateFormat(value) || undefined);

      return wrap('tg-time', serializeText(value.text, isPre), attributes);
    }

    case 'button':
      return serializeButton(value);

    case 'image':
      throw new Error('Unsupported inline image');

    default:
      return serializeText(value.text, isPre);
  }
}

function cite(value: ApiRichText) {
  const html = serializeText(value);
  return html ? wrap('cite', html) : '';
}

function caption(value: ApiPageCaption) {
  const html = serializeText(value.text) + cite(value.credit);
  return html ? wrap('figcaption', html) : '';
}

function figure(html: string, value: ApiPageCaption, spaces: number) {
  const label = caption(value);
  const content = joinIndented([html, label], spaces + INDENT_WIDTH);

  return label ? wrapMultiline('figure', content, spaces) : html;
}

function mediaSource(kind: string, id?: string) {
  if (!id) {
    throw new Error('Missing rich media reference');
  }

  return attribute('src', 'tg://' + kind + '?id=' + (kind === 'photo' ? 'photo_' : 'document_') + id);
}

// Adapted from ToHtmlBot's rich text and rich block serializers.
export function serializeRichHtml(blocks: ApiPageBlock[], spaces = 0): string {
  return blocks.map((block) => indent(serializeBlock(block, spaces), spaces)).join('\n');
}

function serializeBlock(block: ApiPageBlock, spaces: number): string {
  const childSpaces = spaces + INDENT_WIDTH;

  switch (block.type) {
    case 'paragraph':
      return wrap('p', serializeText(block.text));

    case 'title':
    case 'header':
      return wrap('h1', serializeText(block.text));

    case 'subtitle':
    case 'subheader':
      return wrap('h2', serializeText(block.text));

    case 'heading1':
    case 'heading2':
    case 'heading3':
    case 'heading4':
    case 'heading5':
    case 'heading6':
      return wrap('h' + block.type.slice(-1), serializeText(block.text));

    case 'preformatted': {
      const language = attribute('class', block.language ? 'language-' + block.language : undefined);

      return wrap('pre', wrap('code', serializeText(block.text, true), language));
    }

    case 'footer':
      return wrap('footer', serializeText(block.text));

    case 'thinking':
      return wrapMultiline('tg-thinking', indent(serializeText(block.text), childSpaces), spaces);

    case 'divider':
      return '<hr>';

    case 'math':
      return wrap('tg-math-block', escape(block.source));

    case 'anchor':
      return wrap('a', '', attribute('name', block.name));

    case 'blockquote': {
      const credit = cite(block.caption);
      const content = joinIndented([serializeText(block.text), credit], childSpaces);

      return wrapMultiline('blockquote', content, spaces, flag('expandable', block.canCollapse));
    }

    case 'blockquoteBlocks': {
      const children = serializeRichHtml(block.blocks, childSpaces);
      const credit = indent(cite(block.caption), childSpaces);
      const content = [children, credit].filter(Boolean).join('\n');

      return wrapMultiline('blockquote', content, spaces);
    }

    case 'pullquote':
      return wrapMultiline('aside', joinIndented([serializeText(block.text), cite(block.caption)], childSpaces), spaces);

    case 'details': {
      const summary = wrap('summary', serializeText(block.title));
      const children = serializeRichHtml(block.blocks, childSpaces);
      const content = [indent(summary, childSpaces), children].filter(Boolean).join('\n');

      return wrapMultiline('details', content, spaces, flag('open', block.isOpen));
    }

    case 'list':
    case 'orderedList': {
      const items = block.items.map((item) => {
        const checkbox = item.isCheckbox ? '<input type="checkbox"' + flag('checked', item.isChecked) + '>' : '';
        const attributes = ('value' in item ? attribute('value', item.value) : '')
          + ('orderType' in item ? attribute('type', item.orderType) : '');
        if (item.type === 'blocks') {
          const itemSpaces = childSpaces + INDENT_WIDTH;
          const children = serializeRichHtml(item.blocks, itemSpaces);
          const content = [indent(checkbox, itemSpaces), children].filter(Boolean).join('\n');

          return indent(wrapMultiline('li', content, childSpaces, attributes), childSpaces);
        }

        return indent(wrap('li', checkbox + serializeText(item.text), attributes), childSpaces);
      }).join('\n');
      if (block.type === 'list') {
        return wrapMultiline('ul', items, spaces);
      }

      const attributes = attribute('start', block.start)
        + attribute('type', block.orderType)
        + flag('reversed', block.isReversed);

      return wrapMultiline('ol', items, spaces, attributes);
    }

    case 'table': {
      const title = serializeText(block.title);
      const rows = block.rows.map(({ cells }) => {
        const content = cells.map((cell) => {
          const tag = cell.isHeader ? 'th' : 'td';
          const html = cell.text ? serializeText(cell.text) : '';
          const align = cell.alignCenter ? 'center' : cell.alignRight ? 'right' : undefined;
          const valign = cell.verticalAlignMiddle ? 'middle' : cell.verticalAlignBottom ? 'bottom' : undefined;
          const attributes = attribute('colspan', cell.colspan)
            + attribute('rowspan', cell.rowspan)
            + attribute('align', align)
            + attribute('valign', valign);

          return indent(wrap(tag, html, attributes), childSpaces + INDENT_WIDTH);
        }).join('\n');

        return indent(wrapMultiline('tr', content, childSpaces), childSpaces);
      }).join('\n');
      const content = [title ? indent(wrap('caption', title), childSpaces) : '', rows].filter(Boolean).join('\n');
      const attributes = flag('bordered', block.isBordered)
        + flag('striped', block.isStriped)
        + flag('compact', block.isCompact);

      return wrapMultiline('table', content, spaces, attributes);
    }

    case 'collage':
    case 'slideshow':
      return wrapMultiline(
        'tg-' + block.type,
        [serializeRichHtml(block.items, childSpaces), indent(caption(block.caption), childSpaces)]
          .filter(Boolean).join('\n'),
        spaces,
      );

    case 'photo': {
      const attributes = mediaSource('photo', block.photo.id) + flag('tg-spoiler', block.isSpoiler);

      return figure('<img' + attributes + '>', block.caption, spaces);
    }

    case 'video': {
      const attributes = mediaSource('video', block.video.id) + flag('tg-spoiler', block.isSpoiler);

      return figure(wrap('video', '', attributes), block.caption, spaces);
    }

    case 'audio':
      return figure(wrap('audio', '', mediaSource('audio', block.audio.id)), block.caption, spaces);

    case 'document':
      return figure(wrap('tg-document', '', mediaSource('document', block.document.id)), block.caption, spaces);

    case 'map': {
      if (!block.geo) {
        throw new Error('Missing map coordinates');
      }

      const attributes = attribute('lat', block.geo.lat)
        + attribute('long', block.geo.long)
        + attribute('zoom', block.zoom);

      return figure(wrap('tg-map', '', attributes), block.caption, spaces);
    }

    case 'buttonRow': {
      const content = joinIndented(block.buttons.map(serializeButton), childSpaces);

      return wrapMultiline('tg-button-row', content, spaces, attribute('align', block.align));
    }

    default:
      throw new Error('Unsupported rich block');
  }
}
