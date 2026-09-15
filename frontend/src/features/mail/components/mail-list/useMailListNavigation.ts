import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';

import { subscribeWindowEvent } from '../../../../shared/platform/browser-events';
import { mailListMessageIdentity } from './mailListModel';
import type { MailListMessage } from './mailListTypes';

interface MailListNavigationOptions {
  readonly blocked: boolean;
  readonly listRef: RefObject<HTMLDivElement | null>;
  readonly messages: readonly MailListMessage[];
  readonly onSelectMail: (message: MailListMessage) => void;
  readonly onTrashMessage: (message: MailListMessage) => void;
  readonly onTrashSelected: () => void;
  readonly scope: string;
  readonly selectedIds: ReadonlySet<string>;
  readonly selectedMailIdentity?: string;
  readonly setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
}

function isInteractive(element: Element | null): boolean {
  return element instanceof HTMLElement && (
    ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(element.tagName)
    || element.isContentEditable
    || Boolean(element.closest('[role="dialog"], [role="menu"], [contenteditable="true"]'))
  );
}

export function useMailListNavigation(options: MailListNavigationOptions) {
  const { listRef, messages, scope, selectedMailIdentity } = options;
  const [focus, setFocus] = useState<{ identity: string; scope: string } | null>(null);
  const current = useRef(options);
  const focusedRef = useRef(selectedMailIdentity);
  const pending = useRef<{ identity: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const focusedIdentity = focus?.scope === scope ? focus.identity : selectedMailIdentity;
  const focusedIndex = messages.findIndex(message => mailListMessageIdentity(message) === focusedIdentity);
  const cancelOpening = useCallback(() => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
  }, []);

  useEffect(() => { current.current = options; });
  useEffect(() => { focusedRef.current = focusedIdentity; }, [focusedIdentity]);
  useEffect(() => cancelOpening, [cancelOpening, scope]);
  useEffect(() => {
    if (options.blocked || (pending.current && !messages.some(message => (
      mailListMessageIdentity(message) === pending.current?.identity
    )))) cancelOpening();
  }, [cancelOpening, messages, options.blocked]);
  useEffect(() => {
    if (!selectedMailIdentity) return;
    let active = true;
    queueMicrotask(() => {
      if (active && !pending.current) setFocus({ identity: selectedMailIdentity, scope });
    });
    return () => { active = false; };
  }, [scope, selectedMailIdentity]);
  useEffect(() => {
    if (focusedIndex < 0) return;
    listRef.current?.querySelector(`[data-mail-index="${String(focusedIndex)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex, listRef]);

  const selectMail = useCallback((message: MailListMessage) => {
    cancelOpening();
    const identity = mailListMessageIdentity(message);
    focusedRef.current = identity;
    setFocus({ identity, scope: current.current.scope });
    current.current.onSelectMail(message);
  }, [cancelOpening]);

  useEffect(() => subscribeWindowEvent('keydown', event => {
    const state = current.current;
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || state.blocked) return;
    const isDeleteKey = event.key === 'Delete' || event.key === 'Backspace';
    if (isInteractive(document.activeElement) && !(isDeleteKey && state.selectedIds.size > 0)) return;
    const index = state.messages.findIndex(message => mailListMessageIdentity(message) === focusedRef.current);
    const message = state.messages[index];
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!state.messages.length) return;
      event.preventDefault();
      const nextIndex = index < 0 ? 0 : Math.max(0, Math.min(
        state.messages.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1),
      ));
      const next = state.messages[nextIndex];
      if (!next) return;
      const identity = mailListMessageIdentity(next);
      if (pending.current?.identity === identity) return;
      cancelOpening();
      focusedRef.current = identity;
      setFocus({ identity, scope: state.scope });
      pending.current = { identity, timer: setTimeout(() => {
        pending.current = null;
        const latest = current.current;
        const target = latest.messages.find(item => mailListMessageIdentity(item) === identity);
        if (target && latest.scope === state.scope && !latest.blocked && !isInteractive(document.activeElement)) {
          selectMail(target);
        }
      }, 500) };
    } else if (event.key === ' ' && message) {
      event.preventDefault();
      cancelOpening();
      const identity = mailListMessageIdentity(message);
      state.setSelectedIds(previous => {
        const next = new Set(previous);
        if (next.has(identity)) next.delete(identity); else next.add(identity);
        return next;
      });
    } else if (event.key === 'Enter' && message) {
      event.preventDefault();
      selectMail(message);
    } else if (isDeleteKey && (state.selectedIds.size > 0 || message)) {
      event.preventDefault();
      cancelOpening();
      if (state.selectedIds.size > 0) state.onTrashSelected();
      else if (message) {
        const next = state.messages[index + 1] ?? state.messages[index - 1];
        if (next) {
          const identity = mailListMessageIdentity(next);
          focusedRef.current = identity;
          setFocus({ identity, scope: state.scope });
        }
        state.onTrashMessage(message);
      }
    }
  }), [cancelOpening, selectMail]);

  useEffect(() => {
    const stopBlur = subscribeWindowEvent('blur', cancelOpening);
    const stopFocus = subscribeWindowEvent('focusin', () => {
      if (isInteractive(document.activeElement)) cancelOpening();
    });
    const stopPointer = subscribeWindowEvent('pointerdown', event => {
      if (event.target instanceof Node && !listRef.current?.contains(event.target)) cancelOpening();
    });
    return () => { stopBlur(); stopFocus(); stopPointer(); cancelOpening(); };
  }, [cancelOpening, listRef]);

  return { focusedIndex, selectMail };
}
