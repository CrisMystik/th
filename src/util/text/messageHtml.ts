import type { ApiFormattedText, ApiMessageEntity } from '../../api/types';
import { ApiMessageEntityTypes as Entity } from '../../api/types';

import { ENTITY_CLASS_BY_NODE_NAME } from '../../components/middle/composer/helpers/cleanHtml';

export function escapeMessageHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeMessageAttribute(value: string) {
  return escapeMessageHtml(value).replace(/"/g, '&quot;');
}

export function getHtmlDateFormat(date: {
  relative?: true; dayOfWeek?: true; shortDate?: true; longDate?: true; shortTime?: true; longTime?: true;
}) {
  return [
    date.relative && 'r', date.dayOfWeek && 'w', date.shortDate && 'd', date.longDate && 'D',
    date.shortTime && 't', date.longTime && 'T',
  ].filter(Boolean).join('');
}

// Adapted from ToHtmlBot. Split crossing entity ranges into properly nested tags.
export function serializeFormattedHtml({ text, entities = [] }: ApiFormattedText) {
  const spans = entities.flatMap((entity) => {
    const tags = getEntityTags(entity, text);
    const start = Math.max(0, entity.offset);
    const end = Math.min(text.length, entity.offset + entity.length);
    return tags && start < end ? [{ start, end, tags }] : [];
  }).sort((left, right) => left.start - right.start || right.end - left.end);
  const boundaries = Array.from(new Set([0, text.length, ...spans.flatMap(({ start, end }) => [start, end])]))
    .sort((left, right) => left - right);
  let open: typeof spans = [];
  let html = '';
  boundaries.forEach((start, index) => {
    const active = spans.filter((span) => span.start <= start && start < span.end);
    let shared = 0;
    while (shared < open.length && open[shared] === active[shared]) shared++;
    html += open.slice(shared).reverse().map(({ tags }) => tags[1]).join('');
    html += active.slice(shared).map(({ tags }) => tags[0]).join('');
    if (index + 1 < boundaries.length) html += escapeMessageHtml(text.slice(start, boundaries[index + 1]));
    open = active;
  });
  return html;
}

function getEntityTags(entity: ApiMessageEntity, text: string): [string, string] | undefined {
  const value = text.slice(entity.offset, entity.offset + entity.length);
  const attribute = escapeMessageAttribute;
  switch (entity.type) {
    case Entity.Bold: return ['<b>', '</b>'];
    case Entity.Italic: return ['<i>', '</i>'];
    case Entity.Underline: return ['<u>', '</u>'];
    case Entity.Strike: return ['<s>', '</s>'];
    case Entity.Code: return ['<code>', '</code>'];
    case Entity.Pre: return [
      '<pre><code' + (entity.language ? ' class="language-' + attribute(entity.language) + '"' : '') + '>',
      '</code></pre>',
    ];
    case Entity.Spoiler: return ['<tg-spoiler>', '</tg-spoiler>'];
    case Entity.Blockquote: return [entity.canCollapse ? '<blockquote expandable>' : '<blockquote>', '</blockquote>'];
    case Entity.CustomEmoji: return ['<tg-emoji emoji-id="' + attribute(entity.documentId) + '">', '</tg-emoji>'];
    case Entity.MentionName: return ['<a href="tg://user?id=' + attribute(entity.userId) + '">', '</a>'];
    case Entity.TextUrl: return ['<a href="' + attribute(entity.url) + '">', '</a>'];
    case Entity.Email: return ['<a href="mailto:' + attribute(value) + '">', '</a>'];
    case Entity.Phone: return ['<a href="tel:' + attribute(value) + '">', '</a>'];
    case Entity.FormattedDate: return [
      '<tg-time unix="' + entity.date + '" format="' + getHtmlDateFormat(entity) + '">', '</tg-time>',
    ];
    default: return undefined;
  }
}

const BLOCK_TAGS = new Set(['P', 'DIV']);
const IGNORED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT']);

export function parseMessageHtml(html: string): ApiFormattedText {
  // Template contents stay inert, including media URLs in pasted source.
  const template = document.createElement('template');
  template.innerHTML = html.replace(/(<pre\b[^>]*>)(?=\n)/gi, '$1\n');
  const entities: ApiMessageEntity[] = [];
  const scopes: { offset?: number }[] = [];
  let text = '';
  let needsNewline = false;

  function append(value: string) {
    if (!value) return;
    if (needsNewline && text && !text.endsWith('\n') && !value.startsWith('\n')) text += '\n';
    needsNewline = false;
    scopes.forEach((scope) => {
      scope.offset ??= text.length;
    });
    text += value;
  }

  function visit(node: Node, isPre = false) {
    if (node.nodeType === Node.TEXT_NODE) {
      append(node.nodeValue || '');
      return;
    }
    if (!(node instanceof Element) || IGNORED_TAGS.has(node.tagName)) return;
    const tag = node.tagName;
    if (tag === 'BR') {
      append('\n');
      return;
    }
    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) needsNewline = true;
    const scope: { offset?: number } = {};
    scopes.push(scope);
    node.childNodes.forEach((child) => visit(child, isPre || tag === 'PRE'));
    scopes.pop();
    if (scope.offset === undefined) return;
    const entity = getTagEntity(node, scope.offset, text.slice(scope.offset), isPre);
    if (entity) entities.push(entity);
    if (isBlock) needsNewline = true;
  }

  template.content.childNodes.forEach((node) => visit(node));
  entities.sort((left, right) => left.offset - right.offset || right.length - left.length);
  return { text, entities: entities.length ? entities : undefined };
}

