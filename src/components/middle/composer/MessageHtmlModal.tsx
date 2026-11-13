import {
  memo, useMemo, useRef, useState,
} from '../../../lib/teact/teact';

import type { RegularLangKey } from '../../../types/language';

import useLang from '../../../hooks/useLang';
import useLastCallback from '../../../hooks/useLastCallback';

import Button from '../../ui/Button';
import Modal from '../../ui/Modal';

import styles from './MessageHtmlModal.module.scss';

type OwnProps = {
  title: RegularLangKey;
  submitLabel: RegularLangKey;
  initialValue: string;
  onClose: NoneToVoidFunction;
  onSubmit: (value: string) => boolean | Promise<boolean | string>;
};

const HTML_TOKEN = /<!--[\s\S]*?(?:-->|$)|<\/?[\w:-]+(?:[^"'<>]|"[^"]*"|'[^']*')*>|&(?:#x[\da-f]+|#\d+|\w+);/gi;
const ATTRIBUTE_VALUE = /"[^"]*"|'[^']*'/g;

function highlightHtml(value: string) {
  const parts = [];
  let offset = 0;
  for (const match of value.matchAll(HTML_TOKEN)) {
    const [token] = match;
    parts.push(value.slice(offset, match.index));
    offset = match.index + token.length;
    if (token[0] !== '<' || token.startsWith('<!--')) {
      parts.push(<span className={token[0] === '<' ? styles.comment : styles.entity}>{token}</span>);
      continue;
    }
    const tagParts = [];
    let tagOffset = 0;
    for (const part of token.matchAll(ATTRIBUTE_VALUE)) {
      tagParts.push(token.slice(tagOffset, part.index), <span className={styles.attribute}>{part[0]}</span>);
      tagOffset = part.index + part[0].length;
    }
    tagParts.push(token.slice(tagOffset));
    parts.push(<span className={styles.tag}>{tagParts}</span>);
  }
  parts.push(value.slice(offset), '\n');
  return parts;
}

const MessageHtmlModal = ({
  title, submitLabel, initialValue, onClose, onSubmit,
}: OwnProps) => {
  const lang = useLang();
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);
  const isSavingRef = useRef(false);
  const highlightRef = useRef<HTMLPreElement>();
  const highlighted = useMemo(() => highlightHtml(value), [value]);

  const handleInput = useLastCallback((event: React.FormEvent<HTMLTextAreaElement>) => {
    setValue(event.currentTarget.value);
    setError(undefined);
  });

  const handleScroll = useLastCallback((event: React.UIEvent<HTMLTextAreaElement>) => {
    const { scrollTop, scrollLeft } = event.currentTarget;
    highlightRef.current?.scrollTo(scrollLeft, scrollTop);
  });

  const handleClose = useLastCallback(() => {
    if (!isSavingRef.current) onClose();
  });

  const handleSubmit = useLastCallback(async () => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setIsSaving(true);
    setError(undefined);
    try {
      const result = await onSubmit(value);
      if (result === true) onClose();
      else setError(typeof result === 'string' ? result : lang('MessageHtmlInvalid'));
    } catch {
      setError(lang('MessageHtmlSaveFailed'));
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  });

  return (
    <Modal
      isOpen
      hasCloseButton
      noBackdropClose
      title={lang(title)}
      onClose={handleClose}
      className={styles.root}
      dialogClassName={styles.dialog}
      contentClassName={styles.content}
    >
      <div className={styles.editor}>
        <pre ref={highlightRef} className={styles.highlight} aria-hidden>{highlighted}</pre>
        <textarea
          className={styles.input}
          aria-label={lang('MessageHtmlSource')}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          dir="ltr"
          wrap="off"
          value={value}
          readOnly={isSaving}
          onInput={handleInput}
          onScroll={handleScroll}
        />
      </div>
      {error && <div className={styles.error} role="alert">{error}</div>}
      <div className={styles.actions}>
        <Button color="translucent" disabled={isSaving} onClick={handleClose}>{lang('Cancel')}</Button>
        <Button isLoading={isSaving} onClick={handleSubmit}>{lang(submitLabel)}</Button>
      </div>
    </Modal>
  );
};

export default memo(MessageHtmlModal);
