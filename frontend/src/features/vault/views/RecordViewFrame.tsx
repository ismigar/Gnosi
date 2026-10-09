import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { TableNavApi } from './vault-table/types';

interface Props {
  children: ReactNode;
  records: readonly { id: string; title?: unknown }[];
  navigation: RefObject<TableNavApi | null>;
  onOpen?: (id: string) => void;
  onExit?: () => void;
  adaptive?: boolean;
  registerNavApi?: (api: TableNavApi | null) => void;
}

/** A focusable entry/exit point, shared by full-page and embedded record views. */
export function RecordViewFrame({ children, records, navigation, onOpen, onExit, adaptive, registerNavApi }: Props) {
  const { t } = useTranslation();
  const shell = useRef<HTMLDivElement>(null);
  const [fallbackId, setFallbackId] = useState<string | null>(null);
  const current = records.find(record => record.id === fallbackId);
  const targets = () => Array.from(shell.current?.querySelectorAll<HTMLElement>('[data-record-id]') ?? [])
    .filter(element => element.closest('[data-record-view-shell]') === shell.current);
  const focus = (element: HTMLElement | undefined) => {
    if (!element) return false;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return true;
  };
  useEffect(() => {
    if (!registerNavApi) return;
    const enter = (last: boolean) => {
      const elements = Array.from(shell.current?.querySelectorAll<HTMLElement>('[data-record-id]') ?? []);
      const element = last ? elements.at(-1) : elements[0];
      if (element) { element.focus({ preventScroll: true }); element.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return true; }
      const record = last ? records.at(-1) : records[0];
      if (!record) return false;
      setFallbackId(record.id); shell.current?.focus(); return true;
    };
    registerNavApi({ focusFirstCell: () => enter(false), focusLastCell: () => enter(true) });
    return () => { registerNavApi(null); };
  }, [records, registerNavApi]);
  return <div ref={shell} tabIndex={0} data-record-view-shell
    aria-label={t('table.keyboard_navigation')}
    className={`min-h-0 min-w-0 flex flex-col ${adaptive ? '' : 'h-full flex-1'} outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--gnosi-primary)]`}
    onKeyDown={event => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.closest('[data-record-view-shell]') !== shell.current) return;
      if (target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      const atShell = target === event.currentTarget;
      if (event.key === 'Enter' && atShell) {
        event.preventDefault(); event.stopPropagation();
        if (current) { onOpen?.(current.id); return; }
        if (!navigation.current?.focusFirstCell() && !focus(targets()[0])) setFallbackId(records[0]?.id ?? null);
        return;
      }
      // The table owns cell editing, ranges and its own Escape handling.
      if (target.closest('[data-vault-table-scroll]')) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); setFallbackId(null);
        shell.current?.focus({ preventScroll: true }); onExit?.(); return;
      }
      if (target.closest('button, a')) return;
      if (event.key === 'Enter' && target.dataset.recordId) {
        event.preventDefault(); event.stopPropagation(); onOpen?.(target.dataset.recordId); return;
      }
      if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      if (atShell && !current) return;
      const elements = targets();
      const index = elements.indexOf(target);
      const delta = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1;
      if (index >= 0) {
        event.preventDefault(); event.stopPropagation();
        focus(elements[event.key === 'Home' ? 0 : event.key === 'End' ? elements.length - 1 : Math.max(0, Math.min(elements.length - 1, index + delta))]);
      } else if (current) {
        event.preventDefault(); event.stopPropagation();
        const row = records.indexOf(current);
        setFallbackId(records[event.key === 'Home' ? 0 : event.key === 'End' ? records.length - 1 : Math.max(0, Math.min(records.length - 1, row + delta))]?.id ?? null);
      }
    }}>
    {current && <div role="status" className="flex items-center gap-2 border-b border-[var(--border-primary)] px-3 py-1 text-sm text-[var(--text-secondary)]">
      <span>{records.indexOf(current) + 1} / {records.length}</span>
      <button type="button" onClick={() => onOpen?.(current.id)} className="truncate text-[var(--gnosi-primary)]">{typeof current.title === 'string' || typeof current.title === 'number' ? String(current.title) : current.id}</button>
    </div>}
    {children}
  </div>;
}