function getTagEntity(node: Element, offset: number, value: string, isPre: boolean): ApiMessageEntity | undefined {
  const tag = node.tagName;
  const range = { offset, length: value.length };
  if (tag === 'A') {
    const url = node.getAttribute('href')?.trim();
    if (!url || !/^(https?:|tg:|mailto:|tel:|ftp:)/i.test(url)) return undefined;
    const mention = /^tg:\/\/user\?id=(\d+)$/i.exec(url);
    if (mention) return { ...range, type: Entity.MentionName, userId: mention[1] };
    if (url === 'mailto:' + value) return { ...range, type: Entity.Email };
    if (url === 'tel:' + value) return { ...range, type: Entity.Phone };
    return { ...range, type: Entity.TextUrl, url };
  }
  if (tag === 'TG-EMOJI') {
    const documentId = node.getAttribute('emoji-id');
    return documentId && /^\d+$/.test(documentId) ? { ...range, type: Entity.CustomEmoji, documentId } : undefined;
  }
  if (tag === 'TG-TIME') {
    const unix = node.getAttribute('unix');
    const date = Number(unix);
    if (!unix || !Number.isSafeInteger(date)) return undefined;
    const format = node.getAttribute('format') || '';
    return {
      ...range,
      type: Entity.FormattedDate,
      date,
      relative: format.includes('r') || undefined,
      dayOfWeek: format.includes('w') || undefined,
      shortDate: format.includes('d') || undefined,
      longDate: format.includes('D') || undefined,
      shortTime: format.includes('t') || undefined,
      longTime: format.includes('T') || undefined,
    };
  }
  if (tag === 'TG-SPOILER' || (tag === 'SPAN' && node.classList.contains('tg-spoiler'))) {
    return { ...range, type: Entity.Spoiler };
  }
  const type = ENTITY_CLASS_BY_NODE_NAME[tag];
  switch (type) {
    case Entity.Blockquote: return { ...range, type, canCollapse: node.hasAttribute('expandable') || undefined };
    case Entity.Pre: {
      const language = node.querySelector(':scope > code')?.className.match(/(?:^|\s)language-([^\s]+)/)?.[1];
      return { ...range, type, language };
    }
    case Entity.Code: return isPre ? undefined : { ...range, type };
    case Entity.Bold:
    case Entity.Italic:
    case Entity.Underline:
    case Entity.Strike: return { ...range, type };
    default: return undefined;
  }
}
