import type {
  ApiPageBlock, ApiPageCaption, ApiRichButton, ApiRichText,
} from '../../api/types';

import { escapeMessageAttribute as attr, escapeMessageHtml as escape, getHtmlDateFormat } from './messageHtml';

const INLINE_TAGS = {
  bold: 'b', italic: 'i', underline: 'u', strike: 's', fixed: 'code',
  subscript: 'sub', superscript: 'sup', marked: 'mark', spoiler: 'tg-spoiler',
} as const;

function wrap(tag: string, content: string, attributes = '') {
  return '<' + tag + attributes + '>' + content + '</' + tag + '>';
}

function wrapMultiline(tag: string, content: string, attributes = '') {
  return wrap(tag, '\n' + content + '\n', attributes);
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
    case 'empty': return '';
    case 'plain': return isPre ? escape(value.text) : escape(value.text).replace(/\n/g, '<br>\n');
    case 'concat': return value.texts.map((item) => serializeText(item, isPre)).join('');
    case 'bold': case 'italic': case 'underline': case 'strike': case 'fixed':
    case 'subscript': case 'superscript': case 'marked': case 'spoiler':
      return wrap(INLINE_TAGS[value.type], serializeText(value.text, isPre));
    case 'url': return wrap('a', serializeText(value.text, isPre), attribute('href', value.url));
    case 'email': return wrap('a', serializeText(value.text, isPre), attribute('href', 'mailto:' + value.email));
    case 'phone': return wrap('a', serializeText(value.text, isPre), attribute('href', 'tel:' + value.phone));
    case 'mentionName':
      return wrap('a', serializeText(value.text, isPre), attribute('href', 'tg://user?id=' + value.userId));
    case 'anchor': return wrap('a', '', attribute('name', value.name)) + serializeText(value.text, isPre);
    case 'math': return wrap('tg-math', escape(value.source));
    case 'customEmoji': return wrap('tg-emoji', escape(value.alt), attribute('emoji-id', value.documentId));
    case 'date':
      return wrap('tg-time', serializeText(value.text, isPre),
        attribute('unix', value.date) + attribute('format', getHtmlDateFormat(value) || undefined));
    case 'button': return serializeButton(value);
    case 'image': throw new Error('Unsupported inline image');
    default: return serializeText(value.text, isPre);
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

function figure(html: string, value: ApiPageCaption) {
  const label = caption(value);
  return label ? wrapMultiline('figure', html + '\n' + label) : html;
}

function mediaSource(kind: string, id?: string) {
  if (!id) throw new Error('Missing rich media reference');
  return attribute('src', 'tg://' + kind + '?id=' + (kind === 'photo' ? 'photo_' : 'document_') + id);
}

// Adapted from ToHtmlBot's rich text and rich block serializers.
export function serializeRichHtml(blocks: ApiPageBlock[]): string {
  return blocks.map(serializeBlock).join('\n');
}

function serializeBlock(block: ApiPageBlock): string {
  switch (block.type) {
    case 'paragraph': return wrap('p', serializeText(block.text));
    case 'title': case 'header': return wrap('h1', serializeText(block.text));
    case 'subtitle': case 'subheader': return wrap('h2', serializeText(block.text));
    case 'heading1': case 'heading2': case 'heading3': case 'heading4': case 'heading5': case 'heading6':
      return wrap('h' + block.type.slice(-1), serializeText(block.text));
    case 'preformatted':
      return wrap('pre', wrap('code', serializeText(block.text, true),
        attribute('class', block.language ? 'language-' + block.language : undefined)));
    case 'footer': return wrap('footer', serializeText(block.text));
    case 'thinking': return wrapMultiline('tg-thinking', serializeText(block.text));
    case 'divider': return '<hr>';
    case 'math': return wrap('tg-math-block', escape(block.source));
    case 'anchor': return wrap('a', '', attribute('name', block.name));
    case 'blockquote': {
      const credit = cite(block.caption);
      return wrapMultiline('blockquote', [serializeText(block.text), credit].filter(Boolean).join('\n'),
        flag('expandable', block.canCollapse));
    }
    case 'blockquoteBlocks': return wrapMultiline('blockquote', serializeRichHtml(block.blocks) + cite(block.caption));
    case 'pullquote':
      return wrapMultiline('aside', [serializeText(block.text), cite(block.caption)].filter(Boolean).join('\n'));
    case 'details':
      return wrapMultiline('details', wrap('summary', serializeText(block.title)) + '\n' + serializeRichHtml(block.blocks),
        flag('open', block.isOpen));
    case 'list': case 'orderedList': {
      const items = block.items.map((item) => {
        const checkbox = item.isCheckbox ? '<input type="checkbox"' + flag('checked', item.isChecked) + '>' : '';
        const html = item.type === 'blocks' ? serializeRichHtml(item.blocks) : serializeText(item.text);
        const attributes = ('value' in item ? attribute('value', item.value) : '')
          + ('orderType' in item ? attribute('type', item.orderType) : '');
        return wrap('li', checkbox + html, attributes);
      }).join('\n');
      return block.type === 'list' ? wrapMultiline('ul', items) : wrapMultiline('ol', items,
        attribute('start', block.start) + attribute('type', block.orderType) + flag('reversed', block.isReversed));
    }
    case 'table': {
      const title = serializeText(block.title);
      const rows = block.rows.map(({ cells }) => wrap('tr', cells.map((cell) => '\n' + wrap(
        cell.isHeader ? 'th' : 'td', cell.text ? serializeText(cell.text) : '',
        attribute('colspan', cell.colspan) + attribute('rowspan', cell.rowspan)
        + attribute('align', cell.alignCenter ? 'center' : cell.alignRight ? 'right' : undefined)
        + attribute('valign', cell.verticalAlignMiddle ? 'middle' : cell.verticalAlignBottom ? 'bottom' : undefined),
      )).join('') + '\n')).join('\n');
      return wrapMultiline('table', [title ? wrap('caption', title) : '', rows].filter(Boolean).join('\n'),
        flag('bordered', block.isBordered) + flag('striped', block.isStriped) + flag('compact', block.isCompact));
    }
    case 'collage': case 'slideshow':
      return wrapMultiline('tg-' + block.type, serializeRichHtml(block.items) + caption(block.caption));
    case 'photo':
      return figure('<img' + mediaSource('photo', block.photo.id) + flag('tg-spoiler', block.isSpoiler) + '>',
        block.caption);
    case 'video':
      return figure(wrap('video', '', mediaSource('video', block.video.id) + flag('tg-spoiler', block.isSpoiler)),
        block.caption);
    case 'audio': return figure(wrap('audio', '', mediaSource('audio', block.audio.id)), block.caption);
    case 'document':
      return figure(wrap('tg-document', '', mediaSource('document', block.document.id)), block.caption);
    case 'map': {
      if (!block.geo) throw new Error('Missing map coordinates');
      return figure(wrap('tg-map', '', attribute('lat', block.geo.lat) + attribute('long', block.geo.long)
        + attribute('zoom', block.zoom)), block.caption);
    }
    case 'buttonRow':
      return wrapMultiline('tg-button-row', block.buttons.map(serializeButton).join('\n'), attribute('align', block.align));
    default: throw new Error('Unsupported rich block');
  }
}
